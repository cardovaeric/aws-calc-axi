/**
 * Data transfer (`dataTransferV2`) pricing.
 *
 * The live calculator does not look up a single metered unit per row. It turns
 * the whole regional `datatransfer-calc` meter map into per-destination tier
 * groups, picks the most common group for the service region, and only keeps
 * the groups that differ from it as explicit destination options. A row then
 * prices against its own group, or the region-wide common group when the
 * destination has no override. This module reproduces that pipeline, including
 * the way it accumulates every matching meter for one destination.
 *
 * Evidence: analysis/FINDINGS.md section 9, `analysis/bundle.js`
 * (`dataTransferPricing`, `calculateTransferBlockPrice`, `processPrices`,
 * `getDataTransferUnitConversion`, `getConfigSummary`).
 */
import { EngineError, InputValidationError } from "./errors.ts";
import { MissingPriceError, type PriceRecord, type PriceResolver } from "../data/pricing.ts";

export const TRANSFER_TYPES = ["INBOUND", "OUTBOUND", "INTRA_REGION"] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];

/** Region keys the calculator adds to the region code -> name map. */
const VIRTUAL_REGION_LABELS: Record<string, string> = {
  External: "Internet",
  "External-5G-Carrier": "Carrier",
  other: "All other regions",
};

const UNIT_LABELS: Record<string, string> = {
  gb_month: "GB per month",
  tb_month: "TB per month",
};

const TYPE_LABELS: Record<TransferType, string> = {
  INBOUND: "Inbound",
  OUTBOUND: "Outbound",
  INTRA_REGION: "Intra-Region",
};

/** Live default for a fresh row and for rows the definition does not fill in. */
export const DEFAULT_TRANSFER_UNIT = "tb_month";

const GB_PER_TB = 1024;
const EXTERNAL_TYPE_LABELS = { external: "External", carrier: "External-5G-Carrier" } as const;

export interface TransferRow {
  entryType: TransferType;
  /** Raw entered amount, kept as a string so the summary matches the form. */
  value: string;
  unit: string;
  /** Destination region code, `External`, `other`, or empty when unselected. */
  priceKey: string;
}

interface TransferTier {
  startRange: number;
  endRange?: number | undefined;
  price: number;
}

interface TransferGroup {
  tiers: TransferTier[];
  uniqueKey: string;
}

export interface TransferPricing {
  /** Destination key -> tier group. */
  outbound: Map<string, TransferGroup>;
  /** Source key -> tier group. */
  inbound: Map<string, TransferGroup>;
  intraRegion?: TransferGroup | undefined;
  /** Most common outbound group in this region. */
  commonOutbound?: TransferGroup | undefined;
  /** Most common inbound group in this region. */
  commonInbound?: TransferGroup | undefined;
  regionName: string;
}

export interface TransferPricingOptions {
  /** Region display name -> region code, from the locations data. */
  codeByName: Map<string, string>;
  regionName: string;
  mappingDefinitionName: string;
}

export function isTransferType(value: unknown): value is TransferType {
  return typeof value === "string" && (TRANSFER_TYPES as readonly string[]).includes(value);
}

/** Parse the raw override rows into the shape the pricing pipeline expects. */
export function normalizeRows(raw: unknown, dataTransferTypes: unknown): TransferRow[] {
  const declared = Array.isArray(dataTransferTypes) && dataTransferTypes.length > 0
    ? dataTransferTypes.filter(isTransferType)
    : [...TRANSFER_TYPES];
  if (declared.length === 0) {
    throw new EngineError(
      "dataTransferV2 declares no supported transfer types",
      "BAD_DEFINITION",
      { dataTransferTypes }
    );
  }

  const provided: TransferRow[] = [];
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw)) {
      throw new EngineError("dataTransferV2 rows must be a list", "INVALID_SPEC", { value: raw });
    }
    for (const entry of raw) {
      const record =
        typeof entry === "object" && entry !== null
          ? (entry as Record<string, unknown>)
          : undefined;
      if (!record) {
        throw new EngineError(
          "dataTransferV2 row must be an object with entryType and value",
          "INVALID_SPEC",
          { value: entry }
        );
      }
      const entryType = record["entryType"] ?? "OUTBOUND";
      if (!isTransferType(entryType)) {
        throw new EngineError(
          `dataTransferV2 row has unknown entryType "${String(entryType)}"; ` +
            `use ${TRANSFER_TYPES.join(", ")}`,
          "INVALID_SPEC",
          { value: entry }
        );
      }
      if (!declared.includes(entryType)) {
        throw new EngineError(
          `dataTransferV2 row type "${entryType}" is not offered by this service ` +
            `(${declared.join(", ")})`,
          "INVALID_SPEC",
          { value: entry }
        );
      }
      const unit = record["unit"] === undefined ? DEFAULT_TRANSFER_UNIT : String(record["unit"]);
      if (!Object.hasOwn(UNIT_LABELS, unit)) {
        throw new EngineError(
          `dataTransferV2 row unit "${unit}" is not supported; ` +
            `use ${Object.keys(UNIT_LABELS).join(" or ")}`,
          "INVALID_SPEC",
          { value: entry }
        );
      }
      const value = record["value"] ?? "";
      const priceKey =
        entryType === "INBOUND"
          ? String(record["fromRegion"] ?? record["priceKey"] ?? "")
          : entryType === "OUTBOUND"
            ? String(record["toRegion"] ?? record["priceKey"] ?? "")
            : "";
      provided.push({ entryType, value: value === null ? "" : String(value), unit, priceKey });
    }
  }

  // The live state always holds at least one row per declared type, so the
  // config summary lists every type even when the user only filled one.
  return declared.flatMap((entryType) => {
    const rows = provided.filter((row) => row.entryType === entryType);
    return rows.length > 0
      ? rows
      : [{ entryType, value: "", unit: DEFAULT_TRANSFER_UNIT, priceKey: "" }];
  });
}

interface MeterType {
  direction: TransferType;
  destination: string | undefined;
  source: string | undefined;
}

function typeOfMeter(
  meter: string,
  record: PriceRecord,
  codeByName: Map<string, string>
): MeterType | undefined {
  const tokens = meter.split(" ");
  if (tokens[0]?.toLowerCase() !== "datatransfer") return undefined;
  // The pricing file also carries legacy PLC_2.0 rows keyed by usage type.
  if (/GB0240$/.test(meter)) return undefined;
  const kind = tokens.includes("Carrier") ? "External Carrier" : tokens[1] ?? "";
  if (kind === "IntraRegion") {
    return { direction: "INTRA_REGION", destination: undefined, source: undefined };
  }

  const direction: TransferType = tokens.includes("Inbound") ? "INBOUND" : "OUTBOUND";
  if (kind === "External") {
    return { direction, destination: EXTERNAL_TYPE_LABELS.external, source: EXTERNAL_TYPE_LABELS.external };
  }
  if (kind === "External Carrier") {
    return {
      direction,
      destination: EXTERNAL_TYPE_LABELS.carrier,
      source: EXTERNAL_TYPE_LABELS.carrier,
    };
  }
  const attributes = record as unknown as Record<string, unknown>;
  const locationName =
    direction === "OUTBOUND" ? attributes["To Location"] : attributes["From Location"];
  // The live converter resolves the display name back to a region code and
  // skips meters it cannot name, so those never surface as options.
  const code = typeof locationName === "string" ? codeByName.get(locationName) : undefined;
  return { direction, destination: code, source: code };
}

function uniqueKeyOf(tiers: TransferTier[]): string {
  return tiers
    .map((tier) => `Start:${tier.startRange},End:${tier.endRange},Price:${tier.price}`)
    .join(";");
}

/** Most common tier group; ties keep the last group in meter order like the UI. */
function commonGroup(groups: Map<string, TransferGroup> | undefined): TransferGroup | undefined {
  if (!groups) return undefined;
  const counts = new Map<string, { count: number; group: TransferGroup }>();
  for (const group of groups.values()) {
    const entry = counts.get(group.uniqueKey) ?? { count: 0, group };
    entry.count += 1;
    counts.set(group.uniqueKey, entry);
  }
  let best: { count: number; group: TransferGroup } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count >= best.count) best = entry;
  }
  return best?.group;
}

/**
 * Turn the regional meter map into destination tier groups. Meter names whose
 * location is not in the region map are skipped, exactly like the live
 * converter; a row that names one of them still fails closed on lookup.
 */
export function buildTransferPricing(
  meters: Record<string, PriceRecord>,
  options: TransferPricingOptions
): TransferPricing {
  const mapping = options.mappingDefinitionName;
  const outbound = new Map<string, TransferGroup>();
  const inbound = new Map<string, TransferGroup>();
  let intraRegion: TransferGroup | undefined;

  const groupFor = (groups: Map<string, TransferGroup>, key: string): TransferGroup => {
    const existing = groups.get(key);
    if (existing) return existing;
    const created: TransferGroup = { tiers: [], uniqueKey: "" };
    groups.set(key, created);
    return created;
  };

  for (const [meter, record] of Object.entries(meters)) {
    const parsed = typeOfMeter(meter, record, options.codeByName);
    if (!parsed) continue;
    const startRange = Number(record.StartingRange ?? 0);
    const rawEnd = record.EndingRange;
    const endRange =
      rawEnd === undefined || rawEnd === "Inf" || rawEnd === null ? undefined : Number(rawEnd);
    const price = Number(record.price);
    if (!Number.isFinite(price) || !Number.isFinite(startRange) || (endRange !== undefined && !Number.isFinite(endRange))) {
      throw new EngineError(
        `data transfer meter "${meter}" has a non-numeric price or range in ${options.regionName}`,
        "BAD_PRICE",
        { meter, mapping, region: options.regionName }
      );
    }
    const tier: TransferTier = { startRange, endRange, price };

    if (parsed.direction === "INTRA_REGION") {
      intraRegion ??= { tiers: [], uniqueKey: "" };
      intraRegion.tiers.push(tier);
      continue;
    }
    if (parsed.direction === "OUTBOUND") {
      const code = parsed.destination;
      if (!code) continue;
      groupFor(outbound, code).tiers.push(tier);
    } else {
      const code = parsed.source;
      if (!code) continue;
      groupFor(inbound, code).tiers.push(tier);
    }
  }

  const finish = (groups: Map<string, TransferGroup>): void => {
    for (const group of groups.values()) {
      group.tiers.sort((left, right) => left.startRange - right.startRange);
      group.uniqueKey = uniqueKeyOf(group.tiers);
    }
  };
  finish(outbound);
  finish(inbound);
  if (intraRegion) {
    intraRegion.tiers.sort((left, right) => left.startRange - right.startRange);
    intraRegion.uniqueKey = uniqueKeyOf(intraRegion.tiers);
  }

  return {
    outbound,
    inbound,
    ...(intraRegion ? { intraRegion } : {}),
    commonOutbound: commonGroup(outbound),
    commonInbound: commonGroup(inbound),
    regionName: options.regionName,
  };
}

/** Sum the tiers that apply to `value` in GB, twice for intra-region rows. */
function groupCost(group: TransferGroup, valueInGb: number, transferType: TransferType): number {
  let total = 0;
  for (const tier of group.tiers) {
    if (tier.startRange > valueInGb) continue;
    const end =
      tier.endRange === undefined || tier.endRange > valueInGb ? valueInGb : tier.endRange;
    total += tier.price * (end - tier.startRange);
  }
  if (transferType === "INTRA_REGION") total *= 2;
  return total;
}

export interface TransferRowCost {
  row: TransferRow;
  monthly: number;
}

export interface TransferEvaluation {
  monthly: number;
  rows: TransferRowCost[];
  pricing: TransferPricing;
}

function resolveRowGroup(
  row: TransferRow,
  pricing: TransferPricing,
  context: TransferContext
): TransferGroup {
  if (row.entryType === "INTRA_REGION") {
    if (!pricing.intraRegion) {
      throw new MissingPriceError("DataTransfer IntraRegion", context.regionName, context.mapping);
    }
    return pricing.intraRegion;
  }

  const groups = row.entryType === "INBOUND" ? pricing.inbound : pricing.outbound;
  const common = row.entryType === "INBOUND" ? pricing.commonInbound : pricing.commonOutbound;
  if (row.priceKey === "") {
    throw new EngineError(
      `dataTransferV2 row "${row.entryType}" has ${row.value} ${row.unit} but no ` +
        `${row.entryType === "INBOUND" ? "source" : "destination"} region; ` +
        `set ${row.entryType === "INBOUND" ? "fromRegion" : "toRegion"} ` +
        `(for example External, other, or a region code)`,
      "MISSING_INPUT",
      { componentId: context.componentId, entryType: row.entryType }
    );
  }
  const explicit = groups.get(row.priceKey);
  if (explicit) return explicit;
  if (common) {
    // The live UI treats unknown destination keys as "other" and bills the
    // region-wide common pricing, but only for keys it can name. A region code
    // that is not in the locations map is a typo and must fail closed.
    if (!context.regionNameByCode.has(row.priceKey) && !Object.hasOwn(VIRTUAL_REGION_LABELS, row.priceKey)) {
      throw new EngineError(
        `data transfer ${row.entryType === "INBOUND" ? "source" : "destination"} ` +
          `"${row.priceKey}" is not a known region code`,
        "UNKNOWN_REGION",
        { componentId: context.componentId, region: row.priceKey }
      );
    }
    return common;
  }
  throw new MissingPriceError(
    `${row.entryType} ${row.priceKey}`,
    context.regionName,
    context.mapping
  );
}

export interface TransferContext {
  componentId: string;
  regionName: string;
  mapping: string;
  prices: PriceResolver;
  /** Region code -> display name, including the calculator's virtual keys. */
  regionNameByCode: Map<string, string>;
  /** Region display name -> code. */
  regionCodeByName: Map<string, string>;
}

function valueInGb(row: TransferRow, context: TransferContext): number {
  // An untouched row carries an empty amount in the live state.
  if (row.value === "") return 0;
  const numeric = Number(row.value);
  if (!Number.isFinite(numeric)) {
    throw new InputValidationError({
      serviceCode: context.componentId,
      componentId: context.componentId,
      label: "Data Transfer",
      problem: `"${row.value}" is not a number`,
      value: row.value,
    });
  }
  if (numeric < 0) {
    throw new EngineError(
      `data transfer row value ${row.value} is negative`,
      "VALIDATION_ERROR",
      { componentId: context.componentId }
    );
  }
  return row.unit === "tb_month" ? numeric * GB_PER_TB : numeric;
}

/** Price every row of a `dataTransferV2` component. */
export function evaluateTransferRows(
  rows: TransferRow[],
  context: TransferContext
): TransferEvaluation {
  const meters = context.prices.meters(context.mapping);
  if (!meters) {
    throw new MissingPriceError("datatransfer", context.regionName, context.mapping);
  }
  const pricing = buildTransferPricing(meters, {
    codeByName: context.regionCodeByName,
    regionName: context.regionName,
    mappingDefinitionName: context.mapping,
  });

  const priced: TransferRowCost[] = [];
  let monthly = 0;
  for (const row of rows) {
    const value = valueInGb(row, context);
    // A blank amount contributes nothing, like an untouched row in the form.
    if (row.value === "" || value === 0) {
      priced.push({ row, monthly: 0 });
      continue;
    }
    const group = resolveRowGroup(row, pricing, context);
    const cost = groupCost(group, value, row.entryType);
    priced.push({ row, monthly: cost });
    monthly += cost;
  }
  return { monthly: Number(monthly.toFixed(6)), rows: priced, pricing };
}

/** `DT <type>: [<region> ](<value> <unit>)`, matching the live config summary. */
export function transferSummary(rows: TransferRow[], nameByCode: Map<string, string>): string {
  return TRANSFER_TYPES.flatMap((entryType) =>
    rows
      .filter((row) => row.entryType === entryType)
      .map((row) => {
            const label =
          entryType === "INTRA_REGION"
            ? ""
            : `${regionLabel(row.priceKey, nameByCode)} `;
        const amount = row.value === "" ? "0" : row.value;
        const unit = UNIT_LABELS[row.unit] ?? row.unit;
        return `DT ${TYPE_LABELS[entryType]}: ${label}(${amount} ${unit})`;
      })
  ).join(", ");
}

export function regionLabel(priceKey: string, nameByCode: Map<string, string>): string {
  if (priceKey === "") return "Not selected";
  const virtual = VIRTUAL_REGION_LABELS[priceKey];
  if (virtual) return virtual;
  return nameByCode.get(priceKey) ?? "Not selected";
}

/** Save-format rows: only the fields the live converter writes. */
export function toSavedRows(rows: TransferRow[]): Array<Record<string, string>> {
  return rows.map((row) => ({
    entryType: row.entryType,
    value: row.value,
    unit: row.unit,
    ...(row.entryType === "INBOUND" ? { fromRegion: row.priceKey } : {}),
    ...(row.entryType === "OUTBOUND" ? { toRegion: row.priceKey } : {}),
  }));
}
