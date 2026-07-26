import fs from "node:fs";
import path from "node:path";
import { HOUR, ensureDir, sha256File, writeCanonicalJson } from "./lib.mjs";

const API = "https://data-api.binance.vision";

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

export async function downloadDataset(config, dataDir) {
  const rawDir = path.resolve(dataDir, "raw");
  ensureDir(rawDir);
  const files = [];
  for (const symbol of config.universe) {
    const rows = [];
    let cursor = config.fetchStartMs;
    while (cursor < config.asOfExclusiveMs) {
      const url = new URL("/api/v3/klines", API);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("interval", config.interval);
      url.searchParams.set("startTime", String(cursor));
      url.searchParams.set("endTime", String(config.asOfExclusiveMs - 1));
      url.searchParams.set("limit", "1000");
      const page = await getJson(url);
      if (!page.length) break;
      for (const row of page) {
        const openTime = Number(row[0]);
        if (openTime >= config.asOfExclusiveMs) continue;
        rows.push({
          t: openTime,
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
        });
      }
      const next = Number(page.at(-1)[0]) + HOUR;
      if (next <= cursor) throw new Error(`Non-advancing cursor for ${symbol}`);
      cursor = next;
      if (page.length < 1000) break;
    }
    const deduplicated = [...new Map(rows.map((row) => [row.t, row])).values()]
      .sort((left, right) => left.t - right.t);
    const fileName = `${symbol}-${config.interval}.json`;
    const filePath = path.join(rawDir, fileName);
    writeCanonicalJson(filePath, deduplicated);
    files.push({
      symbol,
      file: `raw/${fileName}`,
      rows: deduplicated.length,
      firstOpenTime: deduplicated[0]?.t ?? null,
      lastOpenTime: deduplicated.at(-1)?.t ?? null,
      terminalReason: config.dataPolicy.terminalReasonBySymbol[symbol],
      sha256: sha256File(filePath),
    });
  }
  const manifest = {
    schemaVersion: 1,
    source: API,
    interval: config.interval,
    asOfExclusive: config.asOfExclusive,
    fetchStartInclusive: config.fetchStartInclusive,
    configSha256: config.configSha256,
    files,
  };
  writeCanonicalJson(path.join(dataDir, "manifest.json"), manifest);
  return manifest;
}

export function loadDataset(config, dataDir) {
  const manifestPath = path.resolve(dataDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.configSha256 !== config.configSha256) {
    throw new Error("Dataset manifest config hash does not match configuration");
  }
  const history = new Map();
  const terminalReasonBySymbol = new Map();
  for (const item of manifest.files) {
    const filePath = path.resolve(dataDir, item.file);
    const actualHash = sha256File(filePath);
    if (actualHash !== item.sha256) {
      throw new Error(`Checksum mismatch for ${item.file}`);
    }
    const rows = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (rows.some((row) => row.t >= config.asOfExclusiveMs)) {
      throw new Error(`${item.file} contains a bar at or after as_of`);
    }
    const configuredTerminalReason =
      config.dataPolicy.terminalReasonBySymbol[item.symbol];
    if (item.terminalReason !== configuredTerminalReason) {
      throw new Error(`Terminal reason mismatch for ${item.symbol}`);
    }
    if (item.terminalReason === "replay-cutoff") {
      const lastOpenTime = rows.at(-1)?.t;
      const maximumLag =
        config.dataPolicy.maximumReplayCutoffLagHours * HOUR;
      if (
        !Number.isFinite(lastOpenTime)
        || config.asOfExclusiveMs - HOUR - lastOpenTime > maximumLag
      ) {
        throw new Error(
          `${item.symbol} ends too early to be classified as replay-cutoff`,
        );
      }
    }
    history.set(item.symbol, rows);
    terminalReasonBySymbol.set(item.symbol, item.terminalReason);
  }
  return { manifest, history, terminalReasonBySymbol };
}
