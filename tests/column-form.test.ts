import test from "node:test";
import assert from "node:assert/strict";
import {
  columnFormSelectorValues,
  columnFormSummary,
  evaluateColumnForm,
  type ColumnFormComponent,
} from "../src/engine/column-form.ts";
import { matchAggregation } from "../src/data/column-form.ts";
import type { ColumnFormPricingData } from "../src/data/column-form.ts";

/** Shape of the DAX on-demand node component and its regional PLC_2.0 index. */
const DAX: ColumnFormComponent = {
  id: "columnFormIPM",
  label: "DAX clusters: On-demand DAX nodes",
  mappingDefinitionName: "dax-instances-calc",
  primaryKey: { "Instance Type": ["vCPU", "Memory"] },
  secondaryKey: [],
  calculationId: { monthly: "monthly_ipm" },
  pricingUnitModel: { riPaymentOptions: { hourly: "*" } },
  row: [
    {
      label: "DAX nodes",
      type: "textInput",
      selectorId: "Number of nodes",
      defaultValue: 3,
      exportValueAs: "count",
      validations: { required: true, allowDecimals: false, minValue: 1 },
    },
    {
      label: "DAX instance type",
      type: "autoSuggest",
      selectorId: "Instance Type",
      defaultValue: "r5.large",
    },
  ],
};

const DAX_DATA: ColumnFormPricingData = {
  pricingSelectors: ["Location", "Instance Type", "vCPU", "Memory"],
  selectors: {
    Location: "US East (Ohio)",
    "Instance Type": "r5.large",
    vCPU: "2",
    Memory: "16",
  },
  regionPrices: {
    "r5.large - Hourly Cost": { price: "0.2550000000" },
  },
  setMeters: ["r5.large - Hourly Cost"],
  manifest: { serviceId: "dax", source: "dax-instances-calc" },
  metadataUrl: "https://example.invalid/metadata.json",
};

test("an hourly column form multiplies price, hours, and count", () => {
  const result = evaluateColumnForm(DAX, DAX_DATA, [
    { "Number of nodes": 3, "Instance Type": "r5.large" },
  ]);
  assert.equal(result.monthly, 558.45);
  assert.deepEqual(result.saved, {
    value: [
      {
        "Number of nodes": { value: "3" },
        "Instance Type": { value: "r5.large" },
      },
    ],
  });
  assert.equal(result.configSummary, "DAX nodes (3), DAX instance type (r5.large)");
  assert.deepEqual(result.extraValues, { monthly_ipm: 558.45, count: 3 });
});

test("defaults fill selectors the spec does not override", () => {
  const { values, provided } = columnFormSelectorValues(DAX, undefined);
  assert.deepEqual(values, { "Number of nodes": "3", "Instance Type": "r5.large" });
  assert.equal(provided.size, 0);
});

test("a spec value may be a bare scalar or a {value} object", () => {
  const result = evaluateColumnForm(DAX, DAX_DATA, [
    { "Number of nodes": { value: 2 }, "Instance Type": "r5.large" },
  ]);
  assert.equal(result.monthly, 372.3);
});

test("an unknown selector fails closed", () => {
  assert.throws(
    () =>
      columnFormSelectorValues(DAX, [{ "Number of nodes": 1, "Instance Type": "r5.large", GPU: 2 }]),
    /has no selector "GPU".*Number of nodes, Instance Type/s
  );
});

test("a user override that breaks a validation fails closed", () => {
  assert.throws(
    () => evaluateColumnForm(DAX, DAX_DATA, [{ "Number of nodes": 0 }]),
    /must be at least 1/
  );
  assert.throws(
    () => evaluateColumnForm(DAX, DAX_DATA, [{ "Number of nodes": 1.5 }]),
    /decimals are not allowed/
  );
});

test("an unmatched price set fails closed", () => {
  const data = { ...DAX_DATA, setMeters: ["m5.large - Hourly Cost"] };
  assert.throws(
    () => evaluateColumnForm(DAX, data, [{ "Instance Type": "r5.large" }]),
    /no PLC_2.0 price set matches r5.large/
  );
});

test("an ambiguous price set match fails closed", () => {
  const data = {
    ...DAX_DATA,
    setMeters: ["r5.large - Hourly Cost", "r5.large - Reserved Cost"],
  };
  assert.throws(
    () => evaluateColumnForm(DAX, data, [{ "Instance Type": "r5.large" }]),
    /price set match is ambiguous/
  );
});

test("tiered PLC_2.0 pricing fails closed", () => {
  const data: ColumnFormPricingData = {
    ...DAX_DATA,
    regionPrices: { "r5.large - Hourly Cost": { price: "0.2550000000" } },
  };
  const component: ColumnFormComponent = {
    ...DAX,
    pricingUnitModel: { riPricingTypes: { hourly: ["$price"] } },
  };
  assert.throws(
    () => evaluateColumnForm(component, data, [{ "Instance Type": "r5.large" }]),
    /tiered PLC_2.0 pricing/
  );
});

test("disableCalculation components fail closed", () => {
  const component: ColumnFormComponent = { ...DAX, disableCalculation: true };
  assert.throws(
    () => evaluateColumnForm(component, DAX_DATA, [{ "Instance Type": "r5.large" }]),
    /disableCalculation/
  );
});

test("utilization rows fail closed until implemented", () => {
  const component: ColumnFormComponent = {
    ...DAX,
    row: [...DAX.row, { label: "Utilization", type: "utilization", selectorId: "use" }],
  };
  assert.throws(
    () => evaluateColumnForm(component, DAX_DATA, [{ "Instance Type": "r5.large" }]),
    /"utilization" row/
  );
});

test("dependent selectors fail closed until implemented", () => {
  const component: ColumnFormComponent = {
    ...DAX,
    row: [...DAX.row, { label: "OS", type: "dropDown", selectorId: "OS", dependent: "Instance Type" }],
  };
  assert.throws(
    () => evaluateColumnForm(component, DAX_DATA, [{ "Instance Type": "r5.large" }]),
    /dependent selectors/
  );
});

test("the config summary folds a full pricing strategy block", () => {
  const rows = [
    { label: "Nodes", type: "textInput", selectorId: "count" },
    { label: "Pricing model", type: "dropDown", selectorId: "model", displayInConfigSummary: true },
    { label: "Purchase option", type: "dropDown", selectorId: "option" },
    { label: "Term", type: "dropDown", selectorId: "term" },
  ];
  assert.equal(
    columnFormSummary({ count: "2", model: "Reserved", option: "All Upfront", term: "3 Year" }, rows),
    "Nodes (2), Pricing strategy (Reserved All Upfront 3 Year)"
  );
});

test("aggregation matching prefers the requested region", () => {
  const aggregations = [
    {
      selectors: {
        Location: "US East (N. Virginia)",
        "Instance Type": "r5.large",
        vCPU: "2",
        Memory: "16",
      },
    },
    {
      selectors: {
        Location: "US East (Ohio)",
        "Instance Type": "r5.large",
        vCPU: "2",
        Memory: "16",
      },
    },
  ];
  const selectors = matchAggregation(
    aggregations,
    { "Instance Type": "r5.large" },
    ["Location", "Instance Type", "vCPU", "Memory"],
    "US East (Ohio)"
  );
  assert.equal(selectors.Location, "US East (Ohio)");
});

test("aggregation matching fails closed when nothing matches", () => {
  assert.throws(
    () =>
      matchAggregation(
        [{ selectors: { Location: "US East (Ohio)", "Instance Type": "r5.large" } }],
        { "Instance Type": "r6.large" },
        ["Location", "Instance Type"],
        "US East (Ohio)"
      ),
    /no PLC_2.0 price row matches/
  );
});
