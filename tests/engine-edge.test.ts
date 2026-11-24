import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInput } from "../src/engine/inputs.ts";
import { evaluateTemplate } from "../src/engine/template.ts";
import type { Component, ServiceDefinition } from "../src/data/definitions.ts";
import { regionMaps, resolverFor } from "./helpers.ts";

const pricing = resolverFor({});

function input(component: Partial<Component>): Component {
  return { type: "input", id: "field", ...component } as Component;
}

const context = {
  serviceCode: "test",
  templateId: "t",
  regionName: "US East (Ohio)",
  prices: pricing,
  ...regionMaps(),
  columnForms: new Map(),
};

test("a dropdown with no default selects the first option, like the live UI", () => {
  const result = evaluateInput(
    input({
      subType: "dropdown",
      options: [
        { label: "None", id: "[ZERO_COST]" },
        { label: "Something", id: "something" },
      ],
    }),
    { ...context, overrides: {} }
  );
  assert.equal(result.value, "[ZERO_COST]");
  assert.deepEqual(result.saved, { value: "[ZERO_COST]" });
});

test("a declared dropdown default missing from options falls back to the first", () => {
  const result = evaluateInput(
    input({
      subType: "dropdown",
      defaultDropDownItem: "ghost",
      options: [
        { label: "One", id: "one" },
        { label: "Two", id: "two" },
      ],
    }),
    { ...context, overrides: {} }
  );
  assert.equal(result.value, "one");
});

test("an explicit invalid dropdown override fails closed", () => {
  assert.throws(
    () =>
      evaluateInput(
        input({ subType: "dropdown", options: [{ label: "One", id: "one" }] }),
        { ...context, overrides: { field: "two" } }
      ),
    /not one of one/
  );
});

test("noDefaultItem keeps a dropdown empty", () => {
  const result = evaluateInput(
    input({
      subType: "dropdown",
      noDefaultItem: true,
      options: [{ label: "One", id: "one" }],
    }),
    { ...context, overrides: {} }
  );
  assert.equal(result.present, false);
  assert.equal(result.value, undefined);
});

test("a display-only alert without a type is skipped, not treated as maths", () => {
  const definition: ServiceDefinition = {
    version: "0.0.1",
    serviceName: "Edge",
    serviceCode: "edge",
    templates: [
      {
        id: "edgeTemplate",
        cards: [
          {
            title: "Card",
            inputSection: {
              components: [
                {
                  id: "alert_tip",
                  subType: "alert",
                  header: "Tip",
                  content: "a tip",
                } as unknown as Component,
              ],
            },
            mathsSection: [{ components: [] }],
          },
        ],
      },
    ],
  };
  const result = evaluateTemplate({
    definition,
    template: definition.templates?.[0] as never,
    regionCode: "us-east-2",
    regionName: "US East (Ohio)",
    prices: pricing,
    overrides: {},
    ...regionMaps(),
    columnForms: new Map(),
  });
  assert.equal(result.serviceCost.monthly, 0);
});

test("percent inputs keep the fraction in state and summary", () => {
  const result = evaluateInput(
    input({
      subType: "percentInput",
      label: "Sampling rate",
      defaultValue: 100,
      displayInConfigSummary: true,
    }),
    { ...context, overrides: {} }
  );
  assert.equal(result.value, 1);
  assert.equal(result.configSummary, "Sampling rate (1)");
});

test("throughput inputs convert to the output unit and summarize the entry", () => {
  const result = evaluateInput(
    input({
      subType: "throughput",
      label: "Throughput",
      defaultValue: 125,
      defaultThroughput: "mbps",
      outputThroughput: { label: "MBps", value: "mbps" },
      options: [
        { label: "kbps", value: "kbps", id: "0" },
        { label: "MBps", value: "mbps", id: "1" },
        { label: "Gbps", value: "gbps", id: "2" },
      ],
      displayInConfigSummary: true,
    }),
    { ...context, overrides: {} }
  );
  assert.equal(result.value, 125);
  assert.deepEqual(result.saved, { value: 125, unit: "mbps" });
  assert.equal(result.configSummary, "Throughput (125 MBps)");
});

test("throughput overrides convert gigabytes per second to megabytes", () => {
  const result = evaluateInput(
    input({
      subType: "throughput",
      defaultValue: 1,
      defaultThroughput: "gbps",
      outputThroughput: { label: "MBps", value: "mbps" },
      options: [{ label: "Gbps", value: "gbps", id: "2" }],
    }),
    { ...context, overrides: { field: { value: 1, unit: "gbps" } } }
  );
  assert.equal(result.value, 1024);
  assert.deepEqual(result.saved, { value: 1, unit: "gbps" });
});

test("concatenate joins constants and components without separators", () => {
  const definition = {
    version: "0",
    serviceName: "test",
    serviceCode: "test",
    templates: [
      {
        id: "t",
        cards: [
          {
            inputSection: {
              components: [
                input({ id: "a", subType: "numericInput", defaultValue: 1 }),
                input({ id: "b", subType: "dropdown", defaultDropDownItem: "x", options: [{ id: "x", label: "X" }] }),
              ],
            },
            mathsSection: [
              {
                components: [
                  {
                    type: "pricing",
                    subType: "concatenate",
                    id: "joined",
                    operands: [
                      { constant: "Database Storage " },
                      { variableId: "b" },
                      { constant: " " },
                      { variableId: "a" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as ServiceDefinition;
  const result = evaluateTemplate({
    definition,
    template: definition.templates?.[0] as never,
    regionCode: "us-east-2",
    regionName: "US East (Ohio)",
    prices: pricing,
    overrides: {},
    ...regionMaps(),
    columnForms: new Map(),
  });
  assert.equal(result.values.get("joined"), "Database Storage x 1");
});

test("a bare size override keeps the component's default frequency", () => {
  const result = evaluateInput(
    input({
      subType: "fileSize",
      label: "Storage amount",
      dropDownSize: [
        { label: "MB", id: "mb" },
        { label: "GB", id: "gb" },
      ],
      defaultOption: { size: "gb", frequency: "NA" },
      outputSize: "gb",
      outputFrequency: "NA",
      defaultValue: 100,
      displayInConfigSummary: true,
    }),
    { ...context, overrides: { field: { value: 500, unit: "gb" } } }
  );
  assert.equal(result.value, 500);
  assert.deepEqual(result.saved, { value: 500, unit: "gb|NA" });
  assert.equal(result.configSummary, "Storage amount (500 GB)");
});

test("a frequency override on an NA-frequency fileSize fails closed", () => {
  assert.throws(
    () =>
      evaluateInput(
        input({
          subType: "fileSize",
          dropDownSize: [{ label: "GB", id: "gb" }],
          defaultOption: { size: "gb", frequency: "NA" },
          outputSize: "gb",
          outputFrequency: "NA",
          defaultValue: 100,
        }),
        { ...context, overrides: { field: { value: 500, unit: "gb|month" } } }
      ),
    /frequency "month" is not supported/
  );
});

test("snapShotMaths matches the live first-snapshot plus half-month changed storage formula", () => {
  const definition = {
    serviceCode: "test",
    serviceName: "Test",
    templates: [
      {
        id: "t",
        cards: [
          {
            title: "snapshots",
            mathsSection: [
              {
                components: [
                  {
                    type: "maths",
                    subType: "snapShotMaths",
                    id: "snap",
                    operands: [
                      { operand: "ebsStorage", constant: 500 },
                      { operand: "amountSnapShotChanged", constant: 10 },
                      { operand: "snapShotFrequency", constant: 30 },
                      { operand: "snapShotPricing", constant: 0.05 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as ServiceDefinition;
  const result = evaluateTemplate({
    definition,
    template: definition.templates?.[0] as never,
    regionCode: "us-east-2",
    regionName: "US East (Ohio)",
    prices: pricing,
    overrides: {},
    ...regionMaps(),
    columnForms: new Map(),
  });
  assert.equal(result.values.get("snap"), 32.5);
});

test("a bare size override on a monthly input keeps the monthly frequency", () => {
  const result = evaluateInput(
    input({
      subType: "fileSize",
      label: "Amount",
      dropDownSize: [{ label: "GB", id: "gb" }],
      dropDownFrequency: [{ label: "month", id: "month" }],
      defaultOption: { size: "gb", frequency: "month" },
      outputSize: "gb",
      outputFrequency: "month",
      defaultValue: 100,
    }),
    { ...context, overrides: { field: { value: 250, unit: "gb" } } }
  );
  assert.equal(result.value, 250);
  assert.deepEqual(result.saved, { value: 250, unit: "gb|month" });
});

test("a percentage utilization input converts to hours and saves the entry with its duration", () => {
  const result = evaluateInput(
    input({
      subType: "utilization",
      label: "Monthly utilization",
      defaultValue: 100,
      roundUpToHours: true,
      validations: { required: true, minValue: 0, maxValue: 730 },
    }),
    { ...context, overrides: {} }
  );
  assert.equal(result.value, 730);
  assert.deepEqual(result.saved, { value: "100", unit: "percentagePerMonth" });
  assert.equal(result.present, true);
});

test("a utilization input keeps its declared duration and prints the live summary", () => {
  const result = evaluateInput(
    input({
      subType: "utilization",
      label: "Hours used",
      defaultValue: 730,
      defaultDuration: "hoursPerMonth",
      roundUpToHours: true,
      decimalPlaces: 4,
      displayInConfigSummary: true,
      validations: { required: true, minValue: 0, maxValue: 730 },
    }),
    { ...context, overrides: {} }
  );
  assert.equal(result.value, 730);
  assert.deepEqual(result.saved, { value: "730", unit: "hoursPerMonth" });
  assert.equal(result.configSummary, "Hours used (730 Hours/Month)");
});

test("utilization overrides convert the entry and keep the saved wire shape", () => {
  const component = input({
    subType: "utilization",
    label: "Length of time cluster is running",
    defaultValue: 100,
    defaultDuration: "percentagePerMonth",
    roundUpToHours: false,
    decimalPlaces: 4,
    displayInConfigSummary: true,
    validations: { required: false },
  });
  const below = evaluateInput(component, { ...context, overrides: { field: { value: 33 } } });
  assert.equal(below.value, 240.9);
  assert.deepEqual(below.saved, { value: "33", unit: "percentagePerMonth" });
  assert.equal(
    below.configSummary,
    "Length of time cluster is running (33 % Utilization/Month)"
  );

  const half = evaluateInput(component, { ...context, overrides: { field: { value: 50 } } });
  assert.equal(half.value, 365);

  const none = evaluateInput(component, { ...context, overrides: { field: { value: 0 } } });
  assert.equal(none.value, 0);
  assert.deepEqual(none.saved, { value: "0", unit: "percentagePerMonth" });
});

test("a utilization override can switch to another live duration", () => {
  const result = evaluateInput(
    input({
      subType: "utilization",
      label: "Hours used",
      defaultValue: 730,
      defaultDuration: "hoursPerMonth",
      roundUpToHours: true,
    }),
    { ...context, overrides: { field: { value: 12, unit: "hoursPerDay" } } }
  );
  // 12/24 of a month of hours: 12/24 * 730 = 365.
  assert.equal(result.value, 365);
  assert.deepEqual(result.saved, { value: "12", unit: "hoursPerDay" });
});

test("utilization validations run on the converted hours with the live 0..730 default", () => {
  const component = input({
    subType: "utilization",
    label: "Flow utilization",
    defaultValue: 730,
    defaultDuration: "hoursPerMonth",
    roundUpToHours: true,
    validations: { required: true },
  });
  // A definition without minValue/maxValue still rejects more than a month.
  assert.throws(
    () => evaluateInput(component, { ...context, overrides: { field: { value: 800 } } }),
    /must be between 0 and 730 hours utilized/
  );
  const max = evaluateInput(component, { ...context, overrides: { field: { value: 730 } } });
  assert.equal(max.value, 730);

  // Percentages are validated through their hours: 101% is 737.3 hours.
  const percentage = input({
    subType: "utilization",
    label: "Monthly utilization",
    defaultValue: 100,
    roundUpToHours: true,
    validations: { required: true, minValue: 0, maxValue: 730 },
  });
  assert.throws(
    () => evaluateInput(percentage, { ...context, overrides: { field: { value: 101 } } }),
    /must be between 0 and 730 hours utilized/
  );
});

test("an unknown utilization duration fails closed with the live option ids", () => {
  assert.throws(
    () =>
      evaluateInput(
        input({ subType: "utilization", defaultValue: 100, defaultDuration: "percentagePerMonth" }),
        { ...context, overrides: { field: { value: 10, unit: "hoursPerYear" } } }
      ),
    /"hoursPerYear" is not one of percentagePerMonth, hoursPerDay, hoursPerWeek, hoursPerMonth, minutesPerDay, minutesPerMonth/
  );
});

test("utilization is a supported input subtype, not a fail-closed gap", () => {
  // Regression guard: this case used to throw UNSUPPORTED_INPUT, which kept
  // Deadline Cloud, Direct Connect, MediaConnect, and PCS from evaluating.
  const result = evaluateInput(
    input({ subType: "utilization", defaultValue: 100, roundUpToHours: true }),
    { ...context, overrides: {} }
  );
  assert.equal(result.value, 730);
  // Unknown subtypes still fail closed, so the guard above is meaningful.
  assert.throws(
    () => evaluateInput(input({ subType: "notARealSubtype" }), { ...context, overrides: {} }),
    /no handler for input subtype "notARealSubtype"/
  );
});

function templateFor(components: {
  inputs?: Component[];
  maths?: Component[];
}): ServiceDefinition {
  return {
    version: "0",
    serviceName: "test",
    serviceCode: "test",
    templates: [
      {
        id: "t",
        cards: [
          {
            inputSection: { components: components.inputs ?? [] },
            mathsSection: [{ components: components.maths ?? [] }],
          },
        ],
      },
    ],
  } as unknown as ServiceDefinition;
}

function evaluate(definition: ServiceDefinition, prices = pricing) {
  return evaluateTemplate({
    definition,
    template: definition.templates?.[0] as never,
    regionCode: "us-east-2",
    regionName: "US East (Ohio)",
    prices,
    overrides: {},
    ...regionMaps(),
    columnForms: new Map(),
  });
}

test("replace keeps the original string when no replacement matches, like the live engine", () => {
  const definition = templateFor({
    inputs: [input({ id: "source", subType: "dropdown", defaultDropDownItem: "none", options: [{ id: "none", label: "None" }] })],
    maths: [
      {
        type: "pricing",
        subType: "replace",
        id: "replaced",
        originalId: "source",
        replacements: [{ originalString: "JPEG-XS", replaceString: "CDI" }],
      } as unknown as Component,
    ],
  });
  // The definition's dropdown default ("none") is not in the replacement list.
  assert.equal(evaluate(definition).values.get("replaced"), "none");
});

test("replace substitutes every occurrence of the original string", () => {
  const definition = templateFor({
    inputs: [input({ id: "source", subType: "dropdown", defaultDropDownItem: "a-b-a", options: [{ id: "a-b-a", label: "A B A" }] })],
    maths: [
      {
        type: "pricing",
        subType: "replace",
        id: "replaced",
        originalId: "source",
        replacements: [{ originalString: "a-b", replaceString: "z" }],
      } as unknown as Component,
    ],
  });
  assert.equal(evaluate(definition).values.get("replaced"), "z-a");
});

test("pricingComboV2 bills a derived meter that the region lacks as zero, like the live engine", () => {
  const prices = resolverFor({
    "mediaconnect": { regions: { "US East (Ohio)": {} } },
  });
  const definition = templateFor({
    maths: [
      {
        type: "pricing",
        subType: "concatenate",
        id: "meter",
        operands: [{ constant: "DataProcessedReserved" }, { constant: "Mbps1Yr" }],
      } as unknown as Component,
      {
        type: "pricing",
        subType: "pricingComboV2",
        id: "price",
        mappingDefinitionName: "mediaconnect",
        refers: [{ variableId: "meter" }],
      } as unknown as Component,
    ],
  });
  assert.equal(evaluate(definition, prices).values.get("price"), 0);
});

test("pricingComboV2 still fails closed when the region never loaded", () => {
  const prices = resolverFor({
    "mediaconnect": { regions: { "US West (Oregon)": { Meter: { price: "1" } } } },
  });
  const definition = templateFor({
    maths: [
      {
        type: "pricing",
        subType: "concatenate",
        id: "meter",
        operands: [{ constant: "Meter" }],
      } as unknown as Component,
      {
        type: "pricing",
        subType: "pricingComboV2",
        id: "price",
        mappingDefinitionName: "mediaconnect",
        refers: [{ variableId: "meter" }],
      } as unknown as Component,
    ],
  });
  assert.throws(() => evaluate(definition, prices), /no price for metered unit "Meter"/);
});
