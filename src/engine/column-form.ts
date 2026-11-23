/**
 * `columnFormIPM` inputs (repeatable instance/storage rows driven by PLC_2.0
 * data).
 *
 * Supported shape: one row set per component, selector rows of type
 * `textInput`, `autoSuggest`, or `dropDown`, an hourly or monthly price model,
 * and a single price set. Everything else (tiered PLC_2.0 price patterns,
 * reserved/savings-plan models, utilization rows, dependent selectors,
 * aggregation remaps, sub-components, and repeatable cards) fails closed with
 * the component path instead of guessing.
 *
 * Save format matches the live converter: `{value: [{selectorId: {value}}]}`.
 */
import { EngineError, InputValidationError } from "./errors.ts";
import type { ColumnFormPricingData } from "../data/column-form.ts";
import type { Component } from "../data/definitions.ts";

export interface ColumnFormRowDefinition {
  type: string;
  label: string;
  selectorId: string;
  defaultValue?: unknown;
  exportValueAs?: string;
  exportTagsAsValue?: unknown;
  mappingValue?: string;
  displayInConfigSummary?: unknown;
  dependent?: string | string[];
  validations?: {
    required?: boolean;
    minValue?: number;
    maxValue?: number;
    allowDecimals?: boolean;
  };
}

export interface ColumnFormComponent {
  id: string;
  label: string;
  mappingDefinitionName: string;
  primaryKey: string | Record<string, string[]>;
  secondaryKey?: string[];
  row: ColumnFormRowDefinition[];
  calculationId?: Record<string, string>;
  pricingUnitModel?: {
    riPricingTypes?: Record<string, string | string[]>;
    [key: string]: unknown;
  };
  disableCalculation?: boolean;
  additionalPricingData?: unknown;
  subComponentsList?: unknown;
  remap?: {
    constant?: Record<string, string>;
    keyValue?: Record<string, string>;
  };
  [key: string]: unknown;
}

export function asColumnFormComponent(component: Component): ColumnFormComponent {
  const primaryKey = component["primaryKey"];
  const row = component["row"];
  if (
    (typeof primaryKey !== "string" &&
      (typeof primaryKey !== "object" || primaryKey === null)) ||
    !Array.isArray(row)
  ) {
    throw new EngineError(
      `columnFormIPM "${component.id}" is missing primaryKey or row`,
      "BAD_DEFINITION",
      { componentId: component.id }
    );
  }
  return component as unknown as ColumnFormComponent;
}

function rowValueMap(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (Array.isArray(raw)) {
    if (raw.length !== 1) {
      throw new EngineError(
        "columnFormIPM expects a single row; repeatable rows are not implemented yet",
        "UNSUPPORTED_INPUT",
        { rows: raw.length }
      );
    }
    return rowValueMap(raw[0]);
  }
  if (typeof raw !== "object") {
    throw new EngineError(
      "columnFormIPM values must be an object keyed by selector id",
      "INVALID_SPEC",
      { value: raw }
    );
  }
  return raw as Record<string, unknown>;
}

function scalarOf(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    return scalarOf((raw as Record<string, unknown>)["value"]);
  }
  if (raw === undefined || raw === null) return "";
  return String(raw);
}

export interface ColumnFormRowValues {
  values: Record<string, string>;
  provided: Set<string>;
}

/** Row selector values from defaults plus user overrides (no pricing yet). */
export function columnFormSelectorValues(
  component: ColumnFormComponent,
  raw: unknown
): ColumnFormRowValues {
  const overrides = rowValueMap(raw);
  const known = new Set(component.row.map((row) => row.selectorId));
  for (const key of Object.keys(overrides)) {
    if (!known.has(key)) {
      throw new EngineError(
        `columnFormIPM "${component.id}" has no selector "${key}"; ` +
          `valid selectors: ${[...known].join(", ")}`,
        "INVALID_SPEC",
        { componentId: component.id, selectorId: key, valid: [...known] }
      );
    }
  }
  const values: Record<string, string> = {};
  const provided = new Set<string>();
  for (const row of component.row) {
    const override = overrides[row.selectorId];
    if (override !== undefined) {
      values[row.selectorId] = scalarOf(override);
      provided.add(row.selectorId);
      continue;
    }
    const fallback = row.defaultValue;
    if (fallback === undefined) {
      values[row.selectorId] = "";
      continue;
    }
    values[row.selectorId] = scalarOf(fallback);
  }
  return { values, provided };
}

function assertValid(
  component: ColumnFormComponent,
  row: ColumnFormRowDefinition,
  value: string
): void {
  const validations = row.validations ?? {};
  if (validations.required === true && value === "") {
    throw new EngineError(
      `columnFormIPM "${component.id}" needs a value for "${row.selectorId}"`,
      "MISSING_INPUT",
      { componentId: component.id, selectorId: row.selectorId }
    );
  }
  if (value === "") return;
  if (row.type !== "textInput" && row.type !== "utilization") return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new InputValidationError({
      serviceCode: component.mappingDefinitionName,
      componentId: component.id,
      label: row.label,
      problem: `"${value}" is not a number`,
      value,
    });
  }
  if (validations.allowDecimals === false && !Number.isInteger(numeric)) {
    throw new InputValidationError({
      serviceCode: component.mappingDefinitionName,
      componentId: component.id,
      label: row.label,
      problem: "decimals are not allowed",
      value,
    });
  }
  if (typeof validations.minValue === "number" && numeric < validations.minValue) {
    throw new InputValidationError({
      serviceCode: component.mappingDefinitionName,
      componentId: component.id,
      label: row.label,
      problem: `must be at least ${validations.minValue}`,
      value,
    });
  }
  if (typeof validations.maxValue === "number" && numeric > validations.maxValue) {
    throw new InputValidationError({
      serviceCode: component.mappingDefinitionName,
      componentId: component.id,
      label: row.label,
      problem: `must be at most ${validations.maxValue}`,
      value,
    });
  }
}

const HOURS_IN_MONTH = 730;

export function primarySelectorOf(component: ColumnFormComponent): string {
  const primaryKey = component.primaryKey;
  if (typeof primaryKey === "string") return primaryKey;
  const first = Object.keys(primaryKey)[0];
  if (!first) {
    throw new EngineError(
      `columnFormIPM "${component.id}" has an empty primaryKey`,
      "BAD_DEFINITION",
      { componentId: component.id }
    );
  }
  return first;
}

function assertSupported(component: ColumnFormComponent): void {
  const rejected: Array<[string, unknown]> = [
    ["disableCalculation", component.disableCalculation],
    ["subComponentsList", component.subComponentsList],
    ["additionalPricingData", component.additionalPricingData],
    ["remap.constant", component.remap?.constant],
  ];
  for (const [name, value] of rejected) {
    if (value !== undefined && value !== null && value !== false) {
      throw new EngineError(
        `columnFormIPM "${component.id}" uses ${name}, which is not implemented yet`,
        "UNSUPPORTED_INPUT",
        { componentId: component.id, feature: name }
      );
    }
  }
  if (component.row.some((row) => row.dependent !== undefined)) {
    throw new EngineError(
      `columnFormIPM "${component.id}" has dependent selectors, which are not implemented yet`,
      "UNSUPPORTED_INPUT",
      { componentId: component.id, feature: "dependent" }
    );
  }
  if (component.row.some((row) => row.exportTagsAsValue !== undefined)) {
    throw new EngineError(
      `columnFormIPM "${component.id}" exports selector tags, which are not implemented yet`,
      "UNSUPPORTED_INPUT",
      { componentId: component.id, feature: "exportTagsAsValue" }
    );
  }
  for (const row of component.row) {
    if (!["textInput", "autoSuggest", "dropDown"].includes(row.type)) {
      throw new EngineError(
        `columnFormIPM "${component.id}" has a "${row.type}" row, which is not implemented yet`,
        "UNSUPPORTED_INPUT",
        { componentId: component.id, rowType: row.type, selectorId: row.selectorId }
      );
    }
  }
}

export interface ColumnFormResult {
  monthly: number;
  saved: { value: Array<Record<string, { value: string }>> };
  configSummary: string;
  /** Values other components reference (`calculationId` targets and exports). */
  extraValues: Record<string, number | string>;
}

/** Price a column form from prefetched PLC_2.0 data. */
export function evaluateColumnForm(
  component: ColumnFormComponent,
  data: ColumnFormPricingData,
  raw: unknown
): ColumnFormResult {
  assertSupported(component);
  const { values, provided } = columnFormSelectorValues(component, raw);
  for (const row of component.row) {
    if (provided.has(row.selectorId)) assertValid(component, row, values[row.selectorId] ?? "");
  }

  const primary = primarySelectorOf(component);
  const secondary = component.secondaryKey ?? [];
  const remap = component.remap?.keyValue ?? {};
  const matchValues: string[] = [];
  for (const selector of [primary, ...secondary]) {
    const selected = values[selector];
    if (selected === undefined || selected === "") {
      throw new EngineError(
        `columnFormIPM "${component.id}" needs a value for selector "${selector}"`,
        "MISSING_INPUT",
        { componentId: component.id, selectorId: selector }
      );
    }
    matchValues.push(remap[selected] ?? selected);
  }

  // The live engine matches every selected primary/secondary value against the
  // price-set labels by substring.
  const meters = data.setMeters.filter((meter) =>
    matchValues.every((value) => meter.includes(value))
  );
  if (meters.length === 0) {
    throw new EngineError(
      `no PLC_2.0 price set matches ${matchValues.join(" / ")} in ` +
        `${Object.keys(data.regionPrices).length ? "the selected region" : "this region"}`,
      "MISSING_PRICE",
      { componentId: component.id, matchValues, meters: data.setMeters }
    );
  }
  if (meters.length > 1) {
    throw new EngineError(
      `PLC_2.0 price set match is ambiguous for ${matchValues.join(" / ")}: ` +
        meters.join(", "),
      "AMBIGUOUS_SELECTION",
      { componentId: component.id, matchValues, meters }
    );
  }
  const record = data.regionPrices[meters[0]!];
  if (!record) {
    throw new EngineError(
      `PLC_2.0 price record "${meters[0]}" is missing for ` +
        `${data.manifest.serviceId}`,
      "MISSING_PRICE",
      { componentId: component.id, meter: meters[0] }
    );
  }

  const pricingTypes = component.pricingUnitModel?.riPricingTypes ?? { hourly: "*" };
  const prices: Record<string, number> = {};
  for (const [type, pattern] of Object.entries(pricingTypes)) {
    if (Array.isArray(pattern)) {
      throw new EngineError(
        `columnFormIPM "${component.id}" uses tiered PLC_2.0 pricing (${type}), ` +
          `which is not implemented yet`,
        "UNSUPPORTED_INPUT",
        { componentId: component.id, pricingType: type }
      );
    }
    const rawPrice = (record as unknown as Record<string, unknown>)[type];
    const price = rawPrice === undefined ? Number(record.price) : Number(rawPrice);
    if (!Number.isFinite(price)) {
      throw new EngineError(
        `PLC_2.0 price record "${meters[0]}" has no numeric "${type}" price`,
        "BAD_PRICE",
        { componentId: component.id, meter: meters[0], pricingType: type }
      );
    }
    prices[type] = price;
  }

  const countRow = component.row.find((row) => row.exportValueAs === "count");
  const count = countRow ? Number(values[countRow.selectorId]) : 1;
  if (!Number.isFinite(count) || count < 0) {
    throw new EngineError(
      `columnFormIPM "${component.id}" needs a numeric count`,
      "MISSING_INPUT",
      { componentId: component.id, countRow: countRow?.selectorId }
    );
  }

  const monthlyPrice = prices["monthly"];
  const hourlyPrice = prices["hourly"];
  const pricingModel = monthlyPrice !== undefined ? "Monthly" : "Hourly";
  let monthly: number;
  if (pricingModel === "Monthly") {
    monthly =
      (hourlyPrice ?? 0) * HOURS_IN_MONTH * count + (monthlyPrice ?? 0) * count;
  } else if (hourlyPrice !== undefined) {
    monthly = hourlyPrice * HOURS_IN_MONTH * count;
  } else {
    throw new EngineError(
      `columnFormIPM "${component.id}" has no hourly or monthly price`,
      "MISSING_PRICE",
      { componentId: component.id, meter: meters[0] }
    );
  }
  monthly = Number(monthly.toFixed(4));

  const extraValues: Record<string, number | string> = {};
  for (const [type, id] of Object.entries(component.calculationId ?? {})) {
    if (type === "monthly") extraValues[id] = monthly;
    else if (type === "hourly" && hourlyPrice !== undefined) extraValues[id] = hourlyPrice;
    else if (type === "upfront") extraValues[id] = 0;
  }
  for (const row of component.row) {
    if (!row.exportValueAs) continue;
    const value = values[row.selectorId] ?? "";
    extraValues[row.exportValueAs] = row.exportValueAs === "count" || row.type === "textInput"
      ? Number(value)
      : value;
  }

  const savedRows: Array<Record<string, { value: string }>> = [];
  const rowMap: Record<string, { value: string }> = {};
  for (const row of component.row) {
    rowMap[row.selectorId] = { value: values[row.selectorId] ?? "" };
  }
  savedRows.push(rowMap);

  return {
    monthly,
    saved: { value: savedRows },
    configSummary: columnFormSummary(values, component.row),
    extraValues,
  };
}

/** Config summary: `label (value)` per row, plus the pricing strategy block. */
export function columnFormSummary(
  values: Record<string, string>,
  rows: ColumnFormRowDefinition[]
): string {
  const strategyLabels = ["Pricing model", "Purchase option", "Term"];
  let strategyCount = 0;
  const bySelector = new Map<string, ColumnFormRowDefinition>();
  for (const row of rows) {
    bySelector.set(row.selectorId, row);
    if (strategyLabels.includes(row.label)) strategyCount += 1;
  }
  const completeStrategy = strategyCount === strategyLabels.length;
  const strategy: string[] = [];
  const parts: string[] = [];
  for (const [selectorId, value] of Object.entries(values)) {
    const definition = bySelector.get(selectorId);
    const label = definition?.label ?? selectorId;
    const display = definition?.displayInConfigSummary;
    const shown = display === false ? false : true;
    if (!completeStrategy || !strategyLabels.includes(label)) {
      if (shown) parts.push(`${label} (${value})`);
      continue;
    }
    strategy.push(value);
  }
  const text = parts.join(", ");
  return strategy.length > 0
    ? `${text}, Pricing strategy (${strategy.join(" ")})`
    : text;
}
