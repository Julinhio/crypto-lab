#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  canonicalJson,
  ensureDir,
  sha256Buffer,
  sha256File,
  writeCanonicalJson,
  writeCompactJson,
} from "./lib.mjs";
import { BINANCE_DATA_API, preflight } from "./binance-source.mjs";
import { downloadKlines, inspectSeries } from "./klines.mjs";
import { candleProblems } from "./candle.mjs";
import { isAdmissibleCandle, timeframeMs } from "./timeframe.mjs";
import { loadExposureConfig } from "./exposure-config.mjs";
import { collectProducerSources, producerSourceSha256 } from "./producer-source.mjs";

export const SCHEMA_VERSION = 1;
export const PRODUCER_REPOSITORY = "github.com/Julinhio/crypto-lab";
export const PRODUCER_ENTRY = "src/exposure-bundle.mjs";
export const GIT_COMMIT_AUTHORITY =
  "informative only, never a proof of provenance. The bundle is committed together "
  + "with the manifest and the branch is squash-merged, so this commit does not exist "
  + "at generation time and changes again on merge. Use producer_source_sha256.";

const isoOrNull = (milliseconds) =>
  Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;

// The bundle hash covers the identity, the source, the three bounds, the two
// source hashes and the sorted file list. It deliberately does not cover
// manifest.json, which carries it: hashing the manifest with itself inside
// would be circular.
//
// Per file it also covers the two acquisition facts that cannot be recovered
// from the data afterwards: how many open times the source repeated, and how
// many candles the admissibility rule discarded. Everything else a series entry
// claims is recomputable from the file itself and is re-derived at verify time
// rather than trusted.
export function bundlePreimage({
  bundleId,
  source,
  fetchStart,
  evaluationStart,
  asOfExclusive,
  producerSourceSha256: producerHash,
  acquisitionConfigSha256,
  files,
}) {
  return {
    bundle_id: bundleId,
    source,
    fetch_start: fetchStart,
    evaluation_start: evaluationStart,
    as_of_exclusive: asOfExclusive,
    producer_source_sha256: producerHash,
    acquisition_config_sha256: acquisitionConfigSha256,
    files: [...files]
      .map((item) => ({
        file: item.file,
        symbol: item.symbol,
        timeframe: item.timeframe,
        sha256: item.sha256,
        duplicate_open_times_returned_by_source:
          item.duplicate_open_times_returned_by_source,
        discarded_by_admissibility: item.discarded_by_admissibility,
      }))
      .sort((left, right) => (left.file < right.file ? -1 : 1)),
  };
}

export function computeBundleSha256(preimage) {
  return sha256Buffer(Buffer.from(canonicalJson(preimage), "utf8"));
}

function currentGitCommit(repoRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export async function buildExposureBundle({
  config,
  bundleDir,
  repoRoot = process.cwd(),
  fetchImpl = fetch,
  log = () => {},
}) {
  // Preflight first, on the locked source only. A failure aborts the run.
  const probe = await preflight({ fetchImpl });
  log(`preflight ${probe.source} -> HTTP ${probe.status}`);

  const rawDir = path.resolve(bundleDir, "raw");
  ensureDir(rawDir);

  const series = [];
  for (const symbol of [...config.universe].sort()) {
    for (const timeframe of [...config.timeframes].sort()) {
      const {
        rows,
        discardedByAdmissibility,
        repeatedOpenTimes,
        requests,
      } = await downloadKlines({
        symbol,
        interval: timeframe,
        fetchStartMs: config.fetchStartMs,
        asOfExclusiveMs: config.asOfExclusiveMs,
        fetchImpl,
      });
      if (!rows.length) {
        throw new Error(`${symbol} ${timeframe} returned no admissible candle`);
      }
      const controls = inspectSeries(rows, timeframeMs(timeframe));
      // The written series is keyed by open time, so a duplicate surviving to
      // this point would mean the writer itself is broken.
      if (controls.duplicates !== 0) {
        throw new Error(
          `${symbol} ${timeframe}: duplicate open time in the written series`,
        );
      }
      const fileName = `${symbol}-${timeframe}.json`;
      const filePath = path.join(rawDir, fileName);
      writeCompactJson(filePath, rows);
      series.push({
        symbol,
        timeframe,
        file: `raw/${fileName}`,
        rows: rows.length,
        first_open_time: isoOrNull(rows[0].t),
        first_close_time: isoOrNull(rows[0].closeTime),
        last_open_time: isoOrNull(rows.at(-1).t),
        last_close_time: isoOrNull(rows.at(-1).closeTime),
        duplicate_open_times_returned_by_source: repeatedOpenTimes,
        duplicates_ok: repeatedOpenTimes === 0,
        strictly_ordered: controls.strictlyOrdered,
        gap_count: controls.gapCount,
        gaps: controls.gaps,
        discarded_by_admissibility: discardedByAdmissibility,
        sha256: sha256File(filePath),
      });
      log(
        `${symbol} ${timeframe}: ${rows.length} rows, ${requests} requests, `
        + `${controls.gapCount} gaps, ${discardedByAdmissibility} discarded`,
      );
    }
  }

  const producerSourceFiles = collectProducerSources(
    path.resolve(repoRoot, PRODUCER_ENTRY),
    repoRoot,
  );
  const producerHash = producerSourceSha256(producerSourceFiles);
  const preimage = bundlePreimage({
    bundleId: config.bundleId,
    source: BINANCE_DATA_API,
    fetchStart: config.fetchStartInclusive,
    evaluationStart: config.evaluationStartInclusive,
    asOfExclusive: config.asOfExclusive,
    producerSourceSha256: producerHash,
    acquisitionConfigSha256: config.configSha256,
    files: series,
  });

  const manifest = {
    schema_version: SCHEMA_VERSION,
    bundle_id: config.bundleId,
    source: BINANCE_DATA_API,
    producer_repository: PRODUCER_REPOSITORY,
    fetch_start: config.fetchStartInclusive,
    evaluation_start: config.evaluationStartInclusive,
    as_of_exclusive: config.asOfExclusive,
    acquisition_config_sha256: config.configSha256,
    producer_source_sha256: producerHash,
    producer_source_files: producerSourceFiles,
    generation_git_commit: currentGitCommit(repoRoot),
    generation_git_commit_authority: GIT_COMMIT_AUTHORITY,
    series,
    bundle_sha256: computeBundleSha256(preimage),
  };
  writeCanonicalJson(path.resolve(bundleDir, "manifest.json"), manifest);
  return manifest;
}

// Offline verification. The bundle is self-contained: nothing here touches the
// network or the sibling repository.
export function verifyExposureBundle({
  bundleDir,
  repoRoot = process.cwd(),
  configPath = null,
}) {
  const manifestPath = path.resolve(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const config = configPath ? loadExposureConfig(configPath) : null;
  // Admissibility is re-judged against the configuration when there is one, so
  // that a bundle cannot move its own cutoff to legitimise the rows it carries.
  const fetchStartMs = config
    ? config.fetchStartMs
    : Date.parse(manifest.fetch_start);
  const asOfExclusiveMs = config
    ? config.asOfExclusiveMs
    : Date.parse(manifest.as_of_exclusive);

  const fileChecks = manifest.series.map((item) => {
    const filePath = path.resolve(bundleDir, item.file);
    const actual = fs.existsSync(filePath) ? sha256File(filePath) : null;
    return {
      file: item.file,
      expected: item.sha256,
      actual,
      ok: actual === item.sha256,
    };
  });

  // Anything a series entry claims that the data can answer for itself is
  // recomputed from the file, never read from the manifest. A hand-edited
  // `strictly_ordered: true` must not be able to certify a broken series.
  const controlChecks = manifest.series.map((item) => {
    const filePath = path.resolve(bundleDir, item.file);
    if (!fs.existsSync(filePath)) {
      return { file: item.file, ok: false, reason: "missing file" };
    }
    const rows = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const recomputed = inspectSeries(rows, timeframeMs(item.timeframe));
    const mismatches = [];
    // The admissibility rule is the bundle's defining discipline. Re-apply it
    // row by row: recomputing counts and endpoints would not notice a candle
    // closing at or after the cutoff, which is exactly look-ahead leakage.
    const inadmissible = rows.filter((row) => !isAdmissibleCandle(
      { openTime: row.t, closeTime: row.closeTime },
      fetchStartMs,
      asOfExclusiveMs,
    ));
    if (inadmissible.length) {
      mismatches.push({
        label: "inadmissible_rows",
        expected: 0,
        actual: inadmissible.length,
        firstOpenTime: isoOrNull(inadmissible[0].t),
        firstCloseTime: isoOrNull(inadmissible[0].closeTime),
      });
    }
    // The file name is part of the series identity. Without this, swapping two
    // symbols between entries of the same timeframe passes every other check
    // and silently relabels one asset as another.
    const expectedFile = `raw/${item.symbol}-${item.timeframe}.json`;
    if (item.file !== expectedFile) {
      mismatches.push({
        label: "file_name_matches_identity",
        expected: expectedFile,
        actual: item.file,
      });
    }
    const compare = (label, expected, actual) => {
      if (expected !== actual) mismatches.push({ label, expected, actual });
    };
    // Payload validation, the same rules acquisition applies. Timestamps,
    // ordering and counts all stay coherent around a null price, so nothing
    // above would notice one.
    const invalidRows = [];
    for (const [index, row] of rows.entries()) {
      const problems = candleProblems(row);
      if (problems.length) invalidRows.push({ index, problems });
    }
    if (invalidRows.length) {
      mismatches.push({
        label: "invalid_rows",
        expected: 0,
        actual: invalidRows.length,
        firstIndex: invalidRows[0].index,
        firstProblems: invalidRows[0].problems,
      });
    }
    compare("rows", item.rows, rows.length);
    compare("strictly_ordered", item.strictly_ordered, recomputed.strictlyOrdered);
    compare("gap_count", item.gap_count, recomputed.gapCount);
    compare("duplicates_in_file", 0, recomputed.duplicates);
    compare("first_open_time", item.first_open_time, isoOrNull(rows[0]?.t));
    compare("first_close_time", item.first_close_time, isoOrNull(rows[0]?.closeTime));
    compare("last_open_time", item.last_open_time, isoOrNull(rows.at(-1)?.t));
    compare("last_close_time", item.last_close_time, isoOrNull(rows.at(-1)?.closeTime));
    compare(
      "gaps",
      JSON.stringify(item.gaps),
      JSON.stringify(recomputed.gaps),
    );
    return { file: item.file, ok: mismatches.length === 0, mismatches };
  });

  const preimage = bundlePreimage({
    bundleId: manifest.bundle_id,
    source: manifest.source,
    fetchStart: manifest.fetch_start,
    evaluationStart: manifest.evaluation_start,
    asOfExclusive: manifest.as_of_exclusive,
    producerSourceSha256: manifest.producer_source_sha256,
    acquisitionConfigSha256: manifest.acquisition_config_sha256,
    files: manifest.series,
  });
  const recomputedBundleSha256 = computeBundleSha256(preimage);

  const currentProducerFiles = collectProducerSources(
    path.resolve(repoRoot, PRODUCER_ENTRY),
    repoRoot,
  );
  const currentProducerSha256 = producerSourceSha256(currentProducerFiles);

  const configSha256 = config ? config.configSha256 : null;

  // Hash consistency alone cannot tell a complete bundle from a truncated one:
  // drop a series and its file, recompute bundle_sha256 over what remains, and
  // every other check still passes. The series set is therefore compared against
  // the configured universe x timeframes.
  const present = manifest.series.map((item) => `${item.symbol}-${item.timeframe}`);
  const expected = config
    ? config.universe
      .flatMap((symbol) => config.timeframes.map((tf) => `${symbol}-${tf}`))
      .sort()
    : null;
  const missingSeries = expected
    ? expected.filter((key) => !present.includes(key))
    : [];
  const unexpectedSeries = expected
    ? present.filter((key) => !expected.includes(key))
    : [];
  const duplicatedSeries = [
    ...new Set(present.filter((key, index) => present.indexOf(key) !== index)),
  ];

  // Recomputation confirms the manifest describes the file it points at; it
  // never asks whether the file goes far enough. Without this, dropping the tail
  // of a series, adjusting counts and endpoints and resealing certifies a bundle
  // missing months of the evaluation window.
  //
  // The rule assumes every pair still trades at the cutoff, which is true of
  // this universe. A delisted pair would fail here, and that is deliberate: it
  // would need a declared terminal reason, not a silently shorter series.
  const shortSeries = manifest.series
    .map((item) => {
      const step = timeframeMs(item.timeframe);
      const expected = isoOrNull(
        Math.floor((asOfExclusiveMs - step) / step) * step,
      );
      return { series: `${item.symbol}-${item.timeframe}`, expected, actual: item.last_open_time };
    })
    .filter((item) => item.actual !== item.expected);

  // The same rule at the other end. Trimming a prefix and readjusting the first
  // timestamps leaves a series that is still continuous and admissible, but that
  // may have lost the SMA200 warm-up, or years of the evaluation window.
  //
  // This is the executable form of the mandate: a pair whose history starts
  // after fetch_start must stop the run and be reported, never be padded or
  // silently shifted.
  const lateSeries = manifest.series
    .map((item) => {
      const step = timeframeMs(item.timeframe);
      const expected = isoOrNull(Math.ceil(fetchStartMs / step) * step);
      return { series: `${item.symbol}-${item.timeframe}`, expected, actual: item.first_open_time };
    })
    .filter((item) => item.actual !== item.expected);

  // The config hash proves the config file did not change. It says nothing
  // about whether the manifest still agrees with it, so the config-derived
  // fields are compared one by one.
  const metadataMismatches = [];
  if (config) {
    const expectedMetadata = {
      bundle_id: config.bundleId,
      source: config.source,
      fetch_start: config.fetchStartInclusive,
      evaluation_start: config.evaluationStartInclusive,
      as_of_exclusive: config.asOfExclusive,
    };
    for (const [field, expected] of Object.entries(expectedMetadata)) {
      if (manifest[field] !== expected) {
        metadataMismatches.push({ field, expected, actual: manifest[field] ?? null });
      }
    }
  }

  const checks = {
    // verify is itself a consumer of the manifest, so it must refuse a protocol
    // version it does not know how to read rather than certify it.
    schema_version_supported: manifest.schema_version === SCHEMA_VERSION,
    files_intact: fileChecks.every((item) => item.ok),
    bundle_sha256_consistent: recomputedBundleSha256 === manifest.bundle_sha256,
    producer_source_unchanged:
      currentProducerSha256 === manifest.producer_source_sha256,
    acquisition_config_unchanged:
      configSha256 === null || configSha256 === manifest.acquisition_config_sha256,
    // Derived from the authenticated count, not from the `duplicates_ok`
    // boolean: that boolean is not in the preimage, so it can be left true
    // while the count it summarises is resealed to a non-zero value.
    controls_clean: manifest.series.every(
      (item) => item.duplicate_open_times_returned_by_source === 0
        && item.duplicates_ok === (item.duplicate_open_times_returned_by_source === 0)
        && item.strictly_ordered,
    ),
    series_complete:
      missingSeries.length === 0
      && unexpectedSeries.length === 0
      && duplicatedSeries.length === 0,
    metadata_matches_config: metadataMismatches.length === 0,
    series_start_at_fetch_start: lateSeries.length === 0,
    series_reach_cutoff: shortSeries.length === 0,
    controls_recomputed: controlChecks.every((item) => item.ok),
  };
  return {
    bundle_id: manifest.bundle_id,
    bundle_sha256: manifest.bundle_sha256,
    recomputed_bundle_sha256: recomputedBundleSha256,
    current_producer_source_sha256: currentProducerSha256,
    series_expected: expected ? expected.length : null,
    series_present: present.length,
    checks,
    ok: Object.values(checks).every(Boolean),
    mismatched_files: fileChecks.filter((item) => !item.ok),
    missing_series: missingSeries,
    unexpected_series: unexpectedSeries,
    duplicated_series: duplicatedSeries,
    metadata_mismatches: metadataMismatches,
    series_starting_late: lateSeries,
    series_short_of_cutoff: shortSeries,
    recomputed_control_mismatches: controlChecks.filter((item) => !item.ok),
  };
}

function parseArguments(values) {
  const output = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      output._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) output[key] = true;
    else {
      output[key] = next;
      index += 1;
    }
  }
  return output;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const command = args._[0];
  const configPath = typeof args.config === "string"
    ? args.config
    : "config/crypto-buddy-exposure-v1.json";
  const bundleDir = typeof args.bundle === "string"
    ? args.bundle
    : "data/bundles/crypto-buddy-exposure-v1";

  if (command === "build") {
    const config = loadExposureConfig(configPath);
    const manifest = await buildExposureBundle({
      config,
      bundleDir,
      repoRoot: process.cwd(),
      log: (line) => process.stderr.write(`${line}\n`),
    });
    process.stdout.write(canonicalJson({
      command,
      bundle_id: manifest.bundle_id,
      series: manifest.series.length,
      rows: manifest.series.reduce((sum, item) => sum + item.rows, 0),
      bundle_sha256: manifest.bundle_sha256,
      bundleDirectory: path.resolve(bundleDir),
    }));
  } else if (command === "verify") {
    const result = verifyExposureBundle({
      bundleDir,
      repoRoot: process.cwd(),
      configPath,
    });
    process.stdout.write(canonicalJson(result));
    if (!result.ok) process.exitCode = 2;
  } else {
    throw new Error(
      "Usage: node src/exposure-bundle.mjs build|verify [--config <path>] [--bundle <dir>]",
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
