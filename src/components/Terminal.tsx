import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebContainer } from '@webcontainer/api'
import '@xterm/xterm/css/xterm.css'

type Props = {
  mode: 'node' | 'python'
}

// Module-level singletons — WebContainer allows only ONE boot per page
let webcontainerInstance: WebContainer | null = null
let webcontainerBootPromise: Promise<WebContainer> | null = null
let pyodideInstance: any = null
let pyodideBootPromise: Promise<any> | null = null

async function getWebContainer(): Promise<WebContainer> {
  if (webcontainerInstance) return webcontainerInstance
  if (webcontainerBootPromise) return webcontainerBootPromise

  webcontainerBootPromise = (async () => {
    const wc = await WebContainer.boot()
    webcontainerInstance = wc
    return wc
  })()

  try {
    return await webcontainerBootPromise
  } catch (e) {
    webcontainerBootPromise = null
    throw e
  }
}

async function getPyodide(): Promise<any> {
  if (pyodideInstance) return pyodideInstance
  if (pyodideBootPromise) return pyodideBootPromise

  pyodideBootPromise = (async () => {
    // @ts-ignore
    const { loadPyodide } = await import(
      'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.mjs'
    )
    const py = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/',
    })
    pyodideInstance = py
    return py
  })()

  try {
    return await pyodideBootPromise
  } catch (e) {
    pyodideBootPromise = null
    throw e
  }
}

let filesMounted = false

export default function Terminal({ mode }: Props) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const shellWriterRef = useRef<WritableStreamDefaultWriter | null>(null)
  const currentModeRef = useRef(mode)
  const onDataDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    currentModeRef.current = mode
  }, [mode])

  // Create xterm once
  useEffect(() => {
    if (!termRef.current || xtermRef.current) return

    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontSize: 14,
      fontFamily:
        "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
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
    term.writeln(
      'Node.js via \x1b[36mWebContainers\x1b[0m  •  Python via \x1b[36mPyodide\x1b[0m'
    )
    term.writeln(
      'Localhost + curl + \x1b[33mexternal endpoint scanner\x1b[0m included.\r\n'
    )

    startedRef.current = true
    void runMode(term, mode)

    return () => {
      window.removeEventListener('resize', onResize)
      onDataDisposableRef.current?.dispose()
      // Do NOT dispose xterm on strict re-mount issues — keep singleton WC alive
    }
  }, [])

  // Mode changes: reuse same WC, just switch runtime surface
  useEffect(() => {
    if (!startedRef.current || !xtermRef.current) return
    const term = xtermRef.current
    term.writeln(
      `\r\n\x1b[33mSwitching to ${mode.toUpperCase()} mode...\x1b[0m\r\n`
    )
    void runMode(term, mode)
  }, [mode])

  function clearOnData() {
    onDataDisposableRef.current?.dispose()
    onDataDisposableRef.current = null
    shellWriterRef.current = null
  }

  async function runMode(term: XTerm, currentMode: 'node' | 'python') {
    clearOnData()
    try {
      if (currentMode === 'node') {
        await startNodeShell(term)
      } else {
        await startPythonRepl(term)
      }
    } catch (err: any) {
      const msg = err?.message || String(err)
      term.writeln(`\x1b[31mError: ${msg}\x1b[0m`)
      if (msg.includes('single WebContainer')) {
        term.writeln(
          '\x1b[33mTip: Refresh the page once. Only one WebContainer is allowed per tab.\x1b[0m'
        )
      } else {
        term.writeln(
          'Need HTTPS (or localhost) + COOP/COEP headers. Chrome recommended.'
        )
      }
    }
  }

  async function ensureFiles(wc: WebContainer, term: XTerm) {
    if (filesMounted) return

    wc.on('server-ready', (port, url) => {
      term.writeln(`\r\n\x1b[1;32m[localhost]\x1b[0m Server ready on port ${port}`)
      term.writeln(`\x1b[36mPreview URL:\x1b[0m ${url}\r\n`)
    })

    const scanJs = getScanScript()

    await wc.mount({
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
              dependencies: { express: '^4.21.0' },
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
app.get('/', (req, res) => res.json({ message: 'Web-Termux local server', endpoints: ['GET /','GET /api/health','GET /api/endpoints','GET /api/public-key','GET /api/token','POST /api/echo'] }))
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))
app.get('/api/endpoints', (req, res) => res.json({ endpoints: [
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/endpoints' },
  { method: 'GET', path: '/api/public-key' },
  { method: 'GET', path: '/api/token' },
  { method: 'POST', path: '/api/echo' },
]}))
app.get('/api/public-key', (req, res) => res.json({ public_key: PUBLIC_KEY, type: 'demo' }))
app.get('/api/token', (req, res) => res.json({ access_token: SAMPLE_TOKEN, token_type: 'Bearer', expires_in: 3600 }))
app.post('/api/echo', (req, res) => res.json({ received: req.body }))
app.listen(PORT, () => console.log('Local server on port ' + PORT))
`,
        },
      },
      'tools/curl.js': {
        file: {
          contents: `#!/usr/bin/env node
const args = process.argv.slice(2)
if (!args.length || args.includes('-h')) {
  console.log('Usage: node tools/curl.js [--json] [-X METHOD] [-H "K: V"] [-d BODY] <url>')
  process.exit(0)
}
let method = 'GET', url = null, body, smartJson = false, includeHeaders = false
const headers = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '-X' || a === '--request') method = (args[++i] || 'GET').toUpperCase()
  else if (a === '-H' || a === '--header') {
    const h = args[++i] || ''; const idx = h.indexOf(':')
    if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim()
  } else if (a === '-d' || a === '--data') body = args[++i]
  else if (a === '-i') includeHeaders = true
  else if (a === '--json') smartJson = true
  else if (!a.startsWith('-')) url = a
}
if (!url) { console.error('URL required'); process.exit(1) }
if (url.startsWith('localhost') || url.startsWith('127.0.0.1')) url = 'http://' + url
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
  console.log('\n--- Auto extract ---')
  if (json.endpoints) {
    console.log('Endpoints:')
    ;(Array.isArray(json.endpoints) ? json.endpoints : [json.endpoints]).forEach((e) => {
      if (typeof e === 'string') console.log('  • ' + e)
      else if (e.method && e.path) console.log('  • ' + e.method + ' ' + e.path)
    })
  }
  const found = []
  const walk = (o, p = '') => {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o)) {
      const key = k.toLowerCase(); const path = p ? p + '.' + k : k
      if ((key.includes('public') && key.includes('key')) || key.includes('api_key') || key.includes('access_token') || (key.includes('token') && typeof v === 'string')) {
        if (typeof v === 'string' && v.length > 8) found.push({ path, value: v })
      }
      if (v && typeof v === 'object') walk(v, path)
    }
  }
  walk(json)
  if (found.length) { console.log('Keys/tokens:'); found.forEach((f) => console.log('  • ' + f.path + ' = ' + f.value)) }
} else {
  process.stdout.write(text)
  if (!text.endsWith('\n')) console.log('')
}
if (!res.ok) process.exitCode = 1
`,
        },
      },
      'tools/endpoints.js': {
        file: {
          contents: `#!/usr/bin/env node
const url = process.argv[2] || 'http://localhost:3000/api/endpoints'
const res = await fetch(url)
const text = await res.text()
let json; try { json = JSON.parse(text) } catch { console.log(text); process.exit(0) }
console.log('=== Endpoints & Keys ===\nURL: ' + url + '\nStatus: ' + res.status + '\n')
if (json.endpoints) {
  console.log('Endpoints:')
  ;(Array.isArray(json.endpoints) ? json.endpoints : [json.endpoints]).forEach((e) => {
    if (typeof e === 'string') console.log('  • ' + e)
    else if (e.method && e.path) console.log('  • ' + e.method + ' ' + e.path)
  })
}
`,
        },
      },
      'tools/scan.js': {
        file: { contents: scanJs },
      },
      'index.js': {
        file: {
          contents: `console.log('Web-Termux ready')
console.log('npm run server')
console.log('node tools/curl.js --json http://localhost:3000/')
console.log('node tools/scan.js https://httpbin.org --deep')
`,
        },
      },
      'HELP.txt': {
        file: {
          contents: `npm run server
node tools/curl.js --json http://localhost:3000/
node tools/scan.js https://httpbin.org --deep
node tools/scan.js https://api.github.com --deep
`,
        },
      },
    })

    filesMounted = true

    term.writeln('Installing express...')
    const install = await wc.spawn('npm', ['install'])
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

  async function startNodeShell(term: XTerm) {
    term.writeln('Starting WebContainer (single instance)...')
    const wc = await getWebContainer()
    term.writeln('\x1b[32mWebContainer ready.\x1b[0m')

    await ensureFiles(wc, term)

    const shellProcess = await wc.spawn('jsh', {
      terminal: { cols: term.cols, rows: term.rows },
    })

    shellProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          if (currentModeRef.current === 'node') term.write(data)
        },
      })
    )

    const input = shellProcess.input.getWriter()
    shellWriterRef.current = input

    clearOnData()
    onDataDisposableRef.current = term.onData((data) => {
      if (currentModeRef.current === 'node' && shellWriterRef.current) {
        void shellWriterRef.current.write(data)
      }
    })

    term.writeln('')
    term.writeln('\x1b[1;33mCommands:\x1b[0m')
    term.writeln('  npm run server')
    term.writeln('  node tools/curl.js --json http://localhost:3000/')
    term.writeln('  node tools/scan.js https://httpbin.org --deep')
    term.writeln('  cat HELP.txt')
    term.writeln('')
  }

  async function startPythonRepl(term: XTerm) {
    term.writeln('Loading Pyodide...')
    const py = await getPyodide()
    term.writeln('\x1b[32mPyodide ready.\x1b[0m')
    term.writeln('Python REPL. Type code + Enter. exit() to leave.\r\n')

    let buffer = ''
    clearOnData()
    onDataDisposableRef.current = term.onData(async (data) => {
      if (currentModeRef.current !== 'python') return

      if (data === '\r') {
        term.write('\r\n')
        const code = buffer.trim()
        buffer = ''
        if (!code) {
          term.write('>>> ')
          return
        }
        if (code === 'exit()' || code === 'quit()') {
          term.writeln('Switch to Node mode from the top bar.')
          return
        }
        try {
          py.runPython(
            `import sys\nfrom io import StringIO\n_stdout = StringIO()\n_old = sys.stdout\nsys.stdout = _stdout`
          )
          const result = await py.runPythonAsync(code)
          const stdout = py.runPython('_stdout.getvalue()')
          py.runPython('sys.stdout = _old')
          if (stdout) term.write(stdout)
          if (result !== undefined && result !== null) term.writeln(String(result))
        } catch (e: any) {
          term.writeln(`\x1b[31m${e.message || e}\x1b[0m`)
        }
        term.write('>>> ')
      } else if (data === '\u007f') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1)
          term.write('\b \b')
        }
      } else {
        buffer += data
        term.write(data)
      }
    })

    term.write('>>> ')
  }

  function getScanScript(): string {
    return `#!/usr/bin/env node
const args = process.argv.slice(2)
const deep = args.includes('--deep')
const quiet = args.includes('--quiet')
const urlArg = args.find((a) => !a.startsWith('-'))
if (!urlArg || args.includes('-h') || args.includes('--help')) {
  console.log('Usage: node tools/scan.js <url> [--deep]')
  console.log('Example: node tools/scan.js https://httpbin.org --deep')
  process.exit(0)
}
function normalizeUrl(input) {
  let u = input.trim()
  if (!/^https?:\\/\\//i.test(u)) u = 'https://' + u
  const parsed = new URL(u)
  if (parsed.pathname === '/') parsed.pathname = ''
  return parsed
}
const base = normalizeUrl(urlArg)
const origin = base.origin
const foundEndpoints = new Map()
const foundSecrets = []
function addEndpoint(path, method = 'GET', source = 'x', status = null) {
  const key = method + ' ' + path
  if (!foundEndpoints.has(key)) foundEndpoints.set(key, { method, path, source, status })
}
function addSecret(keyName, value, source) {
  if (typeof value !== 'string' || value.length < 8) return
  if (/^(x+|your_|xxx|example|test|demo|placeholder)/i.test(value)) return
  if (foundSecrets.some((s) => s.value === value)) return
  foundSecrets.push({ key: keyName, value, source })
}
const KEY_RE = /public[_-]?key|api[_-]?key|apikey|access[_-]?token|token|jwt|bearer/i
function walk(obj, source, path = '') {
  if (!obj || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? path + '.' + k : k
    if (KEY_RE.test(k) && typeof v === 'string') addSecret(k, v, source + ' → ' + p)
    if (v && typeof v === 'object') walk(v, source, p)
  }
}
function extractText(text, source) {
  for (const m of text.matchAll(/["'\\\"](\\/[a-zA-Z0-9_\\-{}.\\/]+)["'\\"]/g)) {
    if (m[1].length > 1 && m[1].length < 120) addEndpoint(m[1], 'GET', source)
  }
  for (const m of text.matchAll(/eyJ[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}/g)) {
    addSecret('jwt_like', m[0].slice(0, 64) + '…', source)
  }
}
async function fetchSafe(url) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), 12000)
  try {
    const res = await fetch(url, { signal: c.signal, headers: { Accept: '*/*', 'User-Agent': 'Web-Termux-Scanner/1.0' } })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } catch (e) {
    return { ok: false, status: 0, error: e.message, text: '' }
  } finally { clearTimeout(t) }
}
const PATHS = ['/openapi.json','/swagger.json','/api-docs','/.well-known/openid-configuration','/robots.txt','/api','/api/health','/health','/graphql']
const DEEP = ['/api/users','/api/token','/api/public-key','/api/v1','/wp-json']
console.log('=== External Endpoint Scanner ===')
console.log('Target: ' + origin)
const baseRes = await fetchSafe(base.href)
if (baseRes.error) console.log('Base failed: ' + baseRes.error)
else {
  console.log('Base status: ' + baseRes.status)
  addEndpoint(base.pathname || '/', 'GET', 'base', baseRes.status)
  extractText(baseRes.text, 'base')
  try { const j = JSON.parse(baseRes.text); walk(j, 'base'); if (j.paths) for (const p of Object.keys(j.paths)) addEndpoint(p, 'GET', 'openapi') } catch {}
}
const probe = deep ? PATHS.concat(DEEP) : PATHS
for (const path of probe) {
  const res = await fetchSafe(origin + path)
  if (res.status && [200,201,301,302,401,403,405].includes(res.status)) {
    addEndpoint(path, 'GET', 'probe', res.status)
    if (!quiet && res.ok) console.log('  ✓ ' + path + ' → ' + res.status)
    if (res.ok) { extractText(res.text, path); try { walk(JSON.parse(res.text), path) } catch {} }
  }
}
console.log('\n--- Endpoints (' + foundEndpoints.size + ') ---')
for (const e of [...foundEndpoints.values()].sort((a,b)=>a.path.localeCompare(b.path))) {
  console.log('  ' + e.method.padEnd(6) + e.path + (e.status != null ? ' [' + e.status + ']' : ''))
}
console.log('\n--- Keys/tokens (' + foundSecrets.length + ') ---')
if (!foundSecrets.length) console.log('(none in public responses)')
else foundSecrets.forEach((s) => console.log('  • ' + s.key + ' = ' + (s.value.length > 64 ? s.value.slice(0,64)+'…' : s.value)))
console.log('\nDone.')
`
  }

  return <div ref={termRef} style={{ width: '100%', height: '100%' }} />
}
