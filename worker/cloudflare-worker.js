const RANGE_MAP = { "1D": "1d", "5D": "5d", "1M": "1mo", "6M": "6mo", "1Y": "1y", "5Y": "5y" };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(obj, status) {
  if (!status) status = 200;
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS),
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    var url = new URL(request.url);
    var symbolRaw = url.searchParams.get("symbol");
    if (!symbolRaw) return json({ error: "symbol is required" }, 400);

    var symbol = symbolRaw.trim().toUpperCase();
    var ticker = symbol.indexOf(".NS") === symbol.length - 3 ? symbol : symbol + ".NS";
    var rangeRaw = url.searchParams.get("range") || "1y";
    var range = RANGE_MAP[rangeRaw.toUpperCase()] || rangeRaw.toLowerCase();
    var interval = url.searchParams.get("interval") || "1d";

    var yahooUrl = "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(ticker) +
      "?range=" + range + "&interval=" + interval + "&includePrePost=false";

    try {
      var res = await fetch(yahooUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "application/json",
        },
      });

      if (!res.ok) return json({ error: "Yahoo returned HTTP " + res.status }, 502);

      var data = await res.json();
      var result = data && data.chart && data.chart.result && data.chart.result[0];
      if (!result) {
        var errMsg = (data && data.chart && data.chart.error && data.chart.error.description) || "No data returned";
        return json({ error: errMsg }, 502);
      }

      var meta = result.meta || {};
      var livePrice = meta.regularMarketPrice;

      var ts = result.timestamp || [];
      var quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
      var candles = [];
      for (var i = 0; i < ts.length; i++) {
        var o = quote.open ? quote.open[i] : undefined;
        var h = quote.high ? quote.high[i] : undefined;
        var l = quote.low ? quote.low[i] : undefined;
        var c = quote.close ? quote.close[i] : undefined;
        var v = quote.volume ? quote.volume[i] : undefined;

        // Skip only when there's truly no data at all for this bar.
        if (o === null || o === undefined) continue;

        // The most recent bar can still be "in progress" — Yahoo often
        // leaves close/high/low null until the bar finalizes. Use the live
        // price as a stand-in so today's still-forming candle isn't dropped.
        if (c === null || c === undefined) {
          c = (livePrice !== null && livePrice !== undefined) ? livePrice : o;
        }
        if (h === null || h === undefined) h = Math.max(o, c);
        if (l === null || l === undefined) l = Math.min(o, c);

        candles.push({
          time: ts[i],
          open: round2(o),
          high: round2(h),
          low: round2(l),
          close: round2(c),
          volume: v === null || v === undefined ? 0 : Math.round(v),
        });
      }

      if (candles.length === 0) {
        return json({ error: "No candles for " + symbol + " (" + range + "/" + interval + ")" }, 502);
      }

      return json({
        symbol: symbol,
        currency: meta.currency || "INR",
        longName: meta.longName || symbol,
        regularMarketPrice: meta.regularMarketPrice,
        previousClose: meta.chartPreviousClose !== undefined ? meta.chartPreviousClose : meta.previousClose,
        candles: candles,
      });
    } catch (err) {
      return json({ error: (err && err.message) || "Upstream fetch failed" }, 502);
    }
  },
};
