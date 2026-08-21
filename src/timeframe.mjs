import { DAY, HOUR } from "./lib.mjs";

// Closed allowlist. A timeframe absent from this table fails loudly at startup
// rather than silently borrowing another timeframe's cursor step.
const TIMEFRAME_MS = new Map([
  ["1h", HOUR],
  ["4h", 4 * HOUR],
  ["1d", DAY],
]);

export const SUPPORTED_TIMEFRAMES = [...TIMEFRAME_MS.keys()];

export function timeframeMs(interval) {
  const milliseconds = TIMEFRAME_MS.get(interval);
  if (milliseconds === undefined) {
    throw new Error(
      `Unsupported timeframe ${JSON.stringify(interval)}; supported: ${SUPPORTED_TIMEFRAMES.join(", ")}`,
    );
  }
  return milliseconds;
}

// The pagination cursor derives from the requested timeframe, never from a
// hard-coded constant. Advancing by one bar keeps the next page aligned on the
// first bar the current page did not cover.
export function nextCursor(lastOpenTime, interval) {
  if (!Number.isFinite(lastOpenTime)) {
    throw new Error(`Invalid lastOpenTime: ${lastOpenTime}`);
  }
  return lastOpenTime + timeframeMs(interval);
}

// The first and last slots a complete series must occupy, on the timeframe's own
// grid. Shared by the producer, which refuses to write a series that misses
// either end, and by the verifier, which refuses to certify one.
export function firstSlotAtOrAfter(fetchStartMs, interval) {
  const step = timeframeMs(interval);
  return Math.ceil(fetchStartMs / step) * step;
}

export function lastSlotBefore(asOfExclusiveMs, interval) {
  const step = timeframeMs(interval);
  return Math.floor((asOfExclusiveMs - step) / step) * step;
}

// Admissibility rule, applied exactly as specified: three independent
// conditions. The close is compared against the historical bound, never against
// the wall clock of the run.
export function isAdmissibleCandle(candle, fetchStartMs, asOfExclusiveMs) {
  return candle.openTime >= fetchStartMs
    && candle.openTime < asOfExclusiveMs
    && candle.closeTime < asOfExclusiveMs;
}
