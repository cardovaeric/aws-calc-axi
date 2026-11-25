import test from "node:test";
import assert from "node:assert/strict";
import {
  buildColumnFormSelectorTree,
  columnFormMeterFragments,
  columnFormSelectorValues,
  columnFormSummary,
  columnFormUtilizationHours,
  evaluateColumnForm,
  resolveColumnFormSelectors,
  type ColumnFormComponent,
} from "../src/engine/column-form.ts";
import { columnFormVisibility } from "../src/engine/column-form-loader.ts";
import {
  additionalCargoItems,
  matchAggregation,
  mergeCargoAggregations,
  remapValue,
  reverseRemapValue,
} from "../src/data/column-form.ts";
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

test("a single-meter price set is used as-is, the way the live engine does", () => {
  // Live `y` short-circuits a one-unit price set (`1 === e.length`), so there is
  // nothing to filter and no way for a selector to miss it.
  const data = {
    ...DAX_DATA,
    setMeters: ["m5.large - Hourly Cost"],
    regionPrices: { "m5.large - Hourly Cost": { price: "0.2550000000" } },
  };
  const result = evaluateColumnForm(DAX, data, [{ "Instance Type": "r5.large" }]);
  assert.equal(result.monthly, 558.45);
});

test("an unmatched price set fails closed", () => {
  const data = {
    ...DAX_DATA,
    setMeters: ["m5.large - Hourly Cost", "m5.large - Reserved Cost"],
  };
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

/**
 * The Database Savings Plans shape: the joined artifact offers a TermType value
 * the component's own aggregation rows do not carry, and prices it from its own
 * index with its own pricing unit model and remap. Live `z` rounds the monthly
 * figure up to the cent.
 */
function savingsPlanComponent(): ColumnFormComponent {
  return {
    ...DAX,
    secondaryKey: ["TermType", "LeaseContractLength", "PurchaseOption"],
    pricingUnitModel: { riPaymentOptions: { hourly: "*" } },
    additionalPricingData: [{ name: "Database Savings Plans" }],
    row: [
      DAX.row[0]!,
      DAX.row[1]!,
      {
        label: "Pricing model",
        type: "dropDown",
        selectorId: "TermType",
        exportValueAs: "pricingModel",
        mappingValue: { OnDemand: "Hourly", "Database Savings Plans": "SavingsPlan" },
      },
      {
        label: "Term",
        type: "dropDown",
        selectorId: "LeaseContractLength",
        exportValueAs: "term",
      },
      {
        label: "Payment option",
        type: "dropDown",
        selectorId: "PurchaseOption",
        exportValueAs: "purchaseOption",
        dependent: "LeaseContractLength",
      },
    ],
  };
}

function savingsPlanData(price: string): ColumnFormPricingData {
  return {
    ...DAX_DATA,
    setMeters: ["DatabaseSavingsPlans r5.large OnDemand"],
    regionPrices: {
      "DatabaseSavingsPlans r5.large OnDemand": {
        price,
        PurchaseOption: "No Upfront",
      } as never,
    },
    pricedItem: {
      name: "Database Savings Plans",
      manifest: { serviceId: "databasesavingsplans", source: "dsp-join-with-dax-calc" },
      remap: { keyValue: { "1 year": "1yr" } },
      pricingUnitModel: {
        riPricingTypes: { hourly: [{ PurchaseOption: "No Upfront" }] },
      },
    },
  };
}

test("Database Savings Plans prices the committed rate and rounds the month up", () => {
  // Live DocumentDB, US East (Ohio), db.r8g.12xlarge, Database Savings Plans,
  // 1yr, No Upfront: 5.30005152 * 730 = 3869.0376 -> 3,869.04 USD.
  const result = evaluateColumnForm(savingsPlanComponent(), savingsPlanData("5.30005152"), [
    {
      "Number of nodes": 1,
      "Instance Type": "r5.large",
      TermType: "Database Savings Plans",
      LeaseContractLength: "1yr",
      PurchaseOption: "No Upfront",
    },
  ]);
  assert.equal(result.monthly, 3869.04);
  assert.equal(result.upfront, 0);
  assert.equal(
    result.configSummary,
    "DAX nodes (1), DAX instance type (r5.large), Pricing model (Database Savings Plans), Term (1yr), Payment option (No Upfront)"
  );
});

test("a partial-upfront Savings Plan splits the commitment", () => {
  const data = savingsPlanData("8");
  data.regionPrices["DatabaseSavingsPlans r5.large OnDemand"] = {
    price: "8",
    PurchaseOption: "Partial Upfront",
  } as never;
  const component = savingsPlanComponent();
  data.pricedItem = {
    ...data.pricedItem!,
    pricingUnitModel: {
      riPricingTypes: { hourly: [{ PurchaseOption: "Partial Upfront" }] },
    },
  };
  const result = evaluateColumnForm(component, data, [
    {
      "Number of nodes": 2,
      "Instance Type": "r5.large",
      TermType: "Database Savings Plans",
      LeaseContractLength: "3yr",
      PurchaseOption: "Partial Upfront",
    },
  ]);
  // 3 years is 26280 hours: commitment 210240/unit, half paid up front.
  assert.equal(result.monthly, 5840);
  assert.equal(result.upfront, 210240);
});

test("joined cargo rows are appended and keep their item index", () => {
  const main = [
    { selectors: { "Instance Type": "db.r8g.12xlarge", TermType: "OnDemand" } },
  ];
  const joined = [
    {
      itemIndex: 1,
      remap: {
        keyName: { "docdb:Instance Type": "Instance Type" },
        keyValue: { "1 year": "1yr" },
        constant: { TermType: "Database Savings Plans", PurchaseOption: "No Upfront" },
      },
      rows: [
        {
          selectors: {
            "docdb:Instance Type": "db.r8g.12xlarge",
            "plc:LeaseContract": "1 year",
            PurchaseOption: "No Upfront",
          },
        },
        // A row the constant contradicts is filtered out before the merge.
        { selectors: { "docdb:Instance Type": "db.r8g.2xlarge", TermType: "Reserved" } },
      ],
    },
  ];
  const merged = mergeCargoAggregations(main, undefined, joined);
  assert.equal(merged.rows.length, 2);
  assert.deepEqual(merged.rowItem, [0, 1]);
  assert.deepEqual(merged.rows[1]?.selectors, {
    "Instance Type": "db.r8g.12xlarge",
    "plc:LeaseContract": "1yr",
    PurchaseOption: "No Upfront",
    TermType: "Database Savings Plans",
  });
});

test("additionalPricingData normalizes only usable joined artifacts", () => {
  assert.deepEqual(additionalCargoItems(undefined), []);
  assert.deepEqual(additionalCargoItems({ nope: true }), []);
  assert.deepEqual(
    additionalCargoItems([
      { name: "Database Savings Plans", manifest: { serviceId: "databasesavingsplans", source: "x" } },
      { name: "no manifest" },
      "not an object",
    ]).map((item) => item.name),
    ["Database Savings Plans"]
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

// ---------------------------------------------------------------------------
// Dependent selectors (analysis/FINDINGS.md section 14)
//
// The fixtures below mirror the live PLC_2.0 data for two shapes:
//
// - `FSx_LUSTRE`: `Cache Type` declares `dependent: "Storage type"` and both
//   selectors are aggregation-backed, so the options are gated by the parent.
// - `ELASTICACHE`: `Term`/`Purchase option` are not in the aggregation at all,
//   so their options come from the regional price records and only exist for
//   Reserved records. `Purchase option` declares `dependent: "LeaseContractLength"`.
// ---------------------------------------------------------------------------

const FSX_LUSTRE: ColumnFormComponent = {
  id: "columnFormIPM",
  label: "Storage Type and throughput",
  mappingDefinitionName: "fsx-lustre-calc",
  primaryKey: "Storage type",
  secondaryKey: ["Cache Type", "Throughput capacity"],
  disableCalculation: true,
  calculationId: { hourly: "monthly_ipm" },
  remap: {
    keyValue: {
      "12": "12 MBps/TiB",
      "50": "50 MBps/TiB",
      "125": "125 MBps/TiB",
      "1000": "1000 MBps/TiB",
      "N/A": "No Cache",
      RC20: "SSD cache",
    },
  },
  prioritizedKey: { "Storage type": 16, "Cache Type": 4 },
  row: [
    {
      label: "Storage Type",
      type: "dropDown",
      selectorId: "Storage type",
      defaultValue: "SSD",
      exportValueAs: "StorageType",
    },
    {
      label: "Cache Type",
      type: "dropDown",
      selectorId: "Cache Type",
      dependent: "Storage type",
    },
    {
      label: "Throughput  Capacity",
      type: "dropDown",
      selectorId: "Throughput capacity",
      defaultValue: "50 MBps/TiB",
      exportValueAs: "ThroughputCapacity",
    },
  ],
};

// The aggregation rows carry the values the live form shows, because the live
// engine applies `remap.keyValue` to them before building the component tree.
const FSX_AGGREGATIONS = [
  { "Storage type": "HDD", "Cache Type": "No Cache", "Throughput capacity": "12 MBps/TiB" },
  { "Storage type": "HDD", "Cache Type": "No Cache", "Throughput capacity": "40 MBps/TiB" },
  { "Storage type": "HDD", "Cache Type": "SSD cache", "Throughput capacity": "12 MBps/TiB" },
  { "Storage type": "HDD", "Cache Type": "SSD cache", "Throughput capacity": "40 MBps/TiB" },
  { "Storage type": "SSD", "Cache Type": "No Cache", "Throughput capacity": "1000 MBps/TiB" },
  { "Storage type": "SSD", "Cache Type": "No Cache", "Throughput capacity": "125 MBps/TiB" },
  { "Storage type": "SSD", "Cache Type": "No Cache", "Throughput capacity": "250 MBps/TiB" },
  { "Storage type": "SSD", "Cache Type": "No Cache", "Throughput capacity": "500 MBps/TiB" },
].map((selectors) => ({ selectors: { Location: "US East (Ohio)", ...selectors } }));

function fsxData(
  storageType: string,
  throughput: string,
  records: Record<string, Record<string, unknown>>
): ColumnFormPricingData {
  return {
    pricingSelectors: ["Location", "Storage type", "Cache Type", "Throughput capacity"],
    selectors: {
      Location: "US East (Ohio)",
      "Storage type": storageType,
      "Cache Type": "No Cache",
      "Throughput capacity": throughput,
    },
    regionPrices: records as never,
    setMeters: Object.keys(records),
    manifest: { serviceId: "fsx", source: "fsx-lustre-calc" },
    metadataUrl: "https://example.invalid/metadata.json",
    aggregations: FSX_AGGREGATIONS,
  };
}

// The real FSx price sets hold exactly one opaque metered unit, so the live
// engine does not filter them (`1 === e.length` short-circuit). The dependent
// selectors decide the index path instead, which is what the prefetch resolves.
const FSX_SSD_RECORDS = {
  SJkcZfTtuEZ8xiIULvUsQp: { price: "0.1450000000" },
};

const FSX_HDD_RECORDS = {
  "6yBIQBKwzt l7hYmOwEZhLGesVTm0h0tUdi1aOUZAU8": { price: "0.0410000000" },
};

const ELASTICACHE: ColumnFormComponent = {
  id: "columnFormIPM",
  label: "Cluster settings",
  mappingDefinitionName: "elasticache-calc",
  primaryKey: { "Instance Type": ["vCPU", "Memory"] },
  secondaryKey: ["Cache Engine", "Instance Family", "TermType", "LeaseContractLength", "PurchaseOption"],
  calculationId: { monthly: "monthly_ipm", upfront: "upfront_ipm" },
  pricingUnitModel: {
    riPaymentOptions: {
      "No Upfront": "Hrs",
      "All Upfront": "Quantity",
      "Partial Upfront": ["Quantity", "Hrs"],
    },
    riPricingTypes: {
      hourly: [
        { TermType: "OnDemand", PurchaseOption: "" },
        { TermType: "Reserved", PurchaseOption: "No Upfront" },
        { TermType: "Reserved", PurchaseOption: "Heavy Utilization", Unit: "Hrs" },
        { TermType: "Reserved", PurchaseOption: "Partial Upfront", Unit: "Hrs" },
      ],
      upfront: [
        { TermType: "Reserved", PurchaseOption: "All Upfront", Unit: "Quantity" },
        { TermType: "Reserved", PurchaseOption: "Heavy Utilization", Unit: "Quantity" },
        { TermType: "Reserved", PurchaseOption: "Partial Upfront", Unit: "Quantity" },
      ],
    },
  },
  row: [
    {
      label: "Nodes",
      type: "textInput",
      selectorId: "Number of Nodes",
      defaultValue: 0,
      exportValueAs: "count",
    },
    {
      label: "Instance type",
      type: "autoSuggest",
      selectorId: "Instance Type",
      defaultValue: "cache.m5.xlarge",
    },
    { label: "Utilization", type: "utilization", selectorId: "" },
    {
      label: "Cache Engine",
      type: "dropDown",
      selectorId: "Cache Engine",
      defaultValue: "Redis",
    },
    { label: "Cache Node Type", type: "dropDown", selectorId: "Instance Family" },
    { label: "Pricing model", type: "dropDown", selectorId: "TermType", exportValueAs: "pricingModel",
      mappingValue: { Reserved: "Reserved", OnDemand: "Hourly" } },
    { label: "Term", type: "dropDown", selectorId: "LeaseContractLength" },
    { label: "Purchase option", type: "dropDown", selectorId: "PurchaseOption",
      dependent: "LeaseContractLength" },
  ],
};

const ELASTICACHE_AGGREGATIONS = [
  {
    selectors: {
      Location: "US East (Ohio)",
      TermType: "OnDemand",
      "Cache Engine": "Redis",
      "Instance Type": "cache.m5.xlarge",
      "Instance Family": "Standard",
      vCPU: "4",
      Memory: "12.93 GiB",
    },
  },
  {
    selectors: {
      Location: "US East (Ohio)",
      TermType: "Reserved",
      "Cache Engine": "Redis",
      "Instance Type": "cache.m5.xlarge",
      "Instance Family": "Standard",
      vCPU: "4",
      Memory: "12.93 GiB",
    },
  },
];

const ELASTICACHE_ONDEMAND_RECORDS = {
  "OnDemand Redis cache.m5.xlarge Standard Hrs": {
    price: "0.3110000000",
    TermType: "OnDemand",
    PurchaseOption: "",
    LeaseContractLength: "",
    Unit: "Hrs",
  },
};

const ELASTICACHE_RESERVED_RECORDS = {
  "Reserved Redis cache.m5.xlarge Standard 1yr All Upfront Hrs": {
    price: "0.0000000000",
    TermType: "Reserved",
    PurchaseOption: "All Upfront",
    LeaseContractLength: "1yr",
    Unit: "Hrs",
  },
  "Reserved Redis cache.m5.xlarge Standard 1yr All Upfront Quantity": {
    price: "1741.0000000000",
    TermType: "Reserved",
    PurchaseOption: "All Upfront",
    LeaseContractLength: "1yr",
    Unit: "Quantity",
  },
  "Reserved Redis cache.m5.xlarge Standard 3yr All Upfront Hrs": {
    price: "0.0000000000",
    TermType: "Reserved",
    PurchaseOption: "All Upfront",
    LeaseContractLength: "3yr",
    Unit: "Hrs",
  },
  "Reserved Redis cache.m5.xlarge Standard 3yr All Upfront Quantity": {
    price: "4680.0000000000",
    TermType: "Reserved",
    PurchaseOption: "All Upfront",
    LeaseContractLength: "3yr",
    Unit: "Quantity",
  },
  "Reserved Redis cache.m5.xlarge Standard 1yr No Upfront Hrs": {
    price: "0.2120000000",
    TermType: "Reserved",
    PurchaseOption: "No Upfront",
    LeaseContractLength: "1yr",
    Unit: "Hrs",
  },
  "Reserved Redis cache.m5.xlarge Standard 3yr No Upfront Hrs": {
    price: "0.1680000000",
    TermType: "Reserved",
    PurchaseOption: "No Upfront",
    LeaseContractLength: "3yr",
    Unit: "Hrs",
  },
};

function elasticacheData(
  termType: string,
  records: Record<string, Record<string, unknown>>
): ColumnFormPricingData {
  return {
    pricingSelectors: [
      "Location",
      "TermType",
      "Cache Engine",
      "Instance Type",
      "Instance Family",
      "vCPU",
      "Memory",
    ],
    selectors: {
      Location: "US East (Ohio)",
      TermType: termType,
      "Cache Engine": "Redis",
      "Instance Type": "cache.m5.xlarge",
      "Instance Family": "Standard",
      vCPU: "4",
      Memory: "12.93 GiB",
    },
    regionPrices: records as never,
    setMeters: Object.keys(records),
    manifest: { serviceId: "elasticache", source: "elasticache-calc" },
    metadataUrl: "https://example.invalid/metadata.json",
    aggregations: ELASTICACHE_AGGREGATIONS,
  };
}

test("a dependent selector is only offered the values its parent allows", () => {
  const ssd = evaluateColumnForm(
    FSX_LUSTRE,
    fsxData("SSD", "1000 MBps/TiB", FSX_SSD_RECORDS),
    undefined
  );
  assert.deepEqual(ssd.saved.value[0], {
    "Storage type": { value: "SSD" },
    "Cache Type": { value: "No Cache" },
    "Throughput capacity": { value: "1000 MBps/TiB" },
  });
  const hdd = evaluateColumnForm(
    FSX_LUSTRE,
    fsxData("HDD", "12 MBps/TiB", FSX_HDD_RECORDS),
    { "Storage type": "HDD", "Cache Type": "SSD cache" }
  );
  assert.deepEqual(hdd.saved.value[0], {
    "Storage type": { value: "HDD" },
    "Cache Type": { value: "SSD cache" },
    "Throughput capacity": { value: "12 MBps/TiB" },
  });
});

test("a default that the parent does not offer falls to the first offered value", () => {
  // The definition default is "50 MBps/TiB"; SSD offers 1000/125/250/500 and
  // HDD offers 12/40. Live keeps the aggregation row order, so the first entry
  // is the one the aggregation file lists first.
  const ssd = resolveColumnFormSelectors(
    FSX_LUSTRE,
    { "Storage type": "SSD" },
    fsxData("SSD", "1000 MBps/TiB", FSX_SSD_RECORDS)
  );
  assert.equal(ssd.values["Throughput capacity"], "1000 MBps/TiB");
  const hdd = resolveColumnFormSelectors(
    FSX_LUSTRE,
    { "Storage type": "HDD" },
    fsxData("HDD", "12 MBps/TiB", FSX_HDD_RECORDS)
  );
  assert.equal(hdd.values["Throughput capacity"], "12 MBps/TiB");
});

test("a value the parent no longer offers cascades to the first offered value", () => {
  // HDD + RC20, then the parent switches to SSD where only N/A exists.
  assert.throws(
    () =>
      resolveColumnFormSelectors(
        FSX_LUSTRE,
        { "Storage type": "SSD", "Cache Type": "SSD cache" },
        fsxData("SSD", "1000 MBps/TiB", FSX_SSD_RECORDS)
      ),
    /cannot use "Cache Type"/
  );
  // The same cascade driven by a definition default rather than a user value
  // re-selects the first offered value instead of failing.
  const defaults = resolveColumnFormSelectors(
    { ...FSX_LUSTRE, row: FSX_LUSTRE.row.map((row) =>
      row.selectorId === "Cache Type" ? { ...row, defaultValue: "SSD cache" } : row) },
    { "Storage type": "SSD" },
    fsxData("SSD", "1000 MBps/TiB", FSX_SSD_RECORDS)
  );
  assert.equal(defaults.values["Cache Type"], "No Cache");
});

test("a record-backed selector is dropped when the configuration has no record value", () => {
  const result = evaluateColumnForm(
    ELASTICACHE,
    elasticacheData("OnDemand", ELASTICACHE_ONDEMAND_RECORDS),
    { "Number of Nodes": 2, TermType: "OnDemand" }
  );
  // On-Demand records carry PurchaseOption/LeaseContractLength = "", so the
  // live form does not render them and does not save them.
  assert.deepEqual(result.saved.value[0], {
    "Number of Nodes": { value: "2" },
    "Instance Type": { value: "cache.m5.xlarge" },
    "Cache Engine": { value: "Redis" },
    "Instance Family": { value: "Standard" },
    TermType: { value: "OnDemand" },
  });
  assert.equal(result.monthly, 454.06);
});

test("record-backed dependent selectors default to the first offered value", () => {
  const data = elasticacheData("Reserved", ELASTICACHE_RESERVED_RECORDS);
  const resolved = resolveColumnFormSelectors(ELASTICACHE, { "Number of Nodes": 2, TermType: "Reserved" }, data);
  // The parent list is sorted ascending (`p` in the live bundle); the child
  // list keeps the price-record order for that parent value.
  assert.equal(resolved.values["LeaseContractLength"], "1yr");
  assert.equal(resolved.values["PurchaseOption"], "All Upfront");
});

test("a reserved column form exposes the upfront price and no monthly rate", () => {
  const data = elasticacheData("Reserved", ELASTICACHE_RESERVED_RECORDS);
  const result = evaluateColumnForm(ELASTICACHE, data, {
    "Number of Nodes": 2,
    TermType: "Reserved",
    LeaseContractLength: "1yr",
    PurchaseOption: "All Upfront",
  });
  assert.equal(result.monthly, 0);
  assert.equal(result.upfront, 3482);
  assert.deepEqual(result.extraValues, {
    monthly_ipm: 0,
    upfront_ipm: 3482,
    count: 2,
    pricingModel: "Reserved",
  });
  assert.equal(
    result.configSummary,
    "Nodes (2), Instance type (cache.m5.xlarge), Cache Engine (Redis), " +
      "Cache Node Type (Standard), Pricing strategy (Reserved 1yr All Upfront)"
  );
});

test("a no-upfront reserved column form has a monthly rate and no upfront", () => {
  const data = elasticacheData("Reserved", ELASTICACHE_RESERVED_RECORDS);
  const result = evaluateColumnForm(ELASTICACHE, data, {
    "Number of Nodes": 2,
    TermType: "Reserved",
    LeaseContractLength: "3yr",
    PurchaseOption: "No Upfront",
  });
  assert.equal(result.upfront, 0);
  assert.equal(result.monthly, Number((0.168 * 730 * 2).toFixed(4)));
});

test("the saved row rehydrates to the same selector state", () => {
  const cases: Array<[ColumnFormComponent, ColumnFormPricingData, Record<string, unknown>]> = [
    [FSX_LUSTRE, fsxData("SSD", "1000 MBps/TiB", FSX_SSD_RECORDS), { "Storage type": "SSD" }],
    [
      FSX_LUSTRE,
      fsxData("HDD", "12 MBps/TiB", FSX_HDD_RECORDS),
      { "Storage type": "HDD", "Cache Type": "SSD cache" },
    ],
    [ELASTICACHE, elasticacheData("OnDemand", ELASTICACHE_ONDEMAND_RECORDS), { "Number of Nodes": 2 }],
    [
      ELASTICACHE,
      elasticacheData("Reserved", ELASTICACHE_RESERVED_RECORDS),
      { "Number of Nodes": 2, TermType: "Reserved", PurchaseOption: "No Upfront" },
    ],
  ];
  for (const [component, data, raw] of cases) {
    const first = evaluateColumnForm(component, data, raw);
    const rehydrated = evaluateColumnForm(component, data, first.saved.value);
    assert.deepEqual(rehydrated.saved, first.saved);
    assert.equal(rehydrated.monthly, first.monthly);
    assert.equal(rehydrated.upfront, first.upfront);
    assert.equal(rehydrated.configSummary, first.configSummary);
  }
});

test("the dependent selector contributes its own value to the price-set match", () => {
  // ElastiCache nests Purchase option under Term, so the fragment for
  // Purchase option must be "All Upfront" and not the term it depends on.
  const fragments = columnFormMeterFragments(
    ELASTICACHE,
    {
      "Number of Nodes": "2",
      "Instance Type": "cache.m5.xlarge",
      "Cache Engine": "Redis",
      "Instance Family": "Standard",
      TermType: "Reserved",
      LeaseContractLength: "1yr",
      PurchaseOption: "All Upfront",
    },
    buildColumnFormSelectorTree(
      ELASTICACHE,
      ELASTICACHE_AGGREGATIONS,
      ELASTICACHE_RESERVED_RECORDS as never,
      elasticacheData("Reserved", ELASTICACHE_RESERVED_RECORDS).selectors
    )
  );
  assert.deepEqual(fragments, [
    "cache.m5.xlarge",
    "Redis",
    "Standard",
    "Reserved",
    "1yr",
    "All Upfront",
    "Quantity",
  ]);
});

test("a reverse key remap maps a display value back to its price key", () => {
  // The FSx definition's default is the display label; the price set uses the
  // raw key, so the reverse remap is what makes the match.
  const fragments = columnFormMeterFragments(
    { ...FSX_LUSTRE, row: [{ ...FSX_LUSTRE.row[2]!, defaultValue: "1000 MBps/TiB" }], primaryKey: "Throughput capacity" },
    { "Throughput capacity": "1000 MBps/TiB" },
    undefined
  );
  assert.deepEqual(fragments, ["1000"]);
});

test("a forward key remap is a literal lookup, so a regex-shaped key stays inert", () => {
  // Live `d = (e,t) => t.keyValue[e] || e` is a plain object lookup, so a key
  // such as `"/1\\s?yr/"` never substring-matches a value. That is why the
  // tracker's old `regex-remap` gap had no fail-closed behaviour behind it
  // (docs/DECISIONS.md D-027, analysis/FINDINGS.md section 14.2).
  const keyValue = { "/1\\s?yr/": "1 year" };
  assert.equal(remapValue(keyValue, "1yr"), "1yr");
  assert.equal(remapValue(keyValue, "/1\\s?yr/"), "1 year");
  assert.equal(remapValue(keyValue, "1 year"), "1 year");
  // Live `u` (bundle offset 1466571) reverses the same map the same way.
  assert.equal(reverseRemapValue(keyValue, "1 year"), "/1\\s?yr/");
  assert.equal(reverseRemapValue(keyValue, "1yr"), "1yr");
});

test("a regex-shaped remap key becomes the price-set token, the way live reverses it", () => {
  // Amazon Keyspaces' definition carries `{"/1\\s?yr/": "1 year"}`. The form
  // value is the label; live's token builder (`u`, bundle offset 1466571) maps
  // the label back to the key, and the token filter (`y`) runs it through
  // `String.match`, which is what `columnFormMeterFragments` and
  // `filterColumnFormMeters` do.
  const component: ColumnFormComponent = {
    id: "columnFormIPM",
    label: "Term",
    mappingDefinitionName: "mcs-provisioned-write-calc",
    primaryKey: "LeaseContractLength",
    secondaryKey: [],
    remap: { keyValue: { "/1\\s?yr/": "1 year", "/3\\s?yr/": "3 year" } },
    row: [{ label: "Term", type: "dropDown", selectorId: "LeaseContractLength", defaultValue: "1 year" }],
  };
  const fragments = columnFormMeterFragments(component, { LeaseContractLength: "1 year" }, undefined);
  assert.deepEqual(fragments, ["/1\\s?yr/"]);
});

// ---------------------------------------------------------------------------
// `utilization` rows (analysis/FINDINGS.md section 17)
//
// A utilization row's saved value is `{unit, selectedId}`. Live `q.a` turns it
// into the hours a month the Hourly/Monthly price models multiply by, and when
// the row also carries a selector id its `selectedId` is the value the price
// tree matches. The two fixtures mirror Amazon EMR (not a pricing selector) and
// WorkSpaces (a secondary selector whose aggregation values are remapped to the
// row's `Monthly`/`Hourly` labels).
// ---------------------------------------------------------------------------

const EMR_MASTER_NODE: ColumnFormComponent = {
  id: "masterNode_generated_0",
  label: "EMR master node cost",
  mappingDefinitionName: "elasticmapreduce-calc",
  calculationId: { monthly: "monthlyCost" },
  primaryKey: "Instance Type",
  secondaryKey: [],
  row: [
    {
      label: "Number of master EMR nodes",
      type: "textInput",
      selectorId: "Number of Nodes",
      exportValueAs: "count",
      validations: { required: true, allowDecimals: false, minValue: 0 },
    },
    { label: "EC2 instance", type: "dropDown", selectorId: "Instance Type" },
    {
      label: "Utilization",
      type: "utilization",
      selectorId: "Utilization",
      exportValueAs: "utilization",
    },
  ],
};

const EMR_MASTER_DATA: ColumnFormPricingData = {
  pricingSelectors: ["Location", "Instance Family", "Instance Type"],
  selectors: { Location: "US East (Ohio)", "Instance Type": "m5.xlarge" },
  regionPrices: { "m5.xlarge - Hourly Cost": { price: "0.0480000000" } },
  setMeters: ["m5.xlarge - Hourly Cost"],
  manifest: { serviceId: "elasticmapreduce", source: "elasticmapreduce-calc" },
  metadataUrl: "https://example.invalid/metadata.json",
};

test("a utilization row supplies the hours the hourly model multiplies", () => {
  const result = evaluateColumnForm(EMR_MASTER_NODE, EMR_MASTER_DATA, {
    "Number of Nodes": 1,
    "Instance Type": "m5.xlarge",
  });
  // Live: 1 instance x 0.048 hourly x (100 / 100 Utilized/Month) x 730 = 35.04.
  assert.equal(result.monthly, 35.04);
  assert.deepEqual(result.extraValues, { monthlyCost: 35.04, utilization: 730, count: 1 });
  assert.deepEqual(result.saved.value[0], {
    "Number of Nodes": { value: "1" },
    "Instance Type": { value: "m5.xlarge" },
    Utilization: { value: { unit: "100", selectedId: "%Utilized/Month" } },
  });
  assert.equal(
    result.configSummary,
    "Number of master EMR nodes (1), EC2 instance (m5.xlarge), Utilization (100 %Utilized/Month)"
  );
});

test("utilization hours scale the price and the exported hours", () => {
  const half = evaluateColumnForm(EMR_MASTER_NODE, EMR_MASTER_DATA, {
    "Number of Nodes": 1,
    "Instance Type": "m5.xlarge",
    Utilization: { unit: "50", selectedId: "%Utilized/Month" },
  });
  assert.equal(half.monthly, 17.52);
  assert.equal(half.extraValues["utilization"], 365);
  const quarter = evaluateColumnForm(EMR_MASTER_NODE, EMR_MASTER_DATA, {
    "Number of Nodes": 1,
    "Instance Type": "m5.xlarge",
    Utilization: { unit: "25", selectedId: "%Utilized/Month" },
  });
  // Live does not round the converted hours: 25% is 182.5 hours.
  assert.equal(quarter.monthly, 8.76);
  assert.equal(quarter.extraValues["utilization"], 182.5);
});

test("a utilization row unit alone takes the row's default duration", () => {
  const result = evaluateColumnForm(EMR_MASTER_NODE, EMR_MASTER_DATA, {
    "Number of Nodes": 1,
    "Instance Type": "m5.xlarge",
    Utilization: 25,
  });
  assert.equal(result.monthly, 8.76);
  assert.deepEqual(result.saved.value[0]?.Utilization, {
    value: { unit: "25", selectedId: "%Utilized/Month" },
  });
});

test("utilization durations convert to hours like the live q.a helper", () => {
  assert.equal(columnFormUtilizationHours({ unit: "50", selectedId: "%Utilized/Month" }), 365);
  assert.equal(columnFormUtilizationHours({ unit: "12", selectedId: "Hours/Day" }), 365);
  assert.equal(columnFormUtilizationHours({ unit: "84", selectedId: "Hours/Week" }), 365);
  assert.equal(columnFormUtilizationHours({ unit: "365", selectedId: "Hours/Month" }), 365);
  assert.equal(columnFormUtilizationHours({ unit: "160", selectedId: "Hourly" }), 160);
  // An unrecognised duration is a full month, and so is an absent value.
  assert.equal(columnFormUtilizationHours({ unit: "10", selectedId: "Monthly" }), 730);
  assert.equal(columnFormUtilizationHours(undefined), 730);
});

test("utilization unit validations match the live row", () => {
  assert.throws(
    () =>
      evaluateColumnForm(EMR_MASTER_NODE, EMR_MASTER_DATA, {
        "Number of Nodes": 1,
        "Instance Type": "m5.xlarge",
        Utilization: { unit: "0", selectedId: "%Utilized/Month" },
      }),
    /must be between 1 and 100 for %Utilized\/Month/
  );
  assert.throws(
    () =>
      evaluateColumnForm(EMR_MASTER_NODE, EMR_MASTER_DATA, {
        "Number of Nodes": 1,
        "Instance Type": "m5.xlarge",
        Utilization: { unit: "1.5", selectedId: "%Utilized/Month" },
      }),
    /decimals are not allowed/
  );
});

const WORKSPACES: ColumnFormComponent = {
  id: "columnFormIPM",
  label: "WorkSpaces Bundle Configuration",
  mappingDefinitionName: "workspaces-calc",
  calculationId: { monthly: "monthly_ipm" },
  primaryKey: "Operating System",
  secondaryKey: ["License", "Bundle Description", "Running Mode"],
  remap: { keyValue: { AlwaysOn: "Monthly", AutoStop: "Hourly" } },
  pricingUnitModel: {
    riPricingTypes: {
      monthly: [{ "Running Mode": "Monthly" }, { "Running Mode": "Hourly" }],
      hourly: [{ "Running Mode": "Hourly", $overridePriceKeyWith: "workspaces:PricePerUnit" }],
    },
  },
  row: [
    {
      label: "Number of WorkSpaces",
      type: "textInput",
      selectorId: "Number of WorkSpaces",
      exportValueAs: "count",
    },
    { label: "Operating system", type: "dropDown", selectorId: "Operating System", defaultValue: "Windows" },
    {
      label: "License",
      type: "dropDown",
      selectorId: "License",
      defaultValue: "Included",
      dependent: "Operating System",
    },
    {
      label: "Bundle type",
      type: "dropDown",
      selectorId: "Bundle Description",
      defaultValue: "Standard",
    },
    {
      label: "Billing option",
      type: "utilization",
      selectorId: "Running Mode",
      defaultValue: { unit: "730", selectedId: "Monthly" },
      dependent: ["Bundle Description", "License"],
      exportValueAs: "utilization",
      displayInConfigSummary: false,
    },
  ],
};

// The aggregation rows are already remapped, which is what the live engine
// matches after `remap.keyValue` turns AlwaysOn/AutoStop into Monthly/Hourly.
const WORKSPACES_AGGREGATIONS = [
  {
    selectors: {
      Location: "US East (Ohio)",
      "Operating System": "Windows",
      License: "Included",
      "Bundle Description": "Standard",
      "Running Mode": "Monthly",
    },
  },
  {
    selectors: {
      Location: "US East (Ohio)",
      "Operating System": "Windows",
      License: "Included",
      "Bundle Description": "Standard",
      "Running Mode": "Hourly",
    },
  },
];

function workspacesData(): ColumnFormPricingData {
  return {
    pricingSelectors: ["Location", "Operating System", "License", "Bundle Description", "Running Mode"],
    selectors: { ...WORKSPACES_AGGREGATIONS[0]!.selectors },
    regionPrices: {
      // The live engine remaps the price records too, so the record carries the
      // form label while the meter label keeps the raw aggregation value.
      "Windows Included Standard AlwaysOn": {
        price: "33",
        "Running Mode": "Monthly",
      } as never,
      "Windows Included Standard AutoStop": {
        price: "7.25",
        "workspaces:PricePerUnit": "0.3",
        "Running Mode": "Hourly",
      } as never,
    },
    setMeters: ["Windows Included Standard AlwaysOn", "Windows Included Standard AutoStop"],
    aggregations: WORKSPACES_AGGREGATIONS,
    manifest: { serviceId: "workspaces", source: "workspaces-calc" },
    metadataUrl: "https://example.invalid/metadata.json",
  };
}

test("a utilization row that is also a selector prices and saves its object", () => {
  const monthly = evaluateColumnForm(WORKSPACES, workspacesData(), {
    "Number of WorkSpaces": 1,
  });
  // Live: 1 instance x 33 USD monthly = 33.00.
  assert.equal(monthly.monthly, 33);
  assert.deepEqual(monthly.saved.value[0]?.["Running Mode"], {
    value: { unit: "730", selectedId: "Monthly" },
  });
  // The row declares displayInConfigSummary: false, so it is not printed.
  assert.equal(
    monthly.configSummary,
    "Number of WorkSpaces (1), Operating system (Windows), License (Included), Bundle type (Standard)"
  );

  const hourly = evaluateColumnForm(WORKSPACES, workspacesData(), {
    "Number of WorkSpaces": 1,
    "Running Mode": { unit: "160", selectedId: "Hourly" },
  });
  // Live: (1 x 7.25 monthly) + (1 x 0.3 hourly x 160 hours) = 55.25.
  assert.equal(hourly.monthly, 55.25);
  assert.deepEqual(hourly.saved.value[0]?.["Running Mode"], {
    value: { unit: "160", selectedId: "Hourly" },
  });
});

test("a utilization value the price tree does not offer fails closed", () => {
  assert.throws(
    () =>
      evaluateColumnForm(WORKSPACES, workspacesData(), {
        "Number of WorkSpaces": 1,
        "Running Mode": { unit: "100", selectedId: "%Utilized/Month" },
      }),
    /cannot use "Running Mode" = "%Utilized\/Month"; the live form offers "Monthly", "Hourly"/
  );
});
