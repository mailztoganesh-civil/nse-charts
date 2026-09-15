/* NSE Charts — app.js
 * Renders NSE-listed stock candlesticks using TradingView's lightweight-charts,
 * sourcing OHLC data from a self-hosted Cloudflare Worker (worker/cloudflare-worker.js)
 * that proxies Yahoo Finance server-side. Fully independent of any third-party app.
 */

// ---------------------------------------------------------------------------
// 1. Curated symbol list for the autocomplete dropdown (NSE ticker : company)
//    Extend this list freely — it only powers suggestions, any NSE symbol can
//    still be typed directly (it will be looked up as SYMBOL.NS).
// ---------------------------------------------------------------------------
const NSE_SYMBOLS = [
  ["RELIANCE", "Reliance Industries"], ["TCS", "Tata Consultancy Services"],
  ["HDFCBANK", "HDFC Bank"], ["ICICIBANK", "ICICI Bank"], ["INFY", "Infosys"],
  ["HINDUNILVR", "Hindustan Unilever"], ["ITC", "ITC"], ["SBIN", "State Bank of India"],
  ["BHARTIARTL", "Bharti Airtel"], ["KOTAKBANK", "Kotak Mahindra Bank"],
  ["LT", "Larsen & Toubro"], ["AXISBANK", "Axis Bank"], ["BAJFINANCE", "Bajaj Finance"],
  ["ASIANPAINT", "Asian Paints"], ["MARUTI", "Maruti Suzuki"], ["HCLTECH", "HCL Technologies"],
  ["SUNPHARMA", "Sun Pharmaceutical"], ["TITAN", "Titan Company"], ["ULTRACEMCO", "UltraTech Cement"],
  ["WIPRO", "Wipro"], ["NESTLEIND", "Nestle India"], ["ONGC", "Oil & Natural Gas Corp"],
  ["NTPC", "NTPC"], ["POWERGRID", "Power Grid Corp"], ["M&M", "Mahindra & Mahindra"],
  ["TATAMOTORS", "Tata Motors"], ["TATASTEEL", "Tata Steel"], ["ADANIENT", "Adani Enterprises"],
  ["ADANIPORTS", "Adani Ports"], ["JSWSTEEL", "JSW Steel"], ["COALINDIA", "Coal India"],
  ["BAJAJFINSV", "Bajaj Finserv"], ["HINDALCO", "Hindalco Industries"], ["DRREDDY", "Dr. Reddy's Labs"],
  ["CIPLA", "Cipla"], ["GRASIM", "Grasim Industries"], ["EICHERMOT", "Eicher Motors"],
  ["BRITANNIA", "Britannia Industries"], ["DIVISLAB", "Divi's Laboratories"],
  ["HEROMOTOCO", "Hero MotoCorp"], ["BPCL", "Bharat Petroleum"], ["INDUSINDBK", "IndusInd Bank"],
  ["TECHM", "Tech Mahindra"], ["SBILIFE", "SBI Life Insurance"], ["HDFCLIFE", "HDFC Life Insurance"],
  ["APOLLOHOSP", "Apollo Hospitals"], ["BAJAJ-AUTO", "Bajaj Auto"], ["LTIM", "LTIMindtree"],
  ["SHRIRAMFIN", "Shriram Finance"], ["TATACONSUM", "Tata Consumer Products"],
  ["UPL", "UPL Limited"], ["ZOMATO", "Zomato"], ["DMART", "Avenue Supermarts (DMart)"],
  ["IRCTC", "IRCTC"], ["PAYTM", "One97 Communications (Paytm)"], ["NYKAA", "FSN E-Commerce (Nykaa)"],
];

// ---------------------------------------------------------------------------
// 2. Data fetching — via your own Cloudflare Worker (worker/cloudflare-worker.js),
//    which fetches Yahoo Finance server-side (no CORS restriction applies
//    server-to-server) and returns clean JSON with a CORS header attached.
//    Fully independent of any third-party backend — see README.md to deploy.
// ---------------------------------------------------------------------------
const OHLC_API_BASE = "https://nse-charts-proxy.mailztoganesh.workers.dev";

const REQUEST_TIMEOUT_MS = 10000;

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { cache: "no-store", signal: controller.signal }).finally(() => clearTimeout(timer));
}

function cacheKey(symbol, range, interval) {
  return `nsecharts:cache:${symbol}:${range}:${interval}`;
}

async function fetchChartData(symbol, range, interval) {
  const url = `${OHLC_API_BASE}?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;

  try {
    const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (!json.candles || !json.candles.length) throw new Error("No data returned for this symbol/range");

    const parsed = {
      candles: json.candles,
      currency: "INR",
      longName: json.symbol || symbol,
      regularMarketPrice: json.candles.at(-1).close,
      previousClose: json.candles.length > 1 ? json.candles.at(-2).close : json.candles[0].open,
    };
    try {
      localStorage.setItem(cacheKey(symbol, range, interval), JSON.stringify({ parsed, at: Date.now() }));
    } catch { /* storage full/unavailable — non-fatal */ }
    return parsed;
  } catch (err) {
    // Backend unreachable/asleep/queued — fall back to the last good cached response.
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey(symbol, range, interval)));
      if (cached) {
        const ageMin = Math.round((Date.now() - cached.at) / 60000);
        return { ...cached.parsed, stale: true, staleMinutes: ageMin };
      }
    } catch { /* no usable cache */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 3. Chart setup (TradingView lightweight-charts)
// ---------------------------------------------------------------------------
const chartEl = document.getElementById("chart");
const statusEl = document.getElementById("chartStatus");
const staleBanner = document.getElementById("staleBanner");

const chart = LightweightCharts.createChart(chartEl, {
  layout: {
    background: { color: "#0B0F14" },
    textColor: "#8B96A5",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: "#1B2330" },
    horzLines: { color: "#1B2330" },
  },
  rightPriceScale: { borderColor: "#26303F" },
  timeScale: { borderColor: "#26303F", timeVisible: true, secondsVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const series = chart.addCandlestickSeries({
  upColor: "#2EBD85", downColor: "#F2545B",
  borderUpColor: "#2EBD85", borderDownColor: "#F2545B",
  wickUpColor: "#2EBD85", wickDownColor: "#F2545B",
});

new ResizeObserver(() => {
  chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
}).observe(chartEl);

// ---------------------------------------------------------------------------
// 4. UI wiring
// ---------------------------------------------------------------------------
const symbolInput = document.getElementById("symbolInput");
const suggestionsEl = document.getElementById("suggestions");
const rangesEl = document.getElementById("ranges");
const watchToggle = document.getElementById("watchToggle");
const watchlistSection = document.getElementById("watchlistSection");
const watchlistItems = document.getElementById("watchlistItems");

const quoteSymbol = document.getElementById("quoteSymbol");
const quotePrice = document.getElementById("quotePrice");
const quoteChange = document.getElementById("quoteChange");
const quoteMeta = document.getElementById("quoteMeta");

let state = {
  symbol: localStorage.getItem("nsecharts:lastSymbol") || "RELIANCE",
  range: "1D",
  interval: "5m",
};

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("hidden", !msg);
  statusEl.classList.toggle("error", isError);
}

async function loadSymbol(sym, range, interval) {
  const ticker = sym.trim().toUpperCase();
  quoteSymbol.textContent = ticker;
  setStatus(`Loading ${ticker}…`);
  staleBanner.classList.add("hidden");
  try {
    const data = await fetchChartData(ticker, range, interval);
    if (!data.candles.length) throw new Error("No candles for this range/symbol");
    series.setData(data.candles);
    chart.timeScale().fitContent();
    setStatus("");
    staleBanner.textContent = data.stale ? `Live sources unreachable — showing data from ${data.staleMinutes}m ago` : "";
    staleBanner.classList.toggle("hidden", !data.stale);

    const price = data.regularMarketPrice ?? data.candles.at(-1).close;
    const prevClose = data.previousClose ?? data.candles[0].open;
    const change = price - prevClose;
    const pct = prevClose ? (change / prevClose) * 100 : 0;

    quotePrice.textContent = formatPrice(price, data.currency);
    quoteChange.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
    quoteChange.className = `quote-change ${change >= 0 ? "up" : "down"}`;
    quoteMeta.textContent = data.longName && data.longName !== ticker ? data.longName : "";

    localStorage.setItem("nsecharts:lastSymbol", ticker);
    updateWatchToggle(ticker);
    refreshWatchlistPrices();
  } catch (err) {
    setStatus(`Couldn't load ${ticker}: ${err.message}`, true);
    quotePrice.textContent = "—";
    quoteChange.textContent = "—";
    quoteChange.className = "quote-change";
    quoteMeta.textContent = "";
  }
}

function formatPrice(value, currency) {
  const symbol = currency === "INR" ? "₹" : "";
  return `${symbol}${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// --- symbol search / autocomplete ---
function renderSuggestions(query) {
  const q = query.trim().toUpperCase();
  suggestionsEl.innerHTML = "";
  if (!q) { suggestionsEl.classList.remove("open"); return; }

  const matches = NSE_SYMBOLS.filter(
    ([sym, name]) => sym.startsWith(q) || name.toUpperCase().includes(q)
  ).slice(0, 8);

  if (!matches.length) { suggestionsEl.classList.remove("open"); return; }

  for (const [sym, name] of matches) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<span>${sym}</span><span class="sugg-name">${name}</span>`;
    btn.addEventListener("click", () => selectSymbol(sym));
    suggestionsEl.appendChild(btn);
  }
  suggestionsEl.classList.add("open");
}

function selectSymbol(sym) {
  symbolInput.value = sym;
  suggestionsEl.classList.remove("open");
  state.symbol = sym;
  loadSymbol(sym, state.range, state.interval);
}

symbolInput.addEventListener("input", () => renderSuggestions(symbolInput.value));
symbolInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && symbolInput.value.trim()) {
    selectSymbol(symbolInput.value.trim());
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".symbol-search")) suggestionsEl.classList.remove("open");
});

// --- range selector ---
rangesEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  rangesEl.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  state.range = btn.dataset.range;
  state.interval = btn.dataset.interval;
  loadSymbol(state.symbol, state.range, state.interval);
});

// --- watchlist (persisted in localStorage) ---
function getWatchlist() {
  return JSON.parse(localStorage.getItem("nsecharts:watchlist") || "[]");
}
function saveWatchlist(list) {
  localStorage.setItem("nsecharts:watchlist", JSON.stringify(list));
}
function updateWatchToggle(sym) {
  const on = getWatchlist().includes(sym);
  watchToggle.classList.toggle("on", on);
  watchToggle.textContent = on ? "★" : "☆";
}
watchToggle.addEventListener("click", () => {
  const sym = state.symbol.toUpperCase();
  let list = getWatchlist();
  if (list.includes(sym)) list = list.filter((s) => s !== sym);
  else list.push(sym);
  saveWatchlist(list);
  updateWatchToggle(sym);
  renderWatchlist();
});

function renderWatchlist() {
  const list = getWatchlist();
  watchlistSection.classList.toggle("empty", list.length === 0);
  watchlistItems.innerHTML = "";
  for (const sym of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${sym}</span><span class="wl-price" data-sym="${sym}">…</span>`;
    li.addEventListener("click", (e) => {
      if (e.target.closest(".wl-remove")) return;
      state.symbol = sym;
      symbolInput.value = sym;
      loadSymbol(sym, state.range, state.interval);
    });
    const removeBtn = document.createElement("button");
    removeBtn.className = "wl-remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      saveWatchlist(getWatchlist().filter((s) => s !== sym));
      updateWatchToggle(state.symbol.toUpperCase());
      renderWatchlist();
    });
    li.appendChild(removeBtn);
    watchlistItems.appendChild(li);
  }
}

async function refreshWatchlistPrices() {
  for (const sym of getWatchlist()) {
    const cell = watchlistItems.querySelector(`.wl-price[data-sym="${sym}"]`);
    if (!cell) continue;
    try {
      const data = await fetchChartData(sym, "1D", "5m");
      const last = data.candles.at(-1);
      if (last) cell.textContent = formatPrice(last.close, data.currency);
    } catch {
      cell.textContent = "—";
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Boot
// ---------------------------------------------------------------------------
symbolInput.value = state.symbol;
renderWatchlist();
loadSymbol(state.symbol, state.range, state.interval);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
