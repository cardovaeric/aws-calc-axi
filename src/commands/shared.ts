import { AxiError } from "axi-sdk-js";
import type { CacheOptions } from "../cache.ts";
import {
  loadCatalog,
  loadLocations,
  loadRegionMap,
  type Catalog,
  type Locations,
  type RegionMap,
} from "../data/catalog.ts";
import { loadRuntimeConfig, type FrontEndUi } from "../data/support.ts";
import { loadSpecFile, type EstimateSpec } from "../estimate/spec.ts";
import type { ParsedArgs } from "../cli/args.ts";

export function cacheOptions(flags: ParsedArgs["flags"]): CacheOptions {
  return {
    ...(flags["refresh"] === true ? { refresh: true } : {}),
    ...(flags["offline"] === true ? { offline: true } : {}),
    onNote: (message) => process.stderr.write(`${message}\n`),
  };
}

export function requirePositional(args: ParsedArgs, command: string, what: string): string {
  const value = args.positional[0];
  if (!value) {
    throw new AxiError(`${command} needs ${what}`, "VALIDATION_ERROR", [
      `Run \`${command} --help\` for usage`,
    ]);
  }
  return value;
}

export function requireString(
  flags: ParsedArgs["flags"],
  name: string,
  command: string
): string {
  const value = flags[name];
  if (typeof value !== "string" || value === "") {
    throw new AxiError(`${command} needs --${name}`, "VALIDATION_ERROR", [
      `Run \`${command} --help\` for usage`,
    ]);
  }
  return value;
}

export interface DataPlane {
  catalog: Catalog;
  regionMap: RegionMap;
  locations: Locations;
}

export async function loadDataPlane(flags: ParsedArgs["flags"]): Promise<DataPlane> {
  const cache = cacheOptions(flags);
  const [catalog, regionMap, locations] = await Promise.all([
    loadCatalog(cache),
    loadRegionMap(cache),
    loadLocations(cache),
  ]);
  return { catalog, regionMap, locations };
}

export async function loadConfig(flags: ParsedArgs["flags"]): Promise<FrontEndUi> {
  return loadRuntimeConfig(cacheOptions(flags));
}

export async function readSpec(
  path: string,
  overrides: { name?: string | undefined } = {}
): Promise<EstimateSpec> {
  try {
    const spec = await loadSpecFile(path);
    if (overrides.name) return { ...spec, name: overrides.name };
    return spec;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new AxiError(`no estimate file at ${path}`, "NOT_FOUND", [
        "Run `aws-calc-axi estimate init \"My estimate\" --out estimate.yaml` to scaffold one",
      ]);
    }
    throw error;
  }
}

export function money(value: number): string {
  return value.toFixed(2);
}

/** Total 12 month cost as the calculator renders it: monthly * 12 + upfront. */
export function twelveMonth(monthly: number, upfront: number): number {
  return Math.round((monthly * 12 + upfront) * 100) / 100;
}

export function expiresFrom(createdOn: string): string {
  const date = new Date(createdOn);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}
