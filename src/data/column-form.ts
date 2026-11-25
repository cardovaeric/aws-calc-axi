/**
 * PLC_2.0 data for `columnFormIPM` inputs.
 *
 * A column form component points at a PLC_2.0 mapping (`.../metadata.json`).
 * The metadata names the pricing selectors and the index path, the selector
 * aggregations resolve derived attributes (vCPU, memory, ...), and the index
 * file for the selected path carries the regional price records and price-set
 * labels. This module fetches and resolves that chain; the price math lives in
 * `src/engine/column-form.ts`.
 *
 * Evidence: analysis/FINDINGS.md section 10 and `analysis/bundle.js`
 * (`getData`, `getPlc2Data`, `processPrices` for PLC_2.0 metadata).
 */
import { fetchCachedJson, type CacheOptions } from "../cache.ts";
import { pricingUrl } from "../endpoints.ts";
import { EngineError } from "../engine/errors.ts";
import type { PriceRecord } from "./pricing.ts";

export interface Plc2Manifest {
  serviceId: string;
  source: string;
  currencyCode?: string;
  [key: string]: unknown;
}

export interface Plc2Metadata {
  manifest: Plc2Manifest;
  regionAttributes?: { Location?: string[] };
  valueAttributes?: Record<string, string[]>;
  primarySelectors: string[];
  secondarySelectors: string[];
  [key: string]: unknown;
}

export interface Plc2Aggregation {
  selectors: Record<string, string>;
  total_count?: number;
}

export interface Plc2Aggregations {
  manifest: Plc2Manifest;
  aggregations: Plc2Aggregation[];
}

export interface Plc2Index {
  manifest?: Plc2Manifest;
  regions: Record<string, Record<string, PriceRecord>>;
  sets: Record<string, string[]>;
}

export interface ColumnFormPricingData {
  /** Pricing selectors that take part in meter matching. */
  pricingSelectors: string[];
  /** Resolved selector values, including derived attributes. */
  selectors: Record<string, string>;
  /** Price records for this region, keyed by metered unit label. */
  regionPrices: Record<string, PriceRecord>;
  /** Labels of the first price set for the selected path. */
  setMeters: string[];
  manifest: Plc2Manifest;
  metadataUrl: string;
  /**
   * Every aggregation row for the mapping. The selector option tree is built
   * from these rows, so a dependent selector can offer only the values the
   * parent allows. Absent for hand-built fixtures.
   */
  aggregations?: Plc2Aggregation[];
  /** True when the supplied values matched an aggregation row exactly. */
  exactMatch?: boolean;
}

export interface LoadColumnFormOptions {
  /** `mappingDefinitionURL` from the service definition. */
  mappingUrl: string;
  currency: string;
  regionName: string;
  /** Selector values from the component rows, keyed by selector id. */
  values: Record<string, string>;
  /**
   * `remap` from the component. `keyValue` maps a raw price value to the label
   * the live form shows, and the live engine applies it to the aggregation rows
   * and the price records before matching (`b` and `o` in analysis/bundle.js).
   */
  remap?: { keyValue?: Record<string, string> };
  cache?: CacheOptions;
}

/** Apply `remap.keyValue` forward, the way live `b`/`o`/`d` do. */
export function remapValue(
  keyValue: Record<string, string> | undefined,
  value: string
): string {
  if (!keyValue) return value;
  return keyValue[value] ?? value;
}

/** Apply `remap.keyValue` in reverse, the way the live meter list and path do. */
export function reverseRemapValue(
  keyValue: Record<string, string> | undefined,
  value: string
): string {
  if (!keyValue) return value;
  for (const [key, display] of Object.entries(keyValue)) {
    if (display === value) return key;
  }
  return value;
}

function remapAggregations(
  aggregations: Plc2Aggregation[],
  keyValue: Record<string, string> | undefined
): Plc2Aggregation[] {
  if (!keyValue) return aggregations;
  return aggregations.map((row) => {
    const selectors: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.selectors)) {
      selectors[key] = remapValue(keyValue, String(value));
    }
    return { ...row, selectors };
  });
}

function remapRecords(
  records: Record<string, PriceRecord>,
  keyValue: Record<string, string> | undefined
): Record<string, PriceRecord> {
  if (!keyValue) return records;
  const remapped: Record<string, PriceRecord> = {};
  for (const [meter, record] of Object.entries(records)) {
    const next: Record<string, unknown> = { ...(record as unknown as Record<string, unknown>) };
    for (const [key, value] of Object.entries(next)) {
      if (typeof value === "string") next[key] = remapValue(keyValue, value);
    }
    remapped[meter] = next as unknown as PriceRecord;
  }
  return remapped;
}

function requireObject<T>(value: unknown, what: string, url: string): T {
  if (!value || typeof value !== "object") {
    throw new EngineError(`${what} at ${url} is not an object`, "BAD_DEFINITION", { url });
  }
  return value as T;
}

function metadataBase(metadataUrl: string): string {
  const base = metadataUrl.replace(/\/metadata\.json$/, "");
  if (base === metadataUrl) {
    throw new EngineError(
      `PLC_2.0 mapping URL "${metadataUrl}" does not point at metadata.json`,
      "BAD_DEFINITION",
      { mappingUrl: metadataUrl }
    );
  }
  return base;
}

export interface AggregationMatch {
  /** Selector values for the matched aggregation row. */
  selectors: Record<string, string>;
  /** True when an aggregation row matched every supplied value exactly. */
  exact: boolean;
  /** Selectors whose supplied value the matched row does not carry. */
  diffs: string[];
}

/**
 * Resolve the aggregation row for the supplied selector values, mirroring the
 * live engine (`c` in analysis/bundle.js).
 *
 * An exact match is a row that carries every supplied value. When there is
 * none, live falls back to a weighted best match driven by `prioritizedKey`
 * (default `{"Instance Type": 20, TermType: 10}`) and records which values
 * differed. The live editor's `Update estimate` refuses such a component
 * ("Best Match produced invalid options"), so the prefetch uses the fallback to
 * resolve option sets and then requires an exact match for the values it will
 * publish.
 */
export function resolveAggregationMatch(
  aggregations: Plc2Aggregation[],
  values: Record<string, string>,
  pricingSelectors: string[],
  regionName: string,
  prioritizedKey?: Record<string, number>
): AggregationMatch | undefined {
  const wanted: Record<string, string> = {};
  for (const selector of pricingSelectors) {
    const value = values[selector];
    if (value !== undefined && value !== "") wanted[selector] = value;
  }
  const scores = prioritizedKey ?? { "Instance Type": 20, TermType: 10 };
  // Prefer this region's rows: derived attributes (vCPU, memory) are region
  // independent, and the index path always uses the requested region.
  const regional = aggregations.filter(
    (row) => row.selectors["Location"] === undefined || row.selectors["Location"] === regionName
  );
  const pool = regional.length > 0 ? regional : aggregations;
  const exact = pool.filter((row) =>
    Object.entries(wanted).every(([selector, value]) => row.selectors[selector] === value)
  );
  if (exact.length > 0) {
    // Live takes the first aggregation row that carries every supplied value
    // (`break` in `c`). Selectors the caller did not supply are resolved from
    // that row's tree in the next pass, which is what makes the state settle.
    return { selectors: { ...wanted, ...exact[0]!.selectors }, exact: true, diffs: [] };
  }
  let best: Record<string, string> | undefined;
  let bestScore = -1;
  for (const row of pool) {
    let score = 0;
    let weight = pricingSelectors.length;
    for (const selector of pricingSelectors) {
      if (row.selectors[selector] === wanted[selector]) {
        score += scores[selector] ? scores[selector] * weight : weight;
      }
      weight -= 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = row.selectors;
    }
  }
  if (!best) return undefined;
  const diffs = Object.keys(wanted).filter((selector) => best![selector] !== wanted[selector]);
  return { selectors: { ...wanted, ...best }, exact: false, diffs };
}

/**
 * Resolve the one aggregation row that matches the provided selector values.
 * Throws when no row carries every supplied value: the live editor rejects a
 * "Best Match" component, so a caller that publishes must not accept one.
 */
export function matchAggregation(
  aggregations: Plc2Aggregation[],
  values: Record<string, string>,
  pricingSelectors: string[],
  regionName: string
): Record<string, string> {
  const match = resolveAggregationMatch(aggregations, values, pricingSelectors, regionName);
  const wanted: Record<string, string> = {};
  for (const selector of pricingSelectors) {
    const value = values[selector];
    if (value !== undefined && value !== "") wanted[selector] = value;
  }
  if (!match || !match.exact) {
    throw new EngineError(
      `no PLC_2.0 price row matches ${JSON.stringify(wanted)}`,
      "MISSING_PRICE",
      { values: wanted }
    );
  }
  return match.selectors;
}

export async function loadColumnFormPricing(
  options: LoadColumnFormOptions
): Promise<ColumnFormPricingData> {
  const metadataUrl = pricingUrl(options.mappingUrl, options.currency);
  const metadata = requireObject<Plc2Metadata>(
    await fetchCachedJson(metadataUrl, options.cache ?? {}),
    "PLC_2.0 metadata",
    metadataUrl
  );
  if (!metadata.manifest || typeof metadata.manifest.serviceId !== "string") {
    throw new EngineError(
      `PLC_2.0 metadata at ${metadataUrl} has no manifest.serviceId`,
      "BAD_DEFINITION",
      { url: metadataUrl }
    );
  }
  // The live `getData` gate is `Array.isArray(availableLocation) &&
  // !availableLocation.includes(location)`. A map that declares no `Location`
  // attribute is not region-scoped: Direct Connect carries only
  // `regionAttributes["From Location"]` (the on-prem locations) and prices every
  // region from one map. Failing closed on the missing attribute rejected every
  // Direct Connect region; a region the map really does exclude still throws.
  const locations = metadata.regionAttributes?.Location;
  if (Array.isArray(locations) && !locations.includes(options.regionName)) {
    throw new EngineError(
      `PLC_2.0 price data is not available in ${options.regionName} for ` +
        `${metadata.manifest.serviceId}`,
      "UNKNOWN_REGION",
      { regionName: options.regionName, url: metadataUrl }
    );
  }
  const base = metadataBase(metadataUrl);
  const primarySelectors = metadata.primarySelectors ?? [];
  const secondarySelectors = metadata.secondarySelectors ?? [];
  if (primarySelectors.length === 0) {
    throw new EngineError(
      `PLC_2.0 metadata at ${metadataUrl} declares no primarySelectors`,
      "BAD_DEFINITION",
      { url: metadataUrl }
    );
  }
  const pricingSelectors = [...primarySelectors, ...secondarySelectors];

  const aggregationsUrl = `${base}/primary-selector-aggregations.json`;
  const aggregationFile = requireObject<Plc2Aggregations>(
    await fetchCachedJson(aggregationsUrl, options.cache ?? {}),
    "PLC_2.0 aggregations",
    aggregationsUrl
  );
  if (!Array.isArray(aggregationFile.aggregations)) {
    throw new EngineError(
      `PLC_2.0 aggregations at ${aggregationsUrl} have no aggregations list`,
      "BAD_DEFINITION",
      { url: aggregationsUrl }
    );
  }
  const keyValue = options.remap?.keyValue;
  // The live engine remaps the aggregation rows and the price records before it
  // matches anything (`b` and `o`), so both sides speak the display labels the
  // form shows (`1000 MBps/TiB`, `No Cache`).
  const aggregations = remapAggregations(aggregationFile.aggregations, keyValue);
  const match = resolveAggregationMatch(
    aggregations,
    options.values,
    pricingSelectors,
    options.regionName
  );
  if (!match) {
    throw new EngineError(
      `no PLC_2.0 price row matches ${JSON.stringify(options.values)}`,
      "MISSING_PRICE",
      { values: options.values }
    );
  }
  const selectors = match.selectors;
  // Live injects the region name for both location selectors right before it
  // builds the index path (`{...state, Location: regionName, "From Location":
  // regionName}`, bundle offset 1466476). Direct Connect declares `From
  // Location` as a primary selector but never puts it in the form, so without
  // the injection the path takes whatever location the aggregation file lists
  // first ("AWS GovCloud (US)") and the index has no prices for the region.
  const pathSelectors: Record<string, string> = {
    ...selectors,
    Location: options.regionName,
    "From Location": options.regionName,
  };
  const pathValues = primarySelectors.map((selector) => pathSelectors[selector]);
  if (pathValues.some((value) => value === undefined)) {
    throw new EngineError(
      `PLC_2.0 aggregation row is missing a primary selector value for ` +
        `${primarySelectors.join(", ")}`,
      "BAD_DEFINITION",
      { selectors, primarySelectors }
    );
  }
  // The index path uses the raw price values, so display labels are mapped back.
  const indexPath = pathValues
    .map((value) => encodeURIComponent(reverseRemapValue(keyValue, String(value))))
    .join("/");
  const indexUrl = `${base}/${indexPath}/index.json`;
  const index = requireObject<Plc2Index>(
    await fetchCachedJson(indexUrl, options.cache ?? {}),
    "PLC_2.0 index",
    indexUrl
  );
  const rawRegionPrices = index.regions?.[options.regionName];
  if (!rawRegionPrices) {
    throw new EngineError(
      `PLC_2.0 index at ${indexUrl} has no prices for ${options.regionName}`,
      "MISSING_PRICE",
      { url: indexUrl, regionName: options.regionName }
    );
  }
  const regionPrices = remapRecords(rawRegionPrices, keyValue);
  const firstSet = Object.keys(index.sets ?? {})[0];
  const setMeters = (firstSet ? index.sets[firstSet] ?? [] : []).map((meter) =>
    meter
  );
  if (setMeters.length === 0) {
    throw new EngineError(
      `PLC_2.0 index at ${indexUrl} has no price set`,
      "MISSING_PRICE",
      { url: indexUrl }
    );
  }

  return {
    pricingSelectors,
    selectors,
    regionPrices,
    setMeters,
    manifest: metadata.manifest,
    metadataUrl,
    aggregations,
    exactMatch: match.exact,
  };
}
