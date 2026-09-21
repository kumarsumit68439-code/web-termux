import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebContainer } from '@webcontainer/api'
import '@xterm/xterm/css/xterm.css'

type Props = { mode: 'node' | 'python' }

let webcontainerInstance: WebContainer | null = null
let webcontainerBootPromise: Promise<WebContainer> | null = null
let pyodideInstance: any = null
let pyodideBootPromise: Promise<any> | null = null
let filesMounted = false
let installDone = false

async function getWebContainer(): Promise<WebContainer> {
  if (webcontainerInstance) return webcontainerInstance
  if (webcontainerBootPromise) return webcontainerBootPromise
  webcontainerBootPromise = WebContainer.boot().then((wc) => {
    webcontainerInstance = wc
    return wc
  })
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
    pyodideInstance = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/',
    })
    return pyodideInstance
  })()
  try {
    return await pyodideBootPromise
  } catch (e) {
    pyodideBootPromise = null
    throw e
  }
}

export default function Terminal({ mode }: Props) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const shellWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null)
  const currentModeRef = useRef(mode)
  const dataDispRef = useRef<{ dispose: () => void } | null>(null)
  const initDoneRef = useRef(false)
  const lastModeRef = useRef<'node' | 'python' | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    currentModeRef.current = mode
  }, [mode])

  useEffect(() => {
    if (!termRef.current || initDoneRef.current) return
    initDoneRef.current = true

    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
      },
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)

    // Mobile: wait a tick so layout has size, then fit
    requestAnimationFrame(() => {
      try {
        fitAddon.fit()
      } catch {}
    })

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    const onResize = () => {
      try {
        fitAddon.fit()
      } catch {}
    }
    window.addEventListener('resize', onResize)

    term.writeln('\x1b[1;32mWeb-Termux\x1b[0m — Real browser terminal')
    term.writeln('WebContainers (Node) + Pyodide (Python)')
    term.writeln('')

    lastModeRef.current = mode
    void startRuntime(term, mode)

    return () => {
      window.removeEventListener('resize', onResize)
      dataDispRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    if (!initDoneRef.current || !xtermRef.current) return
    if (lastModeRef.current === mode) return
    lastModeRef.current = mode
    const term = xtermRef.current
    term.writeln(`\r\n\x1b[33m→ ${mode.toUpperCase()} mode\x1b[0m\r\n`)
    void startRuntime(term, mode)
  }, [mode])

  function detachInput() {
    dataDispRef.current?.dispose()
    dataDispRef.current = null
    try {
      shellWriterRef.current?.releaseLock()
    } catch {}
    shellWriterRef.current = null
  }

  async function startRuntime(term: XTerm, m: 'node' | 'python') {
    if (busyRef.current) {
      term.writeln('\x1b[33mPlease wait, still starting...\x1b[0m')
      return
    }
    busyRef.current = true
    detachInput()
    try {
      if (m === 'node') await startNode(term)
      else await startPython(term)
    } catch (err: any) {
      term.writeln(`\x1b[31mError: ${err?.message || err}\x1b[0m`)
      term.writeln('Refresh the page once (close tab fully on mobile).')
    } finally {
      busyRef.current = false
    }
  }

  async function startNode(term: XTerm) {
    term.writeln('Booting WebContainer...')
    const wc = await getWebContainer()
    term.writeln('\x1b[32mOK — WebContainer ready\x1b[0m')

    if (!filesMounted) {
      wc.on('server-ready', (port, url) => {
        term.writeln(`\r\n\x1b[1;32m[localhost]\x1b[0m port ${port}`)
        term.writeln(`\x1b[36m${url}\x1b[0m\r\n`)
      })

      await wc.mount({
        'package.json': {
          file: {
            contents: JSON.stringify({
              name: 'workspace',
              private: true,
              type: 'module',
              scripts: {
                server: 'node server.js',
                start: 'node server.js',
              },
              dependencies: { express: '^4.21.0' },
            }),
          },
        },
        'server.js': {
          file: {
            contents: `import express from 'express'
const app = express()
app.use(express.json())
app.get('/', (_, r) => r.json({ ok: true, endpoints: ['/','/api/health','/api/endpoints','/api/public-key','/api/token'] }))
app.get('/api/health', (_, r) => r.json({ status: 'ok' }))
app.get('/api/endpoints', (_, r) => r.json({ endpoints: [{method:'GET',path:'/api/health'},{method:'GET',path:'/api/public-key'},{method:'GET',path:'/api/token'}] }))
app.get('/api/public-key', (_, r) => r.json({ public_key: 'pk_live_demo_webtermux' }))
app.get('/api/token', (_, r) => r.json({ access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo' }))
app.listen(3000, () => console.log('listening 3000'))
`,
          },
        },
        'tools/curl.js': {
          file: {
            contents: `const args=process.argv.slice(2);let u=args.find(a=>!a.startsWith('-'));const j=args.includes('--json');
if(!u){console.log('Usage: node tools/curl.js [--json] <url>');process.exit(1)}
if(u.startsWith('localhost')||u.startsWith('127.'))u='http://'+u;
const res=await fetch(u);const t=await res.text();let o;try{o=JSON.parse(t)}catch{}
if(j&&o){console.log(JSON.stringify(o,null,2));if(o.endpoints)console.log('Endpoints:',o.endpoints);if(o.public_key)console.log('public_key:',o.public_key);if(o.access_token)console.log('access_token:',o.access_token)}
else console.log(t)
`,
          },
        },
        'tools/scan.js': {
          file: {
            contents: `const url=process.argv[2];const deep=process.argv.includes('--deep');
if(!url){console.log('Usage: node tools/scan.js <url> [--deep]');process.exit(1)}
let base=url;if(!/^https?:/.test(base))base='https://'+base;
const origin=new URL(base).origin;
console.log('Scan',origin);
const paths=['/','/api','/api/health','/openapi.json','/swagger.json','/robots.txt',...(deep?['/api/users','/api/token','/graphql']:[])];
for(const p of paths){
  try{
    const r=await fetch(origin+p,{signal:AbortSignal.timeout(8000)});
    if([200,201,301,302,401,403,405].includes(r.status)){
      console.log(r.status,p);
      if(r.ok){const t=await r.text();try{const j=JSON.parse(t);if(j.public_key)console.log('  public_key',j.public_key);if(j.access_token)console.log('  token',j.access_token);if(j.endpoints)console.log('  endpoints',j.endpoints)}catch{}}
    }
  }catch(e){}
}
console.log('Done');
`,
          },
        },
        'HELP.txt': {
          file: {
            contents: `npm run server
node tools/curl.js --json http://localhost:3000/
node tools/curl.js --json http://localhost:3000/api/public-key
node tools/scan.js https://httpbin.org --deep
ls
node -e "console.log('hi')"
`,
          },
        },
      })
      filesMounted = true
    }

    if (!installDone) {
      term.writeln('npm install (first time, wait)...')
      const inst = await wc.spawn('npm', ['install'])
      inst.output.pipeTo(
        new WritableStream({
          write(d) {
            term.write(d)
          },
        })
      )
      const code = await inst.exit
      installDone = true
      term.writeln(code === 0 ? '\x1b[32mnpm install OK\x1b[0m' : '\x1b[33mnpm install exit ' + code + '\x1b[0m')
    }

    // Ensure terminal has real size before jsh
    try {
      fitAddonRef.current?.fit()
    } catch {}
    const cols = Math.max(term.cols || 80, 40)
    const rows = Math.max(term.rows || 24, 10)

    term.writeln('Starting interactive shell (jsh)...')
    const shell = await wc.spawn('jsh', {
      terminal: { cols, rows },
    })

    // Output → terminal
    void shell.output.pipeTo(
      new WritableStream({
        write(data) {
          term.write(data)
        },
      })
    )

    const writer = shell.input.getWriter()
    shellWriterRef.current = writer

    // Input → shell (critical)
    dataDispRef.current = term.onData((data) => {
      if (currentModeRef.current !== 'node') return
      const w = shellWriterRef.current
      if (!w) return
      w.write(data).catch(() => {})
    })

    // Focus so mobile keyboard works
    term.focus()

    term.writeln('')
    term.writeln('\x1b[1;33mType a command and press Enter:\x1b[0m')
    term.writeln('  ls')
    term.writeln('  node -e "console.log(123)"')
    term.writeln('  cat HELP.txt')
    term.writeln('  npm run server')
    term.writeln('')
  }

  async function startPython(term: XTerm) {
    term.writeln('Loading Pyodide...')
    const py = await getPyodide()
    term.writeln('\x1b[32mPyodide OK\x1b[0m')
    term.writeln('Type Python, then Enter. exit() to stop.\r\n')
    let buf = ''
    dataDispRef.current = term.onData(async (data) => {
      if (currentModeRef.current !== 'python') return
      if (data === '\r') {
        term.write('\r\n')
        const code = buf.trim()
        buf = ''
        if (!code) {
          term.write('>>> ')
          return
        }
        if (code === 'exit()' || code === 'quit()') {
          term.writeln('Use Node button to switch back.')
          return
        }
        try {
          py.runPython(
            'import sys\nfrom io import StringIO\n_s=StringIO()\n_o=sys.stdout\nsys.stdout=_s'
          )
          const result = await py.runPythonAsync(code)
          const out = py.runPython('_s.getvalue()')
          py.runPython('sys.stdout=_o')
          if (out) term.write(out)
          if (result !== undefined && result !== null) term.writeln(String(result))
        } catch (e: any) {
          term.writeln('\x1b[31m' + (e.message || e) + '\x1b[0m')
        }
        term.write('>>> ')
      } else if (data === '\u007f') {
        if (buf.length) {
          buf = buf.slice(0, -1)
          term.write('\b \b')
        }
      } else {
        buf += data
        term.write(data)
      }
    })
    term.focus()
    term.write('>>> ')
  }

  return (
    <div
      ref={termRef}
      style={{ width: '100%', height: '100%', touchAction: 'manipulation' }}
      onClick={() => xtermRef.current?.focus()}
    />
  )
}
