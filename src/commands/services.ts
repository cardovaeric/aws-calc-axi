import type { ParsedArgs } from "../cli/args.ts";
import { booleanFlag, stringFlag } from "../cli/args.ts";
import { loadDataPlane } from "./shared.ts";
import { catalogEntryType, visibleServices } from "../data/catalog.ts";

export const servicesFlags = {
  "--region": { type: "string" as const, description: "AWS region code", value: "us-east-1" },
  "--all": { type: "boolean" as const, description: "include services with no regional coverage" },
  "--query": { type: "string" as const, description: "substring filter on name, code, and keywords" },
  "--limit": { type: "number" as const, description: "maximum rows to print", value: "200" },
  "--refresh": { type: "boolean" as const, description: "ignore the cached data plane" },
  "--offline": { type: "boolean" as const, description: "never touch the network" },
};

export const servicesHelp = `aws-calc-axi services - list region-aware top-level services

Usage:
  aws-calc-axi services [--region us-east-2] [--query s3] [--all] [--limit 200]

Flags:
  --region <code>   region to resolve availability for (default us-east-1)
  --all             search all services, including ones without regional coverage
  --query <text>    filter on service name, code, and search keywords
  --limit <n>       maximum rows (default 200)
  --refresh         ignore the cached data plane
  --offline         never touch the network

Examples:
  aws-calc-axi services --region us-east-2 --query s3
  aws-calc-axi services --region us-east-1 --query lambda
  aws-calc-axi services --all --query bedrock
`;

export async function servicesCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  if (args.help) return { help: servicesHelp };
  const region = stringFlag(args.flags, "region") ?? "us-east-1";
  const { catalog, regionMap } = await loadDataPlane(args.flags);
  const all = booleanFlag(args.flags, "all");
  const query = stringFlag(args.flags, "query");
  const limit = typeof args.flags["limit"] === "number" ? (args.flags["limit"] as number) : 200;

  const matches = visibleServices(catalog, regionMap, {
    region,
    ...(all ? { all: true } : {}),
    ...(query ? { query } : {}),
  }).sort((left, right) => left.name.trim().localeCompare(right.name.trim()));

  const total = matches.length;
  const rows = matches.slice(0, limit).map((entry) => ({
    code: entry.serviceCode,
    name: entry.name.trim(),
    type: catalogEntryType(entry),
  }));

  const output: Record<string, unknown> = {
    region,
    mode: all ? "all services" : "region available",
    services: rows,
    count: `${rows.length} of ${total} services`,
  };
  if (total === 0) {
    output["note"] = `0 services matched${query ? ` "${query}"` : ""} for ${region}`;
  }
  const help: string[] = [];
  if (rows.length > 0) {
    const first = rows[0];
    if (first) help.push(`Run \`aws-calc-axi schema ${first.code} --region ${region}\` for inputs`);
  }
  if (total > rows.length) {
    help.push(`Raise --limit to see the remaining ${total - rows.length} services`);
  }
  output["help"] = help;
  return output;
}
