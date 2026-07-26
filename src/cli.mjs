#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { downloadDataset } from "./data.mjs";
import { runAll } from "./runner.mjs";
import { canonicalJson, sha256File } from "./lib.mjs";

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

function required(args, key, fallback = null) {
  const value = args[key] ?? fallback;
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function compareManifests(leftDir, rightDir) {
  const leftPath = path.resolve(leftDir, "results-manifest.json");
  const rightPath = path.resolve(rightDir, "results-manifest.json");
  const left = JSON.parse(fs.readFileSync(leftPath, "utf8"));
  const right = JSON.parse(fs.readFileSync(rightPath, "utf8"));
  const leftFiles = new Map(left.files.map((item) => [item.file, item.sha256]));
  const rightFiles = new Map(right.files.map((item) => [item.file, item.sha256]));
  const names = [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].sort();
  const differences = names
    .filter((name) => leftFiles.get(name) !== rightFiles.get(name))
    .map((name) => ({
      file: name,
      leftSha256: leftFiles.get(name) ?? null,
      rightSha256: rightFiles.get(name) ?? null,
    }));
  return {
    identical: differences.length === 0
      && left.configSha256 === right.configSha256
      && left.dataManifestSha256 === right.dataManifestSha256,
    leftManifestSha256: sha256File(leftPath),
    rightManifestSha256: sha256File(rightPath),
    sameConfig: left.configSha256 === right.configSha256,
    sameDataManifest: left.dataManifestSha256 === right.dataManifestSha256,
    differingFiles: differences,
  };
}

const args = parseArguments(process.argv.slice(2));
const command = args._[0];
const configPath = required(args, "config", "config/measurements.json");

if (command === "download") {
  const config = loadConfig(configPath);
  const manifest = await downloadDataset(config, required(args, "data", "data/frozen"));
  process.stdout.write(canonicalJson({
    command,
    asOfExclusive: config.asOfExclusive,
    pairs: manifest.files.length,
    rows: manifest.files.reduce((sum, item) => sum + item.rows, 0),
    dataDirectory: path.resolve(required(args, "data", "data/frozen")),
  }));
} else if (command === "run") {
  const result = runAll({
    configPath,
    dataDir: required(args, "data", "data/frozen"),
    outputDir: required(args, "out", "results/current"),
  });
  process.stdout.write(canonicalJson({
    command,
    asOfExclusive: result.config.asOfExclusive,
    ...result.keyResults,
  }));
} else if (command === "verify") {
  const result = compareManifests(required(args, "left"), required(args, "right"));
  process.stdout.write(canonicalJson(result));
  if (!result.identical) process.exitCode = 2;
} else {
  throw new Error("Usage: node src/cli.mjs download|run|verify [options]");
}

