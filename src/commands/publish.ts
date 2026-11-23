import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ParsedArgs } from "../cli/args.ts";
import { stringFlag } from "../cli/args.ts";
import { buildFromSpec, costSummary } from "./cost.ts";
import { readSpec, requirePositional, twelveMonth } from "./shared.ts";
import { publishEstimate, publishProbe, retrieveEstimate } from "../publish.ts";
import {
  captureScreenshot,
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
  "--oracle": {
    type: "boolean" as const,
    description: "publish a recompute probe and diff the live UI recomputation",
  },
  "--oracle-editor": {
    type: "boolean" as const,
    description:
      "recompute the published estimate in the live editor and diff it (for components the read-only probe drops, such as dataTransferV2)",
  },
  "--force-publish": {
    type: "boolean" as const,
    description: "ignore an existing receipt and create new links",
  },
  "--receipt": { type: "string" as const, description: "write a JSON receipt to this path" },
  "--screenshot": { type: "string" as const, description: "save a PNG of the rendered page" },
  "--session": { type: "string" as const, description: "agent-browser session name" },
  "--refresh": { type: "boolean" as const, description: "ignore the cached data plane" },
  "--offline": { type: "boolean" as const, description: "never touch the network" },
};

export const publishHelp = `aws-calc-axi publish - build, publish, open, and render-verify

Usage:
  aws-calc-axi publish <estimate.yaml> [--name "..."] [--receipt receipts/x.json]

Flags:
  --name <text>    override the estimate name (use an axi-e2e prefix for tests)
  --oracle         publish a recompute probe and diff the live UI recomputation
  --oracle-editor  open the published link, click Update estimate, and diff the
                   live editor recomputation (dataTransferV2 parity)
  --force-publish  create new links even when a matching receipt exists
  --receipt <path> write a JSON receipt with the rendered DOM snapshot
  --screenshot <path> save a PNG of the rendered page
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
  specHash: string;
  url: string;
  savedKey: string;
  publishedAt: string;
  expires: string;
  native: Record<string, unknown>;
  oracle?: {
    /**
     * `probe` is a second link whose page recomputes from
     * `calculationComponents`; `editor-recompute` opens the published link and
     * uses the calculator editor, which is the only live recomputation path
     * that rehydrates dataTransferV2 rows.
     */
    kind: "probe" | "editor-recompute";
    url: string;
    savedKey: string;
    recomputed: RenderedEstimate;
    mismatches: Mismatch[];
    verdict: "pass" | "fail";
  };
  stored: {
    services: Array<{ serviceCode: string; monthly: number; upfront: number }>;
    totalCost: Estimate["totalCost"];
  };
  rendered: RenderedEstimate;
  expectation: RenderedExpectation;
  mismatches: Mismatch[];
  verdict: "pass" | "fail";
}

export function expectationFrom(
  result: BuildResult,
  spec: EstimateSpec,
  includeConfigSummary = true
): RenderedExpectation {
  const monthly =
    Math.round((result.serviceTotal.monthly + (result.support?.cost.monthly ?? 0)) * 100) / 100;
  const upfront = result.serviceTotal.upfront;
  return {
    title: spec.name,
    monthly,
    upfront,
    annual: twelveMonth(monthly, upfront),
    services: result.services
      .filter((entry) => entry.path.startsWith("services["))
      .map((entry) => ({
      name: entry.evaluated.serviceName,
      monthly: entry.evaluated.serviceCost.monthly ?? 0,
      ...(entry.evaluated.serviceCost.upfront === undefined
        ? {}
        : { upfront: entry.evaluated.serviceCost.upfront }),
      region: entry.evaluated.regionName,
      ...(includeConfigSummary && entry.evaluated.configSummary
        ? { configSummary: entry.evaluated.configSummary }
        : {}),
    })),
    ...(result.support
      ? { support: { nameContains: result.support.title, monthly: result.support.cost.monthly } }
      : {}),
    groups: collectGroupNames(spec),
    groupRows: result.groups
      .filter((group) => group.path.split(".").length === 1)
      .map((group) => ({ name: group.name, monthly: group.monthly, upfront: group.upfront })),
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
  screenshotPath?: string | undefined;
  session?: string | undefined;
  oracle?: boolean | undefined;
  oracleEditor?: boolean | undefined;
  forcePublish?: boolean | undefined;
  flags: ParsedArgs["flags"];
}

function specHashOf(spec: EstimateSpec): string {
  const canonical = JSON.stringify(spec, Object.keys(spec).sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

async function previousReceipt(path: string): Promise<PublicationReceipt | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PublicationReceipt;
  } catch {
    return undefined;
  }
}

export async function runPublish(options: PublishOptions): Promise<{
  receipt: PublicationReceipt;
  result: BuildResult;
}> {
  const spec = await readSpec(options.specPath, {
    ...(options.name ? { name: options.name } : {}),
  });
  const result = await buildFromSpec(spec, options.flags);
  const specHash = specHashOf(spec);
  const previous =
    options.receiptPath && !options.forcePublish
      ? await previousReceipt(options.receiptPath)
      : undefined;
  const reuse = previous && previous.specHash === specHash && previous.url ? previous : undefined;

  const publication = reuse
    ? {
        url: reuse.url,
        savedKey: reuse.savedKey,
        publishedAt: reuse.publishedAt,
        response: { reused: true },
      }
    : await publishEstimate(result.estimate);
  const stored = await retrieveEstimate(publication.savedKey);
  const publishedName = stored.name || spec.name;
  const rendered = readRenderedEstimate(publication.url, {
    ...(options.session ? { session: options.session } : {}),
    waitText: publishedName,
  });
  const expectation = expectationFrom(result, { ...spec, name: publishedName });
  const mismatches = diffRendered(rendered, expectation);

  let oracle: PublicationReceipt["oracle"];
  if (options.oracle && options.oracleEditor) {
    throw new Error("use either --oracle or --oracle-editor, not both");
  }
  if (options.oracleEditor) {
    // The read-only recompute path silently drops dataTransferV2 (the probe
    // renders 0), while the editor rehydrates the saved rows. Clicking
    // Update estimate is therefore the live oracle for these components.
    const recomputed = readRenderedEstimate(publication.url, {
      ...(options.session ? { session: options.session } : {}),
      waitText: publishedName,
      recompute: true,
    });
    // The editor rebuilds the summary before the UI string table settles, so
    // the same row can render "0 TB per month" or "0 tb_month". Costs are the
    // deterministic signal; summary shape is covered by unit tests and the
    // stored native render.
    const oracleMismatches = diffRendered(
      recomputed,
      expectationFrom(result, { ...spec, name: publishedName }, false)
    );
    oracle = {
      kind: "editor-recompute",
      url: publication.url,
      savedKey: publication.savedKey,
      recomputed,
      mismatches: oracleMismatches,
      verdict: oracleMismatches.length === 0 ? "pass" : "fail",
    };
  } else if (options.oracle) {
    // Receipts written before the `kind` discriminant are probe oracles.
    const previousOracle = reuse?.oracle;
    const reuseProbe =
      previousOracle &&
      (previousOracle.kind ?? "probe") === "probe" &&
      previousOracle.url &&
      previousOracle.savedKey
        ? previousOracle
        : undefined;
    const probe = reuseProbe
      ? { url: reuseProbe.url, savedKey: reuseProbe.savedKey }
      : await publishProbe(result.estimate);
    const recomputed = readRenderedEstimate(probe.url, {
      ...(options.session ? { session: options.session } : {}),
      waitText: spec.name,
    });
    const oracleMismatches = diffRendered(recomputed, expectationFrom(result, spec));
    oracle = {
      kind: "probe",
      url: probe.url,
      savedKey: probe.savedKey,
      recomputed,
      mismatches: oracleMismatches,
      verdict: oracleMismatches.length === 0 ? "pass" : "fail",
    };
  }

  const createdOn = stored.metaData.createdOn ?? publication.publishedAt;
  const expires = expiryOf(createdOn);

  const receipt: PublicationReceipt = {
    estimate: spec.name,
    specHash,
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
    ...(oracle ? { oracle } : {}),
    expectation,
    mismatches,
    verdict: mismatches.length === 0 ? "pass" : "fail",
  };

  if (options.receiptPath) {
    await mkdir(dirname(options.receiptPath), { recursive: true });
    await writeFile(options.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  }
  if (options.screenshotPath) {
    await mkdir(dirname(options.screenshotPath), { recursive: true });
    captureScreenshot(publication.url, options.screenshotPath, {
      ...(options.session ? { session: options.session } : {}),
      waitText: publishedName,
    });
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
      ...(receipt.oracle
        ? { oracle: receipt.oracle.verdict, oracleUrl: receipt.oracle.url }
        : {}),
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
    screenshotPath: stringFlag(args.flags, "screenshot"),
    session: stringFlag(args.flags, "session"),
    oracle: args.flags["oracle"] === true,
    oracleEditor: args.flags["oracle-editor"] === true,
    forcePublish: args.flags["force-publish"] === true,
    flags: args.flags,
  });
  if (receipt.verdict !== "pass" || receipt.oracle?.verdict === "fail") process.exitCode = 1;
  return publishOutput(receipt);
}

