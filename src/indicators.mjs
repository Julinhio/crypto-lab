import { percentile } from "./lib.mjs";

export function addIndicators(bars, config) {
  const settings = config.indicators;
  const trueRanges = bars.map((bar, index) => {
    if (index === 0) return bar.h - bar.l;
    const previousClose = bars[index - 1].c;
    return Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - previousClose),
      Math.abs(bar.l - previousClose),
    );
  });
  const atr = bars.map((_, index) => {
    if (index < settings.atrHours - 1) return Number.NaN;
    let sum = 0;
    for (let cursor = index - settings.atrHours + 1; cursor <= index; cursor += 1) {
      sum += trueRanges[cursor];
    }
    return sum / settings.atrHours;
  });
  // Deliberately kept private to this function. A policy receives the enriched
  // bars below, never this future-looking array.
  const privateForwardMfe = bars.map((bar, index) => {
    if (index + settings.plausibilityForwardHours >= bars.length) return Number.NaN;
    let highest = -Infinity;
    for (
      let cursor = index + 1;
      cursor <= index + settings.plausibilityForwardHours;
      cursor += 1
    ) {
      highest = Math.max(highest, bars[cursor].h);
    }
    return highest / bar.c - 1;
  });
  const ema = [];
  const emaWeight = 2 / (settings.emaHours + 1);
  for (let index = 0; index < bars.length; index += 1) {
    ema[index] = index === 0
      ? bars[index].c
      : bars[index].c * emaWeight + ema[index - 1] * (1 - emaWeight);
  }
  const sma = bars.map((_, index) => {
    if (index < settings.smaHours - 1) return Number.NaN;
    let sum = 0;
    for (let cursor = index - settings.smaHours + 1; cursor <= index; cursor += 1) {
      sum += bars[cursor].c;
    }
    return sum / settings.smaHours;
  });
  const priorHigh = bars.map((_, index) => {
    if (index < settings.priorHighHours) return Number.NaN;
    let highest = -Infinity;
    for (let cursor = index - settings.priorHighHours; cursor < index; cursor += 1) {
      highest = Math.max(highest, bars[cursor].h);
    }
    return highest;
  });
  const medianVolume = bars.map((_, index) => {
    if (index < settings.medianVolumeHours) return Number.NaN;
    return percentile(
      bars
        .slice(index - settings.medianVolumeHours, index)
        .map((bar) => bar.qv),
      0.5,
    );
  });
  const enriched = bars.map((bar, index) => ({
    ...bar,
    atrPct: atr[index] / bar.c,
    ema84: ema[index],
    sma200: sma[index],
    priorHigh20: priorHigh[index],
    medianVolume20: medianVolume[index],
  }));
  const plausibility = enriched.map((_, index) => {
    const lookbackHours = settings.plausibilityLookbackDays * 24;
    const first = Math.max(0, index - lookbackHours);
    const last = index - settings.plausibilityForwardHours;
    const values = [];
    for (let cursor = first; cursor <= last; cursor += 1) {
      if (Number.isFinite(privateForwardMfe[cursor])) {
        values.push(privateForwardMfe[cursor]);
      }
    }
    const minimum = settings.plausibilityMinimumDays * 24;
    return values.length >= minimum
      ? percentile(values, settings.plausibilityPercentile)
      : Number.NaN;
  });
  return enriched.map((bar, index) => ({
    ...bar,
    priorPlausible24: plausibility[index],
  }));
}

export function priorPlausible24(series, index, config) {
  void config;
  return series[index]?.priorPlausible24 ?? Number.NaN;
}
