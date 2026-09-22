import "server-only";

/**
 * Bounded HTTP transport for Officer provider calls.
 *
 * A live Officer request once stalled for ~843 seconds. That is unacceptable
 * for an interactive product: the browser waits, the user learns nothing, and
 * the server holds a socket. Every provider call now runs under an explicit
 * timeout with a real AbortController, and only CLEARLY retryable failures
 * are retried.
 *
 * Never retried (deterministic — a retry just burns budget and latency):
 *   401/403 authorization, 400 malformed request / bad tool arguments,
 *   404 unknown model, 422 schema errors, tenant-denied operations.
 *
 * Retried (bounded, with backoff):
 *   network reset/DNS blips, request timeout, 408, 429, 500, 502, 503, 504.
 *
 * Config:
 *   VAZORA_OFFICER_TIMEOUT_MS   default 45000 (per attempt)
 *   VAZORA_OFFICER_MAX_RETRIES  default 1 (so at most 2 attempts)
 */

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RETRIES = 1;

export function officerTimeoutMs(): number {
  const raw = Number(process.env.VAZORA_OFFICER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

export function officerMaxRetries(): number {
  const raw = Number(process.env.VAZORA_OFFICER_MAX_RETRIES);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MAX_RETRIES;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Transient transport failures worth one more attempt. */
const RETRYABLE_NETWORK = [
  "ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN",
  "socket hang up", "network error", "fetch failed",
];

export type TransportFailure = {
  kind: "timeout" | "network" | "http";
  status?: number;
  message: string;
  retryable: boolean;
  attempts: number;
  durationMs: number;
};

export type TransportResult =
  | { ok: true; response: Response; attempts: number; durationMs: number }
  | { ok: false; failure: TransportFailure };

function isRetryableNetwork(message: string): boolean {
  const m = message.toLowerCase();
  return RETRYABLE_NETWORK.some((n) => m.toLowerCase().includes(n.toLowerCase())) || m.includes("abort");
}

/**
 * POST JSON with a hard per-attempt timeout and bounded retry.
 *
 * The response body is NOT read here — callers own parsing — but a
 * non-retryable error response is returned as a failure with its status so
 * the caller can surface an honest message without retrying.
 */
export async function officerFetch(
  url: string,
  init: { headers: Record<string, string>; body: string },
): Promise<TransportResult> {
  const timeoutMs = officerTimeoutMs();
  const maxRetries = officerMaxRetries();
  const t0 = Date.now();
  let attempts = 0;
  let last: TransportFailure | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) return { ok: true, response, attempts, durationMs: Date.now() - t0 };

      const retryable = RETRYABLE_STATUS.has(response.status);
      const text = (await response.text()).slice(0, 300);
      last = {
        kind: "http", status: response.status,
        message: text || `HTTP ${response.status}`,
        retryable, attempts, durationMs: Date.now() - t0,
      };
      // Deterministic failures (auth, malformed request, schema) stop here.
      if (!retryable) return { ok: false, failure: last };
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && (e.name === "AbortError" || e.message.includes("abort"));
      const message = e instanceof Error ? e.message : "unknown transport error";
      last = {
        kind: aborted ? "timeout" : "network",
        message: aborted ? `provider request exceeded ${timeoutMs}ms and was aborted` : message,
        retryable: aborted || isRetryableNetwork(message),
        attempts, durationMs: Date.now() - t0,
      };
      if (!last.retryable) return { ok: false, failure: last };
    }

    // Backoff before the next bounded attempt.
    if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }

  return {
    ok: false,
    failure: last ?? {
      kind: "network", message: "provider unreachable", retryable: true,
      attempts, durationMs: Date.now() - t0,
    },
  };
}

/** Stable, non-confidential error string for the UI and the audit log. */
export function describeFailure(f: TransportFailure): string {
  if (f.kind === "timeout") return `provider_timeout: ${f.message} (attempts ${f.attempts})`;
  if (f.kind === "http") return `provider HTTP ${f.status}: ${f.message}`;
  return `provider network error: ${f.message} (attempts ${f.attempts})`;
}
