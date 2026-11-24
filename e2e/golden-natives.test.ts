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
  {
    spec: "examples/codebuild-column-form.yaml",
    monthly: 9,
    summary:
      "AWS CodeBuild Compute Type (On-Demand EC2), Number of builds in a month (10), Search Instance Type (arm1.2xlarge), Operating system (Linux)",
  },
  {
    spec: "examples/elasticache-column-form.yaml",
    monthly: 454.06,
    summaryIncludes: "Nodes (2), Instance type (cache.m5.xlarge)",
  },
  {
    spec: "examples/msk-column-form.yaml",
    monthly: 489.9,
    summaryIncludes: "Number of Kafka broker nodes (3), Compute Family (m5.large)",
  },
  {
    spec: "examples/keyspaces-column-form.yaml",
    monthly: 25.69,
    summaryIncludes: "Pricing strategy (OnDemand)",
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

test("native golden examples/dependent-selectors.yaml (dependent selectors)", async () => {
  const spec = await loadSpecFile(join(ROOT, "examples/dependent-selectors.yaml"));
  const { result } = await buildFromSpec(spec);
  assert.equal(result.serviceTotal.monthly, 4080.7);
  assert.equal(result.serviceTotal.upfront, 3482);
  const monthly = result.services.map((entry) => entry.evaluated.serviceCost.monthly);
  assert.deepEqual(monthly, [0, 748.98, 3331.72]);
  const summaries = result.services.map((entry) => entry.evaluated.configSummary);
  // Only a Reserved row renders Term and Purchase option, and the saved row
  // carries both so the editor can reproduce the price.
  assert.ok(summaries[0]?.includes("Pricing strategy (Reserved 1yr All Upfront)"));
  assert.ok(summaries[1]?.includes("Pricing strategy (Reserved No Upfront 1yr)"));
  assert.ok(summaries[2]?.includes("Pricing strategy (Reserved No Upfront 1yr)"));
  const saved = result.services.map(
    (entry) => entry.evaluated.calculationComponents["columnFormIPM"] as
      | { value: Array<Record<string, { value: string }>> }
      | undefined
  );
  assert.deepEqual(saved[2]?.value[0], {
    "Number of Nodes": { value: "2" },
    "Instance Type": { value: "ra3.4xlarge" },
    TermType: { value: "Reserved" },
    PurchaseOption: { value: "No Upfront" },
    LeaseContractLength: { value: "1yr" },
  });
});

/**
 * A live column form holds one row per component; a second configuration is a
 * second service (receipts/column-form-rows-probe.json). The batch fixture
 * locks both the repeated-service shape and the multi-service total.
 */
test("native golden examples/column-form-rows.yaml (repeated services)", async () => {
  const spec = await loadSpecFile(join(ROOT, "examples/column-form-rows.yaml"));
  const { result } = await buildFromSpec(spec);
  assert.equal(result.serviceTotal.monthly, 957.46);
  const monthly = result.services.map((entry) => entry.evaluated.serviceCost.monthly);
  assert.deepEqual(monthly, [9, 4.5, 454.06, 489.9]);
});
