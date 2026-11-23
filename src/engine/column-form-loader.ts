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
  type ServiceDefinition,
  type Template,
} from "../data/definitions.ts";
import { EngineError } from "./errors.ts";
import {
  asColumnFormComponent,
  columnFormSelectorValues,
  primarySelectorOf,
} from "./column-form.ts";
import { CURRENCY } from "../endpoints.ts";

export interface PrepareColumnFormsOptions {
  definition: ServiceDefinition;
  template: Template;
  overrides: Record<string, unknown>;
  regionName: string;
  currency?: string;
  cache?: CacheOptions;
}

export async function prepareColumnForms(
  options: PrepareColumnFormsOptions
): Promise<Map<string, ColumnFormPricingData>> {
  const prepared = new Map<string, ColumnFormPricingData>();
  const currency = options.currency ?? CURRENCY;
  for (const { inputs } of templateComponents(options.template).cards) {
    for (const raw of inputs) {
      if (raw.subType !== "columnFormIPM") continue;
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
