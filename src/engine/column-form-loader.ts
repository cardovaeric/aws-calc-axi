/**
 * Prefetch the PLC_2.0 data a template's `columnFormIPM` components need.
 *
 * The engine itself is synchronous: the service evaluator resolves the selected
 * selector values, fetches metadata, aggregations, and the index file once per
 * component, and hands the result to `evaluateColumnForm`.
 */
import type { CacheOptions } from "../cache.ts";
import { loadColumnFormPricing, type ColumnFormPricingData } from "../data/column-form.ts";
import {
  templateComponents,
  type Card,
  type Component,
  type ServiceDefinition,
  type Template,
} from "../data/definitions.ts";
import { EngineError } from "./errors.ts";
import {
  asColumnFormComponent,
  columnFormSelectorValues,
  primarySelectorOf,
} from "./column-form.ts";
import { evaluateDisplayIf, type ExprContext } from "./expression.ts";
import { CURRENCY } from "../endpoints.ts";

export interface PrepareColumnFormsOptions {
  definition: ServiceDefinition;
  template: Template;
  overrides: Record<string, unknown>;
  regionName: string;
  currency?: string;
  cache?: CacheOptions;
}

/**
 * Values that are already decided before the pricing pass runs: user
 * overrides, then the definition's own defaults. `displayIf` gates are
 * evaluated with these so hidden cards never fetch PLC_2.0 data (the live form
 * only renders visible cards; prefetching a hidden one used to demand a
 * selector the user can never see, for example the OCU fields in every
 * non-selected CodeBuild compute type card).
 */
function provisionalValue(
  component: Component,
  overrides: Record<string, unknown>
): { known: boolean; value: unknown } {
  const raw = overrides[component.id];
  const scalar = (value: unknown): unknown => {
    if (typeof value === "object" && value !== null && "value" in value) {
      return (value as Record<string, unknown>)["value"];
    }
    return value;
  };
  const override = scalar(raw);
  const subType = component.subType ?? "";
  switch (subType) {
    case "dropdown": {
      const options = Array.isArray(component["options"])
        ? (component["options"] as Array<Record<string, unknown>>)
        : [];
      const noDefault = component["noDefaultItem"] === true;
      const declared = component["defaultDropDownItem"];
      const selected =
        override ?? declared ?? (noDefault ? undefined : options[0]?.["id"]);
      return { known: true, value: selected };
    }
    case "checkbox": {
      const value = override ?? component["defaultValue"];
      return { known: true, value: value === true || value === "true" };
    }
    case "numericInput":
    case "percentInput":
    case "durationInput":
    case "frequency":
    case "throughput":
    case "fileSize": {
      const value = override ?? component["defaultValue"];
      return { known: true, value };
    }
    case "dataTransferV2":
      return { known: false, value: undefined };
    default:
      return { known: false, value: undefined };
  }
}

function collectReferencedIds(expr: unknown, into: Set<string>): void {
  if (!expr || typeof expr !== "object") return;
  if (Array.isArray(expr)) {
    for (const item of expr) collectReferencedIds(item, into);
    return;
  }
  const record = expr as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "checkboxChecked" || key === "checkboxNotChecked") {
      if (typeof value === "string") into.add(value);
      continue;
    }
    if (key === "exists") {
      collectReferencedIds(value, into);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          const operand = item as Record<string, unknown>;
          if (typeof operand["id"] === "string" && operand["type"] === "component") {
            into.add(operand["id"]);
          }
          if (typeof operand["variableId"] === "string") {
            into.add(operand["variableId"]);
          }
        }
        collectReferencedIds(item, into);
      }
      continue;
    }
    collectReferencedIds(value, into);
  }
}

type Visibility = (card: Card, component: Component) => boolean;

export function columnFormVisibility(
  template: Template,
  overrides: Record<string, unknown>
): Visibility {
  const provisional = new Map<string, unknown>();
  for (const { inputs } of templateComponents(template).cards) {
    for (const component of inputs) {
      const { known, value } = provisionalValue(component, overrides);
      if (known) provisional.set(component.id, value);
    }
  }
  const context: ExprContext = {
    get: (id) => {
      if (provisional.has(id)) return provisional.get(id) as never;
      return undefined;
    },
    // A metered-unit `exists` gate depends on price data that is not loaded
    // yet; treat it as visible and let the full template evaluation decide.
    hasMeteredUnit: () => true,
  };
  const holds = (expr: unknown): boolean => {
    if (expr === undefined || expr === null) return true;
    const referenced = new Set<string>();
    collectReferencedIds(expr, referenced);
    for (const id of referenced) {
      if (!provisional.has(id)) return true;
    }
    try {
      return evaluateDisplayIf(expr, context);
    } catch {
      return true;
    }
  };
  return (card, component) =>
    holds(card.displayIf) && holds(component["displayIf"]);
}

export async function prepareColumnForms(
  options: PrepareColumnFormsOptions
): Promise<Map<string, ColumnFormPricingData>> {
  const prepared = new Map<string, ColumnFormPricingData>();
  const currency = options.currency ?? CURRENCY;
  const visible = columnFormVisibility(options.template, options.overrides);
  for (const { card, inputs } of templateComponents(options.template).cards) {
    for (const raw of inputs) {
      if (raw.subType !== "columnFormIPM") continue;
      if (!visible(card, raw)) continue;
      const component = asColumnFormComponent(raw);
      const mappingName = component.mappingDefinitionName;
      const mapping = (options.definition.mappingDefinitions ?? []).find(
        (entry) => entry.mappingDefinitionName === mappingName
      );
      if (!mapping) {
        throw new EngineError(
          `columnFormIPM "${component.id}" references mapping "${mappingName}", ` +
            `which the definition does not declare`,
          "BAD_DEFINITION",
          { componentId: component.id, mappingDefinitionName: mappingName }
        );
      }
      if (mapping.mappingDefinitionVersion !== "PLC_2.0") {
        throw new EngineError(
          `columnFormIPM "${component.id}" needs a PLC_2.0 mapping; ` +
            `"${mappingName}" is not one`,
          "BAD_DEFINITION",
          { componentId: component.id, mappingDefinitionName: mappingName }
        );
      }
      const { values } = columnFormSelectorValues(
        component,
        options.overrides[component.id]
      );
      // Only the primary selector is required; hidden secondary selectors are
      // filled from the component tree by the live form.
      const primary = primarySelectorOf(component);
      if (values[primary] === undefined || values[primary] === "") {
        throw new EngineError(
          `columnFormIPM "${component.id}" needs a value for "${primary}"; ` +
            `set ${component.id} with {"${primary}": <value>}`,
          "MISSING_INPUT",
          {
            componentId: component.id,
            selectorId: primary,
            valid: component.row.map((row) => row.selectorId).filter(Boolean),
          }
        );
      }
      prepared.set(
        component.id,
        await loadColumnFormPricing({
          mappingUrl: mapping.mappingDefinitionURL,
          currency,
          regionName: options.regionName,
          values,
          ...(options.cache ? { cache: options.cache } : {}),
        })
      );
    }
  }
  return prepared;
}
