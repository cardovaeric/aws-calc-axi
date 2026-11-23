import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPriceResolver, type PriceResolver, type PricingFile } from "../src/data/pricing.ts";

export const FIXTURES = join(import.meta.dirname, "fixtures");

export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

export function resolverFor(
  mappings: Record<string, PricingFile>,
  regionName = "US East (Ohio)"
): PriceResolver {
  return createPriceResolver({
    currency: "USD",
    regionName,
    mappings: new Map(Object.entries(mappings)),
    mappingByName: new Map(),
  });
}

export function s3Resolver(regionName = "US East (Ohio)"): PriceResolver {
  return resolverFor({ "s3-standard": fixture<PricingFile>("s3-standard.pricing.json") }, regionName);
}
