import { createLcg, mean, percentile } from "./lib.mjs";

export function selectByCapacity(candidates, {
  maxSlots = 2,
  ranking = "plausibility",
  random = null,
} = {}) {
  const selected = [];
  const open = [];
  const byTime = new Map();
  for (const candidate of candidates) {
    const group = byTime.get(candidate.entryTime) ?? [];
    group.push(candidate);
    byTime.set(candidate.entryTime, group);
  }
  for (const entryTime of [...byTime.keys()].sort((left, right) => left - right)) {
    for (let index = open.length - 1; index >= 0; index -= 1) {
      if (open[index].exitTime < entryTime) open.splice(index, 1);
    }
    const ranked = byTime.get(entryTime)
      .filter((candidate) => !open.some((position) => position.symbol === candidate.symbol))
      .map((candidate) => ({
        candidate,
        randomRank: random ? random() : 0,
      }))
      .sort((left, right) => {
        if (ranking === "random") return left.randomRank - right.randomRank;
        return right.candidate.feasibilityScore - left.candidate.feasibilityScore
          || left.candidate.symbol.localeCompare(right.candidate.symbol);
      });
    for (const { candidate } of ranked) {
      if (open.length >= maxSlots) break;
      if (open.some((position) => position.symbol === candidate.symbol)) continue;
      selected.push(candidate);
      open.push(candidate);
    }
  }
  return selected;
}

export function summarizePortfolio(selected, allCandidates = selected) {
  const exitRs = selected.map((candidate) => candidate.exitR);
  let maximumLossStreak = 0;
  let currentLossStreak = 0;
  for (const candidate of selected) {
    if (candidate.exitR < 0) {
      currentLossStreak += 1;
      maximumLossStreak = Math.max(maximumLossStreak, currentLossStreak);
    } else {
      currentLossStreak = 0;
    }
  }
  return {
    trades: selected.length,
    rejectedForCapacityOrDuplicateAsset: allCandidates.length - selected.length,
    totalR: exitRs.reduce((sum, value) => sum + value, 0),
    meanR: mean(exitRs),
    negativeTrades: exitRs.filter((value) => value < 0).length,
    maximumLossStreak,
  };
}

export function randomSelectionControl(candidates, config) {
  const settings = config.measurements.randomSelection;
  const random = createLcg(settings.seed);
  const baseline = summarizePortfolio(
    selectByCapacity(candidates, { maxSlots: config.strategy.maxSlots }),
    candidates,
  );
  const totals = [];
  for (let simulation = 0; simulation < settings.simulations; simulation += 1) {
    const selected = selectByCapacity(candidates, {
      maxSlots: config.strategy.maxSlots,
      ranking: "random",
      random,
    });
    totals.push(summarizePortfolio(selected, candidates).totalR);
  }
  totals.sort((left, right) => left - right);
  return {
    simulations: settings.simulations,
    seed: settings.seed,
    plausibilityRankingTotalR: baseline.totalR,
    meanTotalR: mean(totals),
    p05TotalR: percentile(totals, 0.05),
    medianTotalR: percentile(totals, 0.5),
    p95TotalR: percentile(totals, 0.95),
    probabilityBeatingPlausibilityRanking:
      totals.filter((value) => value > baseline.totalR).length / totals.length,
  };
}

function subsetsThatFit(group, slots, forbiddenSymbols) {
  const output = [[]];
  for (const candidate of group) {
    for (let index = output.length - 1; index >= 0; index -= 1) {
      const subset = output[index];
      if (subset.length >= slots) continue;
      if (forbiddenSymbols.has(candidate.symbol)) continue;
      if (subset.some((item) => item.symbol === candidate.symbol)) continue;
      output.push([...subset, candidate]);
    }
  }
  return output;
}

export function exactOutcomeOracle(candidates, maxSlots = 2) {
  const byTime = new Map();
  for (const candidate of candidates) {
    const group = byTime.get(candidate.entryTime) ?? [];
    group.push(candidate);
    byTime.set(candidate.entryTime, group);
  }
  const times = [...byTime.keys()].sort((left, right) => left - right);
  const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const memo = new Map();
  function solve(timeIndex, openIds) {
    if (timeIndex >= times.length) return 0;
    const entryTime = times[timeIndex];
    const activeIds = openIds
      .filter((id) => byId.get(id).exitTime >= entryTime)
      .sort();
    const key = `${timeIndex}|${activeIds.join(",")}`;
    if (memo.has(key)) return memo.get(key);
    const forbidden = new Set(activeIds.map((id) => byId.get(id).symbol));
    const options = subsetsThatFit(
      byTime.get(entryTime),
      maxSlots - activeIds.length,
      forbidden,
    );
    let best = -Infinity;
    for (const option of options) {
      const value = option.reduce((sum, candidate) => sum + candidate.exitR, 0)
        + solve(
          timeIndex + 1,
          [...activeIds, ...option.map((candidate) => candidate.candidateId)],
        );
      best = Math.max(best, value);
    }
    memo.set(key, best);
    return best;
  }
  return solve(0, []);
}
