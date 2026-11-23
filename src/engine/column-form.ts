/**
 * `columnFormIPM` inputs (repeatable instance/storage rows driven by PLC_2.0
 * data).
 *
 * Supported shape: one row set per component, selector rows of type
 * `textInput`, `autoSuggest`, or `dropDown`, an optional non-selector
 * `utilization` row, a single price set, selector price patterns for
 * reserved/upfront records, and `disableCalculation` raw-price mode. Still
 * fail-closed: repeatable rows, dependent-selector filtering,
 * `additionalPricingData` joins (for example Database Savings Plans),
 * `exportTagsAsValue`, constant/regex remaps, sub-components, multiple price
 * sets, and upfront totals.
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
    riPricingTypes?: Record<string, unknown>;
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
  const selectableRows = component.row.filter(
    (row) =>
      row.selectorId !== undefined &&
      row.selectorId !== "" &&
      !(row.type === "utilization" && (row.selectorId === undefined || row.selectorId === ""))
  );
  const known = new Set(selectableRows.map((row) => row.selectorId));
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
  for (const row of selectableRows) {
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
    ["subComponentsList", component.subComponentsList],
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
  for (const row of component.row) {
    // The utilization row has no selector id; the live form always bills it at
    // 100% for these templates, so it does not take part in pricing selectors.
    if (row.type === "utilization" && (row.selectorId === undefined || row.selectorId === "")) {
      continue;
    }
    if (!["textInput", "autoSuggest", "dropDown"].includes(row.type)) {
      throw new EngineError(
        `columnFormIPM "${component.id}" has a "${row.type}" row, which is not implemented yet`,
        "UNSUPPORTED_INPUT",
        { componentId: component.id, rowType: row.type, selectorId: row.selectorId }
      );
    }
  }
}

/**
 * Extract a price from a PLC_2.0 record using the pricing unit model patterns.
 * `$overridePriceKeyWith` names the record field that holds the price.
 */
function priceForPatterns(
  patterns: unknown[],
  record: Record<string, unknown>
): number | undefined {
  for (const raw of patterns) {
    if (!raw || typeof raw !== "object") continue;
    const pattern = raw as Record<string, unknown>;
    let priceKey = "price";
    let matches = true;
    for (const [key, expected] of Object.entries(pattern)) {
      if (key.startsWith("$")) {
        if (key === "$overridePriceKeyWith") priceKey = String(expected);
        continue;
      }
      if (record[key] !== expected) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const value = Number(record[priceKey]);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
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
  const selectableRows = component.row.filter(
    (row) =>
      row.selectorId !== undefined &&
      row.selectorId !== "" &&
      !(row.type === "utilization" && (row.selectorId === undefined || row.selectorId === ""))
  );
  for (const row of component.row) {
    if (row.selectorId === undefined || row.selectorId === "") continue;
    if (provided.has(row.selectorId)) assertValid(component, row, values[row.selectorId] ?? "");
  }

  const primary = primarySelectorOf(component);
  const secondary = component.secondaryKey ?? [];
  const remap = component.remap?.keyValue ?? {};
  const primaryValue = values[primary];
  if (primaryValue === undefined || primaryValue === "") {
    throw new EngineError(
      `columnFormIPM "${component.id}" needs a value for selector "${primary}"`,
      "MISSING_INPUT",
      { componentId: component.id, selectorId: primary }
    );
  }
  // Secondary selectors that are hidden for the current choice are absent from
  // the live component tree, so only non-empty values take part in matching.
  const matchValues: string[] = [remap[primaryValue] ?? primaryValue];
  for (const selector of secondary) {
    const selected = values[selector];
    if (selected === undefined || selected === "") continue;
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

  const valuesForPatterns = { ...values, ...data.selectors };
  if (valuesForPatterns["TermType"] === "Database Savings Plans") {
    throw new EngineError(
      `columnFormIPM "${component.id}" needs Database Savings Plans pricing, ` +
        `which is not implemented yet`,
      "UNSUPPORTED_INPUT",
      { componentId: component.id, feature: "Database Savings Plans" }
    );
  }
  const pricingTypes = component.pricingUnitModel?.riPricingTypes ?? { hourly: "*" };
  const prices: Record<string, number> = {};
  let matchedTypes = 0;
  const recordFields = record as unknown as Record<string, unknown>;
  for (const [type, patterns] of Object.entries(pricingTypes)) {
    if (!Array.isArray(patterns)) {
      const rawPrice = recordFields[type];
      const price = rawPrice === undefined ? Number(record.price) : Number(rawPrice);
      if (!Number.isFinite(price)) {
        throw new EngineError(
          `PLC_2.0 price record "${meters[0]}" has no numeric "${type}" price`,
          "BAD_PRICE",
          { componentId: component.id, meter: meters[0], pricingType: type }
        );
      }
      prices[type] = price;
      matchedTypes += 1;
      continue;
    }
    // The live engine picks the first selector pattern that matches the price
    // record and reads the pattern's price field (default "price"). Types with
    // no matching pattern (for example upfront on an On-Demand row) stay 0.
    const price = priceForPatterns(patterns, recordFields);
    if (price === undefined) {
      prices[type] = 0;
      continue;
    }
    prices[type] = price;
    matchedTypes += 1;
  }
  if (matchedTypes === 0) {
    throw new EngineError(
      `no PLC_2.0 pricing pattern matches the selected configuration for ` +
        `"${component.id}"`,
      "MISSING_PRICE",
      { componentId: component.id, selected: valuesForPatterns }
    );
  }

  const extraValues: Record<string, number | string> = {};
  if (component.disableCalculation) {
    // The live form computes no subtotal here; it exposes the raw pricing
    // types (for example an hourly rate) for the surrounding maths.
    for (const [type, id] of Object.entries(component.calculationId ?? {})) {
      if (prices[type] !== undefined) extraValues[id] = prices[type];
    }
    for (const row of selectableRows) {
      if (!row.exportValueAs) continue;
      const value = values[row.selectorId] ?? "";
      if (value === "") continue;
      extraValues[row.exportValueAs] = row.exportValueAs === "count" || row.type === "textInput"
        ? Number(value)
        : value;
    }
    const savedRows: Array<Record<string, { value: string }>> = [];
    const rowMap: Record<string, { value: string }> = {};
    for (const row of selectableRows) {
      const value = values[row.selectorId] ?? "";
      if (value === "") continue;
      rowMap[row.selectorId] = { value };
    }
    savedRows.push(rowMap);
    return {
      monthly: 0,
      saved: { value: savedRows },
      configSummary: columnFormSummary(values, component.row),
      extraValues,
    };
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

  const utilizationRow = component.row.find((row) => row.type === "utilization");
  if (utilizationRow?.exportValueAs) extraValues[utilizationRow.exportValueAs] = HOURS_IN_MONTH;
  for (const [type, id] of Object.entries(component.calculationId ?? {})) {
    if (type === "monthly") extraValues[id] = monthly;
    else if (type === "hourly" && hourlyPrice !== undefined) extraValues[id] = hourlyPrice;
    else if (type === "upfront") extraValues[id] = 0;
  }
  for (const row of selectableRows) {
    if (!row.exportValueAs) continue;
    const value = values[row.selectorId] ?? "";
    if (value === "") continue;
    extraValues[row.exportValueAs] = row.exportValueAs === "count" || row.type === "textInput"
      ? Number(value)
      : value;
  }

  // Hidden selectors are absent from the live component tree and therefore
  // from its saved rows and summary.
  const savedRows: Array<Record<string, { value: string }>> = [];
  const rowMap: Record<string, { value: string }> = {};
  for (const row of selectableRows) {
    const value = values[row.selectorId] ?? "";
    if (value === "") continue;
    rowMap[row.selectorId] = { value };
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
    if (value === "") continue;
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
