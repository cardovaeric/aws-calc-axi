import { AxiError } from "axi-sdk-js";

export type FlagType = "string" | "boolean" | "number" | "list";

export interface FlagSpec {
  type: FlagType;
  description: string;
  /** Value placeholder for help text. */
  value?: string;
  aliases?: string[];
}

export type FlagSpecs = Record<string, FlagSpec>;

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean | number | string[]>;
  help: boolean;
}

/**
 * Parse `--flag value`, `--flag=value`, and boolean flags.
 *
 * Unknown flags are rejected with exit code 2 and the valid set, so an agent
 * never proceeds with a flag the tool silently ignored.
 */
export function parseArgs(
  command: string,
  argv: string[],
  specs: FlagSpecs,
  options: { allowPositional?: boolean; maxPositional?: number } = {}
): ParsedArgs {
  const flags: ParsedArgs["flags"] = {};
  const positional: string[] = [];
  let help = false;

  const byName = new Map<string, { name: string; spec: FlagSpec }>();
  for (const [name, spec] of Object.entries(specs)) {
    const key = flagKey(name);
    byName.set(name, { name: key, spec });
    for (const alias of spec.aliases ?? []) byName.set(alias, { name: key, spec });
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : token.slice(equals + 1);
    const entry = byName.get(name);
    if (!entry) {
      throw new AxiError(
        `unknown flag ${name} for \`${command}\``,
        "VALIDATION_ERROR",
        [`valid flags for \`${command}\`: ${validFlagList(specs)}`]
      );
    }

    if (entry.spec.type === "boolean") {
      flags[entry.name] = inlineValue === undefined ? true : inlineValue !== "false";
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
      throw new AxiError(
        `flag ${name} needs a value`,
        "VALIDATION_ERROR",
        [`Run \`${command} --help\` for the expected form`]
      );
    }
    if (inlineValue === undefined) index += 1;

    if (entry.spec.type === "list") {
      const list = (flags[entry.name] as string[] | undefined) ?? [];
      list.push(value);
      flags[entry.name] = list;
      continue;
    }
    if (entry.spec.type === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new AxiError(
          `flag ${name} needs a number, got "${value}"`,
          "VALIDATION_ERROR"
        );
      }
      flags[entry.name] = numeric;
      continue;
    }
    flags[entry.name] = value;
  }

  if (positional.length > 0 && options.allowPositional === false) {
    throw new AxiError(
      `unexpected argument "${positional[0]}" for \`${command}\``,
      "VALIDATION_ERROR",
      [`Run \`${command} --help\` to see the expected arguments`]
    );
  }
  if (options.maxPositional !== undefined && positional.length > options.maxPositional) {
    throw new AxiError(
      `too many arguments for \`${command}\` (got ${positional.length}, expected at most ${options.maxPositional})`,
      "VALIDATION_ERROR"
    );
  }

  return { positional, flags, help };
}

function flagKey(name: string): string {
  return name.replace(/^--?/, "");
}

export function validFlagList(specs: FlagSpecs): string {
  const names = Object.entries(specs).map(([name, spec]) => {
    const value = spec.type === "boolean" ? "" : ` <${spec.value ?? spec.type}>`;
    return `${name}${value}`;
  });
  return names.length > 0 ? names.join(", ") : "(none)";
}

export function stringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function numberFlag(flags: ParsedArgs["flags"], name: string): number | undefined {
  const value = flags[name];
  return typeof value === "number" ? value : undefined;
}

export function booleanFlag(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true;
}

export function listFlag(flags: ParsedArgs["flags"], name: string): string[] {
  const value = flags[name];
  return Array.isArray(value) ? value : [];
}

/** Parse repeated `--set key=value` flags into an object. */
export function parseSetFlags(values: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of values) {
    const equals = entry.indexOf("=");
    if (equals <= 0) {
      throw new AxiError(`--set needs key=value, got "${entry}"`, "VALIDATION_ERROR");
    }
    const key = entry.slice(0, equals);
    const rawValue = entry.slice(equals + 1);
    result[key] = coerceSetValue(rawValue);
  }
  return result;
}

function coerceSetValue(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // fall through to scalar coercion
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}
