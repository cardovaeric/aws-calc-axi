import type { ParsedArgs } from "../cli/args.ts";
import { stringFlag } from "../cli/args.ts";
import { buildFromSpec } from "./cost.ts";
import { readSpec, requirePositional } from "./shared.ts";
import { diffRendered, readRenderedEstimate, type Mismatch, type RenderedEstimate } from "../verify.ts";
import { expectationFrom } from "./publish.ts";
import { retrieveEstimate } from "../publish.ts";
import { savedKeyFromUrl } from "../endpoints.ts";

export const verifyFlags = {
  "--expect": { type: "string" as const, description: "estimate file to compare against" },
  "--session": { type: "string" as const, description: "agent-browser session name" },
  "--refresh": { type: "boolean" as const, description: "ignore the cached data plane" },
  "--offline": { type: "boolean" as const, description: "never touch the network" },
};

export const verifyHelp = `aws-calc-axi verify - re-read a public estimate page and assert it

Usage:
  aws-calc-axi verify <url> [--expect estimate.yaml]

Flags:
  --expect <path>  compute the estimate natively and diff it against the page
  --session <name> agent-browser session (default aws-calc-axi-e2e)
  --refresh        ignore the cached data plane
  --offline        never touch the network

Examples:
  aws-calc-axi verify "https://calculator.aws/#/estimate?id=<key>"
  aws-calc-axi verify "https://calculator.aws/#/estimate?id=<key>" --expect estimate.yaml
`;

export interface VerifyReport {
  rendered: RenderedEstimate;
  stored: {
    name: string;
    savedKey: string;
    totalCost: { monthly: number; upfront: number };
    services: Array<{ serviceCode: string; monthly: number; upfront: number }>;
  } | null;
  mismatches: Mismatch[];
  verdict: "pass" | "fail";
}

export async function verifyUrl(
  url: string,
  options: { expectPath?: string | undefined; session?: string | undefined; flags: ParsedArgs["flags"] }
): Promise<VerifyReport> {
  const savedKey = savedKeyFromUrl(url);
  const rendered = readRenderedEstimate(url, {
    ...(options.session ? { session: options.session } : {}),
  });

  let stored: VerifyReport["stored"] = null;
  if (savedKey) {
    const estimate = await retrieveEstimate(savedKey);
    stored = {
      name: estimate.name,
      savedKey,
      totalCost: estimate.totalCost,
      services: Object.values(estimate.services).flatMap((service) => [
        {
          serviceCode: service.serviceCode,
          monthly: service.serviceCost.monthly ?? 0,
          upfront: service.serviceCost.upfront ?? 0,
        },
        ...(service.subServices ?? []).map((child) => ({
          serviceCode: child.serviceCode,
          monthly: child.serviceCost.monthly ?? 0,
          upfront: child.serviceCost.upfront ?? 0,
        })),
      ]),
    };
  }

  let mismatches: Mismatch[] = [];
  if (options.expectPath) {
    const spec = await readSpec(options.expectPath);
    const result = await buildFromSpec(spec, options.flags);
    mismatches = diffRendered(rendered, expectationFrom(result, spec));
  }

  return {
    rendered,
    stored,
    mismatches,
    verdict: mismatches.length === 0 ? "pass" : "fail",
  };
}

export async function verifyCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  if (args.help) return { help: verifyHelp };
  const url = requirePositional(args, "verify", "a public estimate URL");
  const report = await verifyUrl(url, {
    expectPath: stringFlag(args.flags, "expect"),
    session: stringFlag(args.flags, "session"),
    flags: args.flags,
  });
  if (report.verdict !== "pass") process.exitCode = 1;
  return {
    page: {
      url: report.rendered.url,
      title: report.rendered.title,
      monthly: report.rendered.monthly,
      upfront: report.rendered.upfront,
      annual: report.rendered.annual,
      services: report.rendered.services.length,
      groups: report.rendered.groups.length,
      support: report.rendered.supportRow?.name ?? "none",
      banner: report.rendered.banner,
    },
    stored: report.stored,
    ...(report.mismatches.length > 0 ? { mismatches: report.mismatches } : {}),
    verdict: report.verdict,
  };
}
