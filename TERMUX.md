# Run Web-Termux on Termux (Android)

Web-Termux is a **browser app** (not a native Termux package).  
On Termux you start a local dev server, then open it in Chrome / Firefox.

## 1. Install tools in Termux

```bash
pkg update -y
pkg install -y nodejs-lts git
```

(Optional, if npm is slow: `pkg install -y yarn`)

## 2. Clone and run

```bash
cd ~
git clone https://github.com/kumarsumit68439-code/web-termux.git
cd web-termux
npm install
npm run dev
```

## 3. Open in browser

Terminal will show something like:

```text
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

- Same phone: open **Chrome** → `http://localhost:5173`
- Or use the Network IP from another device on same Wi‑Fi

**Important:** Use a Chromium browser (Chrome recommended). WebContainers need SharedArrayBuffer + COOP/COEP (already set in Vite config).

## 4. Production site (no Termux server needed)

Just open the Vercel URL in your phone browser — no clone required.

## Troubleshooting

| Problem | Fix |
|--------|-----|
| `npm install` fails | `pkg install nodejs-lts` again; clear cache `npm cache clean --force` |
| Port in use | `npm run dev -- --port 5174` |
| WebContainer error | Use HTTPS production URL on Vercel, or localhost with Chrome |
| Out of memory | Close other apps; WebContainers uses a lot of RAM |

## Inside the web terminal (after page loads)

```text
npm run server
node tools/curl.js --json http://localhost:3000/
node tools/scan.js https://httpbin.org --deep
```
