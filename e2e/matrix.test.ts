import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { LEDGER } from "../src/ledger.ts";
import { loadSpecFile } from "../src/estimate/spec.ts";
import { buildFromSpec, type BuildOutcome } from "./helpers/build.ts";
import { diffRendered, readRenderedEstimate } from "../src/verify.ts";
import { expectationFrom } from "../src/commands/publish.ts";
import type { PublicationReceipt } from "../src/commands/publish.ts";
import { retrieveEstimate } from "../src/publish.ts";
import { savedKeyFromUrl } from "../src/endpoints.ts";

const ROOT = join(import.meta.dirname, "..");
// One browser per worktree. This repository runs several worktrees at once and
// a shared session name lets one run navigate away from another's page, which
// shows up as a timeout or as another estimate's title.
const SESSION =
  process.env["AGENT_BROWSER_SESSION"] ?? `aws-cal-axi-e2e-${basename(ROOT)}`;

async function receiptFor(path: string): Promise<PublicationReceipt> {
  return JSON.parse(await readFile(join(ROOT, path), "utf8")) as PublicationReceipt;
}

for (const entry of LEDGER) {
  test(`ledger row ${entry.id}`, async () => {
    const receipt = await receiptFor(entry.receiptPath);
    const spec = await loadSpecFile(join(ROOT, entry.specPath));
    const built: BuildOutcome = await buildFromSpec(spec);

    assert.equal(
      built.result.serviceTotal.monthly,
      entry.expectedMonthlyCents / 100,
      "native monthly cost matches the frozen ledger value"
    );
    if (entry.expectedSupportMonthlyCents !== undefined) {
      assert.equal(
        built.result.support?.cost.monthly,
        entry.expectedSupportMonthlyCents / 100,
        "native support cost matches the frozen ledger value"
      );
    }
    if (entry.expectedRenderedMonthlyCents !== undefined) {
      assert.equal(
        built.result.serviceTotal.monthly + (built.result.support?.cost.monthly ?? 0),
        entry.expectedRenderedMonthlyCents / 100,
        "native rendered total matches the frozen ledger value"
      );
    }
    assert.equal(receipt.verdict, "pass", "receipt render verdict");
    assert.equal(receipt.expires.length, 10, "receipt records the expiry date");

    const savedKey = savedKeyFromUrl(receipt.url);
    assert.ok(savedKey, "receipt URL carries a saved key");
    const stored = await retrieveEstimate(savedKey);
    const rerendered = readRenderedEstimate(receipt.url, {
      session: SESSION,
      waitText: stored.name,
    });
    const mismatches = diffRendered(
      rerendered,
      expectationFrom(built.result, { ...spec, name: stored.name })
    );
    assert.deepEqual(mismatches, [], "public page still renders the native estimate");

    if (entry.oracle === "probe") {
      assert.equal(receipt.oracle?.kind ?? "probe", "probe", "receipt stores a recompute probe");
      assert.ok(receipt.oracle?.url, "receipt stores a recompute probe URL");
      const recomputed = readRenderedEstimate(receipt.oracle.url, {
        session: SESSION,
        waitText: spec.name,
      });
      const oracleMismatches = diffRendered(recomputed, expectationFrom(built.result, spec));
      assert.deepEqual(oracleMismatches, [], "live UI recomputation matches the native estimate");
    }
    if (entry.oracle === "editor") {
      assert.equal(receipt.oracle?.kind, "editor-recompute", "receipt stores an editor recompute");
      assert.ok(receipt.oracle?.url, "receipt stores the editor recompute URL");
      const recomputed = readRenderedEstimate(receipt.oracle.url, {
        session: SESSION,
        waitText: stored.name,
        recompute: true,
      });
      // Editor summaries can lag the UI string table; costs are the signal.
      const oracleMismatches = diffRendered(
        recomputed,
        expectationFrom(built.result, { ...spec, name: stored.name }, false)
      );
      assert.deepEqual(oracleMismatches, [], "live editor recomputation matches the native estimate");
    }
  });
}
