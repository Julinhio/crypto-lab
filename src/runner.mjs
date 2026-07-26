import path from "node:path";
import {
  analyzeBreakoutControls,
  analyzeCapacity,
  analyzeCorridor,
  analyzeFeatures,
  analyzeTargetSweep,
  analyzeTrailing,
} from "./analysis.mjs";
import { loadConfig } from "./config.mjs";
import { loadDataset } from "./data.mjs";
import { addIndicators } from "./indicators.mjs";
import { writeResults } from "./output.mjs";

export function runAll({ configPath, dataDir, outputDir }) {
  const config = loadConfig(configPath);
  config.runtimeDataDir = path.resolve(dataDir);
  const {
    manifest: dataManifest,
    history: rawHistory,
    terminalReasonBySymbol,
  } = loadDataset(config, dataDir);
  const history = new Map();
  for (const [symbol, rows] of rawHistory.entries()) {
    history.set(symbol, addIndicators(rows, config));
  }

  const corridor = analyzeCorridor(history, config);
  const trailing = analyzeTrailing(history, config, terminalReasonBySymbol);
  const target = analyzeTargetSweep(history, config, terminalReasonBySymbol);
  const breakoutScan = target.scans.get("breakout:2");
  if (!breakoutScan) throw new Error("Missing canonical breakout 2R scan");
  const capacity = analyzeCapacity(breakoutScan.candidates, config);
  const controls = analyzeBreakoutControls(breakoutScan.candidates, config);
  const features = analyzeFeatures(breakoutScan.candidates, config);
  const resultsManifest = writeResults({
    outputDir,
    config,
    dataManifest,
    corridor,
    trailing,
    targetSweep: target.rows,
    capacity,
    controls,
    features,
    breakoutCandidates: breakoutScan.candidates,
    breakoutPlanStats: breakoutScan.planStats,
  });
  return {
    config,
    dataManifest,
    resultsManifest,
    keyResults: {
      breakoutCandidateCount: breakoutScan.candidates.length,
      breakoutExecutable: controls.baseline,
      randomSelection: controls.random,
      oracleTotalR: controls.oracleTotalR,
      rawPositiveOnlyTotalR: controls.rawPositiveOnlyTotalR,
    },
  };
}
