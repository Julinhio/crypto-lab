import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export function percentile(values, p) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

export function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : Number.NaN;
}

export function createLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

export function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeCanonicalJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, canonicalJson(value), "utf8");
}

export function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function writeCsv(filePath, rows, columns = null) {
  ensureDir(path.dirname(filePath));
  const headers = columns ?? (rows.length ? Object.keys(rows[0]) : []);
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

export function listFilesRecursive(root) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...listFilesRecursive(fullPath));
    else output.push(fullPath);
  }
  return output.sort();
}

export function relativePosix(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

// Compact canonical form: one JSON array per file, stable key order inherited
// from the row objects, trailing newline. Consumers keep a plain JSON.parse.
export function compactJson(value) {
  return `${JSON.stringify(value)}\n`;
}

export function writeCompactJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, compactJson(value), "utf8");
}
