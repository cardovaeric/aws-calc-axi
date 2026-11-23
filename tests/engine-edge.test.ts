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
