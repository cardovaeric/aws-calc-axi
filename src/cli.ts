import { AxiError, runAxiCli } from "axi-sdk-js";
import { VERSION } from "./version.ts";
import { parseArgs } from "./cli/args.ts";
import { servicesCommand, servicesFlags, servicesHelp } from "./commands/services.ts";
import { schemaCommand, schemaFlags, schemaHelp } from "./commands/schema.ts";
import { pricingCommand, pricingFlags, pricingHelp } from "./commands/pricing.ts";
import { costCommand, costFlags, costHelp } from "./commands/cost.ts";
import { publishCommand, publishFlags, publishHelp } from "./commands/publish.ts";
import { verifyCommand, verifyFlags, verifyHelp } from "./commands/verify.ts";
import { doctorCommand, doctorFlags, doctorHelp } from "./commands/doctor.ts";
import { estimateCommand, estimateFlags, estimateHelp } from "./commands/estimate.ts";
import { buildFromSpec, costSummary } from "./commands/cost.ts";
import { publishOutput, runPublish } from "./commands/publish.ts";
import { booleanFlag, stringFlag, type FlagSpecs } from "./cli/args.ts";
import { readSpec } from "./commands/shared.ts";
import { cacheStats } from "./cache.ts";
import { publishBudget } from "./publish.ts";
import { visibleServices } from "./data/catalog.ts";
import { loadCatalog, loadRegionMap } from "./data/catalog.ts";

const DESCRIPTION =
  "Build, cost, publish, and render-verify AWS Pricing Calculator estimates";

const TOP_LEVEL_HELP = `aws-calc-axi - ${DESCRIPTION}

Usage:
  aws-calc-axi                                  home: data state and next steps
  aws-calc-axi services [--region ...] [--all] [--query ...]
  aws-calc-axi schema <code> [--region ...] [--template ...] [--full]
  aws-calc-axi pricing <code> --region ... [--unit ...]
  aws-calc-axi estimate init "<name>" [--out estimate.yaml]
  aws-calc-axi cost <estimate.yaml> [--full]
  aws-calc-axi apply <estimate.yaml> [--publish]
  aws-calc-axi publish <estimate.yaml> [--name ...] [--receipt path]
  aws-calc-axi verify <url> [--expect estimate.yaml]
  aws-calc-axi doctor [--refresh]

Output is TOON on stdout. Progress and diagnostics go to stderr.
Publishing is explicit: a link counts only after the public page renders and matches.

Examples:
  aws-calc-axi services --region us-east-2 --query s3
  aws-calc-axi schema amazonS3Standard --region us-east-2
  aws-calc-axi cost estimate.yaml --full
  aws-calc-axi publish estimate.yaml --receipt receipts/s3.json

Global flags: --help, --version (-v, -V)
`;

const HELP: Record<string, string> = {
  services: servicesHelp,
  schema: schemaHelp,
  pricing: pricingHelp,
  cost: costHelp,
  apply: costHelp,
  publish: publishHelp,
  verify: verifyHelp,
  doctor: doctorHelp,
  estimate: estimateHelp,
};

const applyFlags: FlagSpecs = {
  ...costFlags,
  "--publish": { type: "boolean", description: "publish and render-verify after computing" },
  "--name": { type: "string", description: "override the estimate name" },
  "--receipt": { type: "string", description: "write a JSON receipt to this path" },
  "--session": { type: "string", description: "agent-browser session name" },
  "--oracle": { type: "boolean", description: "diff the live UI recomputation too" },
  "--force-publish": { type: "boolean", description: "create new links ignoring a receipt" },
};

async function home(): Promise<Record<string, unknown>> {
  const cache = await cacheStats();
  const budget = await publishBudget();
  const output: Record<string, unknown> = {
    description: DESCRIPTION,
  };

  try {
    const offline = { offline: true } as const;
    const [catalog, regionMap] = await Promise.all([loadCatalog(offline), loadRegionMap(offline)]);
    output["data"] = {
      services: catalog.awsServices.length,
      visible: {
        "us-east-1": visibleServices(catalog, regionMap, { region: "us-east-1" }).length,
        "us-east-2": visibleServices(catalog, regionMap, { region: "us-east-2" }).length,
      },
      cached: true,
      cachedResponses: cache.entries,
    };
  } catch {
    output["data"] = {
      cached: false,
      note: "data plane not cached yet; run `aws-calc-axi services` once online",
    };
  }

  output["publish"] = { usedToday: budget.used, dailyLimit: budget.limit };
  output["commands"] = [
    "services",
    "schema",
    "pricing",
    "estimate init",
    "cost",
    "apply",
    "publish",
    "verify",
    "doctor",
  ];
  output["help"] = [
    "Run `aws-calc-axi services --region us-east-2 --query s3` to find a service",
    "Run `aws-calc-axi schema amazonS3Standard --region us-east-2` to see its inputs",
    'Run `aws-calc-axi estimate init "My estimate"` to scaffold a spec',
  ];
  return output;
}

export async function main(): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_LEVEL_HELP,
    commands: {
      services: async (args) => servicesCommand(parseArgs("services", args, servicesFlags)),
      schema: async (args) => schemaCommand(parseArgs("schema", args, schemaFlags)),
      pricing: async (args) => pricingCommand(parseArgs("pricing", args, pricingFlags)),
      cost: async (args) => costCommand(parseArgs("cost", args, costFlags)),
      apply: async (args) => applyCommand(parseArgs("apply", args, applyFlags)),
      publish: async (args) => publishCommand(parseArgs("publish", args, publishFlags)),
      verify: async (args) => verifyCommand(parseArgs("verify", args, verifyFlags)),
      doctor: async (args) => doctorCommand(parseArgs("doctor", args, doctorFlags)),
      estimate: async (args) => estimateCommand(parseArgs("estimate", args, estimateFlags)),
    },
    getCommandHelp: (command) => HELP[command] ?? null,
    home,
  });
}

async function applyCommand(
  args: ReturnType<typeof parseArgs>
): Promise<Record<string, unknown>> {
  if (args.help) return { help: costHelp };
  const path = args.positional[0];
  if (!path) {
    throw new AxiError("apply needs an estimate file", "VALIDATION_ERROR", [
      "Run `aws-calc-axi apply estimate.yaml --publish`",
    ]);
  }
  if (!booleanFlag(args.flags, "publish")) {
    const spec = await readSpec(path);
    const result = await buildFromSpec(spec, args.flags);
    return {
      estimate: {
        name: spec.name,
        services: result.services.length,
        ...(result.support ? { support: result.support.title } : {}),
      },
      cost: costSummary(result),
      help: [`Run \`aws-calc-axi apply ${path} --publish\` to create the public link`],
    };
  }

  const { receipt } = await runPublish({
    specPath: path,
    name: stringFlag(args.flags, "name"),
    receiptPath: stringFlag(args.flags, "receipt"),
    session: stringFlag(args.flags, "session"),
    oracle: args.flags["oracle"] === true,
    forcePublish: args.flags["force-publish"] === true,
    flags: args.flags,
  });
  if (receipt.verdict !== "pass" || receipt.oracle?.verdict === "fail") process.exitCode = 1;
  return publishOutput(receipt);
}
