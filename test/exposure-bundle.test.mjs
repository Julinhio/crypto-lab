import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DAY, HOUR } from "../src/lib.mjs";
import {
  SUPPORTED_TIMEFRAMES,
  isAdmissibleCandle,
  nextCursor,
  timeframeMs,
} from "../src/timeframe.mjs";
import {
  BINANCE_DATA_API,
  PreflightError,
  SourceLockError,
  assertLockedSource,
  lockedUrl,
  preflight,
} from "../src/binance-source.mjs";
import { downloadKlines, inspectSeries } from "../src/klines.mjs";
import { bundlePreimage, buildExposureBundle, computeBundleSha256 } from "../src/exposure-bundle.mjs";
import { loadExposureConfig } from "../src/exposure-config.mjs";

const AS_OF = Date.parse("2026-08-21T00:00:00.000Z");
const FETCH_START = Date.parse("2020-01-01T00:00:00.000Z");

function temporaryDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// --- Timeframe generalisation -------------------------------------------------
// These fail if the cursor advances by a constant instead of by the requested
// timeframe, which is exactly the hour-shaped constant this bundle had to remove.

test("cursor advances by the requested timeframe, not by a constant", () => {
  const anchor = Date.parse("2020-06-15T16:00:00.000Z");
  assert.equal(nextCursor(anchor, "1h") - anchor, HOUR);
  assert.equal(nextCursor(anchor, "4h") - anchor, 4 * HOUR);
  assert.equal(nextCursor(anchor, "1d") - anchor, DAY);
});

test("cursor advancement differs across timeframes", () => {
  const anchor = Date.parse("2020-06-15T16:00:00.000Z");
  const steps = SUPPORTED_TIMEFRAMES.map((tf) => nextCursor(anchor, tf) - anchor);
  assert.equal(
    new Set(steps).size,
    SUPPORTED_TIMEFRAMES.length,
    "a timeframe-independent cursor would collapse these steps onto one value",
  );
});

test("an unsupported timeframe fails loudly instead of borrowing a step", () => {
  assert.throws(() => timeframeMs("2h"), /Unsupported timeframe/);
  assert.throws(() => nextCursor(0, "15m"), /Unsupported timeframe/);
});

test("the paginator requests the next page one bar after the last one it saw", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(Number(new URL(url).searchParams.get("startTime")));
    if (requested.length > 1) return { ok: true, json: async () => [] };
    const page = Array.from({ length: 1000 }, (_, index) => {
      const open = FETCH_START + index * 4 * HOUR;
      return [open, 1, 1, 1, 1, 1, open + 4 * HOUR - 1, 1, 1, 1, 1];
    });
    return { ok: true, json: async () => page };
  };
  await downloadKlines({
    symbol: "BTCUSDT",
    interval: "4h",
    fetchStartMs: FETCH_START,
    asOfExclusiveMs: AS_OF,
    fetchImpl,
  });
  const lastOpen = FETCH_START + 999 * 4 * HOUR;
  assert.equal(requested[0], FETCH_START);
  assert.equal(
    requested[1],
    lastOpen + 4 * HOUR,
    "an hour-shaped cursor would have asked for lastOpen + 1h here",
  );
});

// --- Admissibility rule -------------------------------------------------------
// The three conditions are exercised one at a time. The close condition can only
// be reached with a synthetic candle: with bounds aligned on the timeframe grid,
// real Binance data never violates it.

test("a candle opening before fetchStart is discarded", () => {
  const candle = { openTime: FETCH_START - HOUR, closeTime: FETCH_START - 1 };
  assert.equal(isAdmissibleCandle(candle, FETCH_START, AS_OF), false);
});

test("a candle opening at fetchStart is retained", () => {
  const candle = { openTime: FETCH_START, closeTime: FETCH_START + 4 * HOUR - 1 };
  assert.equal(isAdmissibleCandle(candle, FETCH_START, AS_OF), true);
});

test("a candle opening at or after asOfExclusive is discarded", () => {
  const candle = { openTime: AS_OF, closeTime: AS_OF + 4 * HOUR - 1 };
  assert.equal(isAdmissibleCandle(candle, FETCH_START, AS_OF), false);
});

test("a candle opening before asOfExclusive but closing at or after it is discarded", () => {
  const candle = { openTime: AS_OF - HOUR, closeTime: AS_OF + 3 * HOUR - 1 };
  assert.equal(candle.openTime < AS_OF, true, "the open condition alone would keep it");
  assert.equal(candle.closeTime >= AS_OF, true);
  assert.equal(isAdmissibleCandle(candle, FETCH_START, AS_OF), false);
});

test("the close condition is judged against the historical bound, not the wall clock", () => {
  // A candle still open at fetch time but fully closed before the historical
  // bound stays admissible: only the bound decides.
  const candle = { openTime: AS_OF - DAY, closeTime: AS_OF - 1 };
  assert.equal(isAdmissibleCandle(candle, FETCH_START, AS_OF), true);
});

test("the paginator counts what the admissibility rule discards", async () => {
  const straddling = AS_OF - 2 * HOUR;
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [
      [FETCH_START, 1, 1, 1, 1, 1, FETCH_START + 4 * HOUR - 1, 1, 1, 1, 1],
      [straddling, 1, 1, 1, 1, 1, straddling + 4 * HOUR - 1, 1, 1, 1, 1],
    ],
  });
  const result = await downloadKlines({
    symbol: "BTCUSDT",
    interval: "4h",
    fetchStartMs: FETCH_START,
    asOfExclusiveMs: AS_OF,
    fetchImpl,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].t, FETCH_START);
  assert.equal(result.discardedByAdmissibility, 1);
});

// --- Preflight and source lock ------------------------------------------------

test("a failing preflight aborts the run before any download", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return { ok: false, status: 451, json: async () => [] };
  };
  const bundleDir = temporaryDir("exposure-preflight-");
  const config = loadExposureConfig("config/crypto-buddy-exposure-v1.json");
  await assert.rejects(
    () => buildExposureBundle({ config, bundleDir, fetchImpl }),
    PreflightError,
  );
  assert.equal(calls.length, 1, "no kline request may follow a failed preflight");
  assert.match(calls[0], /\/api\/v3\/ping$/);
  assert.equal(fs.existsSync(path.join(bundleDir, "manifest.json")), false);
  fs.rmSync(bundleDir, { recursive: true, force: true });
});

test("a preflight that cannot connect aborts rather than falling back", async () => {
  const fetchImpl = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  await assert.rejects(() => preflight({ fetchImpl }), PreflightError);
});

test("the preflight probes the locked source only", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url).origin);
    return { ok: true, status: 200 };
  };
  await preflight({ fetchImpl });
  assert.deepEqual(calls, [new URL(BINANCE_DATA_API).origin]);
});

test("no alternative source can be substituted, api.binance.com included", () => {
  assert.throws(() => assertLockedSource("https://api.binance.com"), SourceLockError);
  assert.throws(() => assertLockedSource("https://api1.binance.com"), SourceLockError);
  assert.throws(() => assertLockedSource("http://localhost:8080"), SourceLockError);
  assert.throws(() => assertLockedSource(""), SourceLockError);
  assert.equal(assertLockedSource(BINANCE_DATA_API), BINANCE_DATA_API);
});

test("a config declaring another source is refused at startup", () => {
  const dir = temporaryDir("exposure-config-");
  const configPath = path.join(dir, "swapped.json");
  const config = JSON.parse(
    fs.readFileSync("config/crypto-buddy-exposure-v1.json", "utf8"),
  );
  config.source = "https://api.binance.com";
  fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
  assert.throws(() => loadExposureConfig(configPath), SourceLockError);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("every request the paginator builds targets the locked origin", async () => {
  const origins = new Set();
  const fetchImpl = async (url) => {
    origins.add(new URL(url).origin);
    return { ok: true, json: async () => [] };
  };
  await downloadKlines({
    symbol: "BTCUSDT",
    interval: "1d",
    fetchStartMs: FETCH_START,
    asOfExclusiveMs: AS_OF,
    fetchImpl,
  });
  assert.deepEqual([...origins], [new URL(BINANCE_DATA_API).origin]);
  assert.equal(lockedUrl("/api/v3/klines").origin, new URL(BINANCE_DATA_API).origin);
});

// --- Continuity controls ------------------------------------------------------

test("continuity controls report gaps, duplicates and ordering without repairing", () => {
  const rows = [
    { t: 0 },
    { t: 4 * HOUR },
    { t: 16 * HOUR },
  ];
  const report = inspectSeries(rows, 4 * HOUR);
  assert.equal(report.duplicatesOk, true);
  assert.equal(report.strictlyOrdered, true);
  assert.equal(report.gapCount, 1);
  assert.equal(report.gaps[0].missingBars, 2);
  assert.equal(rows.length, 3, "the report must not alter the series");
});

test("a clean series reports no gap", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ t: index * DAY }));
  const report = inspectSeries(rows, DAY);
  assert.equal(report.gapCount, 0);
  assert.equal(report.duplicates, 0);
  assert.equal(report.strictlyOrdered, true);
});

// --- Bundle hash --------------------------------------------------------------

const PREIMAGE_INPUT = {
  bundleId: "crypto-buddy-exposure-v1",
  fetchStart: "2020-01-01T00:00:00.000Z",
  evaluationStart: "2021-01-01T00:00:00.000Z",
  asOfExclusive: "2026-08-21T00:00:00.000Z",
  producerSourceSha256: "a".repeat(64),
  acquisitionConfigSha256: "b".repeat(64),
  files: [
    { file: "raw/BTCUSDT-4h.json", sha256: "c".repeat(64) },
    { file: "raw/ETHUSDT-1d.json", sha256: "d".repeat(64) },
  ],
};

test("the bundle hash ignores the order the files were produced in", () => {
  const forward = computeBundleSha256(bundlePreimage(PREIMAGE_INPUT));
  const reversed = computeBundleSha256(
    bundlePreimage({ ...PREIMAGE_INPUT, files: [...PREIMAGE_INPUT.files].reverse() }),
  );
  assert.equal(forward, reversed);
});

test("the bundle hash ignores fields the manifest carries but the preimage does not", () => {
  const withNoise = bundlePreimage({
    ...PREIMAGE_INPUT,
    files: PREIMAGE_INPUT.files.map((item) => ({
      ...item,
      rows: 1234,
      generation_git_commit: "deadbeef",
    })),
  });
  assert.equal(
    computeBundleSha256(withNoise),
    computeBundleSha256(bundlePreimage(PREIMAGE_INPUT)),
  );
  assert.deepEqual(Object.keys(withNoise.files[0]).sort(), ["file", "sha256"]);
});

test("the bundle hash moves when any covered field moves", () => {
  const baseline = computeBundleSha256(bundlePreimage(PREIMAGE_INPUT));
  const mutations = [
    { bundleId: "other-bundle" },
    { fetchStart: "2020-01-02T00:00:00.000Z" },
    { evaluationStart: "2021-01-02T00:00:00.000Z" },
    { asOfExclusive: "2026-08-22T00:00:00.000Z" },
    { producerSourceSha256: "e".repeat(64) },
    { acquisitionConfigSha256: "f".repeat(64) },
    { files: [{ file: "raw/BTCUSDT-4h.json", sha256: "0".repeat(64) }] },
  ];
  for (const mutation of mutations) {
    assert.notEqual(
      computeBundleSha256(bundlePreimage({ ...PREIMAGE_INPUT, ...mutation })),
      baseline,
      `mutation ${Object.keys(mutation)[0]} left the bundle hash unchanged`,
    );
  }
});

test("the bundle hash is stable across repeated computation", () => {
  const first = computeBundleSha256(bundlePreimage(PREIMAGE_INPUT));
  const second = computeBundleSha256(bundlePreimage(PREIMAGE_INPUT));
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

// --- Configuration bounds -----------------------------------------------------

test("the shipped configuration matches the arbitrated parameters", () => {
  const config = loadExposureConfig("config/crypto-buddy-exposure-v1.json");
  assert.equal(config.bundleId, "crypto-buddy-exposure-v1");
  assert.equal(config.source, BINANCE_DATA_API);
  assert.deepEqual([...config.universe].sort(), ["BNBUSDT", "BTCUSDT", "ETHUSDT", "XRPUSDT"]);
  assert.deepEqual([...config.timeframes].sort(), ["1d", "4h"]);
  assert.equal(config.fetchStartInclusive, "2020-01-01T00:00:00.000Z");
  assert.equal(config.evaluationStartInclusive, "2021-01-01T00:00:00.000Z");
  assert.equal(config.asOfExclusive, "2026-08-21T00:00:00.000Z");
  assert.ok(config.fetchStartMs < config.evaluationStartMs);
  assert.ok(config.evaluationStartMs < config.asOfExclusiveMs);
});

test("the configuration loader rejects malformed input at startup", () => {
  const dir = temporaryDir("exposure-bounds-");
  const baseline = JSON.parse(
    fs.readFileSync("config/crypto-buddy-exposure-v1.json", "utf8"),
  );
  const cases = [
    [{ schemaVersion: 2 }, /Unsupported schemaVersion/],
    [{ bundleId: "Not Kebab" }, /kebab-case/],
    [{ universe: [] }, /non-empty array/],
    [{ universe: ["BTCUSDT", "BTCUSDT"] }, /duplicates/],
    [{ universe: ["btcusdt"] }, /invalid entry/],
    [{ timeframes: ["15m"] }, /invalid entry/],
    [{ timeframes: ["4h", "4h"] }, /duplicates/],
    [{ fetchStartInclusive: "2027-01-01T00:00:00.000Z" }, /fetchStartInclusive </],
    [{ asOfExclusive: "2020-06-01T00:00:00.000Z" }, /fetchStartInclusive </],
    [{ asOfExclusive: "2026-08-21" }, /canonical UTC instant/],
    [{ asOfExclusive: "not-a-date" }, /valid instant/],
    [{ extraKey: true }, /Unknown configuration keys/],
  ];
  for (const [patch, pattern] of cases) {
    const configPath = path.join(dir, `case-${Object.keys(patch)[0]}-${Math.abs(JSON.stringify(patch).length)}.json`);
    fs.writeFileSync(configPath, JSON.stringify({ ...baseline, ...patch }), "utf8");
    assert.throws(() => loadExposureConfig(configPath), pattern, JSON.stringify(patch));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a missing key is refused rather than defaulted", () => {
  const dir = temporaryDir("exposure-missing-");
  const baseline = JSON.parse(
    fs.readFileSync("config/crypto-buddy-exposure-v1.json", "utf8"),
  );
  delete baseline.evaluationStartInclusive;
  const configPath = path.join(dir, "missing.json");
  fs.writeFileSync(configPath, JSON.stringify(baseline), "utf8");
  assert.throws(() => loadExposureConfig(configPath), /Missing configuration keys/);
  fs.rmSync(dir, { recursive: true, force: true });
});
