import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ParsedArgs } from "../cli/args.ts";
import { stringFlag } from "../cli/args.ts";
import { buildFromSpec, costSummary } from "./cost.ts";
import { readSpec, requirePositional, twelveMonth } from "./shared.ts";
import { publishEstimate, retrieveEstimate } from "../publish.ts";
import {
  diffRendered,
  readRenderedEstimate,
  type Mismatch,
  type RenderedEstimate,
  type RenderedExpectation,
} from "../verify.ts";
import type { BuildResult } from "../estimate/builder.ts";
import type { EstimateSpec } from "../estimate/spec.ts";
import type { Estimate } from "../contract.ts";

export const publishFlags = {
  "--name": { type: "string" as const, description: "override the estimate name" },
  "--receipt": { type: "string" as const, description: "write a JSON receipt to this path" },
  "--session": { type: "string" as const, description: "agent-browser session name" },
  "--refresh": { type: "boolean" as const, description: "ignore the cached data plane" },
  "--offline": { type: "boolean" as const, description: "never touch the network" },
};

export const publishHelp = `aws-calc-axi publish - build, publish, open, and render-verify

Usage:
  aws-calc-axi publish <estimate.yaml> [--name "..."] [--receipt receipts/x.json]

Flags:
  --name <text>    override the estimate name (use an axi-e2e prefix for tests)
  --receipt <path> write a JSON receipt with the rendered DOM snapshot
  --session <name> agent-browser session (default aws-calc-axi-e2e)
  --refresh        ignore the cached data plane
  --offline        never touch the network

A publish is only complete after the public URL is opened and the rendered DOM
matches the computed estimate. The saved key alone is not a receipt.

Examples:
  aws-calc-axi publish estimate.yaml --receipt receipts/s3.json
  aws-calc-axi publish estimate.yaml --name "axi-e2e S3 Standard"
`;

export interface PublicationReceipt {
  estimate: string;
  url: string;
  savedKey: string;
  publishedAt: string;
  expires: string;
  native: Record<string, unknown>;
  stored: {
    services: Array<{ serviceCode: string; monthly: number; upfront: number }>;
    totalCost: Estimate["totalCost"];
  };
  rendered: RenderedEstimate;
  expectation: RenderedExpectation;
  mismatches: Mismatch[];
  verdict: "pass" | "fail";
}

export function expectationFrom(result: BuildResult, spec: EstimateSpec): RenderedExpectation {
  const monthly =
    Math.round((result.serviceTotal.monthly + (result.support?.cost.monthly ?? 0)) * 100) / 100;
  const upfront = result.serviceTotal.upfront;
  return {
    title: spec.name,
    monthly,
    upfront,
    annual: twelveMonth(monthly, upfront),
    services: result.services.map((entry) => ({
      name: entry.evaluated.serviceName,
      monthly: entry.evaluated.serviceCost.monthly ?? 0,
      ...(entry.evaluated.serviceCost.upfront === undefined
        ? {}
        : { upfront: entry.evaluated.serviceCost.upfront }),
      region: entry.evaluated.regionName,
      ...(entry.evaluated.configSummary
        ? { configSummary: entry.evaluated.configSummary }
        : {}),
    })),
    ...(result.support
      ? { support: { nameContains: result.support.title, monthly: result.support.cost.monthly } }
      : {}),
    groups: collectGroupNames(spec),
  };
}

function collectGroupNames(spec: EstimateSpec): string[] {
  const names: string[] = [];
  const walk = (groups: EstimateSpec["groups"]): void => {
    for (const group of groups) {
      names.push(group.name);
      walk(group.groups);
    }
  };
  walk(spec.groups);
  return names;
}

function storedComparison(stored: Estimate): PublicationReceipt["stored"] {
  const services = Object.values(stored.services).flatMap((service) => [
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
  ]);
  return { services, totalCost: stored.totalCost };
}

export interface PublishOptions {
  specPath: string;
  name?: string | undefined;
  receiptPath?: string | undefined;
  session?: string | undefined;
  flags: ParsedArgs["flags"];
}

export async function runPublish(options: PublishOptions): Promise<{
  receipt: PublicationReceipt;
  result: BuildResult;
}> {
  const spec = await readSpec(options.specPath, {
    ...(options.name ? { name: options.name } : {}),
  });
  const result = await buildFromSpec(spec, options.flags);
  const publication = await publishEstimate(result.estimate);
  const stored = await retrieveEstimate(publication.savedKey);
  const rendered = readRenderedEstimate(publication.url, {
    ...(options.session ? { session: options.session } : {}),
    waitText: spec.name,
  });
  const expectation = expectationFrom(result, spec);
  const mismatches = diffRendered(rendered, expectation);
  const createdOn = stored.metaData.createdOn ?? publication.publishedAt;
  const expires = expiryOf(createdOn);

  const receipt: PublicationReceipt = {
    estimate: spec.name,
    url: publication.url,
    savedKey: publication.savedKey,
    publishedAt: publication.publishedAt,
    expires,
    native: {
      ...costSummary(result),
      services: result.services.map((entry) => ({
        code: entry.evaluated.serviceCode,
        template: entry.evaluated.estimateFor,
        region: entry.evaluated.region,
        monthly: entry.evaluated.serviceCost.monthly ?? 0,
        upfront: entry.evaluated.serviceCost.upfront ?? 0,
        summary: entry.evaluated.configSummary,
      })),
    },
    stored: storedComparison(stored),
    rendered,
    expectation,
    mismatches,
    verdict: mismatches.length === 0 ? "pass" : "fail",
  };

  if (options.receiptPath) {
    await mkdir(dirname(options.receiptPath), { recursive: true });
    await writeFile(options.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  }

  return { receipt, result };
}

export function expiryOf(createdOn: string): string {
  const date = new Date(createdOn);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

export function publishOutput(receipt: PublicationReceipt): Record<string, unknown> {
  return {
    publication: {
      url: receipt.url,
      savedKey: receipt.savedKey,
      estimate: receipt.estimate,
      monthly: receipt.rendered.monthlyValue,
      upfront: receipt.rendered.upfrontValue,
      annual: receipt.rendered.annualValue,
      expires: receipt.expires,
      render: receipt.verdict,
      verified: receipt.verdict === "pass",
      ...(receipt.rendered.banner ? { banner: receipt.rendered.banner } : {}),
    },
    ...(receipt.mismatches.length > 0 ? { mismatches: receipt.mismatches } : {}),
    help:
      receipt.verdict === "pass"
        ? [
            `Open ${receipt.url} to review the published page`,
            `Run \`aws-calc-axi verify ${receipt.url}\` to re-read the rendered DOM`,
          ]
        : ["Fix the mismatches above, then re-publish; the previous link keeps its old numbers"],
  };
}

export async function publishCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  if (args.help) return { help: publishHelp };
  const specPath = requirePositional(args, "publish", "an estimate file");
  const receiptPath = stringFlag(args.flags, "receipt");
  const { receipt } = await runPublish({
    specPath,
    name: stringFlag(args.flags, "name"),
    receiptPath,
    session: stringFlag(args.flags, "session"),
    flags: args.flags,
  });
  if (receipt.verdict !== "pass") process.exitCode = 1;
  return publishOutput(receipt);
}

