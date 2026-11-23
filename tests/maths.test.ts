import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMaths } from "../src/engine/maths.ts";
import { tieredCost, type Tier } from "../src/engine/pricing-engine.ts";
import type { Component } from "../src/data/definitions.ts";
import type { EngineValue } from "../src/engine/expression.ts";

function values(map: Record<string, unknown>): (id: string) => EngineValue {
  return (id) => map[id] as EngineValue;
}

function component(extra: Partial<Component>): Component {
  return { type: "maths", id: "m", ...extra } as Component;
}

test("multiplication and addition match decimal arithmetic", () => {
  const get = values({ a: 100, b: "0.023" });
  const product = evaluateMaths(
    component({ subType: "basicMaths", operation: "multiplication", decimalPlaces: 4 }),
    [{ variableId: "a" }, { variableId: "b" }],
    get
  );
  assert.equal(product.value, "2.3000");

  const sum = evaluateMaths(
    component({ subType: "basicMaths", operation: "addition", decimalPlaces: 2 }),
    [{ variableId: "a" }, { variableId: "b" }, { constant: 0.1 }],
    get
  );
  assert.equal(sum.value, "100.12");
});

test("single-operand multiplication, division, and exponent yield zero", () => {
  const get = values({ a: 5 });
  for (const operation of ["multiplication", "division", "exponent"]) {
    const result = evaluateMaths(component({ subType: "basicMaths", operation }), [{ variableId: "a" }], get);
    assert.equal(result.value, 0, operation);
  }
});

test("division by zero yields zero", () => {
  const result = evaluateMaths(
    component({ subType: "basicMaths", operation: "division", decimalPlaces: 4 }),
    [{ variableId: "a" }, { variableId: "b" }],
    values({ a: 10, b: 0 })
  );
  assert.equal(Number(result.value), 0);
});

test("subtraction honours minValue", () => {
  const result = evaluateMaths(
    component({ subType: "basicMaths", operation: "subtraction", minValue: 0 }),
    [{ variableId: "a" }, { variableId: "b" }],
    values({ a: 10, b: 25 })
  );
  assert.equal(result.value, 0);
});

test("required zero operands suppress the computation", () => {
  const result = evaluateMaths(
    component({ subType: "basicMaths", operation: "multiplication", decimalPlaces: 2 }),
    [{ variableId: "a", required: true }, { variableId: "b" }],
    values({ a: 0, b: 10 })
  );
  assert.equal(result.computed, false);
});

test("max and min accept constants", () => {
  const max = evaluateMaths(
    component({ subType: "maxMin", operation: "Maximum", decimalPlaces: 2 }),
    [{ variableId: "a", required: true }, { constant: 0 }],
    values({ a: -3 })
  );
  assert.equal(max.value, "0.00");
  const min = evaluateMaths(
    component({ subType: "maxMin", operation: "Minimum" }),
    [{ variableId: "a" }, { constant: 10 }],
    values({ a: 20 })
  );
  assert.equal(min.value, 10);
});

test("rounding supports factor and decimal modes", () => {
  const factor = evaluateMaths(
    component({
      subType: "rounding",
      method: "roundUp",
      factor: "1",
      decimalPlaces: 0,
    }),
    [{ variableId: "a" }],
    values({ a: 12.2 })
  );
  assert.equal(factor.value, 13);

  const decimal = evaluateMaths(
    component({
      subType: "rounding",
      method: "roundUp",
      toDecimal: true,
      decimalPlaces: 2,
    }),
    [{ variableId: "a" }],
    values({ a: 12.201 })
  );
  assert.equal(decimal.value, 12.21);
});

test("tiered cost bills each tier slice", () => {
  const tiers: Tier[] = [
    { startOfTier: 0, endOfTier: 51200, price: 0.023 },
    { startOfTier: 51201, endOfTier: 512000, price: 0.022 },
    { startOfTier: 512001, endOfTier: -1, price: 0.021 },
  ];
  assert.equal(tieredCost(tiers, 0), 0);
  assert.equal(tieredCost(tiers, 100), 2.3);
  assert.ok(Math.abs(tieredCost(tiers, 51200) - 1177.6) < 1e-9);
  assert.ok(Math.abs(tieredCost(tiers, 51201) - (1177.6 + 0.022)) < 1e-9);
  assert.ok(Math.abs(tieredCost(tiers, 512001) - (1177.6 + 460800 * 0.022 + 0.021)) < 1e-6);
});
