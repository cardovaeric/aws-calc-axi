import { spawnSync } from "node:child_process";
import type { ParsedArgs } from "../cli/args.ts";
import { booleanFlag } from "../cli/args.ts";
import { cacheOptions, loadDataPlane } from "./shared.ts";
import { cacheStats } from "../cache.ts";
import { publishBudget } from "../publish.ts";
import { loadRuntimeConfig, supportPlans } from "../data/support.ts";
import { visibleServices } from "../data/catalog.ts";

export const doctorFlags = {
  "--refresh": { type: "boolean" as const, description: "ignore the cached data plane" },
  "--offline": { type: "boolean" as const, description: "never touch the network" },
};

export const doctorHelp = `aws-calc-axi doctor - data plane and tool health

Usage:
  aws-calc-axi doctor [--refresh] [--offline]

Checks the cached data plane, derived catalog counts, support plans, the publish
budget, and whether agent-browser is available for render verification.

Examples:
  aws-calc-axi doctor
  aws-calc-axi doctor --refresh
`;

export async function doctorCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  if (args.help) return { help: doctorHelp };
  const cache = await cacheStats();
  const budget = await publishBudget();
  const browser = spawnSync("agent-browser", ["--version"], { encoding: "utf8" });

  const problems: string[] = [];
  let data: Record<string, unknown>;
  try {
    const { catalog, regionMap, locations } = await loadDataPlane(args.flags);
    const use1 = visibleServices(catalog, regionMap, { region: "us-east-1" }).length;
    const use2 = visibleServices(catalog, regionMap, { region: "us-east-2" }).length;
    const config = await loadRuntimeConfig(cacheOptions(args.flags));
    const plans = Object.keys(supportPlans(config));
    data = {
      services: catalog.awsServices.length,
      regionMapEntries: Object.keys(regionMap).length,
      regions: new Set(
        Object.values(locations)
          .filter((entry) => entry.type === "AWS Region")
          .map((entry) => entry.code)
      ).size,
      visible: { "us-east-1": use1, "us-east-2": use2 },
      supportPlans: plans,
    };
    if (use1 !== 181) problems.push(`catalog parity: us-east-1 is ${use1}, expected 181`);
    if (use2 !== 160) problems.push(`catalog parity: us-east-2 is ${use2}, expected 160`);
  } catch (error) {
    data = { error: error instanceof Error ? error.message : String(error) };
    problems.push("data plane unavailable; run `aws-calc-axi services --refresh` once online");
  }

  const browserOk = browser.status === 0;
  if (!browserOk) problems.push("agent-browser not available; render verification cannot run");

  return {
    tool: {
      name: "aws-calc-axi",
      node: process.version,
      cache: cache.root,
      cachedResponses: cache.entries,
      offline: booleanFlag(args.flags, "offline"),
    },
    data,
    publish: { usedToday: budget.used, dailyLimit: budget.limit },
    browser: {
      available: browserOk,
      version: browserOk ? browser.stdout.trim() : undefined,
      session: process.env["AGENT_BROWSER_SESSION"] ?? "aws-calc-axi-e2e",
    },
    problems,
    verdict: problems.length === 0 ? "healthy" : "attention",
  };
}
