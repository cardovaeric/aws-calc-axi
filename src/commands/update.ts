import { createHash } from "node:crypto";
import { AxiError } from "axi-sdk-js";
import type { ParsedArgs } from "../cli/args.ts";
import { booleanFlag } from "../cli/args.ts";
import { fetchCached, peekCached } from "../cache.ts";
import { ENDPOINTS } from "../endpoints.ts";
import { loadCatalog, loadRegionMap, loadLocations } from "../data/catalog.ts";
import { loadRuntimeConfig, supportPlans } from "../data/support.ts";

export const updateFlags = {
  "--check": { type: "boolean" as const, description: "report data-plane drift without writing" },
  "--apply": { type: "boolean" as const, description: "refresh the cached data plane" },
  "--definitions": {
    type: "boolean" as const,
    description: "also refresh every service definition (slow)",
  },
};

export const updateHelp = `aws-calc-axi update - detect and refresh data-plane drift

Usage:
  aws-calc-axi update --check [--definitions]
  aws-calc-axi update --apply [--definitions]

Flags:
  --check         fetch fresh copies and report what changed (no writes)
  --apply         refresh the cache with fresh copies
  --definitions   include every service definition (slow, ~10 MB)

The manifest, definitions, prices, and support tiers are an unversioned data
plane. This command compares the cached snapshot with the live one.

Examples:
  aws-calc-axi update --check
  aws-calc-axi update --apply
`;

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

interface DriftRow {
  source: string;
  changed: boolean;
  detail: string;
}

async function compare(
  source: string,
  url: string,
  apply: boolean,
  summarize: (text: string) => string
): Promise<DriftRow> {
  const before = await peekCached(url);
  const fresh = await fetchCached(url, { refresh: true });
  if (apply) {
    return {
      source,
      changed: !before || before.body !== fresh,
      detail: `${summarize(fresh)} (sha ${sha(fresh)})`,
    };
  }
  if (!before) {
    return { source, changed: true, detail: `${summarize(fresh)} (not cached yet)` };
  }
  return {
    source,
    changed: before.body !== fresh,
    detail: before.body === fresh ? `unchanged (sha ${sha(fresh)})` : `changed -> ${summarize(fresh)}`,
  };
}

export async function updateCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  if (args.help) return { help: updateHelp };
  const apply = booleanFlag(args.flags, "apply");
  const check = booleanFlag(args.flags, "check");
  if (!apply && !check) {
    throw new AxiError("update needs --check or --apply", "VALIDATION_ERROR", [
      "Run `aws-calc-axi update --check` to inspect drift",
    ]);
  }

  const rows: DriftRow[] = [];
  rows.push(
    await compare("catalog", ENDPOINTS.catalog, apply, (text) => {
      const catalog = JSON.parse(text) as { awsServices?: unknown[] };
      return `${catalog.awsServices?.length ?? 0} services`;
    })
  );
  rows.push(
    await compare("regionList", ENDPOINTS.regionList, apply, (text) => {
      const map = JSON.parse(text) as Record<string, unknown>;
      return `${Object.keys(map).length} entries`;
    })
  );
  rows.push(
    await compare("runtimeConfig", ENDPOINTS.runtimeConfig, apply, (text) => {
      return `${text.length} bytes`;
    })
  );
  rows.push(
    await compare("locations", ENDPOINTS.locations, apply, (text) => {
      const locations = JSON.parse(text) as Record<string, unknown>;
      return `${Object.keys(locations).length} locations`;
    })
  );

  if (booleanFlag(args.flags, "definitions")) {
    const catalog = await loadCatalog({});
    for (const entry of catalog.awsServices) {
      const url = `${ENDPOINTS.definitionBase}/data/${entry.serviceCode}/en_US.json`;
      try {
        const row = await compare(`definition:${entry.serviceCode}`, url, apply, (text) => `${text.length} bytes`);
        if (!apply || row.changed) rows.push(row);
      } catch (error) {
        rows.push({
          source: `definition:${entry.serviceCode}`,
          changed: false,
          detail: `unavailable: ${error instanceof Error ? error.message.slice(0, 80) : String(error)}`,
        });
      }
    }
  }

  const config = await loadRuntimeConfig({});
  const planCount = Object.keys(supportPlans(config)).length;
  const regionMap = await loadRegionMap({});
  const locations = await loadLocations({});

  return {
    mode: apply ? "apply" : "check",
    drift: rows,
    changed: rows.filter((row) => row.changed).length,
    snapshot: {
      services: (await loadCatalog({})).awsServices.length,
      regionEntries: Object.keys(regionMap).length,
      locations: Object.keys(locations).length,
      supportPlans: planCount,
    },
    help: [apply ? "Cache refreshed; rerun the E2E matrix to re-verify" : "Run `aws-calc-axi update --apply` to refresh"],
  };
}
