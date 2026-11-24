import test from "node:test";
import assert from "node:assert/strict";
import {
  columnFormSelectorValues,
  columnFormSummary,
  evaluateColumnForm,
  type ColumnFormComponent,
} from "../src/engine/column-form.ts";
import { columnFormVisibility } from "../src/engine/column-form-loader.ts";
import { matchAggregation } from "../src/data/column-form.ts";
import type { ColumnFormPricingData } from "../src/data/column-form.ts";
import type { Template } from "../src/data/definitions.ts";

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

test("a strategy-only summary has no leading separator", () => {
  const rows = [
    { label: "Pricing model", type: "dropDown", selectorId: "model" },
    { label: "Purchase option", type: "dropDown", selectorId: "option" },
    { label: "Term", type: "dropDown", selectorId: "term" },
  ];
  assert.equal(
    columnFormSummary({ model: "OnDemand", option: "None", term: "1 Year" }, rows),
    "Pricing strategy (OnDemand None 1 Year)"
  );
});

test("a count export with a suffix drives the row count", () => {
  // ElastiCache data tiering exports `countDT`; the live engine prefix-matches
  // the export name (`te` in analysis/bundle.js), so it must drive the count.
  const component: ColumnFormComponent = {
    ...DAX,
    id: "columnFormIPMDT",
    row: [
      {
        label: "Nodes",
        type: "textInput",
        selectorId: "Number of Nodes",
        defaultValue: 0,
        exportValueAs: "countDT",
      },
      DAX.row[1]!,
    ],
  };
  const zero = evaluateColumnForm(component, DAX_DATA, [
    { "Number of Nodes": 0, "Instance Type": "r5.large" },
  ]);
  assert.equal(zero.monthly, 0);
  const two = evaluateColumnForm(component, DAX_DATA, [
    { "Number of Nodes": 2, "Instance Type": "r5.large" },
  ]);
  assert.equal(two.monthly, 372.3);
});

test("more than one row fails closed with the live behaviour named", () => {
  assert.throws(
    () =>
      evaluateColumnForm(DAX, DAX_DATA, [
        { "Number of nodes": 3, "Instance Type": "r5.large" },
        { "Number of nodes": 1, "Instance Type": "r5.xlarge" },
      ]),
    /takes exactly one row; the live calculator prices only the first saved row/
  );
});

test("a one-element row array is the same as a bare row map", () => {
  const wrapped = evaluateColumnForm(DAX, DAX_DATA, [
    { "Number of nodes": 3, "Instance Type": "r5.large" },
  ]);
  const bare = evaluateColumnForm(DAX, DAX_DATA, {
    "Number of nodes": 3,
    "Instance Type": "r5.large",
  });
  assert.equal(wrapped.monthly, bare.monthly);
  assert.deepEqual(wrapped.saved, bare.saved);
});

test("a card hidden by displayIf is not prefetched", () => {
  const template = {
    id: "t",
    cards: [
      {
        title: "selector",
        inputSection: {
          components: [
            {
              id: "computeType",
              type: "input",
              subType: "dropdown",
              options: [
                { id: "ondemandec2", label: "On-Demand EC2" },
                { id: "ondemandlambda", label: "On-Demand Lambda" },
              ],
              defaultDropDownItem: "ondemandec2",
            },
          ],
        },
      },
      {
        title: "ec2 card",
        displayIf: { "==": [{ type: "component", id: "computeType" }, "ondemandec2"] },
        inputSection: { components: [{ id: "ec2Form", type: "input", subType: "columnFormIPM" }] },
      },
      {
        title: "lambda card",
        displayIf: { "==": [{ type: "component", id: "computeType" }, "ondemandlambda"] },
        inputSection: { components: [{ id: "lambdaForm", type: "input", subType: "columnFormIPM" }] },
      },
    ],
  } as unknown as Template;
  const visible = columnFormVisibility(template, {});
  const ec2Card = template.cards![1]!;
  const lambdaCard = template.cards![2]!;
  assert.equal(visible(ec2Card, ec2Card.inputSection!.components![0]!), true);
  assert.equal(visible(lambdaCard, lambdaCard.inputSection!.components![0]!), false);
  // A user override flips the gate the way the live form does.
  const overridden = columnFormVisibility(template, { computeType: "ondemandlambda" });
  assert.equal(overridden(ec2Card, ec2Card.inputSection!.components![0]!), false);
  assert.equal(overridden(lambdaCard, lambdaCard.inputSection!.components![0]!), true);
});

test("a displayIf that needs a computed value stays visible", () => {
  const template = {
    id: "t",
    cards: [
      {
        title: "gated",
        displayIf: { "==": [{ type: "component", id: "mathsResult" }, "yes"] },
        inputSection: { components: [{ id: "form", type: "input", subType: "columnFormIPM" }] },
      },
    ],
  } as unknown as Template;
  const card = template.cards![0]!;
  const visible = columnFormVisibility(template, {});
  assert.equal(visible(card, card.inputSection!.components![0]!), true);
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
