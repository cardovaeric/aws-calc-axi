import test from "node:test";
import assert from "node:assert/strict";
import type { ServiceDefinition } from "../src/data/definitions.ts";
import { evaluateTemplate } from "../src/engine/template.ts";
import { s3Resolver, fixture } from "./helpers.ts";

const definition = fixture<ServiceDefinition>("s3-standard.definition.json");

function evaluate(set: Record<string, unknown>) {
  const template = definition.templates?.[0];
  assert.ok(template, "fixture has a template");
  return evaluateTemplate({
    definition,
    template,
    regionCode: "us-east-2",
    regionName: "US East (Ohio)",
    prices: s3Resolver(),
    overrides: set,
  });
}

test("S3 Standard 100 GB per month costs 2.30", () => {
  const result = evaluate({
    s3StandardStorageSize: { value: 100, unit: "gb|month" },
    moveToStorageClassMethod: "No movement required",
  });
  assert.equal(result.serviceCost.monthly, 2.3);
  assert.equal(result.serviceCost.upfront, 0);
  assert.equal(result.configSummary, "S3 Standard storage (100 GB per month)");
});

test("S3 saved components match the captured contract shape", () => {
  const result = evaluate({
    s3StandardStorageSize: { value: 100, unit: "gb|month" },
    moveToStorageClassMethod: "No movement required",
  });
  assert.deepEqual(result.calculationComponents["s3StandardStorageSize"], {
    value: 100,
    unit: "gb|month",
  });
  assert.deepEqual(result.calculationComponents["moveToStorageClassMethod"], {
    value: "No movement required",
  });
});

test("S3 unconditional 1 TB prices through the tier table", () => {
  const result = evaluate({
    s3StandardStorageSize: { value: 1, unit: "tb|month" },
  });
  // 1 TB = 1024 GB at 0.023
  assert.equal(result.serviceCost.monthly, 23.55);
  assert.equal(result.configSummary, "S3 Standard storage (1 TB per month)");
});

test("a tier boundary lands on the cheaper tier for the extra GB", () => {
  const result = evaluate({
    s3StandardStorageSize: { value: 51201, unit: "gb|month" },
  });
  const expected = Math.round((51200 * 0.023 + 1 * 0.022) * 100) / 100;
  assert.equal(result.serviceCost.monthly, expected);
});

test("missing required storage input fails closed", () => {
  assert.throws(() => evaluate({}), /required input "s3StandardStorageSize"/);
});

test("the PUT path adds an upfront request cost", () => {
  const result = evaluate({
    s3StandardStorageSize: { value: 100, unit: "gb|month" },
    moveToStorageClassMethod: "PUT to S3 Standard",
    S3_Standard_Average_Object_Size: { value: 1, unit: "mb|NA" },
  });
  // 100 GB / 1 MB = 102400 objects, each billed one PUT at 0.000005 = 0.512
  assert.equal(result.serviceCost.upfront, 0.51);
});
