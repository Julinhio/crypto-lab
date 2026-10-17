import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { verifyExposureBundle } from "../src/exposure-bundle.mjs";
import { loadExposureConfig } from "../src/exposure-config.mjs";

// The v2 bundle exists to keep the sealed validation window physically out of every
// repository. These tests are the executable form of that promise.
const SEAL_INSTANT_MS = Date.parse("2024-07-01T00:00:00.000Z");

const CALIBRATION_PARTS = [
  { id: "crypto-buddy-exposure-v2-core", series: 8 },
  { id: "crypto-buddy-exposure-v2-sol", series: 2 },
];

for (const part of CALIBRATION_PARTS) {
  test(`the shipped ${part.id} verifies clean`, () => {
    const result = verifyExposureBundle({
      bundleDir: `data/bundles/${part.id}`,
      repoRoot: process.cwd(),
      configPath: `config/${part.id}.json`,
    });
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    assert.equal(result.series_present, part.series);
  });

  test(`${part.id} holds no candle opened at or after the seal instant`, () => {
    const config = loadExposureConfig(`config/${part.id}.json`);
    assert.equal(config.asOfExclusiveMs, SEAL_INSTANT_MS, "the calibration cutoff is the seal instant");
    const manifest = JSON.parse(fs.readFileSync(`data/bundles/${part.id}/manifest.json`, "utf8"));
    for (const item of manifest.series) {
      const rows = JSON.parse(fs.readFileSync(`data/bundles/${part.id}/${item.file}`, "utf8"));
      // Row by row, not from the manifest's last_open_time: the manifest is a claim.
      const late = rows.filter((row) => row.t >= SEAL_INSTANT_MS || row.closeTime >= SEAL_INSTANT_MS);
      assert.equal(late.length, 0, `${item.file} carries ${late.length} sealed candle(s)`);
    }
  });
}

test("the calibration parts cover the same universe as the sealed part", () => {
  const sealed = loadExposureConfig("config/crypto-buddy-exposure-v2-validation.json");
  const calibration = CALIBRATION_PARTS.flatMap(
    (part) => loadExposureConfig(`config/${part.id}.json`).universe,
  );
  assert.deepEqual([...calibration].sort(), [...sealed.universe].sort());
});

test("the sealed part is fingerprinted, and its files are not in this repository", () => {
  const fingerprint = JSON.parse(
    fs.readFileSync("data/bundles/crypto-buddy-exposure-v2-validation.fingerprint.json", "utf8"),
  );
  const config = loadExposureConfig("config/crypto-buddy-exposure-v2-validation.json");
  assert.equal(fingerprint.bundle_id, config.bundleId);
  assert.equal(fingerprint.acquisition_config_sha256, config.configSha256);
  assert.equal(fingerprint.as_of_exclusive, config.asOfExclusive);
  assert.match(fingerprint.bundle_sha256, /^[0-9a-f]{64}$/);
  assert.match(fingerprint.manifest_sha256, /^[0-9a-f]{64}$/);
  const expected = config.universe
    .flatMap((symbol) => config.timeframes.map((tf) => `raw/${symbol}-${tf}.json`))
    .sort();
  assert.deepEqual(fingerprint.files.map((item) => item.file), expected);
  for (const item of fingerprint.files) assert.match(item.sha256, /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync("data/bundles/crypto-buddy-exposure-v2-validation"), false);
});
