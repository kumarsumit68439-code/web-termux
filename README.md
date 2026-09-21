# Web-Termux

**Real** browser-based terminal powered by:

- **WebContainers** (StackBlitz) → real Node.js + npm + jsh shell
- **Pyodide** → real CPython 3.x via WebAssembly
- **xterm.js** → professional terminal UI (same as VS Code)

## Features

- Real `npm install`, `node`, `npx`, Vite, etc. inside the browser
- Real Python interpreter + `micropip` for pure-Python packages
- Local storage friendly (history can be added)
- MediaDevices permission ready (extend for camera/mic commands)
- COOP/COEP headers configured for SharedArrayBuffer (required by WebContainers)

## Important Limitations (honest)

- This is **not** full Termux. No `pkg install`, no Android system packages, no real host filesystem access.
- Everything runs inside the browser sandbox (Wasm + virtual FS).
- WebContainers commercial production use may require a StackBlitz license (free for open-source / personal).
- Python networking / native extensions are limited compared to real CPython.

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:5173 (headers are set automatically).

## Deploy on Vercel

1. Push this repo to GitHub
2. Import in Vercel
3. The `vercel.json` already sets the required COOP/COEP headers

## Commands you can try (Node mode)

```
ls
node index.js
npm install lodash
npx --yes cowsay "Hello Web-Termux"
```

## Python mode

```python
print("Hello from real Pyodide")
import sys
sys.version
```

## Next steps you can add

- Supabase auth + save terminal sessions
- File System Access API for local folder mounting
- Media permission commands (`camera`, `mic`)
- Multi-tab terminals
- Package persistence across reloads

Built for real execution, not simulation.
