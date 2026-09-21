import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebContainer } from '@webcontainer/api'
import '@xterm/xterm/css/xterm.css'

type Props = {
  mode: 'node' | 'python'
}

let webcontainerInstance: WebContainer | null = null
let pyodideInstance: any = null

export default function Terminal({ mode }: Props) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const shellWriterRef = useRef<WritableStreamDefaultWriter | null>(null)
  const currentModeRef = useRef(mode)
  const serverUrlRef = useRef<string | null>(null)

  useEffect(() => {
    currentModeRef.current = mode
  }, [mode])

  useEffect(() => {
    if (!termRef.current) return

    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    const onResize = () => fitAddon.fit()
    window.addEventListener('resize', onResize)

    term.writeln('\x1b[1;32mWeb-Termux\x1b[0m — Real browser terminal')
    term.writeln('Node.js via \x1b[36mWebContainers\x1b[0m  •  Python via \x1b[36mPyodide\x1b[0m')
    term.writeln('Localhost + curl + \x1b[33mexternal endpoint scanner\x1b[0m included.\r\n')

    bootRuntime(term, mode)

    return () => {
      window.removeEventListener('resize', onResize)
      term.dispose()
    }
  }, [])

  useEffect(() => {
    if (!xtermRef.current) return
    const term = xtermRef.current
    term.writeln(`\r\n\x1b[33mSwitching to ${mode.toUpperCase()} mode...\x1b[0m\r\n`)
    bootRuntime(term, mode)
  }, [mode])

  async function bootRuntime(term: XTerm, currentMode: 'node' | 'python') {
    try {
      if (currentMode === 'node') {
        await bootWebContainer(term)
      } else {
        await bootPyodide(term)
      }
    } catch (err: any) {
      term.writeln(`\x1b[31mError: ${err?.message || err}\x1b[0m`)
      term.writeln('Make sure you are on HTTPS (or localhost) and COOP/COEP headers are set.')
    }
  }

  async function bootWebContainer(term: XTerm) {
    if (!webcontainerInstance) {
      term.writeln('Booting WebContainer (real Node.js runtime)...')
      webcontainerInstance = await WebContainer.boot()
      term.writeln('\x1b[32mWebContainer ready.\x1b[0m')

      webcontainerInstance.on('server-ready', (port, url) => {
        serverUrlRef.current = url
        term.writeln(`\r\n\x1b[1;32m[localhost]\x1b[0m Server ready on port ${port}`)
        term.writeln(`\x1b[36mPreview URL:\x1b[0m ${url}`)
        term.writeln('Curl this URL or open in a new tab.\r\n')
      })

      // Load scan.js from a compact inline version mounted into the FS
      // (full scanner also available if user copies tools/ — we mount complete tools here)
      const scanJs = await fetchScanScript()

      await webcontainerInstance.mount({
        'package.json': {
          file: {
            contents: JSON.stringify(
              {
                name: 'web-termux-workspace',
                private: true,
                type: 'module',
                scripts: {
                  start: 'node server.js',
                  server: 'node server.js',
                  curl: 'node tools/curl.js',
                  endpoints: 'node tools/endpoints.js',
                  scan: 'node tools/scan.js',
                },
                dependencies: {
                  express: '^4.21.0',
                },
              },
              null,
              2
            ),
          },
        },
        'server.js': {
          file: {
            contents: `import express from 'express'

const app = express()
const PORT = 3000

app.use(express.json())

const PUBLIC_KEY = 'pk_live_51HxYzDemoPublicKeyForWebTermux'
const SAMPLE_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo.token'

app.get('/', (req, res) => {
  res.json({
    message: 'Web-Termux local server is running',
    endpoints: [
      'GET  /',
      'GET  /api/health',
      'GET  /api/endpoints',
      'GET  /api/public-key',
      'GET  /api/token',
      'POST /api/echo',
    ],
  })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

app.get('/api/endpoints', (req, res) => {
  res.json({
    endpoints: [
      { method: 'GET', path: '/', description: 'Root info' },
      { method: 'GET', path: '/api/health', description: 'Health check' },
      { method: 'GET', path: '/api/endpoints', description: 'List all endpoints' },
      { method: 'GET', path: '/api/public-key', description: 'Returns demo public key' },
      { method: 'GET', path: '/api/token', description: 'Returns demo JWT-style token' },
      { method: 'POST', path: '/api/echo', description: 'Echo request body' },
    ],
  })
})

app.get('/api/public-key', (req, res) => {
  res.json({
    public_key: PUBLIC_KEY,
    type: 'demo',
    note: 'Sample public key for testing scanner / curl',
  })
})

app.get('/api/token', (req, res) => {
  res.json({
    access_token: SAMPLE_TOKEN,
    token_type: 'Bearer',
    expires_in: 3600,
  })
})

app.post('/api/echo', (req, res) => {
  res.json({ received: req.body, headers: req.headers })
})

app.listen(PORT, () => {
  console.log('Local server listening on port ' + PORT)
})
`,
          },
        },
        'tools/curl.js': {
          file: {
            contents: `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(\`Usage: node tools/curl.js [options] <url>

Options:
  -X, --request METHOD   HTTP method (default GET)
  -H, --header "Key: Val"  Add request header
  -d, --data BODY        Request body
  -i, --include          Show response headers
  --json                 Pretty JSON + extract endpoints / keys / tokens

Examples:
  node tools/curl.js --json https://httpbin.org/get
  node tools/curl.js --json http://localhost:3000/api/endpoints
\`)
  process.exit(0)
}

let method = 'GET'
let url = null
const headers = {}
let body = undefined
let includeHeaders = false
let smartJson = false

for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '-X' || a === '--request') method = (args[++i] || 'GET').toUpperCase()
  else if (a === '-H' || a === '--header') {
    const h = args[++i] || ''
    const idx = h.indexOf(':')
    if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim()
  } else if (a === '-d' || a === '--data') body = args[++i]
  else if (a === '-i' || a === '--include') includeHeaders = true
  else if (a === '--json') smartJson = true
  else if (!a.startsWith('-')) url = a
}

if (!url) { console.error('Error: URL required'); process.exit(1) }
if (url.startsWith('localhost') || url.startsWith('127.0.0.1')) url = 'http://' + url

async function main() {
  try {
    const res = await fetch(url, { method, headers, body })
    if (includeHeaders || smartJson) {
      console.log('HTTP/' + res.status + ' ' + res.statusText)
      for (const [k, v] of res.headers.entries()) console.log(k + ': ' + v)
      console.log('')
    }
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    if (smartJson && json) {
      console.log(JSON.stringify(json, null, 2))
      console.log('\\n--- Auto extract ---')
      if (json.endpoints) {
        console.log('Endpoints:')
        const list = Array.isArray(json.endpoints) ? json.endpoints : [json.endpoints]
        list.forEach((e) => {
          if (typeof e === 'string') console.log('  • ' + e)
          else if (e.method && e.path) console.log('  • ' + e.method + ' ' + e.path)
          else console.log('  • ' + JSON.stringify(e))
        })
      }
      const found = []
      function walk(obj, path = '') {
        if (!obj || typeof obj !== 'object') return
        for (const [k, v] of Object.entries(obj)) {
          const key = k.toLowerCase()
          const p = path ? path + '.' + k : k
          if ((key.includes('public') && key.includes('key')) || key.includes('api_key') || key.includes('apikey') || key.includes('access_token') || (key.includes('token') && typeof v === 'string')) {
            if (typeof v === 'string' && v.length > 8) found.push({ path: p, value: v })
          }
          if (v && typeof v === 'object') walk(v, p)
        }
      }
      walk(json)
      if (found.length) {
        console.log('Public keys / tokens:')
        found.forEach((f) => console.log('  • ' + f.path + ' = ' + f.value))
      }
    } else {
      process.stdout.write(text)
      if (!text.endsWith('\\n')) console.log('')
    }
    if (!res.ok) process.exitCode = 1
  } catch (err) {
    console.error('curl error:', err.message || err)
    process.exit(1)
  }
}
main()
`,
          },
        },
        'tools/endpoints.js': {
          file: {
            contents: `#!/usr/bin/env node
const url = process.argv[2] || 'http://localhost:3000/api/endpoints'
async function main() {
  try {
    const res = await fetch(url)
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { console.log(text); return }
    console.log('=== Endpoints & Keys Inspector ===')
    console.log('URL: ' + url)
    console.log('Status: ' + res.status + '\\n')
    if (json.endpoints) {
      console.log('Endpoints:')
      const list = Array.isArray(json.endpoints) ? json.endpoints : [json.endpoints]
      list.forEach((e) => {
        if (typeof e === 'string') console.log('  • ' + e)
        else if (e.method && e.path) console.log('  • ' + e.method.padEnd(6) + e.path + (e.description ? '  —  ' + e.description : ''))
        else console.log('  • ' + JSON.stringify(e))
      })
      console.log('')
    }
    const found = []
    function walk(obj, path = '') {
      if (!obj || typeof obj !== 'object') return
      for (const [k, v] of Object.entries(obj)) {
        const key = k.toLowerCase()
        const p = path ? path + '.' + k : k
        if ((key.includes('public') && key.includes('key')) || key.includes('api_key') || key.includes('access_token') || (key.includes('token') && typeof v === 'string')) {
          if (typeof v === 'string') found.push({ path: p, value: v })
        }
        if (v && typeof v === 'object') walk(v, p)
      }
    }
    walk(json)
    if (found.length) {
      console.log('Tokens / public keys:')
      found.forEach((f) => console.log('  • ' + f.path + ' = ' + f.value))
    }
  } catch (err) {
    console.error('Error:', err.message || err)
    process.exit(1)
  }
}
main()
`,
          },
        },
        'tools/scan.js': {
          file: {
            contents: scanJs,
          },
        },
        'index.js': {
          file: {
            contents: `console.log('Web-Termux workspace')
console.log('Local:  npm run server')
console.log('Curl:   node tools/curl.js --json http://localhost:3000/')
console.log('Scan:   node tools/scan.js https://httpbin.org')
console.log('        node tools/scan.js https://api.github.com --deep')
`,
          },
        },
        'HELP.txt': {
          file: {
            contents: `Web-Termux help
===============

LOCAL SERVER
  npm run server
  node tools/curl.js --json http://localhost:3000/
  node tools/endpoints.js

EXTERNAL SITE ENDPOINT SCANNER
  node tools/scan.js <url>
  node tools/scan.js https://httpbin.org
  node tools/scan.js https://api.github.com --deep
  node tools/scan.js https://jsonplaceholder.typicode.com --deep

  What scan does:
  - Fetches base URL (real HTTP)
  - Probes OpenAPI / Swagger / robots.txt / well-known
  - Optional --deep common API paths
  - Extracts path patterns + public keys / tokens from responses

CURL
  node tools/curl.js --json https://httpbin.org/get
  node tools/curl.js -X POST -H "Content-Type: application/json" -d '{\"a\":1}' https://httpbin.org/post

Note: Some sites block browser/WebContainer requests (CORS). That is normal.
`,
          },
        },
      })

      term.writeln('Installing dependencies (express)...')
      const install = await webcontainerInstance.spawn('npm', ['install'])
      install.output.pipeTo(
        new WritableStream({
          write(data) {
            term.write(data)
          },
        })
      )
      await install.exit
      term.writeln('\x1b[32mnpm install done.\x1b[0m')
    }

    const shellProcess = await webcontainerInstance.spawn('jsh', {
      terminal: {
        cols: term.cols,
        rows: term.rows,
      },
    })

    shellProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          term.write(data)
        },
      })
    )

    const input = shellProcess.input.getWriter()
    shellWriterRef.current = input

    term.onData((data) => {
      if (currentModeRef.current === 'node' && shellWriterRef.current) {
        shellWriterRef.current.write(data)
      }
    })

    term.writeln('')
    term.writeln('\x1b[1;33mExternal endpoint scanner:\x1b[0m')
    term.writeln('  node tools/scan.js https://httpbin.org')
    term.writeln('  node tools/scan.js https://api.github.com --deep')
    term.writeln('  node tools/scan.js https://jsonplaceholder.typicode.com --deep')
    term.writeln('')
    term.writeln('\x1b[1;33mLocalhost + curl:\x1b[0m')
    term.writeln('  npm run server')
    term.writeln('  node tools/curl.js --json http://localhost:3000/api/public-key')
    term.writeln('  cat HELP.txt')
    term.writeln('')
  }

  /** Full scanner script embedded for mount */
  async function fetchScanScript(): Promise<string> {
    // Inline the same scanner logic (kept in sync with tools/scan.js in repo root for GitHub visibility)
    return `#!/usr/bin/env node
const args = process.argv.slice(2)
const deep = args.includes('--deep')
const quiet = args.includes('--quiet')
const urlArg = args.find((a) => !a.startsWith('-'))
if (!urlArg || args.includes('-h') || args.includes('--help')) {
  console.log(\`Usage: node tools/scan.js <url> [--deep] [--quiet]

Examples:
  node tools/scan.js https://httpbin.org
  node tools/scan.js https://api.github.com --deep
  node tools/scan.js https://jsonplaceholder.typicode.com --deep
\`)
  process.exit(0)
}
function normalizeUrl(input) {
  let u = input.trim()
  if (!/^https?:\\/\\//i.test(u)) u = 'https://' + u
  try {
    const parsed = new URL(u)
    if (parsed.pathname === '/') parsed.pathname = ''
    return parsed
  } catch {
    console.error('Invalid URL:', input)
    process.exit(1)
  }
}
const base = normalizeUrl(urlArg)
const origin = base.origin
const foundEndpoints = new Map()
const foundSecrets = []
function addEndpoint(path, method = 'GET', source = 'discovered', status = null) {
  const key = method + ' ' + path
  if (!foundEndpoints.has(key)) foundEndpoints.set(key, { method, path, source, status })
}
function addSecret(keyName, value, source) {
  if (typeof value !== 'string' || value.length < 8) return
  if (/^(x+|your_|xxx|example|test|demo|placeholder)/i.test(value)) return
  if (foundSecrets.some((s) => s.value === value && s.key === keyName)) return
  foundSecrets.push({ key: keyName, value, source })
}
const KEY_NAME_RE = /public[_-]?key|api[_-]?key|apikey|access[_-]?token|id[_-]?token|refresh[_-]?token|bearer|jwt|auth[_-]?token|token/i
function walkJsonForSecrets(obj, source, path = '') {
  if (!obj || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? path + '.' + k : k
    if (KEY_NAME_RE.test(k) && typeof v === 'string') addSecret(k, v, source + ' → ' + p)
    if (v && typeof v === 'object') walkJsonForSecrets(v, source, p)
  }
}
function extractFromText(text, source) {
  const pathMatches = text.matchAll(/["'
](\\/[a-zA-Z0-9_\\-{}.\\/]+)["'
]/g)
  for (const m of pathMatches) {
    const p = m[1]
    if (p.length > 1 && p.length < 120 && !p.includes('//')) addEndpoint(p, 'GET', source)
  }
  const jwtRe = /eyJ[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}/g
  for (const m of text.matchAll(jwtRe)) addSecret('jwt_like', m[0].slice(0, 80) + (m[0].length > 80 ? '…' : ''), source)
  const keyRe = /\\b(pk_live_[a-zA-Z0-9]+|pk_test_[a-zA-Z0-9]+|sk_live_[a-zA-Z0-9]+|sk_test_[a-zA-Z0-9]+|AIza[0-9A-Za-z_-]{20,}|ghp_[a-zA-Z0-9]{20,})\\b/g
  for (const m of text.matchAll(keyRe)) addSecret('key_pattern', m[0], source)
}
async function fetchSafe(url, opts = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), opts.timeout || 12000)
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'Web-Termux-Scanner/1.0' },
      signal: controller.signal,
      redirect: 'follow',
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text, url: res.url }
  } catch (err) {
    return { ok: false, status: 0, error: err.message || String(err), text: '', url }
  } finally {
    clearTimeout(t)
  }
}
const DISCOVERY_PATHS = ['/openapi.json','/openapi.yaml','/swagger.json','/swagger/v1/swagger.json','/v1/openapi.json','/api/openapi.json','/api-docs','/api-docs.json','/docs/openapi.json','/.well-known/openid-configuration','/robots.txt','/sitemap.xml','/api','/api/','/api/v1','/api/health','/health','/status','/version','/graphql']
const DEEP_PATHS = ['/api/users','/api/user','/api/auth','/api/login','/api/token','/api/public-key','/api/keys','/api/config','/api/v1/users','/api/v1/health','/v1/users','/v1/health','/rest/v1','/graphql','/wp-json','/wp-json/wp/v2']
function parseOpenApi(json, source) {
  if (!json || typeof json !== 'object') return
  if (json.paths && typeof json.paths === 'object') {
    for (const [path, methods] of Object.entries(json.paths)) {
      if (methods && typeof methods === 'object') {
        for (const method of Object.keys(methods)) {
          if (['get','post','put','patch','delete','options','head'].includes(method.toLowerCase())) addEndpoint(path, method.toUpperCase(), source)
        }
      } else addEndpoint(path, 'GET', source)
    }
  }
  walkJsonForSecrets(json, source)
}
async function main() {
  console.log('=== Web-Termux External Endpoint Scanner ===')
  console.log('Target: ' + origin + base.pathname)
  console.log('Mode:   ' + (deep ? 'deep' : 'standard'))
  console.log('')
  if (!quiet) console.log('→ Fetching base URL...')
  const baseRes = await fetchSafe(base.href)
  if (baseRes.error) {
    console.log('Base fetch failed: ' + baseRes.error)
    console.log('Tip: site may block WebContainer requests (CORS / firewall).')
  } else {
    console.log('Base status: ' + baseRes.status)
    addEndpoint(base.pathname || '/', 'GET', 'base', baseRes.status)
    extractFromText(baseRes.text, 'base body')
    try {
      const j = JSON.parse(baseRes.text)
      walkJsonForSecrets(j, 'base JSON')
      if (j.paths) parseOpenApi(j, 'base OpenAPI')
      if (Array.isArray(j.endpoints)) j.endpoints.forEach((e) => {
        if (typeof e === 'string') addEndpoint(e, 'GET', 'base.endpoints')
        else if (e.path) addEndpoint(e.path, (e.method || 'GET').toUpperCase(), 'base.endpoints')
      })
    } catch {}
  }
  const toProbe = [...DISCOVERY_PATHS]
  if (deep) toProbe.push(...DEEP_PATHS)
  if (!quiet) console.log('→ Probing ' + toProbe.length + ' paths...')
  for (const path of toProbe) {
    const res = await fetchSafe(origin + path)
    if (res.status && res.status < 500 && res.status !== 0) {
      if ([200,201,204,301,302,401,403,405].includes(res.status)) {
        addEndpoint(path, 'GET', 'probe', res.status)
        if (!quiet && res.ok) console.log('  ✓ ' + path + ' → ' + res.status)
      }
      if (res.ok && res.text) {
        extractFromText(res.text, path)
        try {
          const j = JSON.parse(res.text)
          walkJsonForSecrets(j, path)
          if (j.paths || j.openapi || j.swagger) parseOpenApi(j, path)
        } catch {}
        if (path === '/robots.txt') {
          for (const m of res.text.matchAll(/Disallow:\\s*(\\S+)/gi)) {
            if (m[1].startsWith('/') && m[1].length > 1) addEndpoint(m[1], 'GET', 'robots.txt')
          }
        }
      }
    }
  }
  console.log('')
  console.log('--- Endpoints found (' + foundEndpoints.size + ') ---')
  if (foundEndpoints.size === 0) console.log('(none — site may block scanning)')
  else {
    const sorted = [...foundEndpoints.values()].sort((a, b) => a.path.localeCompare(b.path))
    for (const e of sorted) {
      const st = e.status != null ? ' [' + e.status + ']' : ''
      console.log('  ' + e.method.padEnd(7) + e.path + st + '  (' + e.source + ')')
    }
  }
  console.log('')
  console.log('--- Public keys / tokens found (' + foundSecrets.length + ') ---')
  if (foundSecrets.length === 0) console.log('(none in public responses)')
  else {
    for (const s of foundSecrets) {
      const val = s.value.length > 64 ? s.value.slice(0, 64) + '…' : s.value
      console.log('  • ' + s.key + ' = ' + val)
      console.log('    source: ' + s.source)
    }
    console.log('\\nNote: Treat real secrets as sensitive.')
  }
  console.log('')
  console.log('Done. Detail with: node tools/curl.js --json ' + origin + '/')
}
main().catch((e) => { console.error(e); process.exit(1) })
`
  }

  async function bootPyodide(term: XTerm) {
    if (!pyodideInstance) {
      term.writeln('Loading Pyodide...')
      // @ts-ignore
      const { loadPyodide } = await import('https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.mjs')
      pyodideInstance = await loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/',
      })
      term.writeln('\x1b[32mPyodide ready.\x1b[0m')
    }
    term.writeln('Python REPL. exit() to leave.\r\n')
    let buffer = ''
    term.onData(async (data) => {
      if (currentModeRef.current !== 'python') return
      if (data === '\r') {
        term.write('\r\n')
        const code = buffer.trim()
        buffer = ''
        if (!code) { term.write('>>> '); return }
        if (code === 'exit()' || code === 'quit()') { term.writeln('Exiting Python mode.'); return }
        try {
          pyodideInstance.runPython(`import sys\nfrom io import StringIO\n_stdout = StringIO()\n_old = sys.stdout\nsys.stdout = _stdout`)
          const result = await pyodideInstance.runPythonAsync(code)
          const stdout = pyodideInstance.runPython('_stdout.getvalue()')
          pyodideInstance.runPython('sys.stdout = _old')
          if (stdout) term.write(stdout)
          if (result !== undefined && result !== null) term.writeln(String(result))
        } catch (e: any) {
          term.writeln(`\x1b[31m${e.message || e}\x1b[0m`)
        }
        term.write('>>> ')
      } else if (data === '\u007f') {
        if (buffer.length > 0) { buffer = buffer.slice(0, -1); term.write('\b \b') }
      } else {
        buffer += data
        term.write(data)
      }
    })
    term.write('>>> ')
  }

  return <div ref={termRef} style={{ width: '100%', height: '100%' }} />
}
