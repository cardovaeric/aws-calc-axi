import test from "node:test";
import assert from "node:assert/strict";
import { diffRendered, type RenderedEstimate } from "../src/verify.ts";

function rendered(services: Array<{ name: string; monthly: string; configSummary: string }>): RenderedEstimate {
  return {
    url: "https://calculator.aws/#/estimate?id=test",
    title: "test",
    monthly: "7452.75 USD",
    upfront: "0.00 USD",
    annual: "89433.00 USD",
    monthlyValue: 7452.75,
    upfrontValue: 0,
    annualValue: 89433,
    estimateDate: null,
    banner: null,
    readOnlyNotice: false,
    services: services.map((service) => ({
      ...service,
      upfront: "0.00 USD",
      description: null,
      region: "US East (Ohio)",
      status: "-",
    })),
    groups: [],
    supportRow: null,
    capturedAt: new Date().toISOString(),
  };
}

test("duplicate service names match by config summary", () => {
  const page = rendered([
    { name: "Amazon Elastic Block Store (EBS)", monthly: "205.00 USD", configSummary: "gp3" },
    { name: "Amazon Elastic Block Store (EBS)", monthly: "7247.75 USD", configSummary: "io2" },
  ]);
  const mismatches = diffRendered(page, {
    services: [
      { name: "Amazon Elastic Block Store (EBS)", monthly: 7247.75, configSummary: "io2" },
      { name: "Amazon Elastic Block Store (EBS)", monthly: 205, configSummary: "gp3" },
    ],
  });
  assert.deepEqual(mismatches, []);
});

test("duplicate service names fall back to order when summaries are absent", () => {
  const page = rendered([
    { name: "Amazon EC2", monthly: "70.08 USD", configSummary: "" },
    { name: "Amazon EC2", monthly: "43.80 USD", configSummary: "" },
  ]);
  const mismatches = diffRendered(page, {
    services: [
      { name: "Amazon EC2", monthly: 70.08 },
      { name: "Amazon EC2", monthly: 43.8 },
    ],
  });
  assert.deepEqual(mismatches, []);
});
