# Web-Termux

Real browser terminal: **WebContainers** (Node) + **Pyodide** (Python) + **xterm.js**.

## External site endpoint scanner

```bash
node tools/scan.js https://httpbin.org
node tools/scan.js https://api.github.com --deep
node tools/scan.js https://jsonplaceholder.typicode.com --deep
node tools/scan.js http://localhost:3000 --deep
```

### What it does (real HTTP)

1. Fetches the base URL  
2. Probes discovery paths: OpenAPI, Swagger, `robots.txt`, `/.well-known/openid-configuration`, `/api`, `/health`, …  
3. With `--deep`: also probes common API paths (`/api/users`, `/graphql`, `/wp-json`, …)  
4. Parses JSON / text for path patterns  
5. Extracts **public keys**, **API key patterns**, **JWT-like tokens**, `access_token` fields  

Status codes like **401/403** still count as “endpoint exists” (auth required).

### Limits (honest)

- Some sites block browser / WebContainer requests (CORS, WAF) — normal  
- Not a penetration tool: no auth bypass, no aggressive brute force  
- Private keys should never appear in public responses; if the scanner finds something sensitive, treat it carefully  

## Localhost + curl

```bash
npm run server
node tools/curl.js --json http://localhost:3000/
node tools/curl.js --json http://localhost:3000/api/public-key
node tools/endpoints.js
```

When the server starts, the terminal prints `[localhost] Preview URL`.

## Quick reference

| Command | Purpose |
|--------|---------|
| `npm run server` | Sample Express API on port 3000 |
| `node tools/curl.js --json <url>` | HTTP client + key/endpoint extract |
| `node tools/endpoints.js [url]` | Inspector for one URL |
| `node tools/scan.js <url> [--deep]` | **External site endpoint scanner** |
| `cat HELP.txt` | In-terminal help |

## Deploy

GitHub: https://github.com/kumarsumit68439-code/web-termux  
Vercel project `web-termux` auto-deploys from `main` (COOP/COEP headers in `vercel.json`).
