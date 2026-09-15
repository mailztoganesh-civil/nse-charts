/* NSE Charts — app.js
 * Renders NSE-listed stock candlesticks using TradingView's lightweight-charts,
 * sourcing OHLC data from Yahoo Finance's public chart endpoint (proxied for CORS).
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
// 2. Data fetching — Yahoo Finance chart API, routed through CORS proxies
//    since browsers cannot call it cross-origin directly. Strategies are
//    tried in order; the first one that returns valid data wins.
//    See README.md to swap in your own proxy/worker for production use.
// ---------------------------------------------------------------------------
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

const PROXY_STRATEGIES = [
  (url) => url, // direct — works if you deploy your own same-origin proxy at this path
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function fetchYahooChart(symbol, range, interval) {
  const yahooUrl = `${YAHOO_BASE}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  let lastError;
  for (const wrap of PROXY_STRATEGIES) {
    try {
      const res = await fetch(wrap(yahooUrl), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error(json?.chart?.error?.description || "No data returned");
      return parseYahooResult(result);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("All data sources failed");
}

function parseYahooResult(result) {
  const ts = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const o = quote.open?.[i], h = quote.high?.[i], l = quote.low?.[i], c = quote.close?.[i];
    if ([o, h, l, c].some((v) => v === null || v === undefined)) continue;
    candles.push({ time: ts[i], open: o, high: h, low: l, close: c });
  }
  return {
    candles,
    currency: result.meta?.currency || "INR",
    longName: result.meta?.longName || result.meta?.symbol,
    regularMarketPrice: result.meta?.regularMarketPrice,
    previousClose: result.meta?.chartPreviousClose ?? result.meta?.previousClose,
  };
}

// ---------------------------------------------------------------------------
// 3. Chart setup (TradingView lightweight-charts)
// ---------------------------------------------------------------------------
const chartEl = document.getElementById("chart");
const statusEl = document.getElementById("chartStatus");

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

function toYahooSymbol(sym) {
  const s = sym.trim().toUpperCase();
  return s.endsWith(".NS") ? s : `${s}.NS`;
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("hidden", !msg);
  statusEl.classList.toggle("error", isError);
}

async function loadSymbol(sym, range, interval) {
  const ticker = sym.trim().toUpperCase();
  quoteSymbol.textContent = ticker;
  setStatus(`Loading ${ticker}…`);
  try {
    const data = await fetchYahooChart(toYahooSymbol(ticker), range, interval);
    if (!data.candles.length) throw new Error("No candles for this range/symbol");
    series.setData(data.candles);
    chart.timeScale().fitContent();
    setStatus("");

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
      const data = await fetchYahooChart(toYahooSymbol(sym), "1D", "5m");
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
