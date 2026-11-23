import test from "node:test";
import assert from "node:assert/strict";
import type { FrontEndUi } from "../src/data/support.ts";
import {
  computeSupportCost,
  supportCostForSpend,
  supportPayload,
  type SupportPlanKey,
} from "../src/estimate/support.ts";

function config(): FrontEndUi {
  return {
    CONTENT: {
      RESOURCES: {},
      ADD_SUPPORT_PAGE: {
        CONTENT: {
          configuration: {
            supportRecommendation: {
              plans: {
                "basic-support": { id: "basic-support", title: "Basic support plan" },
                "business-support": { id: "business-support", title: "Business Support+" },
                "enterprise-support": { id: "enterprise-support", title: "Enterprise Support" },
                "unified-operations": { id: "unified-operations", title: "Unified Operations" },
              },
            },
          },
          pricingData: {
            "basic-support": { pricing: { min: 0, max: null, percentage: 0 } },
            "business-support": {
              pricing: {
                min: 29,
                tiers: {
                  "9": { min: 29, max: 10000, percentage: 9 },
                  "7": { min: 10000, max: 70000, percentage: 7 },
                  "5": { min: 70000, max: 180000, percentage: 5 },
                  "3": { min: 180000, max: null, percentage: 3 },
                },
                tier: {
                  "9": { max: 10000, min: 0, percentage: 9 },
                  "7": { max: 80000, min: 10000, percentage: 7 },
                  "5": { max: 250000, min: 80000, percentage: 5 },
                  "3": { max: -1, min: 250000, percentage: 3 },
                },
              },
            },
            "enterprise-support": {
              pricing: {
                min: 5000,
                tier: {
                  "10": { max: 150000, min: 0, percentage: 10 },
                  "7": { max: 500000, min: 150000, percentage: 7 },
                },
              },
            },
            "unified-operations": {
              pricing: {
                min: 50000,
                tier: {
                  "10": { max: 250000, min: 0, percentage: 10 },
                  "6": { max: 1000000, min: 250000, percentage: 6 },
                },
              },
            },
          },
        },
      },
    },
  };
}

const business = config().CONTENT.ADD_SUPPORT_PAGE.CONTENT.pricingData["business-support"]?.pricing;

test("business support on a small estimate pays the minimum", () => {
  assert.ok(business);
  const cost = supportCostForSpend(business, 1.53);
  assert.equal(cost, 29);
});

test("business support bills tiers above the minimum", () => {
  assert.ok(business);
  // 9% on the first 10,000 = 900; 7% on the next 20,000 = 1,400
  assert.equal(supportCostForSpend(business, 30000), 2300);
});

test("a chosen spend tier skips higher-percentage tiers", () => {
  assert.ok(business);
  // Skipping the 9% tier bills the whole 30,000 at 7%.
  assert.equal(supportCostForSpend(business, 30000, { selectedPercentage: 7 }), 2100);
});

test("enterprise support minimum applies below 50k spend", () => {
  const cost = computeSupportCost(config(), "enterprise", 1000, 0);
  assert.equal(cost.monthly, 5000);
});

test("basic support is free", () => {
  const cost = computeSupportCost(config(), "basic", 1000, 0);
  assert.deepEqual(cost, { monthly: 0, firstMonth: 0 });
});

test("first month includes upfront fees", () => {
  const cost = computeSupportCost(config(), "business", 30000, 20000);
  assert.equal(cost.monthly, 2300);
  assert.equal(cost.firstMonth, supportCostForSpend(business!, 50000));
});

test("support payload matches the captured shape", () => {
  for (const plan of ["basic", "business", "enterprise", "unified"] as SupportPlanKey[]) {
    const payload = supportPayload(config(), plan);
    assert.equal(payload.description, "");
    assert.deepEqual(payload.calculationComponents["supportPlan"], {
      value: { id: supportPlanId(plan) },
    });
    assert.equal(typeof payload.supportTitle, "string");
  }
  assert.equal(supportPayload(config(), "business").supportTitle, "Business Support+");
});

function supportPlanId(plan: SupportPlanKey): string {
  return {
    basic: "basic-support",
    business: "business-support",
    enterprise: "enterprise-support",
    unified: "unified-operations",
  }[plan];
}
