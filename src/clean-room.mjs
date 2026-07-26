#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = path.resolve(option("root", "repro/clean-room"));
const config = path.resolve(option("config", "config/measurements.json"));
if (fs.existsSync(root)) {
  throw new Error(`Refusing to reuse an existing clean-room directory: ${root}`);
}
fs.mkdirSync(root, { recursive: true });

function run(arguments_) {
  const result = spawnSync(process.execPath, arguments_, {
    cwd: path.resolve("."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const label of ["a", "b"]) {
  run([
    "src/cli.mjs",
    "download",
    "--config",
    config,
    "--data",
    path.join(root, `data-${label}`),
  ]);
  run([
    "src/cli.mjs",
    "run",
    "--config",
    config,
    "--data",
    path.join(root, `data-${label}`),
    "--out",
    path.join(root, `results-${label}`),
  ]);
}
run([
  "src/cli.mjs",
  "verify",
  "--config",
  config,
  "--left",
  path.join(root, "results-a"),
  "--right",
  path.join(root, "results-b"),
]);

