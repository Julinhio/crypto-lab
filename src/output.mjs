import fs from "node:fs";
import path from "node:path";
import {
  ensureDir,
  listFilesRecursive,
  relativePosix,
  sha256File,
  writeCanonicalJson,
  writeCsv,
} from "./lib.mjs";

function iso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : "";
}

function flattenCandidateSnapshot(candidate) {
  return {
    candidate_id: candidate.candidateId,
    symbol: candidate.symbol,
    family: candidate.family,
    setup_time: iso(candidate.setupTime),
    entry_time: iso(candidate.entryTime),
    trigger_price: candidate.triggerPrice,
    entry_price: candidate.entryPrice,
    stop_price: candidate.stopPrice,
    target_r: candidate.targetR,
    gate_target_r: candidate.gateTargetR,
    required_move_fraction: candidate.requiredMove,
    feasibility_score: candidate.feasibilityScore,
    stop_distance_fraction: candidate.features.stopDistancePct,
    plausible_24h_fraction: candidate.features.plausible24Pct,
    stop_to_atr_multiple: candidate.features.stopToAtrMultiple,
    atr_fraction: candidate.features.atrPct,
    trend_strength_atr: candidate.features.trendStrengthAtr,
    setup_extension_atr: candidate.features.setupExtensionAtr,
    trigger_distance_atr: candidate.features.triggerDistanceAtr,
    trigger_delay_hours: candidate.features.triggerDelayHours,
    setup_volume_ratio: candidate.features.setupVolumeRatio,
  };
}

function flattenCandidateOutcome(candidate) {
  return {
    candidate_id: candidate.candidateId,
    exit_time: iso(candidate.exitTime),
    outcome: candidate.outcome,
    exit_r: candidate.exitR,
    armed: candidate.armed,
    maximum_favorable_excursion_r: candidate.maxR,
    holding_hours: candidate.hours,
  };
}

function joinedCandidate(candidate) {
  return {
    ...flattenCandidateSnapshot(candidate),
    ...flattenCandidateOutcome(candidate),
  };
}

function rowsWithPercentDates(rows) {
  return rows.map((row) => ({ ...row }));
}

export function writeResults({
  outputDir,
  config,
  dataManifest,
  corridor,
  trailing,
  targetSweep,
  capacity,
  controls,
  features,
  breakoutCandidates,
  breakoutPlanStats,
}) {
  const root = path.resolve(outputDir);
  ensureDir(root);

  writeCsv(path.join(root, "corridor-by-atr-floor.csv"), rowsWithPercentDates(corridor));
  writeCsv(path.join(root, "trailing-by-arm.csv"), rowsWithPercentDates(trailing));
  writeCsv(path.join(root, "target-sweep.csv"), rowsWithPercentDates(targetSweep));
  writeCsv(path.join(root, "capacity-slots.csv"), rowsWithPercentDates(capacity));
  writeCsv(path.join(root, "feature-tertiles.csv"), rowsWithPercentDates(features.rows));
  writeCsv(
    path.join(root, "feature-correlations.csv"),
    rowsWithPercentDates(features.correlations),
  );

  const randomRows = [{
    ...controls.random,
    baselineTrades: controls.baseline.trades,
    baselineTotalR: controls.baseline.totalR,
  }];
  writeCsv(path.join(root, "random-selection-control.csv"), randomRows);
  writeCsv(path.join(root, "oracle.csv"), [{
    maxSlots: config.strategy.maxSlots,
    oracleTotalR: controls.oracleTotalR,
    rawPositiveOnlyTotalR: controls.rawPositiveOnlyTotalR,
  }]);
  writeCsv(path.join(root, "breakout-plan-stats.csv"), [breakoutPlanStats]);

  const snapshots = breakoutCandidates.map(flattenCandidateSnapshot);
  const outcomes = breakoutCandidates.map(flattenCandidateOutcome);
  const joined = breakoutCandidates.map(joinedCandidate);
  writeCsv(path.join(root, "breakout-2r-candidate-snapshots.csv"), snapshots);
  writeCsv(path.join(root, "breakout-2r-candidate-outcomes.csv"), outcomes);
  writeCsv(path.join(root, "breakout-2r-candidates-joined.csv"), joined);

  const summary = {
    schemaVersion: 1,
    configuration: {
      configSha256: config.configSha256,
      asOfExclusive: config.asOfExclusive,
      evaluationStartInclusive: config.evaluationStartInclusive,
      corridorEvaluationStartInclusive:
        config.measurements.corridorEvaluationStartInclusive,
      fetchStartInclusive: config.fetchStartInclusive,
      universe: config.universe,
      roundTripCostFraction: config.cost.roundTripFraction,
      randomSelection: config.measurements.randomSelection,
      featurePermutation: config.measurements.featurePermutation,
      bootstrap: config.measurements.bootstrap,
    },
    dataManifestSha256: sha256File(
      path.resolve(config.runtimeDataDir, "manifest.json"),
    ),
    keyResults: {
      breakoutCandidateCount: breakoutCandidates.length,
      breakoutExecutable: controls.baseline,
      randomSelection: controls.random,
      oracleTotalR: controls.oracleTotalR,
      rawPositiveOnlyTotalR: controls.rawPositiveOnlyTotalR,
    },
  };
  writeCanonicalJson(path.join(root, "summary.json"), summary);

  const manifestPath = path.join(root, "results-manifest.json");
  const resultFiles = listFilesRecursive(root)
    .filter((filePath) => filePath !== manifestPath)
    .map((filePath) => ({
      file: relativePosix(root, filePath),
      bytes: fs.statSync(filePath).size,
      sha256: sha256File(filePath),
    }));
  const manifest = {
    schemaVersion: 1,
    configSha256: config.configSha256,
    dataManifestSha256: summary.dataManifestSha256,
    files: resultFiles,
  };
  writeCanonicalJson(manifestPath, manifest);
  return manifest;
}
