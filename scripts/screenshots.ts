/**
 * Capture a PNG of every ledger receipt's public page. Read-only: opens links,
 * writes screenshots, publishes nothing.
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LEDGER } from "../src/ledger.ts";
import { captureScreenshot } from "../src/verify.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "receipts", "screenshots");
const session = process.env["AGENT_BROWSER_SESSION"] ?? "aws-cal-axi-e2e";

await mkdir(OUT, { recursive: true });

for (const entry of LEDGER) {
  const receipt = JSON.parse(await readFile(join(ROOT, entry.receiptPath), "utf8")) as {
    url?: string;
  };
  if (!receipt.url) {
    process.stderr.write(`skip ${entry.id}: no URL\n`);
    continue;
  }
  const path = join(OUT, `${entry.id}.png`);
  captureScreenshot(receipt.url, path, { session });
  process.stderr.write(`shot ${entry.id} -> ${path}\n`);
}
