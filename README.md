# NSE Charts

A lightweight, installable PWA that shows candlestick charts for NSE-listed
stocks (`SYMBOL.NS`), built with [TradingView's lightweight-charts](https://github.com/tradingview/lightweight-charts)
and Yahoo Finance's public chart data.

- Type any NSE ticker (RELIANCE, TCS, INFY, …) or pick from the dropdown
- Switch range: 1D / 5D / 1M / 6M / 1Y / 5Y
- Star a symbol to add it to a persistent watchlist
- Installable on Android as a standalone app via PWABuilder

## 1. Run it locally

Any static file server works — the browser needs to fetch `manifest.json`
over HTTP(S), not `file://`.

```bash
npx serve .
# or: python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## 2. Put it on GitHub + GitHub Pages

```bash
git init
git add .
git commit -m "NSE Charts PWA"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source → Deploy from a branch →
`main` / root**. After a minute your app is live at:

```
https://<your-username>.github.io/<repo-name>/
```

This URL **must be HTTPS** (GitHub Pages gives you this for free) —
PWABuilder and Android's Trusted Web Activity both require it.

## 3. Package it as an Android app with PWABuilder

1. Go to **[pwabuilder.com](https://www.pwabuilder.com)**.
2. Paste your GitHub Pages URL and click **Start**.
3. PWABuilder audits the manifest + service worker. This app already ships
   both, so it should score well out of the box. Fix anything it flags in
   `manifest.json` if your fork changes it.
4. Click **Package for stores → Android**.
5. Options that matter:
   - **Package ID**: reverse-domain style, e.g. `com.yourname.nsecharts`.
   - **Signing key**: let PWABuilder generate one for testing, or upload
     your own keystore if you already have one for Play Store releases.
   - **Display mode**: `standalone` (already set in the manifest).
6. Download the generated package. You'll get a `.aab` (for Play Store
   upload) and/or a `.apk` (for direct sideloading/testing).
7. To test immediately: transfer the `.apk` to an Android device (or an
   emulator) and install it directly. For Play Store, upload the `.aab`
   through the Play Console as usual.

The Android wrapper is a **Trusted Web Activity** — it's your live
GitHub Pages site running full-screen with no browser chrome. Any update
you push to `main` goes live immediately without rebuilding the Android
package, as long as you don't change the manifest's icons/name (those are
baked into the package at build time).

## 4. About the data source (read this before relying on it)

Yahoo Finance's chart endpoint doesn't send CORS headers, so a browser
can't call it directly from your GitHub Pages origin. This app routes
requests through public CORS proxies (`corsproxy.io`, `allorigins.win`) as
a zero-setup default — fine for personal use, but they're free/shared
services with **no uptime or rate-limit guarantee**.

For anything more reliable, deploy your own tiny proxy and it'll be tried
first automatically (see `PROXY_STRATEGIES` in `app.js`, first entry
passes the URL through unchanged). A Cloudflare Worker is the easiest
option:

```js
// worker.js — deploy on Cloudflare Workers (free tier is plenty)
export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("Missing url param", { status: 400 });
    const res = await fetch(target);
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(res.body, { status: res.status, headers });
  }
};
```

Then change the first entry in `PROXY_STRATEGIES` (in `app.js`) to route
through it, e.g. `(url) => \`https://your-worker.workers.dev/?url=${encodeURIComponent(url)}\``.

## 5. Customizing

- **Symbol list**: `NSE_SYMBOLS` in `app.js` only powers the autocomplete
  dropdown — any valid NSE symbol can be typed directly even if it's not
  in the list. Add more entries as needed.
- **Colors/fonts**: all design tokens are CSS custom properties at the top
  of `styles.css` (`--ink-0`, `--amber`, `--up`, `--down`, etc.).
- **Icons**: `icons/icon-192.png`, `icons/icon-512.png`,
  `icons/icon-maskable-512.png` — replace with your own art if you want a
  different mark (keep the same filenames/sizes, or update `manifest.json`).

## File structure

```
index.html    — app shell
styles.css    — design tokens + layout
app.js        — data fetching, chart rendering, search, watchlist
manifest.json — PWA manifest (used by PWABuilder)
sw.js         — service worker (offline app-shell caching)
icons/        — app icons (192, 512, maskable 512)
```
