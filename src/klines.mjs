import { lockedUrl } from "./binance-source.mjs";
import { isAdmissibleCandle, nextCursor } from "./timeframe.mjs";

const PAGE_LIMIT = 1000;

async function getJson(url, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

function toCandle(row) {
  return {
    t: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
    closeTime: Number(row[6]),
    qv: Number(row[7]),
    trades: Number(row[8]),
    takerBuyBase: Number(row[9]),
    takerBuyQuote: Number(row[10]),
  };
}

// Shared paginator for every timeframe. The cursor step comes from `interval`
// via nextCursor; there is no hour-shaped constant in this loop.
export async function downloadKlines({
  symbol,
  interval,
  fetchStartMs,
  asOfExclusiveMs,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}) {
  const kept = new Map();
  const discarded = new Set();
  let cursor = fetchStartMs;
  let requests = 0;
  while (cursor < asOfExclusiveMs) {
    const url = lockedUrl("/api/v3/klines", {
      symbol,
      interval,
      startTime: cursor,
      endTime: asOfExclusiveMs - 1,
      limit: PAGE_LIMIT,
    });
    const page = await getJson(url, fetchImpl, timeoutMs);
    requests += 1;
    if (!page.length) break;
    for (const row of page) {
      const candle = toCandle(row);
      if (
        isAdmissibleCandle(
          { openTime: candle.t, closeTime: candle.closeTime },
          fetchStartMs,
          asOfExclusiveMs,
        )
      ) {
        kept.set(candle.t, candle);
      } else {
        discarded.add(candle.t);
      }
    }
    const advanced = nextCursor(Number(page.at(-1)[0]), interval);
    if (advanced <= cursor) {
      throw new Error(`Non-advancing cursor for ${symbol} ${interval}`);
    }
    cursor = advanced;
    if (page.length < PAGE_LIMIT) break;
  }
  const rows = [...kept.values()].sort((left, right) => left.t - right.t);
  return { rows, discardedByAdmissibility: discarded.size, requests };
}

// Continuity controls, reported and never repaired. A gap is a missing bar
// between two consecutive kept bars, expressed on the timeframe's own grid.
export function inspectSeries(rows, intervalMilliseconds) {
  const seen = new Set();
  let duplicates = 0;
  let strictlyOrdered = true;
  const gaps = [];
  for (const [index, row] of rows.entries()) {
    if (seen.has(row.t)) duplicates += 1;
    seen.add(row.t);
    if (index === 0) continue;
    const previous = rows[index - 1];
    if (row.t <= previous.t) strictlyOrdered = false;
    const delta = row.t - previous.t;
    if (delta !== intervalMilliseconds) {
      gaps.push({
        afterOpenTime: new Date(previous.t).toISOString(),
        beforeOpenTime: new Date(row.t).toISOString(),
        missingBars: delta / intervalMilliseconds - 1,
      });
    }
  }
  return {
    duplicates,
    duplicatesOk: duplicates === 0,
    strictlyOrdered,
    gapCount: gaps.length,
    gaps,
  };
}
