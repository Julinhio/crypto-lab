import { firstOutcome, recentSwingStopDistance, scanFamily } from "./engine.mjs";
import {
  exactOutcomeOracle,
  randomSelectionControl,
  selectByCapacity,
  summarizePortfolio,
} from "./portfolio.mjs";
import { createLcg, mean, percentile } from "./lib.mjs";
import { priorPlausible24 } from "./indicators.mjs";

function candidateSummary(candidates) {
  const exitRs = candidates.map((candidate) => candidate.exitR);
  const armed = candidates.filter((candidate) => candidate.armed);
  const average = mean(exitRs);
  const variance = exitRs.length > 1
    ? exitRs.reduce((sum, value) => sum + (value - average) ** 2, 0)
      / (exitRs.length - 1)
    : 0;
  const standardError = Math.sqrt(variance / Math.max(1, exitRs.length));
  return {
    candidates: candidates.length,
    armed: armed.length,
    armedPct: armed.length / candidates.length,
    stopPct:
      candidates.filter((candidate) => candidate.outcome === "stop").length
      / candidates.length,
    expiryPct:
      candidates.filter((candidate) => candidate.outcome === "expiry").length
      / candidates.length,
    meanExitR: average,
    medianExitR: percentile(exitRs, 0.5),
    meanArmedExitR: mean(armed.map((candidate) => candidate.exitR)),
    meanMaxRWhenArmed: mean(armed.map((candidate) => candidate.maxR)),
    approximate95PctMeanLow: average - 1.96 * standardError,
    approximate95PctMeanHigh: average + 1.96 * standardError,
  };
}

export function analyzeCorridor(history, config) {
  const rows = [];
  const k = config.cost.roundTripFraction;
  for (const alpha of config.measurements.corridorNoiseFloorsAtr) {
    for (const stopMode of ["floor-only", "recent-swing"]) {
      let valid = 0;
      let eligible = 0;
      let runs = 0;
      let targets = 0;
      let stops = 0;
      let expiries = 0;
      const eligibleByHour = new Map();
      const corridorWidths = [];
      const requiredMoves = [];
      const allHours = new Set();
      for (const symbol of config.universe) {
        const series = history.get(symbol);
        let wasEligible = false;
        for (let index = 0; index < series.length; index += 1) {
          const bar = series[index];
          if (
            bar.t < config.corridorEvaluationStartMs
            || bar.t >= config.asOfExclusiveMs
          ) {
            wasEligible = false;
            continue;
          }
          allHours.add(bar.t);
          const plausible = priorPlausible24(series, index, config);
          if (!Number.isFinite(plausible) || !Number.isFinite(bar.atrPct)) {
            wasEligible = false;
            continue;
          }
          valid += 1;
          const minimumDistance = alpha * bar.atrPct;
          const maximumDistance = (plausible - 3 * k) / 2;
          const distance = stopMode === "floor-only"
            ? minimumDistance
            : recentSwingStopDistance(series, index, config);
          if (
            !Number.isFinite(distance)
            || distance < minimumDistance
            || distance > maximumDistance
            || maximumDistance <= 0
          ) {
            wasEligible = false;
            continue;
          }
          if (!wasEligible) runs += 1;
          wasEligible = true;
          eligible += 1;
          eligibleByHour.set(bar.t, (eligibleByHour.get(bar.t) ?? 0) + 1);
          corridorWidths.push(maximumDistance - distance);
          const targetMove = 2 * distance + 3 * k;
          requiredMoves.push(targetMove);
          const outcome = firstOutcome(series, index, distance, targetMove, 24);
          if (outcome.outcome === "target") targets += 1;
          else if (outcome.outcome === "stop") stops += 1;
          else if (outcome.outcome === "expiry") expiries += 1;
        }
      }
      const hours = [...allHours];
      const hoursAtLeastOne = hours.filter((time) => (eligibleByHour.get(time) ?? 0) >= 1).length;
      const hoursAtLeastTwo = hours.filter((time) => (eligibleByHour.get(time) ?? 0) >= 2).length;
      const evaluationDays =
        (config.asOfExclusiveMs - config.corridorEvaluationStartMs)
        / (24 * 60 * 60 * 1000);
      rows.push({
        alphaAtr: alpha,
        stopMode,
        validAssetHours: valid,
        eligibleAssetHours: eligible,
        distinctEligibilityRuns: runs,
        distinctRunsPerDay: runs / evaluationDays,
        eligiblePct: eligible / valid,
        avgEligibleAssetsPerHour: eligible / hours.length,
        hoursWithAtLeastOnePct: hoursAtLeastOne / hours.length,
        hoursWithAtLeastTwoPct: hoursAtLeastTwo / hours.length,
        medianCorridorWidthPct: percentile(corridorWidths, 0.5),
        medianRequiredMovePct: percentile(requiredMoves, 0.5),
        targetPct: targets / (targets + stops + expiries),
        stopPct: stops / (targets + stops + expiries),
        expiryPct: expiries / (targets + stops + expiries),
        targetAmongResolvedPct: targets / (targets + stops),
      });
    }
  }
  return rows;
}

export function analyzeTrailing(history, config, terminalReasonBySymbol) {
  const rows = [];
  for (const family of ["pullback", "breakout"]) {
    for (const targetR of config.measurements.trailingArmR) {
      for (const cohort of ["policy", "fixed-2r-gate"]) {
        const gateTargetR = cohort === "policy" ? targetR : 2;
        const { candidates, planStats } = scanFamily(history, config, {
          family,
          targetR,
          gateTargetR,
          exitMode: "trailing",
          collisionPolicy: config.measurements.trailingCollisionPolicy,
          trapTtlHours: config.measurements.trailingTrapTtlHours,
          terminalReasonBySymbol,
        });
        rows.push({
          family,
          targetR,
          gateTargetR,
          cohort,
          trapTtlHours: config.measurements.trailingTrapTtlHours,
          collisionPolicy: config.measurements.trailingCollisionPolicy,
          technicalCensored: planStats.technicalCensored,
          pairDeathsMarkedToZero: planStats.pairDeathsMarkedToZero,
          ...candidateSummary(candidates),
        });
      }
    }
  }
  return rows;
}

export function analyzeTargetSweep(history, config, terminalReasonBySymbol) {
  const rows = [];
  const scans = new Map();
  for (const family of ["pullback", "breakout"]) {
    for (const targetR of config.measurements.targetSweepR) {
      const scan = scanFamily(history, config, {
        family,
        targetR,
        gateTargetR: targetR,
        exitMode: "hard",
        collisionPolicy: config.measurements.targetSweepCollisionPolicy,
        trapTtlHours: config.measurements.targetSweepTrapTtlHours,
        terminalReasonBySymbol,
      });
      scans.set(`${family}:${targetR}`, scan);
      const executable = selectByCapacity(scan.candidates, {
        maxSlots: config.strategy.maxSlots,
      });
      const rawSummary = candidateSummary(scan.candidates);
      const portfolio = summarizePortfolio(executable, scan.candidates);
      rows.push({
        family,
        targetR,
        gateTargetR: targetR,
        trapTtlHours: config.measurements.targetSweepTrapTtlHours,
        collisionPolicy: config.measurements.targetSweepCollisionPolicy,
        rawCandidates: scan.candidates.length,
        rawMeanR: rawSummary.meanExitR,
        rawTotalR: scan.candidates.reduce((sum, candidate) => sum + candidate.exitR, 0),
        executableTrades: portfolio.trades,
        executableMeanR: portfolio.meanR,
        executableTotalR: portfolio.totalR,
        negativeTrades: portfolio.negativeTrades,
        maximumLossStreak: portfolio.maximumLossStreak,
        gateRejected: scan.planStats.gateRejected,
        technicalCensored: scan.planStats.technicalCensored,
        pairDeathsMarkedToZero: scan.planStats.pairDeathsMarkedToZero,
      });
    }
  }
  return { rows, scans };
}

export function analyzeCapacity(candidates, config) {
  return config.measurements.capacitySlots.map((maxSlots) => {
    const selected = selectByCapacity(candidates, { maxSlots });
    const summary = summarizePortfolio(selected, candidates);
    const riskScalePerTrade = 2 / maxSlots;
    return {
      maxSlots,
      riskScalePerTrade,
      ...summary,
      totalFullRiskEquivalentR: summary.totalR * riskScalePerTrade,
    };
  });
}

function ranks(values) {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const output = new Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const averageRank = (start + end - 1) / 2;
    for (let cursor = start; cursor < end; cursor += 1) {
      output[sorted[cursor].index] = averageRank;
    }
    start = end;
  }
  return output;
}

function pearson(left, right) {
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta ** 2;
    rightSquares += rightDelta ** 2;
  }
  return numerator / Math.sqrt(leftSquares * rightSquares);
}

export function analyzeFeatures(candidates, config) {
  const directions = {
    feasibilityScore: "high",
    plausible24Pct: "high",
    stopDistancePct: "high",
    stopToAtrMultiple: "high",
    atrPct: "high",
    trendStrengthAtr: "high",
    setupExtensionAtr: "low",
    triggerDistanceAtr: "low",
    triggerDelayHours: "low",
    setupVolumeRatio: "high",
  };
  const random = createLcg(config.measurements.featurePermutation.seed);
  const rows = [];
  for (const [feature, direction] of Object.entries(directions)) {
    const ordered = [...candidates].sort(
      (left, right) => left.features[feature] - right.features[feature],
    );
    const thirds = [[], [], []];
    ordered.forEach((candidate, index) => {
      thirds[Math.min(2, Math.floor((index * 3) / ordered.length))].push(candidate);
    });
    const groupRows = thirds.map((group, tertile) => ({
      feature,
      expectedDirection: direction,
      tertile: tertile + 1,
      count: group.length,
      minimum: Math.min(...group.map((candidate) => candidate.features[feature])),
      maximum: Math.max(...group.map((candidate) => candidate.features[feature])),
      meanR: mean(group.map((candidate) => candidate.exitR)),
      totalR: group.reduce((sum, candidate) => sum + candidate.exitR, 0),
    }));
    const best = direction === "high" ? thirds[2] : thirds[0];
    const worst = direction === "high" ? thirds[0] : thirds[2];
    const observedDifference =
      mean(best.map((candidate) => candidate.exitR))
      - mean(worst.map((candidate) => candidate.exitR));
    const values = candidates.map((candidate) => candidate.exitR);
    let atLeastObserved = 0;
    const simulations = config.measurements.featurePermutation.simulations;
    for (let simulation = 0; simulation < simulations; simulation += 1) {
      const shuffled = [...values];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const target = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
      }
      const low = shuffled.slice(0, thirds[0].length);
      const high = shuffled.slice(thirds[0].length + thirds[1].length);
      const difference = direction === "high"
        ? mean(high) - mean(low)
        : mean(low) - mean(high);
      if (difference >= observedDifference) atLeastObserved += 1;
    }
    const keepCount = Math.ceil((2 * ordered.length) / 3);
    const kept = direction === "high"
      ? ordered.slice(ordered.length - keepCount)
      : ordered.slice(0, keepCount);
    const abstention = summarizePortfolio(
      selectByCapacity(kept, { maxSlots: config.strategy.maxSlots }),
      kept,
    );
    rows.push(...groupRows.map((row) => ({
      ...row,
      expectedBestMinusWorstMeanR: observedDifference,
      exploratoryPermutationP: atLeastObserved / simulations,
      abstentionExecutableTrades: abstention.trades,
      abstentionExecutableTotalR: abstention.totalR,
    })));
  }

  const correlationFeatures = [
    "setupVolumeRatio",
    "feasibilityScore",
    "plausible24Pct",
    "stopToAtrMultiple",
    "stopDistancePct",
    "atrPct",
  ];
  const correlations = [];
  for (let leftIndex = 0; leftIndex < correlationFeatures.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < correlationFeatures.length;
      rightIndex += 1
    ) {
      const leftName = correlationFeatures[leftIndex];
      const rightName = correlationFeatures[rightIndex];
      const left = candidates.map((candidate) => candidate.features[leftName]);
      const right = candidates.map((candidate) => candidate.features[rightName]);
      correlations.push({
        left: leftName,
        right: rightName,
        spearman: pearson(ranks(left), ranks(right)),
        pearson: pearson(left, right),
      });
    }
  }
  return { rows, correlations };
}

export function analyzeBreakoutControls(candidates, config) {
  const baseline = summarizePortfolio(
    selectByCapacity(candidates, { maxSlots: config.strategy.maxSlots }),
    candidates,
  );
  return {
    baseline,
    random: randomSelectionControl(candidates, config),
    oracleTotalR: exactOutcomeOracle(candidates, config.strategy.maxSlots),
    rawPositiveOnlyTotalR: candidates
      .filter((candidate) => candidate.exitR > 0)
      .reduce((sum, candidate) => sum + candidate.exitR, 0),
  };
}
