import test from "node:test";
import assert from "node:assert/strict";
import { scanFamily, simulateOpenedTrade } from "../src/engine.mjs";
import { addIndicators } from "../src/indicators.mjs";
import { selectByCapacity } from "../src/portfolio.mjs";

function bar(t, o, h, l, c) {
  return { t, o, h, l, c };
}

test("hard target pays the requested net R multiple", () => {
  const result = simulateOpenedTrade({
    series: [
      bar(0, 100, 100, 100, 100),
      bar(1, 100, 121, 99, 120),
    ],
    entryIndex: 0,
    entryPrice: 100,
    stopPrice: 90,
    targetR: 2,
    k: 0.003,
    exitMode: "hard",
  });
  assert.equal(result.outcome, "target");
  assert.equal(result.exitR, 2);
});

test("pessimistic collision resolves stop before target", () => {
  const result = simulateOpenedTrade({
    series: [
      bar(0, 100, 100, 100, 100),
      bar(1, 100, 121, 89, 100),
    ],
    entryIndex: 0,
    entryPrice: 100,
    stopPrice: 90,
    targetR: 2,
    k: 0.003,
    exitMode: "hard",
    collisionPolicy: "pessimistic",
  });
  assert.equal(result.outcome, "stop");
  assert.equal(result.exitR, -1);
});

test("capacity never exceeds slots and blocks a duplicate asset", () => {
  const candidates = [
    {
      candidateId: "a",
      symbol: "BTCUSDT",
      entryTime: 1,
      exitTime: 4,
      feasibilityScore: 2,
    },
    {
      candidateId: "b",
      symbol: "ETHUSDT",
      entryTime: 1,
      exitTime: 2,
      feasibilityScore: 1,
    },
    {
      candidateId: "c",
      symbol: "BTCUSDT",
      entryTime: 2,
      exitTime: 3,
      feasibilityScore: 3,
    },
  ];
  const selected = selectByCapacity(candidates, { maxSlots: 2 });
  assert.deepEqual(selected.map((candidate) => candidate.candidateId), ["a", "b"]);
});

test("pair death is marked to zero while replay cutoff remains a censor", () => {
  const settings = {
    series: [
      bar(0, 100, 100, 100, 100),
      bar(1, 100, 105, 95, 101),
    ],
    entryIndex: 0,
    entryPrice: 100,
    stopPrice: 90,
    targetR: 2,
    k: 0.003,
    exitMode: "hard",
  };
  const death = simulateOpenedTrade({
    ...settings,
    terminalReason: "pair-death",
  });
  const cutoff = simulateOpenedTrade({
    ...settings,
    terminalReason: "replay-cutoff",
  });
  assert.equal(death.outcome, "pair-death-zero");
  assert.ok(death.exitR < -9);
  assert.equal(cutoff.outcome, "technical-censor");
  assert.equal(Object.hasOwn(cutoff, "exitR"), false);
});

test("future MFE never appears on a policy-readable bar", () => {
  const bars = Array.from({ length: 240 }, (_, index) => ({
    t: index,
    o: 100,
    h: 101 + index / 1000,
    l: 99,
    c: 100 + index / 1000,
    qv: 1_000,
  }));
  const config = {
    indicators: {
      atrHours: 14,
      emaHours: 84,
      smaHours: 200,
      priorHighHours: 20,
      medianVolumeHours: 20,
      plausibilityLookbackDays: 7,
      plausibilityForwardHours: 24,
      plausibilityPercentile: 0.75,
      plausibilityMinimumDays: 1,
    },
  };
  const enriched = addIndicators(bars, config);
  assert.equal(enriched.some((item) => Object.hasOwn(item, "forwardMfe")), false);
  assert.ok(Number.isFinite(enriched.at(-1).priorPlausible24));
});

test("a rising edge rejected for missing plausibility is not rearmed next bar", () => {
  const series = Array.from({ length: 31 }, (_, index) => ({
    t: index,
    o: 100,
    h: 100.5,
    l: 98,
    c: 100,
    qv: 1_000,
    atrPct: 0.02,
    ema84: 101,
    sma200: 100,
    priorHigh20: 101,
    medianVolume20: 1_000,
    priorPlausible24: 0.2,
  }));
  series[23].l = 90;
  for (const index of [25, 26]) {
    series[index].ema84 = 99.5;
    series[index].sma200 = 99;
  }
  series[25].priorPlausible24 = Number.NaN;
  series[27].h = 102;
  const config = {
    universe: ["TESTUSDT"],
    evaluationStartMs: 25,
    cost: { roundTripFraction: 0.003 },
    indicators: {},
    dataPolicy: {
      terminalReasonBySymbol: { TESTUSDT: "replay-cutoff" },
    },
    strategy: {
      pivotLeftHours: 2,
      pivotRightHours: 2,
      pivotLookbackHours: 24,
      pivotBufferAtr: 0.25,
      noiseFloorAtr: 1.5,
      noiseFloorAtrReference: "setup-bar-atr-percent",
      preBreakoutDistanceAtr: 0.5,
      maximumExtensionAtr: 2.5,
      positionExpiryHours: 24,
    },
  };
  const scan = scanFamily(new Map([["TESTUSDT", series]]), config, {
    family: "breakout",
    targetR: 2,
    gateTargetR: 2,
    exitMode: "hard",
    collisionPolicy: "pessimistic",
    trapTtlHours: 4,
    terminalReasonBySymbol: new Map([["TESTUSDT", "replay-cutoff"]]),
  });
  assert.equal(scan.planStats.setupRuns, 0);
  assert.equal(scan.candidates.length, 0);
});
