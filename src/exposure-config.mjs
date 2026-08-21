import fs from "node:fs";
import path from "node:path";
import { sha256Buffer } from "./lib.mjs";
import { assertLockedSource } from "./binance-source.mjs";
import { SUPPORTED_TIMEFRAMES } from "./timeframe.mjs";

const ALLOWED_KEYS = new Set([
  "schemaVersion",
  "bundleId",
  "source",
  "universe",
  "timeframes",
  "fetchStartInclusive",
  "evaluationStartInclusive",
  "asOfExclusive",
]);

const BUNDLE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SYMBOL = /^[A-Z0-9]{2,20}$/;

function requireArrayOfUnique(value, label, predicate, expectation) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  for (const item of value) {
    if (typeof item !== "string" || !predicate(item)) {
      throw new Error(`${label} contains an invalid entry ${JSON.stringify(item)}; ${expectation}`);
    }
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} contains duplicates`);
  }
  return value;
}

function requireInstant(raw, label) {
  if (typeof raw !== "string") throw new Error(`${label} must be a string`);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${label} is not a valid instant: ${raw}`);
  }
  if (new Date(milliseconds).toISOString() !== raw) {
    throw new Error(
      `${label} must be a canonical UTC instant such as 2020-01-01T00:00:00.000Z, got ${raw}`,
    );
  }
  return milliseconds;
}

export function loadExposureConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const source = fs.readFileSync(absolutePath);
  const config = JSON.parse(source.toString("utf8"));

  const unknown = Object.keys(config).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length) {
    throw new Error(`Unknown configuration keys: ${unknown.sort().join(", ")}`);
  }
  const missing = [...ALLOWED_KEYS].filter((key) => !Object.hasOwn(config, key));
  if (missing.length) {
    throw new Error(`Missing configuration keys: ${missing.sort().join(", ")}`);
  }
  if (config.schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion: ${config.schemaVersion}`);
  }
  if (typeof config.bundleId !== "string" || !BUNDLE_ID.test(config.bundleId)) {
    throw new Error(`bundleId must be kebab-case, got ${JSON.stringify(config.bundleId)}`);
  }
  assertLockedSource(config.source);
  requireArrayOfUnique(
    config.universe,
    "universe",
    (item) => SYMBOL.test(item),
    "expected an uppercase Binance symbol",
  );
  requireArrayOfUnique(
    config.timeframes,
    "timeframes",
    (item) => SUPPORTED_TIMEFRAMES.includes(item),
    `supported: ${SUPPORTED_TIMEFRAMES.join(", ")}`,
  );

  const fetchStartMs = requireInstant(config.fetchStartInclusive, "fetchStartInclusive");
  const evaluationStartMs = requireInstant(
    config.evaluationStartInclusive,
    "evaluationStartInclusive",
  );
  const asOfExclusiveMs = requireInstant(config.asOfExclusive, "asOfExclusive");
  if (!(fetchStartMs < evaluationStartMs && evaluationStartMs < asOfExclusiveMs)) {
    throw new Error(
      "Expected fetchStartInclusive < evaluationStartInclusive < asOfExclusive",
    );
  }

  return {
    ...config,
    fetchStartMs,
    evaluationStartMs,
    asOfExclusiveMs,
    configPath: absolutePath,
    configSha256: sha256Buffer(source),
  };
}
