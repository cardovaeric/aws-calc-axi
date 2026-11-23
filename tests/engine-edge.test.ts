import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInput } from "../src/engine/inputs.ts";
import { evaluateTemplate } from "../src/engine/template.ts";
import type { Component, ServiceDefinition } from "../src/data/definitions.ts";
import { resolverFor } from "./helpers.ts";

const pricing = resolverFor({});

function input(component: Partial<Component>): Component {
  return { type: "input", id: "field", ...component } as Component;
}

const context = { serviceCode: "test", templateId: "t" };

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
