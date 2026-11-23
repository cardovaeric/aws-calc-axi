import { readFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ServiceSpec } from "../engine/service.ts";

export interface GroupSpec {
  name: string;
  services: ServiceSpec[];
  groups: GroupSpec[];
}

export interface SupportSpec {
  plan: "basic" | "business" | "enterprise" | "unified";
  /** Optional explicit spend tier; defaults to the published tier table. */
  spendTier?: "auto" | number;
}

export interface EstimateSpec {
  name: string;
  currency: string;
  locale: string;
  support?: SupportSpec;
  services: ServiceSpec[];
  groups: GroupSpec[];
}

export class SpecError extends Error {
  readonly path: string;
  readonly problem: string;

  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.name = "SpecError";
    this.path = path;
    this.problem = problem;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, path: string, required = true): string {
  if (value === undefined || value === null || value === "") {
    if (required) throw new SpecError(path, "is required");
    return "";
  }
  if (typeof value !== "string") throw new SpecError(path, "must be a string");
  return value;
}

function recordField(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new SpecError(path, "must be a mapping");
  return value;
}

function arrayField<T>(value: unknown, path: string, map: (item: unknown, path: string) => T): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SpecError(path, "must be a list");
  return value.map((item, index) => map(item, `${path}[${index}]`));
}

function serviceSpec(value: unknown, path: string): ServiceSpec {
  if (!isRecord(value)) throw new SpecError(path, "must be a mapping");
  const code = stringField(value["code"], `${path}.code`);
  const region = stringField(value["region"], `${path}.region`);
  const template = stringField(value["template"], `${path}.template`, false);
  const set = recordField(value["set"], `${path}.set`);
  const subServices = arrayField(value["subServices"], `${path}.subServices`, (item, itemPath) => {
    if (!isRecord(item)) throw new SpecError(itemPath, "must be a mapping");
    const childCode = stringField(item["code"], `${itemPath}.code`);
    const childTemplate = stringField(item["template"], `${itemPath}.template`, false);
    return {
      code: childCode,
      ...(childTemplate ? { template: childTemplate } : {}),
      set: recordField(item["set"], `${itemPath}.set`),
    };
  });
  if (subServices.length === 0 && "subServices" in value) {
    throw new SpecError(`${path}.subServices`, "must list at least one sub-service");
  }
  return {
    code,
    region,
    ...(template ? { template } : {}),
    set,
    ...(subServices.length > 0 ? { subServices } : {}),
  };
}

function groupSpec(value: unknown, path: string): GroupSpec {
  if (!isRecord(value)) throw new SpecError(path, "must be a mapping");
  return {
    name: stringField(value["name"], `${path}.name`),
    services: arrayField(value["services"], `${path}.services`, (item, itemPath) =>
      serviceSpec(item, itemPath)
    ),
    groups: arrayField(value["groups"], `${path}.groups`, (item, itemPath) =>
      groupSpec(item, itemPath)
    ),
  };
}

export function parseSpec(input: unknown): EstimateSpec {
  if (!isRecord(input)) throw new SpecError("estimate", "must be a mapping");
  const name = stringField(input["name"], "name");
  const currency = stringField(input["currency"], "currency", false) || "USD";
  const locale = stringField(input["locale"], "locale", false) || "en_US";

  const supportInput = input["support"];
  let support: SupportSpec | undefined;
  if (supportInput !== undefined && supportInput !== null) {
    if (typeof supportInput === "string") {
      support = { plan: normalizePlan(supportInput, "support") };
    } else if (isRecord(supportInput)) {
      support = {
        plan: normalizePlan(stringField(supportInput["plan"], "support.plan"), "support.plan"),
        ...(supportInput["spendTier"] === undefined
          ? {}
          : { spendTier: parseSpendTier(supportInput["spendTier"], "support.spendTier") }),
      };
    } else {
      throw new SpecError("support", "must be a plan name or a mapping");
    }
  }

  return {
    name,
    currency,
    locale,
    ...(support ? { support } : {}),
    services: arrayField(input["services"], "services", (item, itemPath) =>
      serviceSpec(item, itemPath)
    ),
    groups: arrayField(input["groups"], "groups", (item, itemPath) => groupSpec(item, itemPath)),
  };
}

function normalizePlan(value: string, path: string): SupportSpec["plan"] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "basic" || normalized === "basic-support") return "basic";
  if (normalized === "business" || normalized === "business-support") return "business";
  if (normalized === "enterprise" || normalized === "enterprise-support") return "enterprise";
  if (
    normalized === "unified" ||
    normalized === "unified-operations" ||
    normalized === "unified-operations-support"
  ) {
    return "unified";
  }
  throw new SpecError(path, `unknown support plan "${value}" (basic, business, enterprise, unified)`);
}

function parseSpendTier(value: unknown, path: string): "auto" | number {
  if (value === "auto" || value === undefined) return "auto";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new SpecError(path, "must be a number or auto");
  return numeric;
}

export function parseSpecText(text: string, format: "yaml" | "json"): EstimateSpec {
  const parsed = format === "json" ? (JSON.parse(text) as unknown) : parseYaml(text);
  return parseSpec(parsed);
}

export async function loadSpecFile(path: string): Promise<EstimateSpec> {
  const text = await readFile(path, "utf8");
  const format = path.endsWith(".json") ? "json" : "yaml";
  return parseSpecText(text, format);
}

export function sampleSpec(name: string): string {
  return stringifyYaml({
    name,
    currency: "USD",
    locale: "en_US",
    services: [
      {
        code: "amazonSimpleStorageServiceGroup",
        region: "us-east-2",
        subServices: [
          {
            code: "amazonS3Standard",
            set: { s3StandardStorageSize: { value: 100, unit: "gb|month" } },
          },
        ],
      },
    ],
  });
}
