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

test("selector patterns pick the price field for the selected term", () => {
  const component: ColumnFormComponent = {
    ...DAX,
    secondaryKey: ["TermType"],
    calculationId: { hourly: "hourly_ipm" },
    pricingUnitModel: {
      riPricingTypes: {
        hourly: [
          { TermType: "OnDemand", PurchaseOption: "" },
          { TermType: "Reserved", PurchaseOption: "No Upfront" },
        ],
        upfront: [{ TermType: "Reserved", PurchaseOption: "All Upfront" }],
      },
    },
    additionalPricingData: [{ name: "Database Savings Plans" }],
    row: [...DAX.row, { label: "Pricing model", type: "dropDown", selectorId: "TermType" }],
  };
  const data: ColumnFormPricingData = {
    ...DAX_DATA,
    setMeters: ["r5.large OnDemand - Hourly Cost"],
    regionPrices: {
      "r5.large OnDemand - Hourly Cost": {
        price: "0.2550000000",
        TermType: "OnDemand",
        PurchaseOption: "",
      } as never,
    },
  };
  const result = evaluateColumnForm(component, data, [
    { "Instance Type": "r5.large", TermType: "OnDemand" },
  ]);
  assert.equal(result.monthly, 558.45);
  assert.equal(result.extraValues["hourly_ipm"], 0.255);
  assert.equal(result.saved.value[0]?.TermType?.value, "OnDemand");
});

test("$overridePriceKeyWith reads the named price field", () => {
  const component: ColumnFormComponent = {
    ...DAX,
    pricingUnitModel: {
      riPricingTypes: {
        hourly: [{ $overridePriceKeyWith: "effectiveHourlyRate", TermType: "OnDemand" }],
      },
    },
    row: [...DAX.row, { label: "Pricing model", type: "dropDown", selectorId: "TermType" }],
  };
  const data: ColumnFormPricingData = {
    ...DAX_DATA,
    regionPrices: {
      "r5.large - Hourly Cost": {
        price: "0.2550000000",
        effectiveHourlyRate: "0.2000000000",
        TermType: "OnDemand",
      } as never,
    },
  };
  const result = evaluateColumnForm(component, data, [
    { "Instance Type": "r5.large", TermType: "OnDemand" },
  ]);
  assert.equal(result.monthly, 438);
});

test("no matching pricing pattern fails closed", () => {
  const component: ColumnFormComponent = {
    ...DAX,
    pricingUnitModel: { riPricingTypes: { hourly: [{ TermType: "Reserved" }] } },
    row: [...DAX.row, { label: "Pricing model", type: "dropDown", selectorId: "TermType" }],
  };
  assert.throws(
    () => evaluateColumnForm(component, DAX_DATA, [{ "Instance Type": "r5.large", TermType: "OnDemand" }]),
    /no PLC_2.0 pricing pattern matches/
  );
});

test("Database Savings Plans fail closed", () => {
  const component: ColumnFormComponent = {
    ...DAX,
    pricingUnitModel: { riPricingTypes: { hourly: [{ TermType: "OnDemand" }] } },
    row: [...DAX.row, { label: "Pricing model", type: "dropDown", selectorId: "TermType" }],
  };
  assert.throws(
    () =>
      evaluateColumnForm(component, DAX_DATA, [
        { "Instance Type": "r5.large", TermType: "Database Savings Plans" },
      ]),
    /Database Savings Plans pricing/
  );
});

test("disableCalculation exposes rates without adding a subtotal", () => {
  const component: ColumnFormComponent = {
    ...DAX,
    disableCalculation: true,
    calculationId: { hourly: "hourly_rate" },
    primaryKey: "Instance Type",
    row: [DAX.row[1]!],
  };
  const data: ColumnFormPricingData = {
    ...DAX_DATA,
    setMeters: ["r5.large - Hourly Cost"],
  };
  const result = evaluateColumnForm(component, data, [{ "Instance Type": "r5.large" }]);
  assert.equal(result.monthly, 0);
  assert.equal(result.extraValues["hourly_rate"], 0.255);
});

test("utilization rows are allowed and do not break pricing", () => {
  const component: ColumnFormComponent = {
    ...DAX,
    row: [
      ...DAX.row,
      {
        label: "Utilization (On-Demand only)",
        type: "utilization",
        selectorId: "",
        exportValueAs: "utilizationOut",
      },
    ],
  };
  const result = evaluateColumnForm(component, DAX_DATA, [{ "Instance Type": "r5.large" }]);
  assert.equal(result.monthly, 558.45);
  assert.equal(result.extraValues["utilizationOut"], 730);
});

test("dependent selectors use the supplied values", () => {
  const component: ColumnFormComponent = {
    ...DAX,
    secondaryKey: ["TermType"],
    row: [
      ...DAX.row,
      { label: "Term", type: "dropDown", selectorId: "TermType", dependent: "Instance Type" },
    ],
  };
  const data: ColumnFormPricingData = {
    ...DAX_DATA,
    setMeters: ["r5.large OnDemand - Hourly Cost"],
    regionPrices: { "r5.large OnDemand - Hourly Cost": { price: "0.2550000000" } },
  };
  const result = evaluateColumnForm(component, data, [
    { "Instance Type": "r5.large", TermType: "OnDemand" },
  ]);
  assert.equal(result.monthly, 558.45);
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
