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

    // Boot message
    term.writeln('\x1b[1;32mWeb-Termux\x1b[0m — Real browser terminal')
    term.writeln('Node.js via \x1b[36mWebContainers\x1b[0m  •  Python via \x1b[36mPyodide\x1b[0m')
    term.writeln('Type \x1b[33mhelp\x1b[0m for commands. Switching modes restarts the shell.\r\n')

    bootRuntime(term, mode)

    return () => {
      window.removeEventListener('resize', onResize)
      term.dispose()
    }
  }, [])

  // When mode changes, restart appropriate runtime
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

      // Minimal files so npm works
      await webcontainerInstance.mount({
        'package.json': {
          file: {
            contents: JSON.stringify({
              name: 'web-termux-workspace',
              private: true,
              type: 'module',
              scripts: {
                start: 'node index.js',
              },
            }, null, 2),
          },
        },
        'index.js': {
          file: {
            contents: `console.log('Hello from Web-Termux (real Node.js)!')\n`,
          },
        },
      })
    }

    // Start interactive jsh shell
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

    // Clean previous listeners by replacing onData
    term.onData((data) => {
      if (currentModeRef.current === 'node' && shellWriterRef.current) {
        shellWriterRef.current.write(data)
      }
    })

    term.writeln('Type commands like: ls, node index.js, npm install lodash, npx create-vite@latest, etc.\r\n')
  }

  async function bootPyodide(term: XTerm) {
    if (!pyodideInstance) {
      term.writeln('Loading Pyodide (real CPython via WebAssembly)...')
      // Dynamic import from CDN for simplicity in MVP
      // @ts-ignore
      const { loadPyodide } = await import('https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.mjs')
      pyodideInstance = await loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/',
      })
      term.writeln('\x1b[32mPyodide ready.\x1b[0m')
    }

    term.writeln('Python REPL started. Type Python code and press Enter. Use \x1b[33mexit()\x1b[0m or switch mode to leave.\r\n')

    let buffer = ''
    term.onData(async (data) => {
      if (currentModeRef.current !== 'python') return

      if (data === '\r') {
        // Enter
        term.write('\r\n')
        const code = buffer.trim()
        buffer = ''

        if (!code) {
          term.write('>>> ')
          return
        }

        if (code === 'exit()' || code === 'quit()') {
          term.writeln('Exiting Python mode. Switch to Node or type more code.')
          return
        }

        try {
          // Capture stdout
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
        // Backspace
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