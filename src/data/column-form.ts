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
}

export interface LoadColumnFormOptions {
  /** `mappingDefinitionURL` from the service definition. */
  mappingUrl: string;
  currency: string;
  regionName: string;
  /** Selector values from the component rows, keyed by selector id. */
  values: Record<string, string>;
  cache?: CacheOptions;
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

/** Resolve the one aggregation row that matches the provided selector values. */
export function matchAggregation(
  aggregations: Plc2Aggregation[],
  values: Record<string, string>,
  pricingSelectors: string[],
  regionName: string
): Record<string, string> {
  const wanted: Record<string, string> = {};
  for (const selector of pricingSelectors) {
    const value = values[selector];
    if (value !== undefined && value !== "") wanted[selector] = value;
  }
  const matches = aggregations.filter((row) =>
    Object.entries(wanted).every(([selector, value]) => row.selectors[selector] === value)
  );
  if (matches.length === 0) {
    throw new EngineError(
      `no PLC_2.0 price row matches ${JSON.stringify(wanted)}`,
      "MISSING_PRICE",
      { values: wanted }
    );
  }
  // Derived attributes (vCPU, memory) are region independent, and the index
  // path always uses the requested region, so prefer this region's rows. If
  // the remaining rows disagree on a derived selector, fail closed.
  const regional = matches.filter(
    (row) => row.selectors["Location"] === undefined || row.selectors["Location"] === regionName
  );
  const pool = regional.length > 0 ? regional : matches;
  const first = pool[0]!.selectors;
  const conflicts = pool.some((row) =>
    Object.keys(first).some((key) => row.selectors[key] !== first[key])
  );
  if (conflicts) {
    throw new EngineError(
      `PLC_2.0 selector match is ambiguous for ${JSON.stringify(wanted)} ` +
        `(${pool.length} rows); add a secondary selector`,
      "AMBIGUOUS_SELECTION",
      { values: wanted, matches: pool.length }
    );
  }
  return first;
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
  const locations = metadata.regionAttributes?.Location;
  if (!Array.isArray(locations) || !locations.includes(options.regionName)) {
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
  const selectors = matchAggregation(
    aggregationFile.aggregations,
    options.values,
    pricingSelectors,
    options.regionName
  );
  const pathValues = primarySelectors.map((selector) => selectors[selector]);
  if (pathValues.some((value) => value === undefined || value === "")) {
    throw new EngineError(
      `PLC_2.0 aggregation row is missing a primary selector value for ` +
        `${primarySelectors.join(", ")}`,
      "BAD_DEFINITION",
      { selectors, primarySelectors }
    );
  }
  const indexPath = pathValues.map((value) => encodeURIComponent(String(value))).join("/");
  const indexUrl = `${base}/${indexPath}/index.json`;
  const index = requireObject<Plc2Index>(
    await fetchCachedJson(indexUrl, options.cache ?? {}),
    "PLC_2.0 index",
    indexUrl
  );
  const regionPrices = index.regions?.[options.regionName];
  if (!regionPrices) {
    throw new EngineError(
      `PLC_2.0 index at ${indexUrl} has no prices for ${options.regionName}`,
      "MISSING_PRICE",
      { url: indexUrl, regionName: options.regionName }
    );
  }
  const firstSet = Object.keys(index.sets ?? {})[0];
  const setMeters = firstSet ? index.sets[firstSet] ?? [] : [];
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
  };
}
