import test from "node:test";
import assert from "node:assert/strict";
import { parseSpec, parseSpecText, sampleSpec, SpecError } from "../src/estimate/spec.ts";

test("a minimal spec gets contract defaults", () => {
  const spec = parseSpec({
    name: "Web tier",
    services: [{ code: "aWSLambda", region: "us-east-2" }],
  });
  assert.equal(spec.currency, "USD");
  assert.equal(spec.locale, "en_US");
  assert.deepEqual(spec.groups, []);
  assert.deepEqual(spec.services[0]?.set, {});
});

test("sub-services and nested groups parse", () => {
  const spec = parseSpec({
    name: "S3",
    services: [
      {
        code: "amazonSimpleStorageServiceGroup",
        region: "us-east-2",
        subServices: [
          {
            code: "amazonS3Standard",
            set: { s3StandardStorageSize: { value: 100, unit: "gb|month" } },
          },
        ],
      },
    ],
    groups: [
      {
        name: "Prod",
        services: [],
        groups: [{ name: "Prod/Data", services: [{ code: "aWSLambda", region: "us-east-1" }], groups: [] }],
      },
    ],
  });
  assert.equal(spec.services[0]?.subServices?.[0]?.code, "amazonS3Standard");
  assert.equal(spec.groups[0]?.groups[0]?.name, "Prod/Data");
});

test("support accepts a plan name or a mapping", () => {
  assert.equal(parseSpec({ name: "x", support: "business", services: [] }).support?.plan, "business");
  assert.equal(
    parseSpec({ name: "x", support: "business-support", services: [] }).support?.plan,
    "business"
  );
  const mapped = parseSpec({ name: "x", support: { plan: "unified", spendTier: 9 }, services: [] });
  assert.equal(mapped.support?.plan, "unified");
  assert.equal(mapped.support?.spendTier, 9);
  assert.throws(
    () => parseSpec({ name: "x", support: "platinum", services: [] }),
    /unknown support plan/
  );
});

test("missing fields produce path-addressed errors", () => {
  assert.throws(() => parseSpec({ services: [] }), (error: unknown) => {
    assert.ok(error instanceof SpecError);
    assert.equal(error.path, "name");
    return true;
  });
  assert.throws(
    () => parseSpec({ name: "x", services: [{ region: "us-east-1" }] }),
    /services\[0\]\.code: is required/
  );
  assert.throws(
    () => parseSpec({ name: "x", services: [{ code: "x", region: "us-east-1", subServices: [] }] }),
    /must list at least one sub-service/
  );
});

test("YAML and JSON parse identically", () => {
  const yaml = sampleSpec("Sample");
  const fromYaml = parseSpecText(yaml, "yaml");
  const fromJson = parseSpecText(JSON.stringify(fromYaml), "json");
  assert.deepEqual(fromYaml, fromJson);
  assert.equal(fromYaml.services[0]?.code, "amazonSimpleStorageServiceGroup");
});
