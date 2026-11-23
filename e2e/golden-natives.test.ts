import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadSpecFile } from "../src/estimate/spec.ts";
import { buildFromSpec } from "./helpers/build.ts";

const ROOT = join(import.meta.dirname, "..");

/**
 * Native goldens for fixtures that do not have a public render receipt yet.
 * They lock the engine's arithmetic and summaries until the next publish.
 */
const CASES = [
  {
    spec: "examples/xray.yaml",
    monthly: 50,
    summary: "Number of requests per month (10000000), Sampling rate (1), Add X-Ray Insights (No)",
  },
  {
    spec: "examples/cloudformation.yaml",
    monthly: 2736.6,
    summary:
      "Number of third-party extensions managed (100), Total number of operations per extension (1000 per day), Average duration per operation (30 seconds)",
  },
  {
    spec: "examples/eventbridge.yaml",
    monthly: 10,
    summaryIncludes: "Number of custom events (10 million per month)",
  },
  {
    spec: "examples/dax.yaml",
    monthly: 558.45,
    summary: "DAX nodes (3), DAX instance type (r5.large)",
  },
  {
    spec: "examples/s3-data-transfer.yaml",
    monthly: 92.16,
    summary:
      "DT Inbound: Not selected (0 TB per month), DT Outbound: Internet (1 TB per month)",
  },
  {
    spec: "examples/athena.yaml",
    monthly: 14.85,
    summary: "Total number of queries (100 per day), Amount of data scanned per query (1 GB), Number of DPUs (4)",
  },
] as const;

for (const testCase of CASES) {
  test(`native golden ${testCase.spec}`, async () => {
    const spec = await loadSpecFile(join(ROOT, testCase.spec));
    const { result } = await buildFromSpec(spec);
    assert.equal(result.serviceTotal.monthly, testCase.monthly);
    const service = result.services[0];
    assert.ok(service);
    if ("summary" in testCase && testCase.summary) {
      assert.equal(service.evaluated.configSummary, testCase.summary);
    }
    if ("summaryIncludes" in testCase && testCase.summaryIncludes) {
      assert.ok(service.evaluated.configSummary.includes(testCase.summaryIncludes));
    }
  });
}
