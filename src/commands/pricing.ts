import { AxiError } from "axi-sdk-js";
import type { ParsedArgs } from "../cli/args.ts";
import { stringFlag } from "../cli/args.ts";
import { cacheOptions, loadDataPlane, requirePositional, requireString } from "./shared.ts";
import { loadDefinition, templateById } from "../data/definitions.ts";
import { createPriceResolver, loadServiceMappings } from "../data/pricing.ts";
import { regionName } from "../data/catalog.ts";
import { CURRENCY } from "../endpoints.ts";

export const pricingFlags = {
  "--region": { type: "string" as const, description: "AWS region code (required)", value: "us-east-2" },
  "--template": { type: "string" as const, description: "template id (default: first template)" },
  "--unit": { type: "string" as const, description: "filter metered units by substring" },
  "--refresh": { type: "boolean" as const, description: "ignore the cached pricing files" },
  "--offline": { type: "boolean" as const, description: "never touch the network" },
};

export const pricingHelp = `aws-calc-axi pricing - resolved metered unit prices for a service

Usage:
  aws-calc-axi pricing <serviceCode> --region us-east-2 [--unit storage] [--template <id>]

Flags:
  --region <code>    region to resolve prices in (required)
  --template <id>    template id; default is the service's first template
  --unit <text>      filter on the metered unit label
  --refresh          ignore the cached pricing files
  --offline          never touch the network

Examples:
  aws-calc-axi pricing amazonS3Standard --region us-east-2 --unit "Standard Storage"
  aws-calc-axi pricing amazonCloudWatch --region us-east-1 --unit Dashboard
`;

interface PriceRow {
  component: string;
  mapping: string;
  unit: string;
  price: number | "missing";
  tier?: string;
}

export async function pricingCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  if (args.help) return { help: pricingHelp };
  const code = requirePositional(args, "pricing", "a service code");
  const region = requireString(args.flags, "region", "pricing");
  const filter = stringFlag(args.flags, "unit")?.toLowerCase();
  const cache = cacheOptions(args.flags);
  const definition = await loadDefinition(code, cache);
  const { locations } = await loadDataPlane(args.flags);
  const name = regionName(locations, region);
  if (!name) {
    throw new AxiError(`unknown region "${region}"`, "VALIDATION_ERROR", [
      "Region codes look like us-east-2",
    ]);
  }

  const template = templateById(definition, stringFlag(args.flags, "template"));
  if (!template) {
    throw new AxiError(`service ${code} has no such template`, "NOT_FOUND", [
      `templates: ${(definition.templates ?? []).map((entry) => entry.id).join(", ")}`,
    ]);
  }

  const { mappings } = await loadServiceMappings(definition.mappingDefinitions ?? [], CURRENCY, cache);
  const prices = createPriceResolver({
    currency: CURRENCY,
    regionName: name,
    mappings,
    mappingByName: new Map(),
  });

  const rows: PriceRow[] = [];
  for (const card of template.cards ?? []) {
    for (const component of card.inputSection?.components ?? []) {
      if (component.type !== "pricing") continue;
      const mapping = String(component["mappingDefinitionName"] ?? "");
      if (component.subType === "singlePricePoint") {
        const unit = resolveMeterLabel(component, region);
        if (filter && !unit.toLowerCase().includes(filter)) continue;
        const price = prices.price(mapping, unit);
        rows.push({
          component: component.id,
          mapping,
          unit,
          price: price ?? "missing",
        });
      } else if (component.subType === "tieredPricing") {
        const tiers = component["tiers"] as Record<string, unknown> | undefined;
        const selected = (tiers?.[region] ?? tiers?.["allRegions"]) as
          | Array<{ meteredUnit?: string; startOfTier?: number; endOfTier?: number }>
          | undefined;
        for (const tier of selected ?? []) {
          const unit = tier.meteredUnit ?? "";
          if (filter && !unit.toLowerCase().includes(filter)) continue;
          const price = prices.price(mapping, unit);
          rows.push({
            component: component.id,
            mapping,
            unit,
            price: price ?? "missing",
            tier: `${tier.startOfTier ?? 0}..${tier.endOfTier ?? -1}`,
          });
        }
      }
    }
  }

  const missing = rows.filter((row) => row.price === "missing").length;
  return {
    service: { code: definition.serviceCode, name: definition.serviceName.trim() },
    region,
    regionName: name,
    template: template.id,
    prices: rows,
    count: `${rows.length} metered units, ${missing} missing`,
    ...(missing > 0
      ? {
          help: [
            "Missing meters are hidden by displayIf in the web UI; the engine refuses to price them as zero",
          ],
        }
      : {}),
  };
}

function resolveMeterLabel(
  component: Record<string, unknown> & { [key: string]: unknown },
  region: string
): string {
  const meteredUnit = component["meteredUnit"];
  if (typeof meteredUnit === "string") return meteredUnit;
  if (typeof meteredUnit === "object" && meteredUnit !== null) {
    const record = meteredUnit as Record<string, unknown>;
    const regional = record[region];
    if (typeof regional === "string") return regional;
    const all = record["allRegions"];
    if (typeof all === "string") return all;
  }
  return "";
}

