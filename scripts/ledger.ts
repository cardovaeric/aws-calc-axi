import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LEDGER, formatCoverage, type LedgerReceiptView } from "../src/ledger.ts";

const ROOT = join(import.meta.dirname, "..");

async function readReceipt(path: string): Promise<LedgerReceiptView | undefined> {
  try {
    return JSON.parse(await readFile(join(ROOT, path), "utf8")) as LedgerReceiptView;
  } catch {
    return undefined;
  }
}

const receipts = new Map<string, LedgerReceiptView | undefined>();
for (const entry of LEDGER) {
  receipts.set(entry.id, await readReceipt(entry.receiptPath));
}

const coverage = formatCoverage(LEDGER, receipts);
await writeFile(join(ROOT, "COVERAGE.md"), coverage, "utf8");

const passed = LEDGER.filter((entry) => receipts.get(entry.id)?.verdict === "pass").length;
process.stderr.write(
  `ledger: ${LEDGER.length} rows, ${passed} with a passing rendered receipt -> COVERAGE.md\n`
);
