import fs from "node:fs";
import path from "node:path";
import { sha256Buffer } from "./lib.mjs";

export function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const source = fs.readFileSync(absolutePath);
  const config = JSON.parse(source.toString("utf8"));
  const asOfExclusiveMs = Date.parse(config.asOfExclusive);
  const evaluationStartMs = Date.parse(config.evaluationStartInclusive);
  const fetchStartMs = Date.parse(config.fetchStartInclusive);
  const corridorEvaluationStartMs = Date.parse(
    config.measurements.corridorEvaluationStartInclusive,
  );
  for (const [label, value] of Object.entries({
    asOfExclusiveMs,
    evaluationStartMs,
    fetchStartMs,
    corridorEvaluationStartMs,
  })) {
    if (!Number.isFinite(value)) throw new Error(`Invalid ${label}`);
  }
  if (!(fetchStartMs < evaluationStartMs && evaluationStartMs < asOfExclusiveMs)) {
    throw new Error("Expected fetchStart < evaluationStart < asOf");
  }
  const terminalReasons = config.dataPolicy?.terminalReasonBySymbol ?? {};
  const missingTerminalReasons = config.universe.filter(
    (symbol) => !Object.hasOwn(terminalReasons, symbol),
  );
  if (missingTerminalReasons.length) {
    throw new Error(
      `Missing terminal reason for: ${missingTerminalReasons.join(", ")}`,
    );
  }
  const allowedTerminalReasons = new Set(["replay-cutoff", "pair-death"]);
  for (const symbol of config.universe) {
    if (!allowedTerminalReasons.has(terminalReasons[symbol])) {
      throw new Error(`Invalid terminal reason for ${symbol}`);
    }
  }
  if (config.strategy.noiseFloorAtrReference !== "setup-bar-atr-percent") {
    throw new Error("Unsupported noiseFloorAtrReference");
  }
  return {
    ...config,
    asOfExclusiveMs,
    evaluationStartMs,
    fetchStartMs,
    corridorEvaluationStartMs,
    configPath: absolutePath,
    configSha256: sha256Buffer(source),
  };
}
