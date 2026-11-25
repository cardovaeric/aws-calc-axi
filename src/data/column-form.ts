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
 * A component may also carry `additionalPricingData`: extra PLC_2.0 cargo items
 * (joined artifacts) that the live form merges into the same selector tree. The
 * Database Savings Plans artifact is the only one in the catalog: it adds a
 * `Database Savings Plans` pricing model and prices that selection from its own
 * manifest and index path. Live `getData` spreads the list into `item`, `c`
 * concatenates every item's aggregation rows (remapped per item) and returns the
 * item the matched row came from, and `u`/`w` price from that item's index and
 * `pricingUnitModel`. This module reproduces that.
 *
 * Evidence: analysis/FINDINGS.md sections 10 and 18, `analysis/bundle.js`
 * (`getData` at bundle offset 1466650, `c` at 1465000, `s.b`/`s.a` at 1227400).
 */
import { fetchCachedJson, type CacheOptions } from "../cache.ts";
import { pricingUrl } from "../endpoints.ts";
import { EngineError } from "../engine/errors.ts";
import type { PriceRecord } from "./pricing.ts";

export interface Plc2Manifest {
  serviceId: string;
  source: string;
  currencyCode?: string;
  /** Selectors that make up the index path, in order. Additional items only. */
  primarySelectors?: string[];
  secondarySelectors?: string[];
  /** Regions the item does not price; live skips the item entirely. */
  excludedRegions?: string[];
  [key: string]: unknown;
}

/**
 * A PLC_2.0 remap, in live `s.b`/`s.a` terms: `keyName` renames selector keys,
 * `keyValue` maps raw price tokens to the labels the form shows, and
 * `constant` injects fixed selector values (and, for aggregations, filters the
 * rows that already disagree with them).
 */
export interface Plc2Remap {
  keyName?: Record<string, string>;
  keyValue?: Record<string, string>;
  constant?: Record<string, string>;
}

/**
 * One cargo item: the component's own PLC_2.0 artifact, or an
 * `additionalPricingData` join. Live `getData` builds
 * `{manifest, pricingUnitModel, remap}` and prices from whichever item's
 * aggregation row the selected values matched (`selectedCargoItem`).
 */
export interface Plc2CargoItem {
  name?: string;
  manifest: Plc2Manifest;
  pricingUnitModel?: Record<string, unknown>;
  remap?: Plc2Remap;
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
  /**
   * The cargo item that priced this configuration. Equal to the component's own
   * artifact unless the matched aggregation row came from an
   * `additionalPricingData` join; `regionPrices`, `setMeters`, the pricing unit
   * model, and the remap all come from this item. Absent for hand-built
   * fixtures, which then fall back to the component itself.
   */
  pricedItem?: Plc2CargoItem;
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
  /**
   * `additionalPricingData` from the component: joined PLC_2.0 cargo items.
   * Their aggregation rows join the selector tree and, when a supplied value
   * only exists there, they price the component.
   */
  additionalPricingData?: unknown;
  cache?: CacheOptions;
}

/** Apply `remap.keyValue` forward, the way live `b`/`o`/`d` do. */
export function remapValue(
  keyValue: Record<string, string> | undefined,
  value: string
): string {
  if (!keyValue) return value;
  return keyValue[value] || value;
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

/**
 * Remap a record's fields the way live `s.b` (records) does: rename keys with
 * `keyName`, map values with `keyValue`, then overwrite `constant` fields.
 */
function remapFields(
  fields: Record<string, unknown>,
  remap: Plc2Remap | undefined
): Record<string, unknown> {
  if (!remap) return fields;
  const keyName = remap.keyName ?? {};
  const keyValue = remap.keyValue ?? {};
  const constant = remap.constant ?? {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    next[keyName[key] || key] =
      typeof value === "string" ? keyValue[value] || value : value;
  }
  for (const [key, value] of Object.entries(constant)) next[key] = value;
  return next;
}

function remapAggregations(
  aggregations: Plc2Aggregation[],
  remap: Plc2Remap | undefined
): Plc2Aggregation[] {
  if (!remap) return aggregations;
  const constant = remap.constant ?? {};
  // Live `c`: a row survives when it carries no value that contradicts a
  // constant, so a joined artifact that only prices one option can be filtered
  // down before the constant fills the rest in.
  const rows =
    Object.keys(constant).length > 0
      ? aggregations.filter((row) =>
          Object.entries(constant).every(
            ([key, value]) =>
              row.selectors[key] === undefined || row.selectors[key] === value
          )
        )
      : aggregations;
  return rows.map((row) => ({
    ...row,
    selectors: remapFields(row.selectors, remap) as Record<string, string>,
  }));
}

function remapRecords(
  records: Record<string, PriceRecord>,
  remap: Plc2Remap | undefined
): Record<string, PriceRecord> {
  if (!remap) return records;
  const remapped: Record<string, PriceRecord> = {};
  for (const [meter, record] of Object.entries(records)) {
    remapped[meter] = remapFields(
      { ...(record as unknown as Record<string, unknown>) },
      remap
    ) as unknown as PriceRecord;
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
  /** Position of the matched row in the array that was searched. */
  rowIndex?: number;
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
    const row = exact[0]!;
    return {
      selectors: { ...wanted, ...row.selectors },
      exact: true,
      diffs: [],
      rowIndex: aggregations.indexOf(row),
    };
  }
  let best: Record<string, string> | undefined;
  let bestIndex = -1;
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
      bestIndex = aggregations.indexOf(row);
    }
  }
  if (!best) return undefined;
  const diffs = Object.keys(wanted).filter((selector) => best![selector] !== wanted[selector]);
  return { selectors: { ...wanted, ...best }, exact: false, diffs, rowIndex: bestIndex };
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

  // Live `getData`: `item: [{name: "default", manifest, pricingUnitModel,
  // remap}, ...additionalPricingData]`. The component's own artifact comes
  // first; every joined artifact contributes its aggregation rows to the same
  // selector tree and can price the component when the matched row is its own.
  const items: Plc2CargoItem[] = [
    {
      name: "default",
      manifest: metadata.manifest,
      ...(options.remap ? { remap: options.remap } : {}),
    },
    ...additionalCargoItems(options.additionalPricingData),
  ];

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
  // The live engine remaps the aggregation rows and the price records before it
  // matches anything (`s.b` and `s.a`, keys with `keyName`, values with
  // `keyValue`, fixed values with `constant`), so both sides speak the display
  // labels the form shows (`1000 MBps/TiB`, `No Cache`, `Database Savings
  // Plans`). Each cargo item remaps with its own map.
  const joined: JoinedCargoRows[] = [];
  for (let index = 1; index < items.length; index += 1) {
    const item = items[index]!;
    const excluded = item.manifest.excludedRegions;
    if (Array.isArray(excluded) && excluded.includes(options.regionName)) continue;
    const rows = await fetchJoinedAggregations(item, options);
    if (!rows) continue;
    joined.push({ itemIndex: index, rows, ...(item.remap ? { remap: item.remap } : {}) });
  }
  const { rows: aggregations, rowItem } = mergeCargoAggregations(
    aggregationFile.aggregations,
    items[0]?.remap,
    joined
  );

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
  // Live returns the cargo item the matched aggregation row came from and
  // prices from that item's manifest, index path, and pricing unit model.
  const pricedIndex = match.rowIndex === undefined ? 0 : rowItem[match.rowIndex] ?? 0;
  const priced = items[pricedIndex] ?? items[0]!;
  const pricedPrimary =
    pricedIndex === 0 ? primarySelectors : priced.manifest.primarySelectors ?? primarySelectors;
  const pricedSecondary =
    pricedIndex === 0 ? secondarySelectors : priced.manifest.secondarySelectors ?? [];
  const pricedKeyValue = priced.remap?.keyValue;
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
  const keyName = priced.remap?.keyName ?? {};
  const pathKeys = pricedPrimary.concat(pricedSecondary);
  const pathValues = pathKeys.map((selector) => {
    const value = pathSelectors[keyName[selector] ?? selector];
    // The index path uses the raw price values, so display labels are mapped
    // back with this item's `keyValue` map.
    return value === undefined ? undefined : reverseRemapValue(pricedKeyValue, String(value));
  });
  // Live `u` joins the primary and secondary selectors and drops the empty
  // ones (`filter(Boolean)`); a joined artifact can put a selector in either
  // list. A declared primary selector that never got a value is still a
  // definition error here, because the shorter path would silently price a
  // different configuration.
  if (pathValues.slice(0, pricedPrimary.length).some((value) => value === undefined)) {
    throw new EngineError(
      `PLC_2.0 aggregation row is missing a primary selector value for ` +
        `${pricedPrimary.join(", ")}`,
      "BAD_DEFINITION",
      { selectors, primarySelectors: pricedPrimary }
    );
  }
  const indexPath = pathValues
    .filter((value): value is string => value !== undefined && value !== "")
    .map((value) => encodeURIComponent(value))
    .join("/");
  const indexBase = pricedIndex === 0 ? base : cargoBase(priced, options.currency);
  const indexUrl = `${indexBase}/${indexPath}/index.json`;
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
  const regionPrices = remapRecords(rawRegionPrices, priced.remap);
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
    pricedItem: priced,
  };
}

/**
 * Normalize `additionalPricingData` into cargo items. The catalog carries the
 * joined artifacts as an array of `{name, manifest, remap, pricingUnitModel}`;
 * anything without a usable manifest is inert, which is what the live fetch
 * does when the extra artifact request fails (`Additional Pricing Artifacts API
 * failed quietly`).
 */
export function additionalCargoItems(raw: unknown): Plc2CargoItem[] {
  if (!Array.isArray(raw)) return [];
  const items: Plc2CargoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const manifest = record["manifest"];
    if (!manifest || typeof manifest !== "object") continue;
    const typed = manifest as Plc2Manifest;
    if (typeof typed.serviceId !== "string" || typeof typed.source !== "string") continue;
    items.push({
      ...(typeof record["name"] === "string" ? { name: record["name"] } : {}),
      manifest: typed,
      ...(record["remap"] && typeof record["remap"] === "object"
        ? { remap: record["remap"] as Plc2Remap }
        : {}),
      ...(record["pricingUnitModel"] && typeof record["pricingUnitModel"] === "object"
        ? { pricingUnitModel: record["pricingUnitModel"] as Record<string, unknown> }
        : {}),
    });
  }
  return items;
}

/** One fetched joined item and the rows live would append for it. */
export interface JoinedCargoRows {
  /** Position in `getData`'s `item` list (0 is the component's own artifact). */
  itemIndex: number;
  rows: Plc2Aggregation[];
  remap?: Plc2Remap;
}

/**
 * Concatenate the aggregation rows of every cargo item the way live `c` does:
 * the component's own rows first, then each joined item in list order, each
 * remapped with its own map. `rowItem` keeps the item each row came from, which
 * is how `selectedCargoItem` is found after the values match a row.
 */
export function mergeCargoAggregations(
  mainRows: Plc2Aggregation[],
  mainRemap: Plc2Remap | undefined,
  joined: JoinedCargoRows[]
): { rows: Plc2Aggregation[]; rowItem: number[] } {
  const rows: Plc2Aggregation[] = [];
  const rowItem: number[] = [];
  for (const row of remapAggregations(mainRows, mainRemap)) {
    rows.push(row);
    rowItem.push(0);
  }
  for (const item of joined) {
    for (const row of remapAggregations(item.rows, item.remap)) {
      rows.push(row);
      rowItem.push(item.itemIndex);
    }
  }
  return { rows, rowItem };
}

function cargoBase(item: Plc2CargoItem, currency: string): string {
  return pricingUrl(
    `pricing/2.0/meteredUnitMaps/${item.manifest.serviceId}/${currency}/current/` +
      `${item.manifest.source}`,
    currency
  );
}

/**
 * Fetch one joined artifact's aggregation rows for this region. Live fetches
 * every additional item quietly: a failed extra request is dropped instead of
 * failing the component.
 */
async function fetchJoinedAggregations(
  item: Plc2CargoItem,
  options: LoadColumnFormOptions
): Promise<Plc2Aggregation[] | undefined> {
  const url =
    `${cargoBase(item, options.currency)}/` +
    `${encodeURIComponent(options.regionName)}/primary-selector-aggregations.json`;
  let body: unknown;
  try {
    body = await fetchCachedJson(url, options.cache ?? {});
  } catch {
    return undefined;
  }
  if (!body || typeof body !== "object") return undefined;
  const file = body as Plc2Aggregations;
  return Array.isArray(file.aggregations) ? file.aggregations : undefined;
}
