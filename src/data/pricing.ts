import { fetchCachedJson, type CacheOptions } from "../cache.ts";
import { pricingUrl } from "../endpoints.ts";
import type { MappingDefinition } from "./definitions.ts";

export interface PriceRecord {
  price: string;
  rateCode?: string;
  RegionlessRateCode?: string;
}

export interface PricingFile {
  manifest?: {
    serviceId?: string;
    currencyCode?: string;
    hawkFilePublicationDate?: string;
    source?: string;
    [key: string]: unknown;
  };
  sets?: Record<string, unknown>;
  regions: Record<string, Record<string, PriceRecord>>;
}

export class MissingPriceError extends Error {
  readonly meter: string;
  readonly region: string;
  readonly mappingDefinition: string;

  constructor(meter: string, region: string, mappingDefinition: string) {
    super(
      `no price for metered unit "${meter}" in ${region} ` +
        `(mapping definition "${mappingDefinition}")`
    );
    this.name = "MissingPriceError";
    this.meter = meter;
    this.region = region;
    this.mappingDefinition = mappingDefinition;
  }
}

const memo = new Map<string, PricingFile>();

/** Pricing files can carry region-less meters under one of these keys. */
const NON_REGION_KEYS = ["Any", "any", "", "all", "All", "All regions"];

/**
 * Merge region-less meters into every regional price map, exactly as the live
 * data loader does. Without this, meters like CloudWatch's tiered request price
 * look missing in a region that actually inherits them.
 */
export function mergeNonRegionPrices(file: PricingFile): PricingFile {
  const regions = file.regions ?? {};
  let shared: Record<string, PriceRecord> = {};
  for (const key of NON_REGION_KEYS) {
    const bucket = regions[key];
    if (bucket) shared = { ...shared, ...bucket };
  }
  if (Object.keys(shared).length === 0) return file;

  const merged: Record<string, Record<string, PriceRecord>> = {};
  for (const [region, prices] of Object.entries(regions)) {
    merged[region] = NON_REGION_KEYS.includes(region) ? prices : { ...shared, ...prices };
  }
  return { ...file, regions: merged };
}

export async function loadMapping(
  mapping: MappingDefinition,
  currency: string,
  options: CacheOptions = {}
): Promise<PricingFile> {
  const url = pricingUrl(mapping.mappingDefinitionURL, currency);
  const cached = memo.get(url);
  if (cached) return cached;
  const file = await fetchCachedJson<PricingFile>(url, options);
  if (!file || typeof file.regions !== "object" || file.regions === null) {
    throw new Error(`pricing file ${url} has no regions`);
  }
  const merged = mergeNonRegionPrices(file);
  memo.set(url, merged);
  return merged;
}

export function clearPricingMemo(): void {
  memo.clear();
}

export interface PriceContext {
  currency: string;
  regionName: string;
  mappings: Map<string, PricingFile>;
  mappingByName: Map<string, MappingDefinition>;
}

export interface PriceResolver {
  /** Resolve a metered unit price, or undefined when the unit is absent. */
  price(mappingDefinitionName: string, meteredUnit: string): number | undefined;
  /** Resolve or throw. Use when a visible component genuinely needs the price. */
  requirePrice(mappingDefinitionName: string, meteredUnit: string): number;
  /** Whether a metered unit exists in this region (drives displayIf `exists`). */
  has(mappingDefinitionName: string, meteredUnit: string): boolean;
  /** Raw price record, for definitions that read a non-price field. */
  record(mappingDefinitionName: string, meteredUnit: string): PriceRecord | undefined;
  regionName: string;
  currency: string;
}

export function createPriceResolver(context: PriceContext): PriceResolver {
  const lookup = (mappingDefinitionName: string, meteredUnit: string): PriceRecord | undefined => {
    const file = context.mappings.get(mappingDefinitionName);
    if (!file) {
      throw new Error(
        `pricing mapping "${mappingDefinitionName}" was not loaded; ` +
          `add it to the definition's mappingDefinitions`
      );
    }
    const region = file.regions[context.regionName];
    if (!region) return undefined;
    return region[meteredUnit];
  };

  return {
    regionName: context.regionName,
    currency: context.currency,
    price(mappingDefinitionName, meteredUnit) {
      const record = lookup(mappingDefinitionName, meteredUnit);
      if (!record) return undefined;
      const value = Number(record.price);
      return Number.isFinite(value) ? value : undefined;
    },
    requirePrice(mappingDefinitionName, meteredUnit) {
      const value = this.price(mappingDefinitionName, meteredUnit);
      if (value === undefined) {
        throw new MissingPriceError(meteredUnit, context.regionName, mappingDefinitionName);
      }
      return value;
    },
    has(mappingDefinitionName, meteredUnit) {
      return lookup(mappingDefinitionName, meteredUnit) !== undefined;
    },
    record(mappingDefinitionName, meteredUnit) {
      return lookup(mappingDefinitionName, meteredUnit);
    },
  };
}

/** Load every mapping definition a service declares. */
export async function loadServiceMappings(
  mappings: MappingDefinition[],
  currency: string,
  options: CacheOptions = {}
): Promise<{ mappings: Map<string, PricingFile>; mappingByName: Map<string, MappingDefinition> }> {
  const loaded = await Promise.all(
    mappings.map(async (mapping) => ({
      mapping,
      file: await loadMapping(mapping, currency, options),
    }))
  );
  return {
    mappings: new Map(loaded.map(({ mapping, file }) => [mapping.mappingDefinitionName, file])),
    mappingByName: new Map(loaded.map(({ mapping }) => [mapping.mappingDefinitionName, mapping])),
  };
}
