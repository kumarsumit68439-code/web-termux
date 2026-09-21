import { useEffect, useState } from 'react'
import Terminal from './components/Terminal'
import './App.css'

export default function App() {
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<'node' | 'python'>('node')

  useEffect(() => {
    setReady(true)
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="prompt">$</span> Web-Termux
        </div>
        <div className="modes">
          <button
            className={mode === 'node' ? 'active' : ''}
            onClick={() => setMode('node')}
            type="button"
          >
            Node / jsh
          </button>
          <button
            className={mode === 'python' ? 'active' : ''}
            onClick={() => setMode('python')}
            type="button"
          >
            Python (Pyodide)
          </button>
        </div>
        <div className="status">Real execution • WebContainers + Pyodide</div>
      </header>
      <main className="terminal-wrapper">{ready && <Terminal mode={mode} />}</main>
    </div>
  )
}
