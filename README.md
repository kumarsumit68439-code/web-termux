# Web-Termux

**Real** browser-based terminal powered by:

- **WebContainers** (StackBlitz) → real Node.js + npm + jsh shell
- **Pyodide** → real CPython via WebAssembly
- **xterm.js** → professional terminal UI

## Localhost + curl + endpoints / tokens

WebContainers networking is **not** classic OS `127.0.0.1` from outside the tab, but inside the container you get real local servers.

### 1. Start sample local server

```bash
npm run server
```

When ready, the terminal prints:

```text
[localhost] Server ready on port 3000
Preview URL: https://....webcontainer-api.io/
```

You can open that Preview URL in a new tab **or** curl from inside the terminal:

```bash
node tools/curl.js --json http://localhost:3000/
node tools/curl.js --json http://localhost:3000/api/endpoints
node tools/curl.js --json http://localhost:3000/api/public-key
node tools/curl.js --json http://localhost:3000/api/token
```

### 2. Curl (real fetch-based CLI)

```bash
node tools/curl.js [options] <url>

# Options
-X METHOD          # GET, POST, ...
-H "Key: Value"    # headers
-d BODY            # body
-i                 # include response headers
--json             # pretty JSON + auto extract endpoints / public keys / tokens
```

Example with token + endpoints:

```bash
node tools/curl.js --json http://localhost:3000/api/endpoints
node tools/curl.js --json http://localhost:3000/api/public-key
```

### 3. Endpoints + public key / token inspector

```bash
node tools/endpoints.js
node tools/endpoints.js http://localhost:3000/api/endpoints
```

This prints:

- All listed API endpoints
- Public keys
- Access tokens / JWT-style tokens found in JSON responses

### Sample API routes (from `server.js`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Root info + endpoint list |
| GET | `/api/health` | Health check |
| GET | `/api/endpoints` | Full endpoint catalog |
| GET | `/api/public-key` | Demo public key |
| GET | `/api/token` | Demo Bearer / JWT-style token |
| POST | `/api/echo` | Echo body + headers |

## Limitations (honest)

- Not full Termux / not real host OS localhost for every program outside the container.
- Native `curl` binary is not present; we ship a **real** Node `fetch`-based `tools/curl.js` that works the same for HTTP(S).
- WebContainers commercial production may need a StackBlitz license.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:5173 (COOP/COEP headers are set).

## Deploy

Repo is already linked to Vercel project `web-termux`. Push to `main` auto-deploys. `vercel.json` sets required COOP/COEP headers.
