import { AxiError } from "axi-sdk-js";
import type { ParsedArgs } from "../cli/args.ts";
import { booleanFlag, stringFlag } from "../cli/args.ts";
import { cacheOptions, loadDataPlane, requirePositional } from "./shared.ts";
import { loadDefinition, templateById, type Component } from "../data/definitions.ts";
import { createPriceResolver, loadServiceMappings } from "../data/pricing.ts";
import { regionName } from "../data/catalog.ts";
import { CURRENCY } from "../endpoints.ts";
import { evaluateDisplayIf } from "../engine/expression.ts";

export const schemaFlags = {
  "--region": { type: "string" as const, description: "region used for visibility checks", value: "us-east-1" },
  "--template": { type: "string" as const, description: "template id (default: first template)" },
  "--full": { type: "boolean" as const, description: "include full option lists and validations" },
  "--refresh": { type: "boolean" as const, description: "ignore the cached data plane" },
  "--offline": { type: "boolean" as const, description: "never touch the network" },
};

export const schemaHelp = `aws-calc-axi schema - show a service definition's inputs

Usage:
  aws-calc-axi schema <serviceCode> [--region us-east-2] [--template <id>] [--full]

Flags:
  --region <code>    region used to resolve display conditions (default us-east-1)
  --template <id>    template id; default is the service's first template
  --full             include option lists, defaults, and validations
  --refresh          ignore the cached data plane
  --offline          never touch the network

Examples:
  aws-calc-axi schema amazonS3Standard --region us-east-2
  aws-calc-axi schema aWSLambda --template lambdaWithFreeTier --full
  aws-calc-axi schema amazonSimpleNotificationService
`;

interface InputRow {
  id: string;
  subType: string;
  label: string;
  required: boolean;
  hidden: boolean;
  defaultValue?: unknown;
  options?: Array<{ id: string; label: string }>;
  validations?: unknown;
  /** columnFormIPM selector rows (the values the spec sets). */
  selectors?: Array<{ id: string; type: string; label: string; defaultValue?: unknown }>;
  /** dataTransferV2 entry types the component offers. */
  transferTypes?: string[];
}

function inputRow(component: Component, visible: boolean, full: boolean): InputRow {
  const validations = component["validations"];
  const required =
    typeof validations === "object" &&
    validations !== null &&
    (validations as Record<string, unknown>)["required"] === true;
  const optionSource = (component["options"] ??
    component["dropDownSize"] ??
    component["dropDownDuration"]) as Array<Record<string, unknown>> | undefined;

  const row: InputRow = {
    id: component.id,
    subType: component.subType ?? "unknown",
    label: String(component["label"] ?? component["title"] ?? ""),
    required,
    hidden: !visible,
  };

  const defaultValue =
    component["defaultValue"] ??
    component["defaultDropDownItem"] ??
    component["defaultFrequency"] ??
    component["defaultOption"];
  if (defaultValue !== undefined) row.defaultValue = defaultValue;

  if (Array.isArray(optionSource) && full) {
    row.options = optionSource.map((option) => ({
      id: String(option["id"] ?? option["value"] ?? ""),
      label: String(option["label"] ?? option["name"] ?? ""),
    }));
  }
  if (validations !== undefined && full) row.validations = validations;

  if (component.subType === "columnFormIPM") {
    const selectorRows = Array.isArray(component["row"])
      ? (component["row"] as Array<Record<string, unknown>>)
      : [];
    row.selectors = selectorRows.map((selector) => ({
      id: String(selector["selectorId"] ?? ""),
      type: String(selector["type"] ?? ""),
      label: String(selector["label"] ?? selector["selectorId"] ?? ""),
      ...(selector["defaultValue"] === undefined
        ? {}
        : { defaultValue: selector["defaultValue"] }),
    }));
    row.defaultValue = selectorRows
      .filter((selector) => selector["defaultValue"] !== undefined)
      .map((selector) => `${String(selector["selectorId"])}=${String(selector["defaultValue"])}`)
      .join(", ");
  }
  if (component.subType === "dataTransferV2") {
    const types = component["dataTransferTypes"];
    if (Array.isArray(types)) row.transferTypes = types.map((entry) => String(entry));
  }
  return row;
}

export async function schemaCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  if (args.help) return { help: schemaHelp };
  const code = requirePositional(args, "schema", "a service code");
  const region = stringFlag(args.flags, "region") ?? "us-east-1";
  const full = booleanFlag(args.flags, "full");
  const cache = cacheOptions(args.flags);
  const definition = await loadDefinition(code, cache);
  const { locations } = await loadDataPlane(args.flags);
  const name = regionName(locations, region);
  if (!name) {
    throw new AxiError(`unknown region "${region}"`, "VALIDATION_ERROR", [
      "Region codes look like us-east-2; run `aws-calc-axi services --all` for service codes",
    ]);
  }

  const service = {
    code: definition.serviceCode,
    name: definition.serviceName.trim(),
    version: definition.version,
    layout: definition.layout ?? "simple",
    selector: definition.subType === "subServiceSelector",
  };

  if (definition.subType === "subServiceSelector") {
    return {
      service,
      region,
      regionName: name,
      subServices: (definition.templates ?? []).map((entry) => String(entry)),
      defaultSubServices: definition.defaultTemplates ?? [],
      help: [`Run \`aws-calc-axi schema ${definition.defaultTemplates?.[0] ?? "<subService>"}\` for a child's inputs`],
    };
  }

  const requestedTemplate = stringFlag(args.flags, "template");
  const template = templateById(definition, requestedTemplate);
  if (!template) {
    throw new AxiError(
      `service ${code} has no template "${requestedTemplate ?? ""}"`,
      "NOT_FOUND",
      [`templates: ${(definition.templates ?? []).map((entry) => entry.id).join(", ")}`]
    );
  }

  // PLC_2.0 mappings are selector trees, not flat metered unit maps.
  const flatMappings = (definition.mappingDefinitions ?? []).filter(
    (mapping) => mapping.mappingDefinitionVersion !== "PLC_2.0"
  );
  const { mappings } = await loadServiceMappings(flatMappings, CURRENCY, cache);
  const prices = createPriceResolver({
    currency: CURRENCY,
    regionName: name,
    mappings,
    mappingByName: new Map(),
  });
  const context = {
    get: (id: string) => values.get(id) as never,
    hasMeteredUnit: (mapping: string, meter: string) => prices.has(mapping, meter),
  };
  const values = new Map<string, unknown>();
  const inputs: InputRow[] = [];

  for (const card of template.cards ?? []) {
    const cardVisible = evaluateDisplayIf(card.displayIf, context);
    for (const component of card.inputSection?.components ?? []) {
      if (component.type !== "input") continue;
      if (component.subType === "bodyText" || component.subType === "headerText" || component.subType === "alert") {
        continue;
      }
      const visible = cardVisible && evaluateDisplayIf(component["displayIf"], context);
      inputs.push(inputRow(component, visible, full));
    }
  }

  return {
    service,
    region,
    regionName: name,
    template: { id: template.id, title: template.title ?? template.id },
    templates: (definition.templates ?? []).map((entry) => entry.id),
    inputs,
    count: `${inputs.length} inputs`,
    help: [
      `Set values with \`--set <id>=<value>\` in an estimate file`,
      `Run \`aws-calc-axi schema ${code} --full\` for options, defaults, and validations`,
    ],
  };
}
