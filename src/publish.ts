import { ENDPOINTS, publicEstimateUrl } from "./endpoints.ts";
import { fetchText } from "./http.ts";
import type { Estimate } from "./contract.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheRoot } from "./cache.ts";

export interface SaveResponseBody {
  message?: string;
  savedKey?: string;
}

export interface PublishResult {
  savedKey: string;
  url: string;
  publishedAt: string;
  response: unknown;
}

interface SaveEnvelope {
  statusCode?: number;
  body?: string;
  headers?: Record<string, string>;
}

interface PublishBudget {
  date: string;
  count: number;
}

function budgetPath(): string {
  return join(cacheRoot(), "publishes.json");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function publishBudget(): Promise<{ used: number; limit: number }> {
  const limit = Number(process.env["AWSCALC_MAX_PUBLISHES_PER_DAY"] ?? 25);
  try {
    const raw = await readFile(budgetPath(), "utf8");
    const parsed = JSON.parse(raw) as PublishBudget;
    if (parsed.date !== today()) return { used: 0, limit };
    return { used: parsed.count, limit };
  } catch {
    return { used: 0, limit };
  }
}

async function recordPublish(): Promise<void> {
  const budget = await publishBudget();
  const next: PublishBudget = { date: today(), count: budget.used + 1 };
  await mkdir(cacheRoot(), { recursive: true });
  await writeFile(budgetPath(), JSON.stringify(next), "utf8");
}

/** POST an estimate to the public save endpoint and return the public link. */
export async function publishEstimate(
  estimate: Estimate,
  options: { attempts?: number; skipBudgetCheck?: boolean } = {}
): Promise<PublishResult> {
  const budget = await publishBudget();
  if (!options.skipBudgetCheck && budget.used >= budget.limit) {
    throw new Error(
      `publish budget exhausted: ${budget.used}/${budget.limit} links today. ` +
        `Links are public; raise AWSCALC_MAX_PUBLISHES_PER_DAY only when intentional`
    );
  }

  const payload = JSON.stringify(estimate);
  const text = await fetchText(ENDPOINTS.publish, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    attempts: options.attempts ?? 3,
  });

  let envelope: SaveEnvelope;
  try {
    envelope = JSON.parse(text) as SaveEnvelope;
  } catch {
    throw new Error(`save endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (envelope.statusCode !== undefined && envelope.statusCode !== 201) {
    throw new Error(`save endpoint returned statusCode ${envelope.statusCode}: ${text.slice(0, 300)}`);
  }
  if (typeof envelope.body !== "string") {
    throw new Error(`save endpoint response has no body: ${text.slice(0, 300)}`);
  }

  let body: SaveResponseBody;
  try {
    body = JSON.parse(envelope.body) as SaveResponseBody;
  } catch {
    throw new Error(`save endpoint body is not JSON: ${envelope.body.slice(0, 200)}`);
  }
  if (!body.savedKey) {
    throw new Error(`save endpoint returned no savedKey: ${envelope.body.slice(0, 300)}`);
  }

  await recordPublish();

  return {
    savedKey: body.savedKey,
    url: publicEstimateUrl(body.savedKey),
    publishedAt: new Date().toISOString(),
    response: body,
  };
}

/** Fetch the stored estimate JSON for a saved key (verification and receipts). */
export async function retrieveEstimate(savedKey: string): Promise<Estimate> {
  const text = await fetchText(`${ENDPOINTS.retrieve}/${savedKey}`);
  return JSON.parse(text) as Estimate;
}

export function savedKeyOf(url: string): string | undefined {
  const match = /[?&#]id=([^&\s]+)/.exec(url);
  return match?.[1];
}
