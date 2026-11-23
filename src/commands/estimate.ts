import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import type { ParsedArgs } from "../cli/args.ts";
import { booleanFlag, stringFlag } from "../cli/args.ts";
import { sampleSpec } from "../estimate/spec.ts";

export const estimateFlags = {
  "--out": { type: "string" as const, description: "file to write", value: "estimate.yaml" },
  "--force": { type: "boolean" as const, description: "overwrite an existing file" },
};

export const estimateHelp = `aws-calc-axi estimate - scaffold an estimate file

Usage:
  aws-calc-axi estimate init "<name>" [--out estimate.yaml] [--force]

Flags:
  --out <path>  where to write the spec (default estimate.yaml)
  --force       overwrite an existing file

Examples:
  aws-calc-axi estimate init "Web tier"
  aws-calc-axi estimate init "S3 test" --out s3.yaml --force
`;

export async function estimateCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  if (args.help) return { help: estimateHelp };
  const sub = args.positional[0];
  if (sub !== "init") {
    throw new AxiError(
      sub ? `unknown estimate command "${sub}"` : "estimate needs a subcommand",
      "VALIDATION_ERROR",
      ["Run `aws-calc-axi estimate init \"<name>\"`"]
    );
  }
  const name = args.positional[1];
  if (!name) {
    throw new AxiError("estimate init needs a name", "VALIDATION_ERROR", [
      'Run `aws-calc-axi estimate init "My estimate"`',
    ]);
  }

  const out = resolve(stringFlag(args.flags, "out") ?? "estimate.yaml");
  const force = booleanFlag(args.flags, "force");
  const body = sampleSpec(name);

  try {
    await writeFile(out, body, { encoding: "utf8", flag: force ? "w" : "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new AxiError(`${out} already exists`, "CONFLICT", [
        `Add --force to overwrite it, or choose --out <other file>`,
      ]);
    }
    throw error;
  }
  await mkdir(dirname(out), { recursive: true });

  return {
    estimate: { name, path: out },
    help: [
      `Run \`aws-calc-axi cost ${out}\` to compute it`,
      `Run \`aws-calc-axi publish ${out} --receipt receipts/<name>.json\` to publish and verify`,
    ],
  };
}
