import { fetchCachedJson, type CacheOptions } from "../cache.ts";
import { ENDPOINTS } from "../endpoints.ts";

export interface CatalogEntry {
  name: string;
  serviceCode: string;
  description?: string;
  searchKeywords?: string[];
  type: "AWSService" | "static";
  regions?: string[];
  linkUrl?: string;
  isActive?: string;
  disableConfigure?: boolean;
  serviceDefinitionLocation?: string;
  serviceDefinitionUrlPath?: string;
  templates?: string[];
  subType?: string;
  disableRegionSupport?: boolean;
  slug?: string;
}

export interface Catalog {
  awsServices: CatalogEntry[];
  static?: unknown;
}

export type RegionMap = Record<string, string[]>;

export interface LocationRecord {
  name: string;
  code: string;
  type: string;
  label: string;
  continent?: string;
}

export type Locations = Record<string, LocationRecord>;

/** Service codes hidden from the region-aware catalog for reasons outside the rule. */
export const HIDDEN_SERVICE_CODES = new Set(["amazonTechnic"]);

/** Subtypes that are never top-level "Add service" entries. */
export const NON_TOP_LEVEL_SUBTYPES = new Set(["subService", "TCOCalculator"]);

export async function loadCatalog(options: CacheOptions = {}): Promise<Catalog> {
  return fetchCachedJson<Catalog>(ENDPOINTS.catalog, options);
}

export async function loadRegionMap(options: CacheOptions = {}): Promise<RegionMap> {
  return fetchCachedJson<RegionMap>(ENDPOINTS.regionList, options);
}

export async function loadLocations(options: CacheOptions = {}): Promise<Locations> {
  return fetchCachedJson<Locations>(ENDPOINTS.locations, options);
}

export function regionName(locations: Locations, regionCode: string): string | undefined {
  for (const record of Object.values(locations)) {
    if (record.code === regionCode) return record.name;
  }
  return undefined;
}

export function regionCodeByName(locations: Locations, name: string): string | undefined {
  return locations[name]?.code;
}

export function serviceByCode(catalog: Catalog, serviceCode: string): CatalogEntry | undefined {
  return catalog.awsServices.find((entry) => entry.serviceCode === serviceCode);
}

/** True when the service or any of its selector templates is priced in `region`. */
export function serviceSupportsRegion(
  entry: CatalogEntry,
  regionMap: RegionMap,
  region: string
): boolean {
  const own = regionMap[entry.serviceCode];
  if (own?.includes(region)) return true;
  if (entry.subType === "subServiceSelector") {
    return (entry.templates ?? []).some((code) => regionMap[code]?.includes(region));
  }
  return false;
}

export interface VisibleServiceOptions {
  region: string;
  /** Include services with no regional coverage ("search all services" mode). */
  all?: boolean;
  query?: string;
}

/**
 * Region-aware top-level service list, reproducing the web app rule:
 * active, not a sub-service or TCO tool, configure enabled, and available in
 * the region (directly or through a selector child).
 */
export function visibleServices(
  catalog: Catalog,
  regionMap: RegionMap,
  options: VisibleServiceOptions
): CatalogEntry[] {
  const query = options.query?.trim().toLowerCase();
  return catalog.awsServices.filter((entry) => {
    if (entry.type !== "AWSService") return false;
    if (entry.isActive !== "true") return false;
    if (HIDDEN_SERVICE_CODES.has(entry.serviceCode)) return false;
    if (entry.subType && NON_TOP_LEVEL_SUBTYPES.has(entry.subType)) return false;
    if (entry.disableConfigure) return false;
    if (!options.all && !serviceSupportsRegion(entry, regionMap, options.region)) return false;
    if (query) {
      const haystack = `${entry.name} ${entry.serviceCode} ${(entry.searchKeywords ?? []).join(" ")}`
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function catalogEntryType(entry: CatalogEntry): "selector" | "service" | "tco" {
  if (entry.subType === "subServiceSelector") return "selector";
  if (entry.subType === "TCOCalculator") return "tco";
  return "service";
}
