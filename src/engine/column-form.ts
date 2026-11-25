/**
 * `columnFormIPM` inputs (one row per component, driven by PLC_2.0 data).
 *
 * Supported shape: selector rows of type `textInput`, `autoSuggest`,
 * `dropDown`, or `utilization`; dependent selectors (`row.dependent`); a single
 * price set; selector price patterns for reserved/upfront records;
 * `remap.keyValue`; `remap.constant`; `disableCalculation` raw-price mode; and
 * `additionalPricingData` joins, which add a joined cargo item's selector
 * options (the Database Savings Plans pricing model) and, when its aggregation
 * row is the one selected, price from that item's own manifest and index. Still
 * fail-closed: `subComponentsList`, tiered PLC_2.0 patterns,
 * `exportTagsAsValue`, and multiple price sets.
 *
 * A `utilization` row is not a plain selector: its saved value is an object
 * `{unit, selectedId}` (the live `L` component and the `q.a` hours helper in
 * `analysis/bundle.js`), which supplies the hours a month the `Hourly` and
 * `Monthly` price models multiply by. Used with a `selectorId` it is also a
 * pricing selector, and its `selectedId` is the value the price tree shows
 * (WorkSpaces `remap.keyValue` turns the aggregation's `AlwaysOn`/`AutoStop`
 * into the row's `Monthly`/`Hourly`). See `analysis/FINDINGS.md` section 17.
 *
 * A component holds exactly one row, which is what the live calculator does: its
 * save format is an array but both rehydration paths take `value[0]`, and the
 * live form adds a second configuration as a second service. More than one row
 * fails closed instead of publishing a number the live editor cannot reproduce
 * (analysis/FINDINGS.md section 13).
 *
 * Dependent selectors, defaults, and save format are reproduced from the live
 * `columnFormIPM` module (analysis/FINDINGS.md section 14). In short: each
 * selector's option set is built from the aggregation rows for the selected
 * primary value, or from the regional price records when the mapping does not
 * carry the selector; a selector whose row declares `dependent` is nested under
 * that parent's value and is only offered the values reachable from the parent
 * that is currently selected. A value that is not offered is replaced by the
 * row's `defaultValue` when that is offered, otherwise by the first offered
 * value; a selector with no offered value at all is dropped from the saved row.
 *
 * `remap.constant` pins a selector that has no row: the data layer keeps only
 * the aggregation rows whose value matches (or is absent) and writes the
 * constant into every row and price record, exactly like live `b` (bundle
 * offset 1227218). The pinned selector is a normal selector value from then on,
 * but it never contributes a price-set fragment, because live `y` drops a
 * fragment equal to a constant value (offset 1469061).
 *
 * Save format matches the live converter: `{value: [{selectorId: {value}}]}`,
 * where a `utilization` row's inner value is `{unit, selectedId}` rather than a
 * string.
 */
import { Decimal } from "decimal.js";
import { EngineError, InputValidationError } from "./errors.ts";
import type {
  ColumnFormPricingData,
  Plc2Aggregation,
} from "../data/column-form.ts";
import type { Component } from "../data/definitions.ts";

export interface ColumnFormRowDefinition {
  type: string;
  label: string;
  selectorId: string;
  defaultValue?: unknown;
  exportValueAs?: string;
  exportTagsAsValue?: unknown;
  mappingValue?: Record<string, string>;
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
    riPaymentOptions?: Record<string, string | string[]>;
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
      // The live column form holds exactly one row. Its save converter writes
      // an array, and both of its rehydration paths read `value[0]`, keeping
      // only the first row (analysis/FINDINGS.md section 13). The live UI
      // represents a second configuration as a second service, not as a
      // second row, so publishing extra rows would produce a number the live
      // editor cannot reproduce. Fail closed and say what does work.
      throw new EngineError(
        `columnFormIPM takes exactly one row; the live calculator prices ` +
          `only the first saved row and the live form adds a second ` +
          `configuration as a separate service. Got ${raw.length} rows.`,
        "UNSUPPORTED_INPUT",
        { rows: raw.length, evidence: "analysis/FINDINGS.md section 13" }
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
  /** `utilization` rows keep their live value object beside the selector id. */
  utilization: Record<string, ColumnFormUtilization>;
}

/**
 * A `utilization` row's live value: the number the user typed plus the unit
 * label the dropdown shows (live `L.createOptions` and `q.a` in
 * `analysis/bundle.js`).
 */
export interface ColumnFormUtilization {
  unit: string;
  selectedId: string;
}

/** Rows that carry a selector id and therefore take part in pricing. */
export function selectableRows(
  component: ColumnFormComponent
): ColumnFormRowDefinition[] {
  return component.row.filter(
    (row) => row.selectorId !== undefined && row.selectorId !== ""
  );
}

/** Row selector values from defaults plus user overrides (no pricing yet). */
export function columnFormSelectorValues(
  component: ColumnFormComponent,
  raw: unknown
): ColumnFormRowValues {
  const overrides = rowValueMap(raw);
  const rows = selectableRows(component);
  const known = new Set(rows.map((row) => row.selectorId));
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
  const utilization: Record<string, ColumnFormUtilization> = {};
  for (const row of rows) {
    if (row.type === "utilization") {
      const override = overrides[row.selectorId];
      const fallback = utilizationOf(row.defaultValue) ?? {
        ...COLUMN_FORM_UTILIZATION_DEFAULT,
      };
      const value = override === undefined ? fallback : utilizationOf(override, fallback);
      if (!value) {
        throw new EngineError(
          `columnFormIPM "${component.id}" needs "${row.selectorId}" as ` +
            `{unit, selectedId} (for example {"unit": "100", "selectedId": ` +
            `"%Utilized/Month"}) or a bare number for the unit`,
          "INVALID_SPEC",
          { componentId: component.id, selectorId: row.selectorId, value: override }
        );
      }
      if (override !== undefined) provided.add(row.selectorId);
      values[row.selectorId] = value.selectedId;
      utilization[row.selectorId] = value;
      continue;
    }
    const override = overrides[row.selectorId];
    if (override !== undefined) {
      values[row.selectorId] = scalarOf(override);
      provided.add(row.selectorId);
      continue;
    }
    const fallback = row.defaultValue;
    if (fallback === undefined || fallback === null) {
      // Live `getInitialValue` falls back to the component type's default when
      // the row declares none, and `componentType.textInput.defaultValue` is
      // "1" (bundle offset 2877758). A blank text input therefore holds 1 - the
      // live Mainframe and Directory Service forms show it - while a dropdown
      // with no default stays empty until the option tree resolves it.
      values[row.selectorId] = row.type === "textInput" ? "1" : "";
      continue;
    }
    values[row.selectorId] = scalarOf(fallback);
  }
  // A constant is a selector whose value only the definition can supply. Live
  // writes it into every aggregation row and price record and never offers a
  // form row for it, so it is not a user-supplied value here either.
  for (const [selectorId, constant] of Object.entries(component.remap?.constant ?? {})) {
    const supplied = provided.has(selectorId) ? values[selectorId] : undefined;
    if (supplied !== undefined && supplied !== constant) {
      throw new EngineError(
        `columnFormIPM "${component.id}" pins "${selectorId}" to ` +
          `"${constant}" with remap.constant, so it cannot be "${supplied}"`,
        "INVALID_SELECTION",
        { componentId: component.id, selectorId, value: supplied, constant }
      );
    }
    values[selectorId] = constant;
  }
  return { values, provided, utilization };
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

/**
 * The four duration labels a `utilization` row offers when it is not also a
 * pricing selector (live `P` in `analysis/bundle.js`, offset 2870678).
 */
export const COLUMN_FORM_UTILIZATION_OPTIONS = [
  "%Utilized/Month",
  "Hours/Day",
  "Hours/Week",
  "Hours/Month",
] as const;

/**
 * The unit a duration gets when the live form has to (re)select it (live `D`,
 * offset 2870901). `Monthly` and `Hourly` are the WorkSpaces billing option.
 */
export const COLUMN_FORM_UTILIZATION_UNITS: Record<string, string> = {
  "%Utilized/Month": "100",
  "Hours/Day": "24",
  "Hours/Week": "168",
  "Hours/Month": "730",
  Hourly: "160",
  Monthly: "730",
};

/** Live `L.defaultProps.initialValue` and the component default value. */
export const COLUMN_FORM_UTILIZATION_DEFAULT: ColumnFormUtilization = {
  unit: "100",
  selectedId: "%Utilized/Month",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read a `utilization` row value from the live save shape
 * (`{value: {unit, selectedId}}`), the bare object, or a scalar unit.
 * `fallback.selectedId` fills in the duration when only a unit is given.
 */
export function utilizationOf(
  raw: unknown,
  fallback: ColumnFormUtilization = COLUMN_FORM_UTILIZATION_DEFAULT
): ColumnFormUtilization | undefined {
  let candidate = raw;
  const wrapper = asRecord(candidate);
  if (wrapper && !("unit" in wrapper) && "value" in wrapper) candidate = wrapper["value"];
  const record = asRecord(candidate);
  if (record && "unit" in record) {
    const unit = record["unit"];
    if (unit === undefined || unit === null || unit === "") return undefined;
    const selectedId = record["selectedId"];
    return {
      unit: String(unit),
      selectedId:
        typeof selectedId === "string" && selectedId !== ""
          ? selectedId
          : fallback.selectedId,
    };
  }
  if (typeof candidate === "string" || typeof candidate === "number") {
    const unit = String(candidate).trim();
    if (unit === "") return undefined;
    return { unit, selectedId: fallback.selectedId };
  }
  return undefined;
}

/**
 * Live `q.a` (offset 1271617): the hours in a month a `utilization` value
 * stands for. Unlike the `utilization` input subtype this helper does not
 * round, and a value it does not recognise (such as `Monthly`) means a full
 * 730-hour month.
 */
export function columnFormUtilizationHours(value: ColumnFormUtilization | undefined): number {
  if (!value || value.unit === "" || value.selectedId === "") return HOURS_IN_MONTH;
  const unit = Number(value.unit);
  if (!Number.isFinite(unit)) return HOURS_IN_MONTH;
  switch (value.selectedId) {
    case "%Utilized/Month":
      return (unit / 100) * HOURS_IN_MONTH;
    case "Hours/Day":
      return (unit / 24) * HOURS_IN_MONTH;
    case "Hours/Week":
      return (unit / 168) * HOURS_IN_MONTH;
    case "Hours/Month":
    case "Hourly":
      return unit;
    default:
      return HOURS_IN_MONTH;
  }
}

/**
 * Live `L.validateChange`: the typed unit must be a whole number in
 * `1..max`, where `max` depends on the selected duration.
 */
function assertUtilizationValid(
  component: ColumnFormComponent,
  row: ColumnFormRowDefinition,
  value: ColumnFormUtilization
): void {
  const unit = Number(value.unit);
  if (!Number.isFinite(unit)) {
    throw new InputValidationError({
      serviceCode: component.mappingDefinitionName,
      componentId: component.id,
      label: row.label,
      problem: `"${value.unit}" is not a number`,
      value: value.unit,
    });
  }
  const max = Number(COLUMN_FORM_UTILIZATION_UNITS[value.selectedId] ?? HOURS_IN_MONTH);
  if (!Number.isInteger(unit)) {
    throw new InputValidationError({
      serviceCode: component.mappingDefinitionName,
      componentId: component.id,
      label: row.label,
      problem: "decimals are not allowed",
      value: value.unit,
    });
  }
  if (unit < 1 || unit > max) {
    throw new InputValidationError({
      serviceCode: component.mappingDefinitionName,
      componentId: component.id,
      label: row.label,
      problem: `must be between 1 and ${max} for ${value.selectedId}`,
      value: value.unit,
    });
  }
}

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
  if (component.subComponentsList !== undefined && component.subComponentsList !== null) {
    throw new EngineError(
      `columnFormIPM "${component.id}" uses subComponentsList, which is not implemented yet`,
      "UNSUPPORTED_INPUT",
      { componentId: component.id, feature: "subComponentsList" }
    );
  }
  for (const row of component.row) {
    // A `utilization` row is native: with a selector id it is resolved through
    // the same option tree as the other rows and its `selectedId` takes part in
    // price matching; its `{unit, selectedId}` value supplies the hours the
    // Hourly/Monthly models multiply by.
    if (!["textInput", "autoSuggest", "dropDown", "utilization"].includes(row.type)) {
      throw new EngineError(
        `columnFormIPM "${component.id}" has a "${row.type}" row, which is not implemented yet`,
        "UNSUPPORTED_INPUT",
        { componentId: component.id, rowType: row.type, selectorId: row.selectorId }
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Selector option tree (live `h`, `d`, and `p` in analysis/bundle.js)
// ---------------------------------------------------------------------------

/**
 * Options offered for one selector. Mirrors the live component tree: a nested
 * map whose leaves are `null`. A selector that declares `dependent` is keyed by
 * its parent's value first, so only the options reachable from the selected
 * parent are visible.
 */
export type SelectorOptions = null | { [value: string]: SelectorOptions };

export interface ColumnFormSelectorTree {
  /** selectorId -> parent selector ids, in declaration order. */
  dependents: Record<string, string[]>;
  /** selectorId -> option tree; absent or empty means "not offered". */
  options: Record<string, SelectorOptions>;
  /**
   * Every value the primary selector offers, built from the same rows without
   * narrowing by the primary itself (live `d(primaryKey.value, row, primary)`).
   * Absent for a composite `primaryKey`, whose value comes from the row state.
   */
  primaryOptions?: SelectorOptions;
}

function dependentChain(
  dependents: Record<string, string[]>,
  selectorId: string
): string[] {
  return dependents[selectorId] ?? [];
}

function insertOption(
  root: Record<string, SelectorOptions>,
  path: string[],
  value: string
): void {
  let node = root;
  for (const key of path) {
    const next = node[key];
    if (typeof next === "object" && next !== null) {
      node = next;
      continue;
    }
    const created: Record<string, SelectorOptions> = {};
    node[key] = created;
    node = created;
  }
  node[value] = node[value] ?? null;
}

function sortOptions(node: SelectorOptions): SelectorOptions {
  if (typeof node !== "object" || node === null) return node;
  const sorted: Record<string, SelectorOptions> = {};
  for (const key of Object.keys(node).sort()) sorted[key] = node[key] ?? null;
  return sorted;
}

/**
 * Build the selector option tree the live form renders.
 *
 * Aggregation-backed selectors take their values from the aggregation rows for
 * the selected primary value. Selectors the mapping does not carry (`!==` in
 * the aggregation row) are rebuilt from the regional price records instead -
 * the live `if (0 !== u.length)` branch - which is how `Term` and
 * `Purchase option` appear only for Reserved price records. Those record-backed
 * selectors have their top-level keys sorted ascending, matching live `p`.
 */
export function buildColumnFormSelectorTree(
  component: ColumnFormComponent,
  aggregations: Plc2Aggregation[],
  records: Record<string, Record<string, unknown>>,
  selectors: Record<string, string>
): ColumnFormSelectorTree {
  const primary = primarySelectorOf(component);
  const secondary = component.secondaryKey ?? [];
  const dependents: Record<string, string[]> = {};
  for (const row of component.row) {
    if (!row.selectorId || !row.dependent) continue;
    dependents[row.selectorId] = Array.isArray(row.dependent)
      ? row.dependent.map(String)
      : [String(row.dependent)];
  }

  const options: Record<string, SelectorOptions> = {};
  const roots: Record<string, Record<string, SelectorOptions>> = {};
  const primaryRoot: Record<string, SelectorOptions> = {};
  const missing = new Set<string>();
  for (const selectorId of secondary) {
    roots[selectorId] = {};
    options[selectorId] = roots[selectorId];
  }

  for (const aggregation of aggregations) {
    // The live engine fetches a per-region aggregation file, so only this
    // region's rows take part in the option tree.
    if (
      selectors["Location"] !== undefined &&
      aggregation.selectors["Location"] !== selectors["Location"]
    ) {
      continue;
    }
    // The primary's own options come from every row of the region: live builds
    // `primaryKey.value` before it narrows anything, which is what makes a
    // remapped default resolve to the label the form shows.
    const primaryValue = aggregation.selectors[primary];
    if (typeof component.primaryKey === "string" && primaryValue) {
      insertOption(primaryRoot, [], primaryValue);
    }
    if (aggregation.selectors[primary] !== selectors[primary]) continue;
    for (const selectorId of secondary) {
      if (!(selectorId in aggregation.selectors)) {
        missing.add(selectorId);
        continue;
      }
      const value = aggregation.selectors[selectorId];
      if (!value) continue;
      const path = dependentChain(dependents, selectorId).map(
        (parent) => aggregation.selectors[parent] ?? ""
      );
      insertOption(roots[selectorId]!, path, value);
    }
  }

  const recordEntries = Object.values(records) as Array<Record<string, unknown>>;
  for (const selectorId of missing) {
    const root: Record<string, SelectorOptions> = {};
    for (const record of recordEntries) {
      const value = record[selectorId];
      if (typeof value !== "string" || value === "") continue;
      const path = dependentChain(dependents, selectorId).map((parent) => {
        const parentValue = record[parent];
        return typeof parentValue === "string" ? parentValue : "";
      });
      insertOption(root, path, value);
    }
    options[selectorId] = sortOptions(root);
  }

  return {
    dependents,
    options,
    ...(typeof component.primaryKey === "string" ? { primaryOptions: primaryRoot } : {}),
  };
}

/**
 * Narrow a selector's option tree by the parent values that are selected.
 * Returns `undefined` when the tree does not contain that path, mirroring the
 * live `getValue` `delete` branch.
 */
function narrowOptions(
  tree: SelectorOptions,
  parents: string[],
  values: Record<string, string>
): SelectorOptions | undefined {
  if (tree === null) return null;
  let node: SelectorOptions = tree;
  for (const parent of parents) {
    const parentValue = values[parent];
    if (parentValue === undefined || parentValue === "") return undefined;
    if (typeof node !== "object" || node === null) return undefined;
    const next: SelectorOptions | undefined = node[parentValue];
    if (next === undefined) return undefined;
    node = next;
  }
  return node;
}

function optionKeys(node: SelectorOptions): string[] {
  if (typeof node !== "object" || node === null) return [];
  return Object.keys(node);
}

/** Live `v`: follow the first key all the way down and return the last one. */
function deepestFirstKey(node: SelectorOptions): string | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const keys = Object.keys(node);
  if (keys.length === 0) return undefined;
  let key = keys[0]!;
  let value = node[key];
  while (typeof value === "object" && value !== null) {
    const nextKeys = Object.keys(value);
    if (nextKeys.length === 0) break;
    key = nextKeys[0]!;
    value = value[key];
  }
  return key;
}

/**
 * Live `b`: walk the option tree by the given path and return the last path
 * element, falling back to the first key at the level where the path breaks.
 */
function descendOptions(node: SelectorOptions, path: string[]): string | undefined {
  let current: SelectorOptions = node;
  for (let index = 0; index < path.length; index += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const keys = Object.keys(current);
    if (keys.length === 0) return undefined;
    const wanted = path[index]!;
    if (!keys.includes(wanted)) return keys[0];
    if (index === path.length - 1) return wanted;
    current = current[wanted] ?? null;
  }
  return deepestFirstKey(node);
}

// ---------------------------------------------------------------------------
// Selector resolution (live `getValue` and `getInitialValue`)
// ---------------------------------------------------------------------------

export interface ResolvedColumnFormSelectors {
  /** Resolved selector values. Dropped selectors are absent. */
  values: Record<string, string>;
  /** Selectors the live form would not render for this configuration. */
  dropped: string[];
  /** Resolved `{unit, selectedId}` for every rendered utilization row. */
  utilization: Record<string, ColumnFormUtilization>;
  tree?: ColumnFormSelectorTree;
}

/**
 * Resolve the selector state the live form would hold for these inputs.
 *
 * Rows are visited in definition order, and each row sees the parent values
 * already resolved in this pass - the live `createRows` loop mutates its value
 * map in place. A value the parent no longer offers is replaced by the row's
 * `defaultValue` when that is offered, otherwise by the first offered option.
 * A user-supplied value that is not offered fails closed instead of being
 * silently rewritten, so a typo never publishes a different configuration.
 */
export function resolveColumnFormSelectors(
  component: ColumnFormComponent,
  raw: unknown,
  data: ColumnFormPricingData
): ResolvedColumnFormSelectors {
  const {
    values: initial,
    provided,
    utilization: initialUtilization,
  } = columnFormSelectorValues(component, raw);
  const utilization: Record<string, ColumnFormUtilization> = { ...initialUtilization };
  const aggregations = data.aggregations ?? [];
  if (aggregations.length === 0) {
    // Hand-built pricing data (unit fixtures) carries no aggregation rows, so
    // there is no option tree to resolve against. Take the values as given.
    return { values: initial, dropped: [], utilization };
  }
  const primary = primarySelectorOf(component);
  // Live resolves the primary selector through its own option tree before it
  // narrows anything (bundle offset 1467544: `primaryKey.value` is built from
  // every row, then `y` takes the selected value or the deepest first key). A
  // declared default that is a `remap.keyValue` key - a price token - is not an
  // offered value, so the form lands on the label the aggregation rows carry.
  const primaryValue = resolvePrimaryValue(component, initial, provided, data);
  const bindings: Record<string, string> = { ...data.selectors, [primary]: primaryValue };
  const tree = buildColumnFormSelectorTree(
    component,
    aggregations,
    data.regionPrices as unknown as Record<string, Record<string, unknown>>,
    bindings
  );
  const resolved: Record<string, string> = { [primary]: primaryValue };
  const dropped: string[] = [];
  for (const row of selectableRows(component)) {
    const selectorId = row.selectorId;
    const current = initial[selectorId] ?? "";
    const isUtilization = row.type === "utilization";
    if (selectorId === primary) {
      resolved[selectorId] = primaryValue;
      continue;
    }
    let offered: string[];
    if (!(selectorId in tree.options)) {
      if (!isUtilization) {
        // Not a pricing selector (text inputs, the count row): keep as given.
        resolved[selectorId] = current;
        continue;
      }
      // A utilization row the price tree does not carry is the live `P` list:
      // the four durations, always offered.
      offered = [...COLUMN_FORM_UTILIZATION_OPTIONS];
    } else {
      const narrowed = narrowOptions(
        tree.options[selectorId] ?? null,
        dependentChain(tree.dependents, selectorId),
        resolved
      );
      offered = optionKeys(narrowed ?? null);
    }
    if (offered.length === 0) {
      if (provided.has(selectorId)) {
        throw new EngineError(
          `columnFormIPM "${component.id}" cannot use "${selectorId}" = ` +
            `"${current}": the live form offers no value for it in this ` +
            `configuration` +
            (dependentParents(tree, selectorId, resolved).length > 0
              ? ` (${dependentParents(tree, selectorId, resolved)
                  .map((parent) => `${parent} = "${resolved[parent] ?? ""}"`)
                  .join(", ")})`
              : ""),
          "INVALID_SELECTION",
          {
            componentId: component.id,
            selectorId,
            value: current,
            parents: dependentParents(tree, selectorId, resolved).map((parent) => ({
              selectorId: parent,
              value: resolved[parent] ?? "",
            })),
          }
        );
      }
      dropped.push(selectorId);
      delete utilization[selectorId];
      continue;
    }
    if (current !== "" && offered.includes(current)) {
      resolved[selectorId] = current;
      continue;
    }
    if (current !== "" && provided.has(selectorId)) {
      // The live form would silently re-select; an explicit value from the spec
      // is a typo or a stale value, so it fails closed with the valid options.
      throw new EngineError(
        `columnFormIPM "${component.id}" cannot use "${selectorId}" = "${current}"; ` +
          `the live form offers ${offered.map((value) => `"${value}"`).join(", ")}` +
          (dependentParents(tree, selectorId, resolved).length > 0
            ? ` for ${dependentParents(tree, selectorId, resolved)
                .map((parent) => `${parent} = "${resolved[parent] ?? ""}"`)
                .join(", ")}`
            : ""),
        "INVALID_SELECTION",
        { componentId: component.id, selectorId, value: current, offered }
      );
    }
    if (!isUtilization) {
      const fallback = row.defaultValue === undefined ? "" : scalarOf(row.defaultValue);
      if (fallback !== "" && offered.includes(fallback)) {
        resolved[selectorId] = fallback;
        continue;
      }
    }
    // The value became invalid because a parent changed. The live form
    // silently re-selects the first offered value; a user-supplied value is
    // rejected above, so this is a definition default that the parent no
    // longer allows. A utilization row also resets its unit, exactly like live
    // `L.createOptions` (`{unit: D[label], selectedId: label}`).
    const first = offered[0]!;
    resolved[selectorId] = first;
    if (isUtilization) {
      utilization[selectorId] = {
        unit: COLUMN_FORM_UTILIZATION_UNITS[first] ?? "100",
        selectedId: first,
      };
    }
  }
  return { values: resolved, dropped, utilization, tree };
}

function dependentParents(
  tree: ColumnFormSelectorTree,
  selectorId: string,
  values: Record<string, string>
): string[] {
  return dependentChain(tree.dependents, selectorId).filter(
    (parent) => values[parent] !== undefined && values[parent] !== ""
  );
}

/**
 * Resolve the primary selector the way live `getInitialValue` does: keep the
 * current value when the option tree offers it, otherwise take the row's
 * declared default when that is offered, otherwise the first offered value.
 *
 * A composite `primaryKey` (`{"Stream Class": ["VCPU", "VRAM", "RAM"]}`) keeps
 * its row value: the live tree for it is nested by the composite keys and the
 * surrounding index path supplies the rest.
 */
function resolvePrimaryValue(
  component: ColumnFormComponent,
  initial: Record<string, string>,
  provided: Set<string>,
  data: ColumnFormPricingData
): string {
  const primary = primarySelectorOf(component);
  const current = initial[primary] ?? "";
  if (typeof component.primaryKey !== "string") return current;
  const offered = optionKeys(primaryOptionTree(component, data));
  if (offered.length === 0) return current;
  if (current !== "" && offered.includes(current)) return current;
  if (current !== "" && provided.has(primary)) {
    throw new EngineError(
      `columnFormIPM "${component.id}" cannot use "${primary}" = "${current}"; ` +
        `the live form offers ${offered.map((value) => `"${value}"`).join(", ")}`,
      "INVALID_SELECTION",
      { componentId: component.id, selectorId: primary, value: current, offered }
    );
  }
  const row = component.row.find((entry) => entry.selectorId === primary);
  const fallback = row?.defaultValue === undefined ? "" : scalarOf(row.defaultValue);
  if (fallback !== "" && offered.includes(fallback)) return fallback;
  return offered[0]!;
}

/** Values the primary selector offers across this region's rows (live `primaryKey.value`). */
function primaryOptionTree(
  component: ColumnFormComponent,
  data: ColumnFormPricingData
): SelectorOptions {
  const primary = primarySelectorOf(component);
  const root: Record<string, SelectorOptions> = {};
  for (const aggregation of data.aggregations ?? []) {
    if (
      data.selectors["Location"] !== undefined &&
      aggregation.selectors["Location"] !== data.selectors["Location"]
    ) {
      continue;
    }
    const value = aggregation.selectors[primary];
    if (!value) continue;
    insertOption(root, [], value);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Price set matching (live `y`, `w`, `m`, and the `riPaymentOptions` block)
// ---------------------------------------------------------------------------

/** Live `m`: the `es`/`directconnect` comma tolerance. */
function commaTolerantMatch(label: string, fragment: string, serviceId: string): boolean {
  if (serviceId !== "es" && serviceId !== "directconnect") return false;
  const stripped = label.replace(/,+/g, "");
  try {
    if (stripped.match(fragment.replace(/,+/g, ""))) return true;
  } catch {
    return false;
  }
  if (fragment.includes(",") && !fragment.includes(", ")) {
    const spaced = fragment.replace(/,/g, ", ");
    return label.includes(spaced.replace(/,+/g, ""));
  }
  return false;
}

function fragmentMatches(label: string, fragment: string | RegExp, serviceId: string): boolean {
  try {
    if (label.match(fragment)) return true;
  } catch {
    // An invalid regular expression cannot match; fail the filter closed.
    return false;
  }
  if (typeof fragment === "string") return commaTolerantMatch(label, fragment, serviceId);
  return false;
}

/**
 * The price-set labels for the selected configuration.
 *
 * Live `y`: one fragment per selector value; a selector that declares
 * `dependent` contributes the value reached by walking its option tree with the
 * parent values; `remap.keyValue` maps a display value back to its raw key; and
 * a selected `riPaymentOptions` key adds its unit (`Hrs`/`Quantity`) as a
 * fragment so an `All Upfront` row is priced from the `Quantity` record.
 *
 * `component` covers the component's own cargo item: when an
 * `additionalPricingData` join priced the configuration, live takes the
 * `remap.keyValue` and `pricingUnitModel` from that joined item instead, so the
 * caller passes the priced item's model and remap here. A fragment that equals
 * the item's `remap.constant` for that selector is dropped, because live `y`
 * returns null for it: the joined artifact's meters spell the fixed part
 * differently (`DatabaseSavingsPlans ...`).
 */
export function columnFormMeterFragments(
  component: ColumnFormComponent,
  values: Record<string, string>,
  tree: ColumnFormSelectorTree | undefined,
  options: {
    pricingUnitModel?: ColumnFormComponent["pricingUnitModel"];
    keyValue?: Record<string, string>;
    constant?: Record<string, string>;
  } = {}
): string[] {
  const primary = primarySelectorOf(component);
  const secondary = component.secondaryKey ?? [];
  const remap = options.keyValue ?? component.remap?.keyValue ?? {};
  const constant = options.constant ?? component.remap?.constant;
  const fragments: string[] = [];
  const selectorOrder = [primary, ...secondary];
  const seen = new Set<string>();
  for (const selectorId of selectorOrder) {
    if (seen.has(selectorId)) continue;
    seen.add(selectorId);
    let fragment: string | undefined;
    const parents = tree ? dependentChain(tree.dependents, selectorId) : [];
    const parentValues =
      tree && parents.length > 0 ? parents.map((parent) => values[parent] ?? "") : [];
    if (tree && parents.length > 0 && parentValues.every((value) => value !== "")) {
      // Live walks `[dependent..., selectorId]` through the tree, so the walk
      // returns this selector's own value once the parent path is satisfied.
      const node = tree.options[selectorId];
      fragment = descendOptions(node ?? null, [...parentValues, values[selectorId] ?? ""]);
      if (fragment === undefined || fragment === "") {
        fragment = values[selectorId];
      }
    } else {
      fragment = values[selectorId];
    }
    if ((fragment === undefined || fragment === "") && tree) {
      fragment = deepestFirstKey(tree.options[selectorId] ?? null);
    }
    if (fragment === undefined || fragment === "") continue;
    // Live `y` returns null - dropping the fragment - when a selector's value
    // equals a `remap.constant` value (bundle offset 1469061). The pinned
    // selector is not rendered, so it never names a metered unit.
    if (constant && Object.values(constant).includes(fragment)) continue;
    for (const [pattern, display] of Object.entries(remap)) {
      if (display === fragment) {
        fragment = pattern;
        break;
      }
    }
    fragments.push(fragment);
  }
  const paymentOptions =
    (options.pricingUnitModel ?? component.pricingUnitModel)?.riPaymentOptions;
  if (paymentOptions) {
    for (const [option, units] of Object.entries(paymentOptions)) {
      if (!fragments.includes(option)) continue;
      // The unit is pushed as a regular expression source, exactly like live.
      fragments.push(Array.isArray(units) ? `(${units.join("|")})` : units);
      break;
    }
  }
  return fragments;
}

/** Filter `setMeters` by the selected fragments, mirroring live `y`. */
export function filterColumnFormMeters(
  setMeters: string[],
  fragments: string[],
  serviceId: string
): string[] {
  // Live `y` returns the set untouched when it holds a single metered unit.
  if (setMeters.length === 1) return setMeters;
  return setMeters.filter((label) =>
    fragments.every((fragment) => fragmentMatches(label, fragment, serviceId))
  );
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

const EXPORT_PREFIXES = ["count", "term", "purchaseOption", "utilization", "pricingModel"];

function exportValue(
  component: ColumnFormComponent,
  values: Record<string, string>,
  prefix: string
): { value: string; row?: ColumnFormRowDefinition } | undefined {
  for (const row of selectableRows(component)) {
    const name = row.exportValueAs;
    if (!name) continue;
    const match = EXPORT_PREFIXES.find((candidate) => name.startsWith(candidate));
    if (match !== prefix) continue;
    return { value: values[row.selectorId] ?? "", row };
  }
  return undefined;
}

function pricingModelOf(
  component: ColumnFormComponent,
  values: Record<string, string>,
  prices: Record<string, number>
): string {
  const exported = exportValue(component, values, "pricingModel");
  const mapped = exported?.row?.mappingValue?.[exported.value];
  if (mapped) return mapped;
  const monthly = prices["monthly"];
  return monthly !== undefined && monthly > 0 ? "Monthly" : "Hourly";
}

/**
 * Live `H`: the term in years is the leading number of the exported term
 * (`"1yr"` -> 1, `"3yr"` -> 3). Anything else is a definition error; live would
 * turn it into a negative commitment, which no receipt could reproduce.
 */
function savingsPlanTermYears(component: ColumnFormComponent, values: Record<string, string>): number {
  const term = exportValue(component, values, "term")?.value ?? "";
  if (typeof term === "number") return term;
  const years = Number(term.substring(0, 1));
  if (!Number.isFinite(years) || years <= 0) {
    throw new EngineError(
      `columnFormIPM "${component.id}" needs a "Database Savings Plans" term ` +
        `selector whose value starts with a number of years; got "${term}"`,
      "BAD_DEFINITION",
      { componentId: component.id, term }
    );
  }
  return years;
}

/** Live `a`: the upfront fraction of a purchase option. */
function upfrontFraction(purchaseOption: string): number {
  switch (purchaseOption) {
    case "NoUpfront":
    case "No Upfront":
      return 0;
    case "PartialUpfront":
    case "Partial Upfront":
      return 0.5;
    case "AllUpfront":
    case "All Upfront":
      return 1;
    default:
      return 0;
  }
}

const TOTAL_DAYS_IN_YEAR = 365;
const HOURS_IN_DAY = 24;

/**
 * Live `z` and `B.b`: the Savings Plans model. The commitment is the hourly
 * rate times every hour of the term; the upfront option pays a fraction of it
 * up front and the rest is the effective hourly rate. Live rounds the monthly
 * figure *up* to the cent (`Math.ceil(100 * total) / 100`) before the display
 * rounds two decimals, which is why a receipt has to use the same rounding.
 */
function savingsPlanCost(
  hourly: number,
  count: number,
  termYears: number,
  purchaseOption: string
): { monthly: number; upfront: number } {
  const hours = new Decimal(termYears).times(TOTAL_DAYS_IN_YEAR).times(HOURS_IN_DAY);
  const totalCommitment = new Decimal(hourly).times(hours);
  // `B.b.calculateUpfrontCost`: fraction * rate * hours, trimmed to 13 places.
  const upfrontPerUnit = new Decimal(upfrontFraction(purchaseOption))
    .times(totalCommitment)
    .toFixed(13);
  // `B.b.calculateEffectiveHourlyRate`: (commitment - upfront) / hours.
  const effectiveHourly = totalCommitment
    .minus(upfrontPerUnit)
    .dividedBy(hours)
    .toFixed(13);
  // `B.b.calculateMonthlyRate`, then `z`'s ceiling to the cent.
  const monthlyPerUnit = new Decimal(effectiveHourly).times(HOURS_IN_MONTH).toFixed(13);
  const monthlyTotal = new Decimal(monthlyPerUnit).times(count).toFixed(4);
  const monthly = new Decimal(Math.ceil(100 * Number(monthlyTotal))).dividedBy(100);
  const upfront = new Decimal(upfrontPerUnit).times(count).toFixed(4);
  return { monthly: monthly.toNumber(), upfront: Number(upfront) };
}

export interface ColumnFormResult {
  monthly: number;
  upfront: number;
  saved: {
    value: Array<Record<string, { value: string | ColumnFormUtilization }>>;
  };
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
  // User-supplied values go through the row validations before anything is
  // replaced by an offered option.
  {
    const { provided, values: initial, utilization } = columnFormSelectorValues(
      component,
      raw
    );
    for (const row of selectableRows(component)) {
      if (!provided.has(row.selectorId)) continue;
      if (row.type === "utilization") {
        assertUtilizationValid(component, row, utilization[row.selectorId]!);
        continue;
      }
      assertValid(component, row, initial[row.selectorId] ?? "");
    }
  }
  const resolved = resolveColumnFormSelectors(component, raw, data);
  const values = resolved.values;
  const primary = primarySelectorOf(component);
  const primaryValue = values[primary];
  if (primaryValue === undefined || primaryValue === "") {
    throw new EngineError(
      `columnFormIPM "${component.id}" needs a value for selector "${primary}"`,
      "MISSING_INPUT",
      { componentId: component.id, selectorId: primary }
    );
  }
  // A joined cargo item, when it priced the configuration, supplies the
  // pricing unit model and remap that live `y`/`w` read from
  // `selectedCargoItem` instead of from the component.
  const unitModel = data.pricedItem?.pricingUnitModel
    ? (data.pricedItem.pricingUnitModel as ColumnFormComponent["pricingUnitModel"])
    : component.pricingUnitModel;
  const meterKeyValue = data.pricedItem?.remap?.keyValue ?? component.remap?.keyValue;
  const meterConstant = data.pricedItem?.remap?.constant ?? component.remap?.constant;

  const fragments = columnFormMeterFragments(component, values, resolved.tree, {
    ...(unitModel ? { pricingUnitModel: unitModel } : {}),
    ...(meterKeyValue ? { keyValue: meterKeyValue } : {}),
    ...(meterConstant ? { constant: meterConstant } : {}),
  });
  const meters = filterColumnFormMeters(data.setMeters, fragments, data.manifest.serviceId);
  if (meters.length === 0) {
    throw new EngineError(
      `no PLC_2.0 price set matches ${fragments.join(" / ") || primaryValue} in ` +
        `${Object.keys(data.regionPrices).length ? "the selected region" : "this region"}`,
      "MISSING_PRICE",
      { componentId: component.id, matchValues: fragments, meters: data.setMeters }
    );
  }

  const pricingTypes = unitModel?.riPricingTypes ?? { hourly: "*" };
  const prices: Record<string, number> = {};
  const matchedTypes = new Set<string>();
  for (const [type, patterns] of Object.entries(pricingTypes)) {
    prices[type] = 0;
    if (!Array.isArray(patterns)) {
      if (patterns !== "*") {
        throw new EngineError(
          `columnFormIPM "${component.id}" has a "${type}" pricing type that is ` +
            `neither a pattern list nor "*"`,
          "BAD_DEFINITION",
          { componentId: component.id, pricingType: type }
        );
      }
      // Live throws when an asterisk pricing type is asked to price more than
      // one metered unit; we fail closed with the same information.
      if (meters.length !== 1) {
        throw new EngineError(
          `PLC_2.0 price set match is ambiguous for ${fragments.join(" / ")}: ` +
            `${meters.join(", ")}`,
          "AMBIGUOUS_SELECTION",
          { componentId: component.id, matchValues: fragments, meters }
        );
      }
      const record = data.regionPrices[meters[0]!];
      if (!record) {
        throw new EngineError(
          `PLC_2.0 price record "${meters[0]}" is missing for ${data.manifest.serviceId}`,
          "MISSING_PRICE",
          { componentId: component.id, meter: meters[0] }
        );
      }
      prices[type] = Number((record as unknown as Record<string, unknown>)["price"] as never);
      if (!Number.isFinite(prices[type])) {
        throw new EngineError(
          `PLC_2.0 price record "${meters[0]}" has no numeric price`,
          "BAD_PRICE",
          { componentId: component.id, meter: meters[0] }
        );
      }
      matchedTypes.add(type);
      continue;
    }
    if (patterns.length === 0) continue;
    // Live `w`: every matching metered unit is tried in order and the last
    // match wins, so an `All Upfront` row and a `Partial Upfront` row select
    // their own unit from the same price set.
    for (const meter of meters) {
      const record = data.regionPrices[meter];
      if (!record) {
        throw new EngineError(
          `PLC_2.0 price record "${meter}" is missing for ${data.manifest.serviceId}`,
          "MISSING_PRICE",
          { componentId: component.id, meter }
        );
      }
      const price = priceForPatterns(patterns, record as unknown as Record<string, unknown>);
      if (price === undefined) continue;
      prices[type] = price;
      matchedTypes.add(type);
    }
  }
  if (matchedTypes.size === 0) {
    throw new EngineError(
      `no PLC_2.0 pricing pattern matches the selected configuration for ` +
        `"${component.id}"`,
      "MISSING_PRICE",
      { componentId: component.id, selected: { ...values, ...data.selectors }, meters }
    );
  }

  const extraValues: Record<string, number | string> = {};
  const rows = selectableRows(component);
  const utilizationRow = component.row.find((row) => row.type === "utilization");
  // Live `te`/`q.a`: the exported hours come from the utilization row's value,
  // and a component with no utilization row prices a full 730-hour month.
  const totalHours = columnFormUtilizationHours(
    utilizationRow?.selectorId ? resolved.utilization[utilizationRow.selectorId] : undefined
  );

  if (component.disableCalculation) {
    // The live form computes no subtotal here; it exposes the raw pricing
    // types (for example an hourly rate) for the surrounding maths.
    for (const [type, id] of Object.entries(component.calculationId ?? {})) {
      if (prices[type] !== undefined) extraValues[id] = prices[type];
    }
    for (const row of rows) {
      if (!row.exportValueAs) continue;
      if (row.type === "utilization") continue;
      const value = values[row.selectorId] ?? "";
      if (value === "") continue;
      extraValues[row.exportValueAs] = row.exportValueAs.startsWith("count") || row.type === "textInput"
        ? Number(value)
        : value;
    }
    if (utilizationRow?.exportValueAs) {
      extraValues[utilizationRow.exportValueAs] = totalHours;
    }
    return {
      monthly: 0,
      upfront: 0,
      saved: { value: [savedRow(rows, values, resolved.utilization)] },
      configSummary: columnFormSummary(values, component.row, resolved.utilization),
      extraValues,
    };
  }

  const countRow = exportValue(component, values, "count");
  const count = countRow ? Number(countRow.value) : 1;
  if (!Number.isFinite(count) || count < 0) {
    throw new EngineError(
      `columnFormIPM "${component.id}" needs a numeric count`,
      "MISSING_INPUT",
      { componentId: component.id, countRow: countRow?.row?.selectorId }
    );
  }

  const hourlyPrice = prices["hourly"] ?? 0;
  const monthlyPrice = prices["monthly"] ?? 0;
  const upfrontPrice = prices["upfront"] ?? 0;
  const model = pricingModelOf(component, values, prices);
  let monthly: number;
  let upfront: number;
  switch (model) {
    case "Reserved":
      // Live `U`: the commitment rate times the month, plus a one-off upfront.
      monthly = hourlyPrice * HOURS_IN_MONTH * count;
      upfront = upfrontPrice * count;
      break;
    case "Monthly":
      // Live `V`: hourly for a partial month plus a flat monthly fee. The live
      // helper skips the hourly term entirely when the hourly rate is 0.
      monthly = hourlyPrice
        ? hourlyPrice * totalHours * count + monthlyPrice * count
        : monthlyPrice * count;
      upfront = 0;
      break;
    case "Hourly":
      // Live `G`: a pure hourly rate over the utilization row's hours.
      monthly = hourlyPrice * totalHours * count;
      upfront = 0;
      break;
    case "SavingsPlan": {
      // Live `z`: the commitment covers every hour of the term, the purchase
      // option takes a fraction of it up front, and the remaining effective
      // hourly rate times the month is the monthly cost. The monthly figure is
      // rounded up to the cent exactly like live (`Math.ceil(100 * total)/100`).
      const termYears = savingsPlanTermYears(component, values);
      const purchaseOption =
        exportValue(component, values, "purchaseOption")?.value ?? "";
      const savings = savingsPlanCost(hourlyPrice, count, termYears, purchaseOption);
      monthly = savings.monthly;
      upfront = savings.upfront;
      break;
    }
    default:
      throw new EngineError(
        `columnFormIPM "${component.id}" has an unknown pricing model "${model}"`,
        "BAD_DEFINITION",
        { componentId: component.id, pricingModel: model }
      );
  }
  monthly = Number(monthly.toFixed(4));
  upfront = Number(upfront.toFixed(4));

  if (utilizationRow?.exportValueAs) {
    extraValues[utilizationRow.exportValueAs] = totalHours;
  }
  for (const [type, id] of Object.entries(component.calculationId ?? {})) {
    if (type === "monthly") extraValues[id] = monthly;
    else if (type === "hourly") extraValues[id] = hourlyPrice;
    else if (type === "upfront") extraValues[id] = upfront;
  }
  for (const row of rows) {
    if (!row.exportValueAs) continue;
    if (row.type === "utilization") continue;
    const value = values[row.selectorId] ?? "";
    if (value === "") continue;
    extraValues[row.exportValueAs] = row.exportValueAs.startsWith("count") || row.type === "textInput"
      ? Number(value)
      : value;
  }

  return {
    monthly,
    upfront,
    saved: { value: [savedRow(rows, values, resolved.utilization)] },
    configSummary: columnFormSummary(values, component.row, resolved.utilization),
    extraValues,
  };
}

/** The saved row: one entry per rendered selector, in definition order. */
function savedRow(
  rows: ColumnFormRowDefinition[],
  values: Record<string, string>,
  utilization: Record<string, ColumnFormUtilization>
): Record<string, { value: string | ColumnFormUtilization }> {
  const rowMap: Record<string, { value: string | ColumnFormUtilization }> = {};
  for (const row of rows) {
    if (row.type === "utilization") {
      const value = utilization[row.selectorId];
      if (!value) continue;
      rowMap[row.selectorId] = { value };
      continue;
    }
    const value = values[row.selectorId] ?? "";
    if (value === "") continue;
    rowMap[row.selectorId] = { value };
  }
  return rowMap;
}

/** Config summary: `label (value)` per row, plus the pricing strategy block. */
export function columnFormSummary(
  values: Record<string, string>,
  rows: ColumnFormRowDefinition[],
  utilization: Record<string, ColumnFormUtilization> = {}
): string {
  const strategyLabels = ["Pricing model", "Purchase option", "Term"];
  let strategyCount = 0;
  // Definition order and rendered rows only: a `remap.constant` selector has no
  // row and never appears in the live summary.
  for (const row of rows) {
    if (strategyLabels.includes(row.label)) strategyCount += 1;
  }
  const completeStrategy = strategyCount === strategyLabels.length;
  const strategy: string[] = [];
  const parts: string[] = [];
  for (const definition of rows) {
    const value = values[definition.selectorId] ?? "";
    if (value === "") continue;
    const label = definition.label;
    const display = definition.displayInConfigSummary;
    const shown = display === false ? false : true;
    // Live `ee` joins an object value's members with a space, so a utilization
    // row prints `Billing option (730 Monthly)` / `Utilization (50 %Utilized/Month)`.
    const util = definition.type === "utilization" ? utilization[definition.selectorId] : undefined;
    const text = util ? `${util.unit} ${util.selectedId}` : value;
    if (!completeStrategy || !strategyLabels.includes(label)) {
      if (shown) parts.push(`${label} (${text})`);
      continue;
    }
    strategy.push(text);
  }
  const text = parts.join(", ");
  if (strategy.length === 0) return text;
  const strategyText = `Pricing strategy (${strategy.join(" ")})`;
  return text === "" ? strategyText : `${text}, ${strategyText}`;
}
