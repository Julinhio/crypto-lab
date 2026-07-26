import { priorPlausible24 } from "./indicators.mjs";

export function recentSwingStopDistance(series, index, config) {
  const settings = config.strategy;
  const first = Math.max(settings.pivotLeftHours, index - settings.pivotLookbackHours);
  for (let pivot = index - settings.pivotRightHours; pivot >= first; pivot -= 1) {
    const low = series[pivot].l;
    let confirmed = true;
    for (
      let cursor = pivot - settings.pivotLeftHours;
      cursor <= pivot + settings.pivotRightHours;
      cursor += 1
    ) {
      if (cursor !== pivot && series[cursor].l <= low) {
        confirmed = false;
        break;
      }
    }
    if (!confirmed) continue;
    const setup = series[index];
    const bufferedStop = low - settings.pivotBufferAtr * setup.atrPct * setup.c;
    const distance = (setup.c - bufferedStop) / setup.c;
    return distance > 0 ? distance : Number.NaN;
  }
  return Number.NaN;
}

export function isPreBreakoutSetup(series, index, config) {
  const bar = series[index];
  if (![bar.ema84, bar.sma200, bar.priorHigh20, bar.atrPct].every(Number.isFinite)) {
    return false;
  }
  if (!(bar.c > bar.ema84 && bar.ema84 > bar.sma200)) return false;
  if (!(bar.c < bar.priorHigh20)) return false;
  const triggerDistance = (bar.priorHigh20 - bar.c) / bar.c;
  if (triggerDistance > config.strategy.preBreakoutDistanceAtr * bar.atrPct) return false;
  const extensionAtr = (bar.c - bar.ema84) / (bar.atrPct * bar.c);
  return extensionAtr <= config.strategy.maximumExtensionAtr;
}

export function isPullbackSetup(series, index) {
  const bar = series[index];
  if (![bar.ema84, bar.sma200, bar.atrPct].every(Number.isFinite)) return false;
  const uptrend = bar.c > bar.ema84 && bar.ema84 > bar.sma200;
  let touchedMean = false;
  for (let cursor = Math.max(0, index - 6); cursor <= index; cursor += 1) {
    if (series[cursor].l <= bar.ema84 + 0.5 * bar.atrPct * bar.c) {
      touchedMean = true;
    }
  }
  return uptrend
    && touchedMean
    && index > 0
    && bar.c > series[index - 1].h
    && bar.c > bar.ema84;
}

export function simulateOpenedTrade({
  series,
  entryIndex,
  entryPrice,
  stopPrice,
  targetR,
  k,
  includeEntryBar = false,
  collisionPolicy = "pessimistic",
  exitMode = "hard",
  expiryHours = 24,
  terminalReason = "replay-cutoff",
}) {
  const d = (entryPrice - stopPrice) / entryPrice;
  if (!(d > 0)) return { outcome: "invalid" };
  const targetMove = targetR * (d + k) + k;
  const targetPrice = entryPrice * (1 + targetMove);
  let armed = false;
  let peak = entryPrice;
  let trailingStop = stopPrice;
  let maxR = 0;
  const start = includeEntryBar ? entryIndex : entryIndex + 1;
  for (let cursor = start; cursor < series.length; cursor += 1) {
    const bar = series[cursor];
    const elapsedHours = cursor - entryIndex;
    if (!armed) {
      const stopHit = bar.l <= stopPrice;
      const targetHit = bar.h >= targetPrice;
      if (stopHit && targetHit) {
        if (collisionPolicy === "pessimistic") {
          return {
            outcome: "stop",
            exitR: -1,
            armed: false,
            maxR,
            hours: elapsedHours,
          };
        }
        if (exitMode === "hard") {
          return {
            outcome: "target",
            exitR: targetR,
            armed: true,
            maxR: targetR,
            hours: elapsedHours,
          };
        }
      }
      if (stopHit) {
        const fill = bar.o < stopPrice ? bar.o : stopPrice;
        return {
          outcome: "stop",
          exitR: (fill / entryPrice - 1 - k) / (d + k),
          armed: false,
          maxR,
          hours: elapsedHours,
        };
      }
      peak = Math.max(peak, bar.h);
      maxR = Math.max(maxR, (peak / entryPrice - 1 - k) / (d + k));
      if (targetHit) {
        if (exitMode === "hard") {
          return {
            outcome: "target",
            exitR: targetR,
            armed: true,
            maxR,
            hours: elapsedHours,
          };
        }
        armed = true;
        trailingStop = Math.max(stopPrice, peak * (1 - d));
        if (bar.l <= trailingStop) {
          return {
            outcome: "trailing",
            exitR: (trailingStop / entryPrice - 1 - k) / (d + k),
            armed: true,
            maxR,
            hours: elapsedHours,
          };
        }
      } else if (elapsedHours >= expiryHours) {
        return {
          outcome: "expiry",
          exitR: (bar.c / entryPrice - 1 - k) / (d + k),
          armed: false,
          maxR,
          hours: elapsedHours,
        };
      }
    } else {
      peak = Math.max(peak, bar.h);
      maxR = Math.max(maxR, (peak / entryPrice - 1 - k) / (d + k));
      trailingStop = Math.max(trailingStop, peak * (1 - d));
      if (bar.l <= trailingStop) {
        const fill = bar.o < trailingStop ? bar.o : trailingStop;
        return {
          outcome: "trailing",
          exitR: (fill / entryPrice - 1 - k) / (d + k),
          armed: true,
          maxR,
          hours: elapsedHours,
        };
      }
    }
  }
  const hours = Math.max(0, series.length - 1 - entryIndex);
  if (terminalReason === "pair-death") {
    return {
      outcome: "pair-death-zero",
      exitR: (-1 - k) / (d + k),
      armed,
      maxR,
      hours,
    };
  }
  if (terminalReason !== "replay-cutoff") {
    throw new Error(`Unsupported terminal reason: ${terminalReason}`);
  }
  return {
    outcome: "technical-censor",
    armed,
    maxR,
    hours,
  };
}

function noiseFloorFraction(setupBar, config, noiseFloorAtr) {
  if (config.strategy.noiseFloorAtrReference !== "setup-bar-atr-percent") {
    throw new Error("Unsupported noise floor ATR reference");
  }
  return noiseFloorAtr * setupBar.atrPct;
}

function candidateFeatures({
  setupBar,
  trigger,
  triggerIndex,
  setupIndex,
  entryPrice,
  stopPrice,
  plausible,
  requiredMove,
}) {
  const d = (entryPrice - stopPrice) / entryPrice;
  return {
    feasibilityScore: plausible / requiredMove,
    stopDistancePct: d,
    plausible24Pct: plausible,
    stopToAtrMultiple: d / setupBar.atrPct,
    atrPct: setupBar.atrPct,
    trendStrengthAtr:
      (setupBar.ema84 - setupBar.sma200) / (setupBar.atrPct * setupBar.c),
    setupExtensionAtr:
      (setupBar.c - setupBar.ema84) / (setupBar.atrPct * setupBar.c),
    triggerDistanceAtr:
      (trigger - setupBar.c) / (setupBar.atrPct * setupBar.c),
    triggerDelayHours: triggerIndex - setupIndex,
    setupVolumeRatio: setupBar.qv / setupBar.medianVolume20,
  };
}

export function scanFamily(history, config, {
  family,
  targetR,
  gateTargetR = targetR,
  exitMode,
  collisionPolicy,
  trapTtlHours = config.strategy.trapTtlHours,
  noiseFloorAtr = config.strategy.noiseFloorAtr,
  terminalReasonBySymbol = new Map(),
}) {
  const k = config.cost.roundTripFraction;
  const candidates = [];
  const planStats = {
    setupRuns: 0,
    triggeredBeforeGate: 0,
    gateRejected: 0,
    gateRejectedNoiseOnly: 0,
    gateRejectedPlausibilityOnly: 0,
    gateRejectedBoth: 0,
    invalidated: 0,
    sameBarTriggerAndInvalidation: 0,
    expired: 0,
    technicalCensored: 0,
    pairDeathsMarkedToZero: 0,
  };
  for (const symbol of config.universe) {
    const series = history.get(symbol);
    const terminalReason =
      terminalReasonBySymbol.get(symbol)
      ?? config.dataPolicy.terminalReasonBySymbol[symbol];
    let previousBreakoutSetup = false;
    for (let index = 0; index < series.length; index += 1) {
      const setupBar = series[index];
      const breakoutSetup = family === "breakout"
        ? isPreBreakoutSetup(series, index, config)
        : false;
      const breakoutRisingEdge = breakoutSetup && !previousBreakoutSetup;
      if (family === "breakout") previousBreakoutSetup = breakoutSetup;
      if (
        setupBar.t < config.evaluationStartMs
        || !Number.isFinite(setupBar.atrPct)
      ) {
        continue;
      }
      const plausible = priorPlausible24(series, index, config);
      if (!Number.isFinite(plausible)) continue;
      const stopDistanceAtSetup = recentSwingStopDistance(series, index, config);
      if (!Number.isFinite(stopDistanceAtSetup)) continue;
      const stopPrice = setupBar.c * (1 - stopDistanceAtSetup);

      if (family === "pullback") {
        if (!isPullbackSetup(series, index)) continue;
        const d = stopDistanceAtSetup;
        const requiredMove = gateTargetR * (d + k) + k;
        if (
          d < noiseFloorFraction(setupBar, config, noiseFloorAtr)
          || requiredMove > plausible
        ) continue;
        const result = simulateOpenedTrade({
          series,
          entryIndex: index,
          entryPrice: setupBar.c,
          stopPrice,
          targetR,
          k,
          collisionPolicy,
          exitMode,
          expiryHours: config.strategy.positionExpiryHours,
          terminalReason,
        });
        if (result.outcome === "technical-censor") {
          planStats.technicalCensored += 1;
          continue;
        }
        if (result.outcome === "pair-death-zero") {
          planStats.pairDeathsMarkedToZero += 1;
        }
        if (result.outcome === "invalid") continue;
        candidates.push({
          candidateId: `${symbol}:${setupBar.t}:pullback:${targetR}:${gateTargetR}`,
          symbol,
          family,
          setupTime: setupBar.t,
          entryTime: setupBar.t,
          exitTime: series[index + result.hours]?.t ?? series.at(-1).t,
          triggerPrice: setupBar.c,
          entryPrice: setupBar.c,
          stopPrice,
          targetR,
          gateTargetR,
          requiredMove,
          feasibilityScore: plausible / requiredMove,
          features: {
            feasibilityScore: plausible / requiredMove,
            stopDistancePct: d,
            plausible24Pct: plausible,
            stopToAtrMultiple: d / setupBar.atrPct,
            atrPct: setupBar.atrPct,
          },
          ...result,
        });
        continue;
      }

      if (!breakoutRisingEdge) continue;
      planStats.setupRuns += 1;
      const trigger = setupBar.priorHigh20;
      let resolvedPlan = false;
      for (
        let triggerIndex = index + 1;
        triggerIndex <= Math.min(index + trapTtlHours, series.length - 1);
        triggerIndex += 1
      ) {
        const triggerBar = series[triggerIndex];
        const invalidated = triggerBar.l <= stopPrice;
        const triggered = triggerBar.h >= trigger;
        if (invalidated && triggered) {
          planStats.sameBarTriggerAndInvalidation += 1;
          resolvedPlan = true;
          break;
        }
        if (invalidated) {
          planStats.invalidated += 1;
          resolvedPlan = true;
          break;
        }
        if (!triggered) continue;
        planStats.triggeredBeforeGate += 1;
        resolvedPlan = true;
        const entryPrice = Math.max(trigger, triggerBar.o);
        const d = (entryPrice - stopPrice) / entryPrice;
        const requiredMove = gateTargetR * (d + k) + k;
        const failsNoise =
          d < noiseFloorFraction(setupBar, config, noiseFloorAtr);
        const failsPlausibility = requiredMove > plausible;
        if (failsNoise || failsPlausibility) {
          planStats.gateRejected += 1;
          if (failsNoise && failsPlausibility) planStats.gateRejectedBoth += 1;
          else if (failsNoise) planStats.gateRejectedNoiseOnly += 1;
          else planStats.gateRejectedPlausibilityOnly += 1;
          break;
        }
        const result = simulateOpenedTrade({
          series,
          entryIndex: triggerIndex,
          entryPrice,
          stopPrice,
          targetR,
          k,
          includeEntryBar: true,
          collisionPolicy,
          exitMode,
          expiryHours: config.strategy.positionExpiryHours,
          terminalReason,
        });
        if (result.outcome === "technical-censor") {
          planStats.technicalCensored += 1;
        } else if (result.outcome !== "invalid") {
          if (result.outcome === "pair-death-zero") {
            planStats.pairDeathsMarkedToZero += 1;
          }
          const features = candidateFeatures({
            setupBar,
            trigger,
            triggerIndex,
            setupIndex: index,
            entryPrice,
            stopPrice,
            plausible,
            requiredMove,
          });
          candidates.push({
            candidateId: `${symbol}:${setupBar.t}:breakout:${targetR}:${gateTargetR}`,
            symbol,
            family,
            setupTime: setupBar.t,
            entryTime: triggerBar.t,
            exitTime: series[triggerIndex + result.hours]?.t ?? series.at(-1).t,
            triggerPrice: trigger,
            entryPrice,
            stopPrice,
            targetR,
            gateTargetR,
            requiredMove,
            feasibilityScore: features.feasibilityScore,
            features,
            ...result,
          });
        }
        break;
      }
      if (!resolvedPlan) planStats.expired += 1;
    }
  }
  return { candidates, planStats };
}

export function firstOutcome(series, index, stopDistance, targetDistance, horizonHours = 24) {
  if (index + horizonHours >= series.length) return { outcome: "unknown" };
  const entryPrice = series[index].c;
  const stopPrice = entryPrice * (1 - stopDistance);
  const targetPrice = entryPrice * (1 + targetDistance);
  for (let cursor = index + 1; cursor <= index + horizonHours; cursor += 1) {
    const stopHit = series[cursor].l <= stopPrice;
    const targetHit = series[cursor].h >= targetPrice;
    if (stopHit && targetHit) return { outcome: "stop" };
    if (stopHit) return { outcome: "stop" };
    if (targetHit) return { outcome: "target" };
  }
  return {
    outcome: "expiry",
    expiryReturn: series[index + horizonHours].c / entryPrice - 1,
  };
}
