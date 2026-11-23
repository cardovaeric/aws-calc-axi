import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDisplayIf, type ExprContext } from "../src/engine/expression.ts";

function context(values: Record<string, unknown> = {}, meters: string[] = []): ExprContext {
  return {
    get: (id) => values[id] as never,
    hasMeteredUnit: (mapping, unit) => meters.includes(`${mapping}:${unit}`),
  };
}

test("comparisons coerce numeric strings", () => {
  assert.equal(evaluateDisplayIf({ "==": [{ type: "component", id: "a" }, "1"] }, context({ a: 1 })), true);
  assert.equal(evaluateDisplayIf({ ">": [{ type: "component", id: "a" }, 2] }, context({ a: 3 })), true);
  assert.equal(evaluateDisplayIf({ "<=": [{ type: "component", id: "a" }, 3] }, context({ a: 3 })), true);
  assert.equal(evaluateDisplayIf({ "!=": [{ type: "component", id: "a" }, "x"] }, context({ a: "y" })), true);
});

test("and, or, not", () => {
  const expr = {
    and: [
      { "==": [{ type: "component", id: "os" }, "linux"] },
      { or: [{ "==": [{ type: "component", id: "tenancy" }, "shared"] }, false] },
    ],
  };
  assert.equal(evaluateDisplayIf(expr, context({ os: "linux", tenancy: "shared" })), true);
  assert.equal(evaluateDisplayIf(expr, context({ os: "windows", tenancy: "shared" })), false);
  assert.equal(evaluateDisplayIf({ not: { "==": [1, 2] } }, context()), true);
});

test("exists checks metered units in the selected region", () => {
  const expr = {
    exists: {
      type: "meteredUnit",
      mappingDefinitionName: "s3-standard",
      meteredUnit: "Standard Storage First 50 TB per GB Mo",
    },
  };
  assert.equal(
    evaluateDisplayIf(expr, context({}, ["s3-standard:Standard Storage First 50 TB per GB Mo"])),
    true
  );
  assert.equal(evaluateDisplayIf(expr, context()), false);
});

test("checkboxChecked reads booleans", () => {
  assert.equal(evaluateDisplayIf({ checkboxChecked: "flag" }, context({ flag: true })), true);
  assert.equal(evaluateDisplayIf({ checkboxNotChecked: "flag" }, context({ flag: true })), false);
});

test("unknown operators fail closed rather than showing a card", () => {
  assert.throws(() => evaluateDisplayIf({ weird: [1, 2] }, context()), /unsupported displayIf operator/);
});

test("a missing expression is visible", () => {
  assert.equal(evaluateDisplayIf(undefined, context()), true);
});
