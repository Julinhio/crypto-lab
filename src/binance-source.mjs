// Single, locked acquisition source for every dataset produced by this repository.
// Switching source is an arbitration, never an in-flight fallback: nothing here
// accepts an alternative host, and no caller can inject one.
export const BINANCE_DATA_API = "https://data-api.binance.vision";

const LOCKED_ORIGIN = new URL(BINANCE_DATA_API).origin;

export class PreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreflightError";
  }
}

export class SourceLockError extends Error {
  constructor(message) {
    super(message);
    this.name = "SourceLockError";
  }
}

export function assertLockedSource(candidate) {
  if (typeof candidate !== "string" || !candidate.length) {
    throw new SourceLockError("Source must be a non-empty string");
  }
  let origin;
  try {
    origin = new URL(candidate).origin;
  } catch {
    throw new SourceLockError(`Source is not a valid URL: ${candidate}`);
  }
  if (origin !== LOCKED_ORIGIN) {
    throw new SourceLockError(
      `Source is locked to ${LOCKED_ORIGIN}, refused: ${origin}`,
    );
  }
  return BINANCE_DATA_API;
}

export function lockedUrl(pathname, searchParams = {}) {
  const url = new URL(pathname, BINANCE_DATA_API);
  assertLockedSource(url.toString());
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

// Probes the locked source only. A failure here aborts the run: callers must not
// catch it to reach for a different host, a proxy, or a cached dataset.
export async function preflight({ fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const url = lockedUrl("/api/v3/ping");
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new PreflightError(
      `Preflight to ${BINANCE_DATA_API} failed: ${error.message}`,
    );
  }
  if (!response.ok) {
    throw new PreflightError(
      `Preflight to ${BINANCE_DATA_API} returned HTTP ${response.status}`,
    );
  }
  return { source: BINANCE_DATA_API, status: response.status };
}
