#!/usr/bin/env node
/**
 * External site endpoint + public key / token scanner
 * Runs inside WebContainers (real fetch).
 *
 * Usage:
 *   node tools/scan.js <url>
 *   node tools/scan.js https://api.github.com
 *   node tools/scan.js https://httpbin.org --deep
 *
 * What it does (real HTTP):
 *   1. Fetches the base URL
 *   2. Checks common discovery paths (openapi, swagger, robots, well-known, etc.)
 *   3. Tries common API endpoint patterns
 *   4. Extracts endpoints from JSON / HTML / JS text patterns
 *   5. Finds public_key / api_key / access_token / jwt-like strings
 *
 * Limits:
 *   - CORS / network blocks can stop some sites (browser + WebContainer rules)
 *   - Does not brute-force private APIs or bypass auth
 *   - "Deep" mode only tries a safe fixed list of paths (not aggressive)
 */

const args = process.argv.slice(2)
const deep = args.includes('--deep')
const quiet = args.includes('--quiet')
const urlArg = args.find((a) => !a.startsWith('-'))

if (!urlArg || args.includes('-h') || args.includes('--help')) {
  console.log(`Usage: node tools/scan.js <url> [--deep] [--quiet]

Examples:
  node tools/scan.js https://httpbin.org
  node tools/scan.js https://api.github.com
  node tools/scan.js https://jsonplaceholder.typicode.com --deep
  node tools/scan.js http://localhost:3000 --deep

Options:
  --deep    Also probe a safe list of common API paths
  --quiet   Less verbose progress
`)
  process.exit(0)
}

function normalizeUrl(input) {
  let u = input.trim()
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  try {
    const parsed = new URL(u)
    // strip trailing slash for base
    if (parsed.pathname === '/') parsed.pathname = ''
    return parsed
  } catch {
    console.error('Invalid URL:', input)
    process.exit(1)
  }
}

const base = normalizeUrl(urlArg)
const origin = base.origin
const foundEndpoints = new Map() // path -> { method, source, status? }
const foundSecrets = [] // { path, key, value, source }

function addEndpoint(path, method = 'GET', source = 'discovered', status = null) {
  const key = method + ' ' + path
  if (!foundEndpoints.has(key)) {
    foundEndpoints.set(key, { method, path, source, status })
  }
}

function addSecret(keyName, value, source) {
  if (typeof value !== 'string' || value.length < 8) return
  // skip obvious placeholders
  if (/^(x+|your_|xxx|example|test|demo|placeholder)/i.test(value)) return
  if (foundSecrets.some((s) => s.value === value && s.key === keyName)) return
  foundSecrets.push({ key: keyName, value, source })
}

const KEY_NAME_RE =
  /public[_-]?key|api[_-]?key|apikey|access[_-]?token|id[_-]?token|refresh[_-]?token|client[_-]?secret|bearer|jwt|auth[_-]?token|token/i

function walkJsonForSecrets(obj, source, path = '') {
  if (!obj || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? path + '.' + k : k
    if (KEY_NAME_RE.test(k) && typeof v === 'string') {
      addSecret(k, v, source + ' → ' + p)
    }
    if (v && typeof v === 'object') walkJsonForSecrets(v, source, p)
  }
}

function extractFromText(text, source) {
  // OpenAPI-style paths: "/users/{id}"
  const pathMatches = text.matchAll(/["'`](\/[a-zA-Z0-9_\-{}.\/]+)["'`]/g)
  for (const m of pathMatches) {
    const p = m[1]
    if (p.length > 1 && p.length < 120 && !p.includes('//')) {
      addEndpoint(p, 'GET', source)
    }
  }

  // Absolute API URLs on same host
  try {
    const abs = text.matchAll(
      new RegExp(
        origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\/[a-zA-Z0-9_\-./{}]+)',
        'g'
      )
    )
    for (const m of abs) addEndpoint(m[1], 'GET', source)
  } catch {}

  // JWT-like
  const jwtRe =
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g
  for (const m of text.matchAll(jwtRe)) {
    addSecret('jwt_like', m[0].slice(0, 80) + (m[0].length > 80 ? '…' : ''), source)
  }

  // pk_ / sk_ / api_ style keys
  const keyRe =
    /\b(pk_live_[a-zA-Z0-9]+|pk_test_[a-zA-Z0-9]+|sk_live_[a-zA-Z0-9]+|sk_test_[a-zA-Z0-9]+|AIza[0-9A-Za-z_-]{20,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]+)\b/g
  for (const m of text.matchAll(keyRe)) {
    addSecret('key_pattern', m[0], source)
  }
}

async function fetchSafe(url, opts = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), opts.timeout || 12000)
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Web-Termux-Scanner/1.0',
        ...(opts.headers || {}),
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, headers: res.headers, text, url: res.url }
  } catch (err) {
    return { ok: false, status: 0, error: err.message || String(err), text: '', url }
  } finally {
    clearTimeout(t)
  }
}

const DISCOVERY_PATHS = [
  '/openapi.json',
  '/openapi.yaml',
  '/swagger.json',
  '/swagger/v1/swagger.json',
  '/v1/openapi.json',
  '/api/openapi.json',
  '/api-docs',
  '/api-docs.json',
  '/docs/openapi.json',
  '/.well-known/openid-configuration',
  '/robots.txt',
  '/sitemap.xml',
  '/api',
  '/api/',
  '/api/v1',
  '/api/health',
  '/health',
  '/status',
  '/version',
  '/graphql',
]

const DEEP_PATHS = [
  '/api/users',
  '/api/user',
  '/api/auth',
  '/api/login',
  '/api/token',
  '/api/public-key',
  '/api/keys',
  '/api/config',
  '/api/v1/users',
  '/api/v1/health',
  '/v1/users',
  '/v1/health',
  '/rest/v1',
  '/graphql',
  '/wp-json',
  '/wp-json/wp/v2',
]

function parseOpenApi(json, source) {
  if (!json || typeof json !== 'object') return
  if (json.paths && typeof json.paths === 'object') {
    for (const [path, methods] of Object.entries(json.paths)) {
      if (methods && typeof methods === 'object') {
        for (const method of Object.keys(methods)) {
          if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method.toLowerCase())) {
            addEndpoint(path, method.toUpperCase(), source)
          }
        }
      } else {
        addEndpoint(path, 'GET', source)
      }
    }
  }
  // components / security schemes sometimes have key names only
  walkJsonForSecrets(json, source)
}

async function main() {
  console.log('\x1b[1;32m=== Web-Termux External Endpoint Scanner ===\x1b[0m')
  console.log('Target: ' + origin + base.pathname)
  console.log('Mode:   ' + (deep ? 'deep (common paths)' : 'standard discovery'))
  console.log('')

  // 1) Base URL
  if (!quiet) console.log('→ Fetching base URL...')
  const baseRes = await fetchSafe(base.href)
  if (baseRes.error) {
    console.log('\x1b[31mBase fetch failed:\x1b[0m ' + baseRes.error)
    console.log('Tip: site may block browser/WebContainer requests (CORS / firewall).')
  } else {
    console.log('Base status: ' + baseRes.status + ' (' + baseRes.url + ')')
    addEndpoint(base.pathname || '/', 'GET', 'base', baseRes.status)
    extractFromText(baseRes.text, 'base body')
    try {
      const j = JSON.parse(baseRes.text)
      walkJsonForSecrets(j, 'base JSON')
      if (j.paths) parseOpenApi(j, 'base OpenAPI')
      if (Array.isArray(j.endpoints)) {
        j.endpoints.forEach((e) => {
          if (typeof e === 'string') addEndpoint(e, 'GET', 'base.endpoints')
          else if (e.path) addEndpoint(e.path, (e.method || 'GET').toUpperCase(), 'base.endpoints')
        })
      }
    } catch {}
  }

  // 2) Discovery paths
  const toProbe = [...DISCOVERY_PATHS]
  if (deep) toProbe.push(...DEEP_PATHS)

  if (!quiet) console.log('→ Probing ' + toProbe.length + ' discovery paths...')
  for (const path of toProbe) {
    const u = origin + path
    const res = await fetchSafe(u)
    if (res.status && res.status < 500 && res.status !== 0) {
      // record interesting statuses (not only 200 — 401/403 still prove endpoint exists)
      if ([200, 201, 204, 301, 302, 401, 403, 405].includes(res.status)) {
        addEndpoint(path, 'GET', 'probe', res.status)
        if (!quiet && res.ok) process.stdout.write('  ✓ ' + path + ' → ' + res.status + '\n')
      }
      if (res.ok && res.text) {
        extractFromText(res.text, path)
        try {
          const j = JSON.parse(res.text)
          walkJsonForSecrets(j, path)
          if (j.paths || j.openapi || j.swagger) parseOpenApi(j, path)
          if (path.includes('openid-configuration') && j.token_endpoint) {
            addEndpoint(new URL(j.token_endpoint).pathname, 'POST', 'oidc')
          }
        } catch {}
        if (path === '/robots.txt') {
          const dis = res.text.matchAll(/Disallow:\s*(\S+)/gi)
          for (const m of dis) {
            if (m[1].startsWith('/') && m[1].length > 1) addEndpoint(m[1], 'GET', 'robots.txt')
          }
          const all = res.text.matchAll(/Allow:\s*(\S+)/gi)
          for (const m of all) {
            if (m[1].startsWith('/')) addEndpoint(m[1], 'GET', 'robots.txt')
          }
        }
      }
    }
  }

  // 3) Report
  console.log('')
  console.log('\x1b[1;33m--- Endpoints found (' + foundEndpoints.size + ') ---\x1b[0m')
  if (foundEndpoints.size === 0) {
    console.log('(none discovered — site may block scanning or has no public API surface)')
  } else {
    const sorted = [...foundEndpoints.values()].sort((a, b) => a.path.localeCompare(b.path))
    for (const e of sorted) {
      const st = e.status != null ? ' [' + e.status + ']' : ''
      console.log('  ' + e.method.padEnd(7) + e.path + st + '  \x1b[90m(' + e.source + ')\x1b[0m')
    }
  }

  console.log('')
  console.log('\x1b[1;33m--- Public keys / tokens found (' + foundSecrets.length + ') ---\x1b[0m')
  if (foundSecrets.length === 0) {
    console.log('(none in public responses — this is normal for secure APIs)')
  } else {
    for (const s of foundSecrets) {
      const val = s.value.length > 64 ? s.value.slice(0, 64) + '…' : s.value
      console.log('  • ' + s.key + ' = ' + val)
      console.log('    \x1b[90msource: ' + s.source + '\x1b[0m')
    }
    console.log('\n\x1b[33mNote: Treat any real secrets as sensitive. Do not paste private keys into chats.\x1b[0m')
  }

  console.log('')
  console.log('Done. Use curl for details:')
  console.log('  node tools/curl.js --json ' + origin + '/')
  if (foundEndpoints.size) {
    const first = [...foundEndpoints.values()].find((e) => e.status === 200) || [...foundEndpoints.values()][0]
    if (first) console.log('  node tools/curl.js --json ' + origin + first.path)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
