import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinition } from "../src/data/definitions.ts";
import { evaluateInput } from "../src/engine/inputs.ts";
import { loadSpecFile } from "../src/estimate/spec.ts";
import { buildFromSpec } from "./helpers/build.ts";
import { resolverFor } from "../tests/helpers.ts";

const ROOT = join(import.meta.dirname, "..");

/**
 * The `utilization` input subtype against the live definitions.
 *
 * Expected values are the live `calculateUtilizationValue` results:
 * `entry / duration.max * 730`, `Math.ceil`ed when `roundUpToHours` is set and
 * otherwise rounded up to `decimalPlaces`. The stored component is the entry
 * plus the duration id; the config summary prints the live duration label.
 */
const CASES = [
  {
    code: "awsPcs",
    componentId: "monthlyUtilization",
    label: "Length of time cluster is running",
    unit: "percentagePerMonth",
    unitLabel: "% Utilization/Month",
    // The definition declares no min/max, so the live form range is 0..730 hours.
    values: [
      { entered: 0, hours: 0 },
      { entered: 50, hours: 365 },
      { entered: 100, hours: 730 },
    ],
    summarized: true,
  },
  {
    code: "awsPcs",
    componentId: "monthlyUtilization_standard",
    label: "Length of time each node is running",
    unit: "percentagePerMonth",
    unitLabel: "% Utilization/Month",
    values: [
      { entered: 0, hours: 0 },
      { entered: 50, hours: 365 },
      { entered: 100, hours: 730 },
    ],
    summarized: true,
  },
  {
    code: "awsElementalMediaConnect",
    componentId: "flowUtilization",
    label: "Flow utilization",
    unit: "hoursPerMonth",
    unitLabel: "Hours/Month",
    values: [
      { entered: 0, hours: 0 },
      { entered: 365, hours: 365 },
      { entered: 730, hours: 730 },
    ],
    summarized: true,
  },
  {
    code: "awsElementalMediaConnect",
    componentId: "runningFlowUtilization",
    label: "Running flow utilization",
    unit: "hoursPerMonth",
    unitLabel: "Hours/Month",
    values: [
      { entered: 0, hours: 0 },
      { entered: 365, hours: 365 },
      { entered: 730, hours: 730 },
    ],
    summarized: true,
  },
  {
    code: "awsDeadlineCloud",
    componentId: "monthlyUtilization",
    label: "Monthly utilization",
    unit: "percentagePerMonth",
    unitLabel: "% Utilization/Month",
    values: [
      { entered: 0, hours: 0 },
      { entered: 50, hours: 365 },
      { entered: 100, hours: 730 },
    ],
    // `displayInConfigSummary: false` on this component.
    summarized: false,
  },
  {
    code: "awsDirectConnect",
    componentId: "utilization",
    label: "Hours used",
    unit: "hoursPerMonth",
    unitLabel: "Hours/Month",
    values: [
      { entered: 0, hours: 0 },
      { entered: 365, hours: 365 },
      { entered: 730, hours: 730 },
    ],
    summarized: false,
  },
] as const;

const context = {
  serviceCode: "test",
  templateId: "t",
  regionName: "US East (Ohio)",
  prices: resolverFor({}),
  regionNameByCode: new Map([["us-east-2", "US East (Ohio)"]]),
  regionCodeByName: new Map([["US East (Ohio)", "us-east-2"]]),
  columnForms: new Map(),
};

for (const testCase of CASES) {
  test(`${testCase.code} ${testCase.componentId} saves the entry, the duration, and the live summary`, async () => {
    const definition = await loadDefinition(testCase.code);
    const component = (definition.templates ?? [])
      .flatMap((template) => template.cards ?? [])
      .flatMap((card) => card.inputSection?.components ?? [])
      .find((entry) => entry.id === testCase.componentId && entry.subType === "utilization");
    assert.ok(component, `${testCase.code} declares ${testCase.componentId} as a utilization input`);

    for (const value of testCase.values) {
      const result = evaluateInput(component, {
        ...context,
        serviceCode: testCase.code,
        overrides: { [testCase.componentId]: value.entered },
      });
      assert.equal(
        result.value,
        value.hours,
        `${testCase.componentId} at ${value.entered} is ${value.hours} hours`
      );
      assert.deepEqual(result.saved, { value: String(value.entered), unit: testCase.unit });
      if (testCase.summarized) {
        assert.equal(
          result.configSummary,
          `${testCase.label} (${value.entered} ${testCase.unitLabel})`
        );
      } else {
        assert.equal(result.configSummary, undefined);
      }
    }
  });
}

test("AWS PCS evaluates natively at utilization min, middle, and max", async () => {
  const spec = await loadSpecFile(join(ROOT, "examples/utilization-pcs.yaml"));
  const { result } = await buildFromSpec(spec);
  const rows = result.services.map((entry) => entry.evaluated.serviceCost.monthly);
  assert.deepEqual(rows, [0, 218.16, 436.32]);
  assert.equal(result.serviceTotal.monthly, 654.48);
});

test("Elemental MediaConnect evaluates natively at utilization min, middle, and max", async () => {
  const spec = await loadSpecFile(join(ROOT, "examples/utilization-mediaconnect.yaml"));
  const { result } = await buildFromSpec(spec);
  const rows = result.services.map((entry) => entry.evaluated.serviceCost.monthly);
  assert.deepEqual(rows, [0, 5475, 10950]);
  assert.equal(result.serviceTotal.monthly, 16425);
});

/**
 * Known gaps, owned by the column-form work (repeatable rows and dependent
 * selectors), not by this subtype. These fixtures pin the fixtures so the day
 * the column form lands the assertions below fail loudly and the fixtures
 * promote to native goldens and ledger rows.
 */
const COLUMN_FORM_GAPS = [
  { spec: "examples/utilization-deadline-cloud.yaml", service: "awsDeadlineCloud" },
  { spec: "examples/utilization-direct-connect.yaml", service: "awsDirectConnect" },
] as const;

for (const gap of COLUMN_FORM_GAPS) {
  test(`${gap.service} still stops on a column-form gap, never on utilization`, async () => {
    const spec = await loadSpecFile(join(ROOT, gap.spec));
    await assert.rejects(
      () => buildFromSpec(spec),
      (error: Error) => {
        assert.match(error.message, /PLC_2\.0/, "remaining blocker is the column form");
        assert.doesNotMatch(error.message, /utilization/);
        return true;
      }
    );
  });
}
