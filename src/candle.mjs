// Payload validation, shared by the two consumers that need it: acquisition,
// which converts raw API rows, and verification, which re-reads a written
// bundle. Number() turns a malformed field into NaN and JSON.stringify turns
// NaN into null, so without this an invalid upstream response would land in a
// data file as a silent `null` price, or as `0` when the field was null.
export const CANDLE_FIELDS = [
  "t",
  "o",
  "h",
  "l",
  "c",
  "v",
  "closeTime",
  "qv",
  "trades",
  "takerBuyBase",
  "takerBuyQuote",
];

export const API_ROW_MINIMUM_FIELDS = 11;

const TIMESTAMP_FIELDS = ["t", "closeTime"];
const STRICTLY_POSITIVE_FIELDS = ["o", "h", "l", "c"];
const NON_NEGATIVE_FIELDS = ["v", "qv", "trades", "takerBuyBase", "takerBuyQuote"];

// Returns the list of reasons a candle is unusable, empty when it is sound.
// Reporting every reason rather than throwing lets verification list what is
// wrong with a series instead of stopping at the first row.
export function candleProblems(candle) {
  if (candle === null || typeof candle !== "object" || Array.isArray(candle)) {
    return [`candle is not an object: ${JSON.stringify(candle)}`];
  }
  const problems = [];
  for (const field of CANDLE_FIELDS) {
    if (!Object.hasOwn(candle, field)) {
      problems.push(`missing field ${field}`);
    } else if (!Number.isFinite(candle[field])) {
      problems.push(`${field} is not finite: ${JSON.stringify(candle[field])}`);
    }
  }
  // Every later rule assumes finite numbers, so stop here when they are not.
  if (problems.length) return problems;

  for (const field of TIMESTAMP_FIELDS) {
    if (!Number.isInteger(candle[field]) || candle[field] < 0) {
      problems.push(`${field} is not a valid timestamp: ${candle[field]}`);
    }
  }
  for (const field of STRICTLY_POSITIVE_FIELDS) {
    if (!(candle[field] > 0)) {
      problems.push(`${field} must be strictly positive: ${candle[field]}`);
    }
  }
  for (const field of NON_NEGATIVE_FIELDS) {
    if (candle[field] < 0) {
      problems.push(`${field} must be zero or more: ${candle[field]}`);
    }
  }
  if (candle.closeTime < candle.t) {
    problems.push(`closeTime ${candle.closeTime} precedes openTime ${candle.t}`);
  }
  // Internal coherence. Finite and strictly positive is not enough: a high below
  // the open, or a low above it, describes a candle that cannot have happened,
  // and downstream range and volatility measures would be computed from it.
  const body = { low: Math.min(candle.o, candle.c), high: Math.max(candle.o, candle.c) };
  if (candle.h < body.high) {
    problems.push(`h ${candle.h} is below the higher of open and close ${body.high}`);
  }
  if (candle.l > body.low) {
    problems.push(`l ${candle.l} is above the lower of open and close ${body.low}`);
  }
  if (candle.l > candle.h) {
    problems.push(`l ${candle.l} is above h ${candle.h}`);
  }
  return problems;
}

// Converts one raw kline row and refuses anything the rules above reject. The
// run stops rather than freezing a candle nobody can trust.
export function candleFromApiRow(row, context = "") {
  const where = context ? ` for ${context}` : "";
  if (!Array.isArray(row)) {
    throw new Error(`Kline row${where} is not an array: ${JSON.stringify(row)}`);
  }
  if (row.length < API_ROW_MINIMUM_FIELDS) {
    throw new Error(
      `Kline row${where} has ${row.length} fields, expected at least `
      + `${API_ROW_MINIMUM_FIELDS}: ${JSON.stringify(row)}`,
    );
  }
  // Reject the raw field before converting it. Number(null) is 0, which is a
  // legal volume, so a null field would otherwise survive as a genuine-looking
  // zero instead of being caught.
  const rawProblems = [];
  for (let index = 0; index < API_ROW_MINIMUM_FIELDS; index += 1) {
    const value = row[index];
    if (typeof value !== "number" && typeof value !== "string") {
      rawProblems.push(`field ${index} is ${JSON.stringify(value) ?? "undefined"}`);
    } else if (typeof value === "string" && value.trim() === "") {
      rawProblems.push(`field ${index} is empty`);
    }
  }
  if (rawProblems.length) {
    throw new Error(
      `Invalid kline row${where}: ${rawProblems.join("; ")}`,
    );
  }
  const candle = {
    t: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
    closeTime: Number(row[6]),
    qv: Number(row[7]),
    trades: Number(row[8]),
    takerBuyBase: Number(row[9]),
    takerBuyQuote: Number(row[10]),
  };
  const problems = candleProblems(candle);
  if (problems.length) {
    throw new Error(
      `Invalid kline row${where}: ${problems.join("; ")} `
      + `(raw: ${JSON.stringify(row.slice(0, API_ROW_MINIMUM_FIELDS))})`,
    );
  }
  return candle;
}
