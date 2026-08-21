import fs from "node:fs";
import path from "node:path";
import { canonicalJson, relativePosix, sha256Buffer } from "./lib.mjs";

const LOCAL_IMPORT = /\bfrom\s+"(\.[^"]+)"|\bimport\s+"(\.[^"]+)"/g;

// Walks the static import graph of the acquisition entry point, restricted to
// local modules. The resulting hash is stable and verifiable after the fact,
// unlike the producing commit, which does not yet exist when the bundle is
// generated and changes again on squash-merge.
export function collectProducerSources(entryPath, repoRoot) {
  const root = path.resolve(repoRoot);
  const pending = [path.resolve(entryPath)];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const text = fs.readFileSync(current, "utf8");
    for (const match of text.matchAll(LOCAL_IMPORT)) {
      const specifier = match[1] ?? match[2];
      const resolved = path.resolve(path.dirname(current), specifier);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Unresolved local import ${specifier} in ${current}`);
      }
      pending.push(resolved);
    }
  }
  return [...visited]
    .map((filePath) => ({
      path: relativePosix(root, filePath),
      sha256: sha256Buffer(fs.readFileSync(filePath)),
    }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
}

export function producerSourceSha256(files) {
  return sha256Buffer(Buffer.from(canonicalJson(files), "utf8"));
}
