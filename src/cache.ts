import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fetchText, type FetchOptions } from "./http.ts";

export interface CachedBody {
  url: string;
  fetchedAt: string;
  body: string;
}

export interface CacheOptions {
  /** Cache lifetime in ms. Default 24h. */
  ttlMs?: number;
  /** Never touch the network; fail if the entry is absent. */
  offline?: boolean;
  /** Ignore a fresh entry and refetch. */
  refresh?: boolean;
  fetch?: FetchOptions;
  onNote?: (message: string) => void;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function cacheRoot(): string {
  return process.env.AWSCALC_CACHE_DIR ?? join(homedir(), ".cache", "aws-calc-axi");
}

export function isOffline(): boolean {
  return process.env.AWSCALC_OFFLINE === "1" || process.env.AWSCALC_OFFLINE === "true";
}

function entryPath(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return join(cacheRoot(), "http", hash.slice(0, 2), `${hash}.json`);
}

async function readEntry(url: string): Promise<CachedBody | undefined> {
  try {
    const raw = await readFile(entryPath(url), "utf8");
    const parsed = JSON.parse(raw) as CachedBody;
    if (parsed.url !== url || typeof parsed.body !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

async function writeEntry(entry: CachedBody): Promise<void> {
  const path = entryPath(entry.url);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(entry), "utf8");
  await rename(tmp, path);
}

function ageMs(entry: CachedBody): number {
  const fetched = Date.parse(entry.fetchedAt);
  return Number.isFinite(fetched) ? Date.now() - fetched : Number.POSITIVE_INFINITY;
}

/**
 * Content cache for the calculator.aws data plane.
 *
 * Entries are keyed by URL and stored as text. A fresh entry is reused for
 * `ttlMs`; stale entries are refetched, and a refetch failure falls back to the
 * stale copy so offline work keeps functioning.
 */
export async function fetchCached(url: string, options: CacheOptions = {}): Promise<string> {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const cached = options.refresh ? undefined : await readEntry(url);
  if (cached && ageMs(cached) < ttl) return cached.body;

  if (options.offline ?? isOffline()) {
    if (cached) return cached.body;
    throw new Error(`offline and no cached copy of ${url} (run once without AWSCALC_OFFLINE)`);
  }

  try {
    const body = await fetchText(url, options.fetch);
    await writeEntry({ url, fetchedAt: new Date().toISOString(), body });
    return body;
  } catch (error) {
    if (cached) {
      options.onNote?.(`fetch failed, using stale cache for ${url}: ${String(error)}`);
      return cached.body;
    }
    throw error;
  }
}

export async function fetchCachedJson<T>(url: string, options: CacheOptions = {}): Promise<T> {
  const text = await fetchCached(url, options);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`invalid JSON from ${url}: ${String(error)}`);
  }
}

export async function readFileCached(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/** Snapshot metadata for `doctor` and estimate pinning. */
export async function cacheStats(): Promise<{ entries: number; root: string }> {
  const { readdir } = await import("node:fs/promises");
  const root = join(cacheRoot(), "http");
  let entries = 0;
  try {
    for (const prefix of await readdir(root)) {
      const files = await readdir(join(root, prefix)).catch(() => [] as string[]);
      entries += files.filter((file) => file.endsWith(".json")).length;
    }
  } catch {
    entries = 0;
  }
  return { entries, root: cacheRoot() };
}
