import type { ParsedArgs } from "../cli/args.ts";
import { booleanFlag } from "../cli/args.ts";
import { buildEstimate, type BuildResult } from "../estimate/builder.ts";
import type { EstimateSpec } from "../estimate/spec.ts";
import {
  cacheOptions,
  loadConfig,
  loadDataPlane,
  readSpec,
  requirePositional,
  twelveMonth,
} from "./shared.ts";

export const costFlags = {
  "--full": { type: "boolean" as const, description: "include per-service and per-subtotal math" },
  "--refresh": { type: "boolean" as const, description: "ignore the cached data plane" },
  "--offline": { type: "boolean" as const, description: "never touch the network" },
};

export const costHelp = `aws-calc-axi cost - compute an estimate without publishing

Usage:
  aws-calc-axi cost <estimate.yaml> [--full]

Flags:
  --full       include per-service costs and subtotal components
  --refresh    ignore the cached data plane
  --offline    never touch the network

Examples:
  aws-calc-axi cost estimate.yaml
  aws-calc-axi cost estimate.yaml --full
`;

export async function buildFromSpec(
  spec: EstimateSpec,
  flags: ParsedArgs["flags"]
): Promise<BuildResult> {
  const cache = cacheOptions(flags);
  const { catalog } = await loadDataPlane(flags);
  const supportConfig = spec.support ? await loadConfig(flags) : undefined;
  return buildEstimate(spec, {
    catalog,
    cache,
    ...(supportConfig ? { supportConfig } : {}),
  });
}

export function costSummary(result: BuildResult): Record<string, unknown> {
  const monthly = result.serviceTotal.monthly;
  const upfront = result.serviceTotal.upfront;
  const support = result.support;
  const cost: Record<string, unknown> = {
    monthly,
    upfront,
    total12m: twelveMonth(monthly, upfront),
    currency: result.estimate.metaData.currency,
  };
  if (support) {
    cost["supportMonthly"] = support.cost.monthly;
    cost["includingSupportMonthly"] = Math.round((monthly + support.cost.monthly) * 100) / 100;
    cost["includingSupport12m"] =
      Math.round((twelveMonth(monthly, upfront) + support.cost.monthly * 12) * 100) / 100;
  }
  return cost;
}

export async function costCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  if (args.help) return { help: costHelp };
  const path = requirePositional(args, "cost", "an estimate file");
  const spec = await readSpec(path);
  const result = await buildFromSpec(spec, args.flags);
  const full = booleanFlag(args.flags, "full");

  const output: Record<string, unknown> = {
    estimate: {
      name: spec.name,
      services: result.services.length,
      groups: countGroups(spec),
      ...(result.support ? { support: result.support.title } : {}),
    },
    cost: costSummary(result),
  };

  if (full) {
    output["services"] = result.services.map((entry) => ({
      code: entry.evaluated.serviceCode,
      name: entry.evaluated.serviceName,
      region: entry.evaluated.region,
      template: entry.evaluated.estimateFor,
      monthly: entry.evaluated.serviceCost.monthly ?? 0,
      upfront: entry.evaluated.serviceCost.upfront ?? 0,
      summary: entry.evaluated.configSummary,
    }));
    output["subtotals"] = result.services.flatMap((entry) =>
      entry.evaluated.subtotals.map((subtotal) => ({
        service: entry.evaluated.serviceCode,
        component: subtotal.componentId,
        costType: subtotal.costType,
        value: subtotal.value,
      }))
    );
  }

  output["help"] = [
    `Run \`aws-calc-axi publish ${path}\` to create and render-verify the public link`,
    `Run \`aws-calc-axi cost ${path} --full\` for per-service and subtotal math`,
  ];
  return output;
}

function countGroups(spec: EstimateSpec): number {
  const count = (groups: EstimateSpec["groups"]): number =>
    groups.reduce((total, group) => total + 1 + count(group.groups), 0);
  return count(spec.groups);
}

