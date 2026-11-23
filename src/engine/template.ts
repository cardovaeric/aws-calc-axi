import { Decimal } from "decimal.js";
import {
  templateComponents,
  type Card,
  type Component,
  type ServiceDefinition,
  type Template,
} from "../data/definitions.ts";
import { MissingPriceError, type PriceResolver } from "../data/pricing.ts";
import type { ColumnFormPricingData } from "../data/column-form.ts";
import type { CalculationComponents } from "../contract.ts";
import { toCents } from "../contract.ts";
import { evaluateDisplayIf, type ExprContext, type Operand } from "./expression.ts";
import { evaluateInput } from "./inputs.ts";
import { evaluateMaths, applyMathsDecimals } from "./maths.ts";
import {
  magicPrice,
  resolveTiers,
  singlePricePoint,
  tieredCost,
  type PricingContext,
  type Tier,
} from "./pricing-engine.ts";
import { EngineError, UnsupportedComponentError } from "./errors.ts";
import { componentLabel, type EvaluatedTemplate, type Subtotal } from "./types.ts";

export interface TemplateContext {
  definition: ServiceDefinition;
  template: Template;
  regionCode: string;
  regionName: string;
  prices: PriceResolver;
  overrides: Record<string, unknown>;
  /** Region code -> display name, including the calculator's virtual keys. */
  regionNameByCode: Map<string, string>;
  /** Region display name -> code. */
  regionCodeByName: Map<string, string>;
  /** Prefetched PLC_2.0 data for the template's columnFormIPM components. */
  columnForms: Map<string, ColumnFormPricingData>;
}

interface Runtime {
  values: Map<string, unknown>;
  saved: CalculationComponents;
  summary: string[];
  subtotals: Subtotal[];
  tiers: Map<string, Tier[]>;
  cards: string[];
  hasUpfront: boolean;
}

function exprContext(runtime: Runtime, prices: PriceResolver): ExprContext {
  return {
    get: (id) => runtime.values.get(id) as never,
    hasMeteredUnit: (mappingDefinitionName, meteredUnit) =>
      prices.has(mappingDefinitionName, meteredUnit),
  };
}

/**
 * Evaluate a template into concrete values, the wire `calculationComponents`,
 * the config summary, and the cost subtotals.
 *
 * Ordering mirrors the web app: per card, inputs (and pricing lookups) first,
 * then maths. Components hidden by `displayIf` contribute nothing and are set
 * to zero so later maths can reference them safely.
 */
export function evaluateTemplate(context: TemplateContext): EvaluatedTemplate {
  const { definition, template, regionCode, regionName, prices } = context;
  const runtime: Runtime = {
    values: new Map(),
    saved: {},
    summary: [],
    subtotals: [],
    tiers: new Map(),
    cards: [],
    hasUpfront: false,
  };

  const pricingContext: PricingContext = {
    regionCode,
    regionName,
    prices,
    get: (id) => runtime.values.get(id),
    serviceCode: definition.serviceCode,
  };

  for (const { card, inputs, maths } of templateComponents(template).cards) {
    const cardVisible = evaluateDisplayIf(card.displayIf, exprContext(runtime, prices));
    if (cardVisible) runtime.cards.push(card.title ?? template.id);

    for (const component of [...inputs, ...maths]) {
      if (!cardVisible) {
        setHidden(runtime, component);
        continue;
      }
      if (!evaluateDisplayIf(component["displayIf"], exprContext(runtime, prices))) {
        setHidden(runtime, component);
        continue;
      }
      evaluateComponent(runtime, component, card, context, pricingContext);
    }
  }

  const monthly = sumSubtotals(runtime.subtotals, "Monthly");
  const upfront = sumSubtotals(runtime.subtotals, "Upfront");

  return {
    calculationComponents: runtime.saved,
    configSummary: runtime.summary.filter((part) => part !== "").join(", "),
    serviceCost: runtime.hasUpfront
      ? { monthly: toCents(monthly), upfront: toCents(upfront) }
      : { monthly: toCents(monthly) },
    subtotals: runtime.subtotals,
    values: runtime.values,
    hasUpfront: runtime.hasUpfront,
    cards: runtime.cards,
  };
}

function sumSubtotals(subtotals: Subtotal[], costType: string): number {
  return subtotals
    .filter((subtotal) => subtotal.costType === costType)
    .reduce((total, subtotal) => new Decimal(total).add(subtotal.value).toNumber(), 0);
}

const DISPLAY_ONLY_SUBTYPES = new Set([
  "bodyText",
  "headerText",
  "alert",
  "condition",
  "conversionDisplay",
]);

function setHidden(runtime: Runtime, component: Component): void {
  runtime.values.set(component.id, 0);
}

function evaluateComponent(
  runtime: Runtime,
  component: Component,
  card: Card,
  context: TemplateContext,
  pricingContext: PricingContext
): void {
  const { definition, template } = context;
  const subType = component.subType ?? "unknown";
  const type =
    component.type ??
    (DISPLAY_ONLY_SUBTYPES.has(subType) ? "display" : "unknown");
  component = { ...component, type };

  if (component.type === "display" || component.type === "maths" || component.type === "variable") {
    if (component.subType === "priceDisplay") {
      evaluatePriceDisplay(runtime, component);
      return;
    }
    if (DISPLAY_ONLY_SUBTYPES.has(component.subType ?? "")) {
      runtime.values.set(component.id, 0);
      return;
    }
  }

  if (component.type === "maths" || component.type === "variable") {
    evaluateMathsComponent(runtime, component, context);
    return;
  }

  if (component.type === "input") {
    const result = evaluateInput(component, {
      serviceCode: definition.serviceCode,
      templateId: template.id,
      overrides: context.overrides,
      regionName: context.regionName,
      prices: context.prices,
      regionNameByCode: context.regionNameByCode,
      regionCodeByName: context.regionCodeByName,
      columnForms: context.columnForms,
    });
    runtime.values.set(component.id, result.value);
    for (const [id, value] of Object.entries(result.extraValues ?? {})) {
      runtime.values.set(id, value);
    }
    if (result.saved) runtime.saved[component.id] = result.saved;
    if (result.configSummary) runtime.summary.push(result.configSummary);
    return;
  }

  if (component.type === "pricing") {
    evaluatePricingComponent(runtime, component, pricingContext);
    return;
  }

  throw new UnsupportedComponentError({
    serviceCode: definition.serviceCode,
    templateId: template.id,
    cardTitle: card.title,
    componentId: component.id,
    kind: component.type,
    subType: component.subType ?? "unknown",
  });
}

function evaluatePriceDisplay(runtime: Runtime, component: Component): void {
  const refer = component["subTotalRefer"];
  if (typeof refer !== "string" || refer === "") {
    runtime.values.set(component.id, 0);
    return;
  }
  const raw = runtime.values.get(refer);
  const value = Number(raw);
  const costType = String(component["costType"] ?? "Monthly");
  if (costType === "Upfront") runtime.hasUpfront = true;
  runtime.subtotals.push({
    componentId: component.id,
    label: componentLabel(component),
    costType,
    value: Number.isFinite(value) ? value : 0,
  });
  runtime.values.set(component.id, value);
}

function evaluatePricingComponent(
  runtime: Runtime,
  component: Component,
  pricingContext: PricingContext
): void {
  const subType = component.subType ?? "unknown";
  switch (subType) {
    case "singlePricePoint": {
      const price = singlePricePoint(component, pricingContext);
      runtime.values.set(component.id, price);
      return;
    }
    case "tieredPricing": {
      const tiers = resolveTiers(component, pricingContext);
      runtime.tiers.set(component.id, tiers);
      runtime.values.set(component.id, tiers);
      return;
    }
    case "replace": {
      const originalId = String(component["originalId"] ?? "");
      const originalValue = originalId ? runtime.values.get(originalId) : undefined;
      const replacements = (component["replacements"] as Array<Record<string, unknown>> | undefined) ?? [];
      const match = replacements.find(
        (entry) => String(entry["originalString"]) === String(originalValue)
      );
      if (!match) {
        throw new EngineError(
          `replace "${component.id}" has no mapping for ${originalId}=${String(originalValue)}`,
          "BAD_DEFINITION",
          { componentId: component.id, originalId, originalValue }
        );
      }
      runtime.values.set(component.id, String(match["replaceString"] ?? ""));
      return;
    }
    case "concatenate": {
      const operands = (component["operands"] as Array<Record<string, unknown>> | undefined) ?? [];
      const parts = operands.map((operand) => {
        if (typeof operand["constant"] === "string") return String(operand["constant"]);
        const id = String(operand["variableId"] ?? "");
        const value = runtime.values.get(id);
        if (value === undefined || value === null || value === "") {
          throw new EngineError(
            `concatenate "${component.id}" needs component "${id}"`,
            "MISSING_INPUT",
            { componentId: component.id, referencedId: id }
          );
        }
        return String(value);
      });
      runtime.values.set(component.id, parts.join(""));
      return;
    }
    case "pricingComboV2": {
      const refers = (component["refers"] as Array<Record<string, unknown>> | undefined) ?? [];
      const first = refers[0];
      const variableId = first ? String(first["variableId"] ?? "") : "";
      const label = variableId ? runtime.values.get(variableId) : undefined;
      if (typeof label !== "string" || label === "") {
        throw new EngineError(
          `pricingComboV2 "${component.id}" needs component "${variableId}" to select a meter`,
          "MISSING_INPUT",
          { componentId: component.id, referencedId: variableId }
        );
      }
      const magic = magicPrice(label);
      if (magic !== undefined) {
        runtime.values.set(component.id, magic);
        return;
      }
      const mapping = String(component["mappingDefinitionName"] ?? "");
      const key = first && typeof first["key"] === "string" ? first["key"] : "price";
      const record = pricingContext.prices.record(mapping, label);
      if (!record) {
        throw new MissingPriceError(label, pricingContext.regionName, mapping);
      }
      const raw = (record as unknown as Record<string, unknown>)[key];
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new EngineError(
          `pricingComboV2 "${component.id}" price field "${key}" is "${String(raw)}"`,
          "BAD_PRICE",
          { componentId: component.id, label, key }
        );
      }
      runtime.values.set(component.id, value);
      return;
    }
    default:
      throw new UnsupportedComponentError({
        serviceCode: pricingContext.serviceCode,
        templateId: String(component["templateId"] ?? ""),
        componentId: component.id,
        kind: component.type,
        subType,
      });
  }
}

function evaluateMathsComponent(
  runtime: Runtime,
  component: Component,
  context: TemplateContext
): void {
  const subType = component.subType ?? "basicMaths";
  const get = (id: string): unknown => runtime.values.get(id);

  if (subType === "variable" || component.type === "variable") {
    const refer = component["refer"];
    const referenced = Array.isArray(refer) ? refer[0] : refer;
    if (typeof referenced !== "string") {
      throw new EngineError(`variable "${component.id}" has no refer`, "BAD_DEFINITION", {
        componentId: component.id,
      });
    }
    const value = get(referenced);
    runtime.values.set(component.id, value);
    return;
  }

  if (subType === "tieredPricingMath") {
    const inputRefer = String(component["inputRefer"] ?? "");
    const tieredPricingRefer = String(component["tieredPricingRefer"] ?? "");
    const tiers = runtime.tiers.get(tieredPricingRefer);
    if (!tiers) {
      throw new EngineError(
        `tieredPricingMath "${component.id}" references missing pricing ` +
          `"${tieredPricingRefer}"`,
        "BAD_DEFINITION",
        { componentId: component.id, referencedId: tieredPricingRefer }
      );
    }
    const inputRaw = get(inputRefer);
    const inputValue = Number(inputRaw);
    if (!Number.isFinite(inputValue)) {
      runtime.values.set(component.id, 0);
      return;
    }
    const value = tieredCost(tiers, inputValue);
    runtime.values.set(component.id, applyMathsDecimals(component, value));
    return;
  }

  const operands = (component["operands"] as Operand[] | undefined) ?? [];
  if (operands.length === 0) {
    runtime.values.set(component.id, 0);
    return;
  }

  if (
    subType === "basicMaths" ||
    subType === "maxMin" ||
    subType === "rounding"
  ) {
    const result = evaluateMaths(component, operands, (id) => get(id) as never);
    runtime.values.set(component.id, result.computed ? result.value : 0);
    return;
  }

  throw new UnsupportedComponentError({
    serviceCode: context.definition.serviceCode,
    templateId: context.template.id,
    componentId: component.id,
    kind: component.type,
    subType,
  });
}
