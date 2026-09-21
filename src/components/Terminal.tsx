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

    const onResize = () => {
      fitAddon.fit()
      // resize shell if running — WebContainers jsh picks up cols/rows on spawn mostly
    }
    window.addEventListener('resize', onResize)

    term.writeln('\x1b[1;32mWeb-Termux\x1b[0m — Real browser terminal')
    term.writeln('Node.js via \x1b[36mWebContainers\x1b[0m  •  Python via \x1b[36mPyodide\x1b[0m')
    term.writeln('Localhost servers + curl + endpoints/token inspector included.\r\n')

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

      // Listen for any server started inside the container → this is "localhost" here
      webcontainerInstance.on('server-ready', (port, url) => {
        serverUrlRef.current = url
        term.writeln(`\r\n\x1b[1;32m[localhost]\x1b[0m Server ready on port ${port}`)
        term.writeln(`\x1b[36mPreview URL:\x1b[0m ${url}`)
        term.writeln('You can curl this URL from the terminal or open it in a new tab.\r\n')
      })

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

// Sample public key / token style responses for demo
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
    note: 'This is a sample public key for testing curl / endpoints inspector',
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
/**
 * Real fetch-based curl-like CLI for WebContainers.
 * Usage:
 *   node tools/curl.js [options] <url>
 *   npm run curl -- <url>
 *
 * Options:
 *   -X METHOD   HTTP method (GET, POST, ...)
 *   -H "K: V"   Header
 *   -d BODY     Request body
 *   -i          Include response headers
 *   --json      Pretty-print JSON + extract endpoints / public keys / tokens
 */

const args = process.argv.slice(2)

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(\`Usage: node tools/curl.js [options] <url>

Options:
  -X, --request METHOD   HTTP method (default GET)
  -H, --header "Key: Val"  Add request header (repeatable)
  -d, --data BODY        Request body
  -i, --include          Show response headers
  --json                 Pretty JSON + auto show endpoints / keys / tokens
  -h, --help             Show help

Examples:
  node tools/curl.js http://localhost:3000/
  node tools/curl.js --json http://localhost:3000/api/endpoints
  node tools/curl.js -X POST -H "Content-Type: application/json" -d '{\"hi\":1}' http://localhost:3000/api/echo
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
  if (a === '-X' || a === '--request') {
    method = (args[++i] || 'GET').toUpperCase()
  } else if (a === '-H' || a === '--header') {
    const h = args[++i] || ''
    const idx = h.indexOf(':')
    if (idx > 0) {
      headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim()
    }
  } else if (a === '-d' || a === '--data') {
    body = args[++i]
  } else if (a === '-i' || a === '--include') {
    includeHeaders = true
  } else if (a === '--json') {
    smartJson = true
  } else if (!a.startsWith('-')) {
    url = a
  }
}

if (!url) {
  console.error('Error: URL required')
  process.exit(1)
}

// Normalize common localhost aliases inside WebContainers
if (url.startsWith('localhost') || url.startsWith('127.0.0.1')) {
  url = 'http://' + url
}

async function main() {
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? body : undefined,
    })

    if (includeHeaders || smartJson) {
      console.log('HTTP/' + res.status + ' ' + res.statusText)
      for (const [k, v] of res.headers.entries()) {
        console.log(k + ': ' + v)
      }
      console.log('')
    }

    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}

    if (smartJson && json) {
      console.log(JSON.stringify(json, null, 2))
      console.log('\n\x1b[1;33m--- Auto extract ---\x1b[0m')

      // Endpoints
      if (json.endpoints) {
        console.log('\x1b[36mEndpoints:\x1b[0m')
        if (Array.isArray(json.endpoints)) {
          json.endpoints.forEach((e) => {
            if (typeof e === 'string') console.log('  • ' + e)
            else if (e.method && e.path) console.log('  • ' + e.method + ' ' + e.path + (e.description ? ' — ' + e.description : ''))
            else console.log('  • ' + JSON.stringify(e))
          })
        } else {
          console.log(JSON.stringify(json.endpoints, null, 2))
        }
      }

      // Public keys / tokens (common shapes)
      const found = []
      function walk(obj, path = '') {
        if (!obj || typeof obj !== 'object') return
        for (const [k, v] of Object.entries(obj)) {
          const key = k.toLowerCase()
          const p = path ? path + '.' + k : k
          if (
            key.includes('public_key') ||
            key.includes('publickey') ||
            key.includes('api_key') ||
            key.includes('apikey') ||
            key === 'key' ||
            key.includes('access_token') ||
            key.includes('token') ||
            key.includes('jwt') ||
            key.includes('secret') === false && key.includes('token')
          ) {
            if (typeof v === 'string' && v.length > 8) {
              found.push({ path: p, value: v })
            }
          }
          if (v && typeof v === 'object') walk(v, p)
        }
      }
      walk(json)

      if (found.length) {
        console.log('\x1b[36mPublic keys / tokens found:\x1b[0m')
        found.forEach((f) => {
          console.log('  • ' + f.path + ' = ' + f.value)
        })
      } else if (!json.endpoints) {
        console.log('(no endpoints or token-like fields auto-detected)')
      }
    } else {
      process.stdout.write(text)
      if (!text.endsWith('\n')) console.log('')
    }

    if (!res.ok) process.exitCode = 1
  } catch (err) {
    console.error('curl error:', err.message || err)
    console.error('Tip: start local server first →  npm run server')
    console.error('Then use the Preview URL printed by [localhost] or try http://localhost:3000')
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
/**
 * Fetch a URL and pretty-print endpoints + public keys + tokens.
 * Usage: node tools/endpoints.js [url]
 * Default: http://localhost:3000/api/endpoints
 */

const url = process.argv[2] || 'http://localhost:3000/api/endpoints'

async function main() {
  try {
    const res = await fetch(url)
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      console.log(text)
      return
    }

    console.log('\x1b[1;32m=== Endpoints & Keys Inspector ===\x1b[0m')
    console.log('URL: ' + url)
    console.log('Status: ' + res.status)
    console.log('')

    if (json.endpoints) {
      console.log('\x1b[36mEndpoints:\x1b[0m')
      const list = Array.isArray(json.endpoints) ? json.endpoints : [json.endpoints]
      list.forEach((e) => {
        if (typeof e === 'string') console.log('  • ' + e)
        else if (e.method && e.path)
          console.log('  • ' + e.method.padEnd(6) + e.path + (e.description ? '  —  ' + e.description : ''))
        else console.log('  • ' + JSON.stringify(e))
      })
      console.log('')
    }

    // Also try common key endpoints if root was hit
    const extra = []
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      const base = url.replace(/\/api\/.*$/, '').replace(/\/$/, '') || 'http://localhost:3000'
      for (const path of ['/api/public-key', '/api/token', '/api/endpoints']) {
        try {
          const r = await fetch(base + path)
          if (r.ok) {
            const j = await r.json()
            extra.push({ path, data: j })
          }
        } catch {}
      }
    }

    if (extra.length) {
      console.log('\x1b[36mDiscovered key/token responses:\x1b[0m')
      for (const item of extra) {
        console.log('  ' + item.path)
        console.log('  ' + JSON.stringify(item.data, null, 2).split('\n').join('\n  '))
        console.log('')
      }
    }

    // Generic walk for keys/tokens in main response
    const found = []
    function walk(obj, path = '') {
      if (!obj || typeof obj !== 'object') return
      for (const [k, v] of Object.entries(obj)) {
        const key = k.toLowerCase()
        const p = path ? path + '.' + k : k
        if (
          (key.includes('public') && key.includes('key')) ||
          key.includes('api_key') ||
          key.includes('apikey') ||
          key.includes('access_token') ||
          (key.includes('token') && typeof v === 'string')
        ) {
          if (typeof v === 'string') found.push({ path: p, value: v })
        }
        if (v && typeof v === 'object') walk(v, p)
      }
    }
    walk(json)
    if (found.length) {
      console.log('\x1b[36mTokens / public keys in response:\x1b[0m')
      found.forEach((f) => console.log('  • ' + f.path + ' = ' + f.value))
    }

    if (!json.endpoints && !found.length && !extra.length) {
      console.log(JSON.stringify(json, null, 2))
    }
  } catch (err) {
    console.error('Error:', err.message || err)
    console.error('Start the sample server first:  npm run server')
    process.exit(1)
  }
}

main()
`,
          },
        },
        'index.js': {
          file: {
            contents: `console.log('Hello from Web-Termux (real Node.js)!')
console.log('Try: npm run server   then   node tools/curl.js --json http://localhost:3000/')
`,
          },
        },
        'HELP.txt': {
          file: {
            contents: `Web-Termux quick help
=====================

LOCALHOST (WebContainers style)
  npm run server          Start sample Express server on port 3000
  → Terminal will print [localhost] Preview URL when ready
  → Inside container you can also use http://localhost:3000

CURL (real fetch-based CLI)
  node tools/curl.js http://localhost:3000/
  node tools/curl.js --json http://localhost:3000/api/endpoints
  node tools/curl.js --json http://localhost:3000/api/public-key
  node tools/curl.js --json http://localhost:3000/api/token
  node tools/curl.js -X POST -H "Content-Type: application/json" -d '{"hi":1}' http://localhost:3000/api/echo

ENDPOINTS + PUBLIC KEY / TOKEN INSPECTOR
  node tools/endpoints.js
  node tools/endpoints.js http://localhost:3000/api/endpoints

Other
  npm install <pkg>       Real npm install
  node index.js
  npx --yes cowsay hello
`,
          },
        },
      })

      term.writeln('Installing sample server dependencies (express)...')
      const install = await webcontainerInstance.spawn('npm', ['install'])
      install.output.pipeTo(
        new WritableStream({
          write(data) {
            term.write(data)
          },
        })
      )
      const code = await install.exit
      if (code !== 0) {
        term.writeln('\x1b[33mWarning: npm install exited with code ' + code + '\x1b[0m')
      } else {
        term.writeln('\x1b[32mnpm install done.\x1b[0m')
      }
    }

    // Interactive jsh shell
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
    term.writeln('\x1b[1;33mQuick start (localhost + curl):\x1b[0m')
    term.writeln('  1. npm run server')
    term.writeln('  2. Wait for \x1b[32m[localhost]\x1b[0m Preview URL')
    term.writeln('  3. node tools/curl.js --json http://localhost:3000/')
    term.writeln('  4. node tools/curl.js --json http://localhost:3000/api/public-key')
    term.writeln('  5. node tools/endpoints.js')
    term.writeln('  Or: cat HELP.txt')
    term.writeln('')
  }

  async function bootPyodide(term: XTerm) {
    if (!pyodideInstance) {
      term.writeln('Loading Pyodide (real CPython via WebAssembly)...')
      // @ts-ignore
      const { loadPyodide } = await import('https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.mjs')
      pyodideInstance = await loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/',
      })
      term.writeln('\x1b[32mPyodide ready.\x1b[0m')
    }

    term.writeln('Python REPL. Type code + Enter. exit() to leave.\r\n')

    let buffer = ''
    term.onData(async (data) => {
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
          term.writeln('Exiting Python mode.')
          return
        }

        try {
          pyodideInstance.runPython(`
import sys
from io import StringIO
_stdout = StringIO()
_old = sys.stdout
sys.stdout = _stdout
`)
          const result = await pyodideInstance.runPythonAsync(code)
          const stdout = pyodideInstance.runPython('_stdout.getvalue()')
          pyodideInstance.runPython('sys.stdout = _old')

          if (stdout) term.write(stdout)
          if (result !== undefined && result !== null) {
            term.writeln(String(result))
          }
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

  return <div ref={termRef} style={{ width: '100%', height: '100%' }} />
}
