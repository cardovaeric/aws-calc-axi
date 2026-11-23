import { VERSION } from "./version.ts";

export interface FetchOptions {
  /** Attempts before giving up. Default 4. */
  attempts?: number;
  /** Base backoff in ms; doubles per attempt. Default 400. */
  backoffMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  signal?: AbortSignal;
  /** Called before each retry, for stderr diagnostics. */
  onRetry?: (info: { attempt: number; url: string; reason: string; waitMs: number }) => void;
}

export class HttpError extends Error {
  readonly url: string;
  readonly status: number | undefined;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = "HttpError";
    this.url = url;
    this.status = status;
  }
}

const DEFAULT_USER_AGENT = `aws-calc-axi/${VERSION}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
}

/** Fetch text with bounded exponential backoff. Throws HttpError on failure. */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const attempts = options.attempts ?? 4;
  const base = options.backoffMs ?? 400;
  let lastReason = "unknown error";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let waitMs = base * 2 ** (attempt - 1);
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          "user-agent": DEFAULT_USER_AGENT,
          "accept-encoding": "gzip, deflate, br",
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });

      if (response.ok) {
        return await response.text();
      }

      lastReason = `HTTP ${response.status} ${response.statusText}`.trim();
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable) {
        throw new HttpError(`request failed: ${lastReason}`, url, response.status);
      }
      waitMs = retryAfterMs(response) ?? waitMs;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      lastReason = error instanceof Error ? error.message : String(error);
    }

    if (attempt === attempts) break;
    options.onRetry?.({ attempt, url, reason: lastReason, waitMs });
    await sleep(waitMs);
  }

  throw new HttpError(`request failed after ${attempts} attempts: ${lastReason}`, url);
}
