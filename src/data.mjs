import fs from "node:fs";
import path from "node:path";
import { HOUR, ensureDir, sha256File, writeCanonicalJson } from "./lib.mjs";
import { BINANCE_DATA_API } from "./binance-source.mjs";
import { downloadKlines } from "./klines.mjs";

const API = BINANCE_DATA_API;

export async function downloadDataset(config, dataDir) {
  const rawDir = path.resolve(dataDir, "raw");
  ensureDir(rawDir);
  const files = [];
  for (const symbol of config.universe) {
    const { rows: deduplicated } = await downloadKlines({
      symbol,
      interval: config.interval,
      fetchStartMs: config.fetchStartMs,
      asOfExclusiveMs: config.asOfExclusiveMs,
    });
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
