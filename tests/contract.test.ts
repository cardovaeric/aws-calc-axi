import test from "node:test";
import assert from "node:assert/strict";
import { costOf, sumCosts, toCents, totalCostOf } from "../src/contract.ts";

test("costOf omits a zero upfront", () => {
  assert.deepEqual(costOf(2.3, 0), { monthly: 2.3 });
  assert.deepEqual(costOf(2.3, 1.5), { monthly: 2.3, upfront: 1.5 });
});

test("totalCostOf always keeps both fields", () => {
  assert.deepEqual(totalCostOf(2.3, 0), { monthly: 2.3, upfront: 0 });
});

test("toCents removes binary float noise", () => {
  assert.equal(toCents(0.1 + 0.2), 0.3);
  assert.equal(toCents(27.599999999999998), 27.6);
});

test("sumCosts adds services and rounds once", () => {
  assert.deepEqual(sumCosts([{ monthly: 1.53 }, { monthly: 0.1 }, { monthly: 0.2 }]), {
    monthly: 1.83,
    upfront: 0,
  });
});
