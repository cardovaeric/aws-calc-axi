/**
 * Exhaustive P0 conformance matrix.
 *
 * Generates every value combination that is reachable through the calculator
 * UI for the P0 services, rather than hand-picking a few fixtures:
 *
 *   - one case per template baseline (defaults plus required fills),
 *   - one case per dropdown option (one-factor-at-a-time),
 *   - boundary cases per numeric input (min, zero when allowed, max, mid),
 *   - one case per fileSize size unit and per frequency unit,
 *   - one case per throughput/frequency unit,
 *   - one case inside each pricing tier and the closest achievable value to
 *     each tier boundary,
 *   - the full cross product for interacting decision dimensions that are
 *     small enough to enumerate (for example EBS storage type x snapshot
 *     frequency), and pairwise for larger ones.
 *
 * Usage:
 *   node --experimental-strip-types scripts/conformance.ts generate
 *   node --experimental-strip-types scripts/conformance.ts native
 *   node --experimental-strip-types scripts/conformance.ts publish [--limit N]
 *   node --experimental-strip-types scripts/conformance.ts report
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadDefinition, type Card, type Component, type ServiceDefinition } from "../src/data/definitions.ts";
import { evaluateService } from "../src/engine/service.ts";
import { EngineError } from "../src/engine/errors.ts";
import { runPublish } from "../src/commands/publish.ts";
import {
  convertSize,
  convertDuration,
  convertFrequency,
  roundConverted,
} from "../src/engine/units.ts";
import { numberFlag, stringFlag, type ParsedArgs } from "../src/cli/args.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "analysis", "conformance");
const MANIFEST = join(OUT, "manifest.json");
const STATE = join(OUT, "state.json");
const REPORT = join(OUT, "REPORT.md");

/** P0 services that are in scope for exhaustive conformance. */
const TARGETS: Array<{ code: string; label: string }> = [
  { code: "awsEks", label: "Amazon EKS" },
  { code: "amazonElasticBlockStore", label: "Amazon EBS" },
  { code: "vpnConnectionVpc", label: "VPC VPN Connection" },
  { code: "networkAccessAnalyzerVpc", label: "VPC Network Access Analyzer" },
  { code: "reachabilityAnalyzerVpc", label: "VPC Reachability Analyzer" },
  { code: "trafficMirroringVpc", label: "VPC Traffic Mirroring" },
  { code: "publicIpv4Address", label: "VPC Public IPv4 Address" },
  { code: "ipamVpc", label: "VPC IPAM" },
  { code: "dataTransferVpc", label: "VPC Data Transfer" },
  { code: "vpcRouteServer", label: "VPC Route Server" },
  { code: "networkAddressTranslationNatGatewayVpc", label: "VPC NAT Gateway" },
  { code: "transitGatewayVpc", label: "VPC Transit Gateway" },
  { code: "awsPrivateLinkVpc", label: "VPC PrivateLink" },
  { code: "gatewayLoadBalancerVpc", label: "VPC Gateway Load Balancer" },
  { code: "cloudWan", label: "VPC Cloud WAN" },
];

/** Services that cannot pass natively yet; still enumerated so the gap is explicit. */
const BLOCKED_TARGETS: Array<{ code: string; label: string; reason: string }> = [
  { code: "ec2Enhancement", label: "Amazon EC2", reason: "ec2PriceFetcher not implemented" },
  { code: "eC2Next", label: "Amazon EC2 (next)", reason: "ec2PriceFetcher not implemented" },
  { code: "windowsWorkloads", label: "Windows/SQL on EC2", reason: "25 bespoke subtypes" },
  { code: "amazonRDSMySQLDB", label: "RDS for MySQL", reason: "column-form v2" },
  { code: "amazonRDSPostgreSQLDB", label: "RDS for PostgreSQL", reason: "column-form v2" },
  { code: "amazonRDSMariaDB", label: "RDS for MariaDB", reason: "column-form v2" },
  { code: "amazonRDSForSQLServer", label: "RDS for SQL Server", reason: "column-form v2" },
  { code: "amazonRdsForOracle", label: "RDS for Oracle", reason: "column-form v2" },
  { code: "amazonRdsForDb2", label: "RDS for Db2", reason: "column-form v2" },
];

const REGIONS = ["us-east-1", "us-east-2"] as const;
const BATCH_SIZE = 10;
/** Upper bound for oracle fixtures; the definition maximum can hang the editor. */
const ORACLE_MAX_INPUT = 10_000;

interface ConformanceCase {
  id: string;
  code: string;
  label: string;
  template: string;
  region: string;
  set: Record<string, unknown>;
  covers: string[];
  /** Present when the case is expected to fail closed today. */
  blocked?: string;
}

interface Batch {
  id: string;
  code: string;
  label: string;
  region: string;
  cases: ConformanceCase[];
  specPath: string;
  receiptPath: string;
  /** Hash of the effective spec; a change invalidates previous progress. */
  hash: string;
}

interface Manifest {
  generatedAt: string;
  cases: ConformanceCase[];
  batches: Batch[];
  blocked: Array<{ code: string; label: string; reason: string; cases: number }>;
}

interface State {
  batches: Record<
    string,
    {
      hash?: string;
      status: "pending" | "pass" | "fail" | "native-error" | "error";
      url?: string;
      savedKey?: string;
      monthly?: number;
      upfront?: number;
      rows?: number;
      mismatches?: Array<{ field: string; expected: string; actual: string }>;
      nativeError?: string;
      at?: string;
    }
  >;
}

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function templates(definition: ServiceDefinition): Array<{ id: string; cards: Card[] }> {
  return arr(definition.templates)
    .map((entry) => rec(entry))
    .filter((entry): entry is Rec => entry !== undefined)
    .map((entry) => ({ id: text(entry["id"]), cards: arr(entry["cards"]) as Card[] }));
}

function componentsOf(cards: Card[]): Component[] {
  const out: Component[] = [];
  for (const card of cards) {
    for (const component of card.inputSection?.components ?? []) out.push(component);
  }
  return out;
}

function validations(component: Component): Rec {
  return rec(component["validations"]) ?? {};
}

function optionIds(component: Component): string[] {
  return arr(component["options"])
    .map((option) => rec(option))
    .filter((option): option is Rec => option !== undefined)
    .map((option) => text(option["id"] ?? option["value"]))
    .filter(Boolean);
}

function sizeIds(component: Component): string[] {
  return arr(component["dropDownSize"])
    .map((option) => rec(option))
    .filter((option): option is Rec => option !== undefined)
    .map((option) => text(option["id"]))
    .filter(Boolean);
}

function frequencyIds(component: Component): string[] {
  return arr(component["dropDownFrequency"])
    .map((option) => rec(option))
    .filter((option): option is Rec => option !== undefined)
    .map((option) => text(option["id"]))
    .filter(Boolean);
}

function defaultFileUnit(component: Component): string {
  const defaultOption = rec(component["defaultOption"]);
  const size = text(defaultOption?.["size"]) || sizeIds(component)[0] || "gb";
  const frequency =
    text(defaultOption?.["frequency"]) ||
    frequencyIds(component)[0] ||
    (frequencyIds(component).length === 0 ? "NA" : "month");
  return `${size}|${frequency}`;
}

function rulesOf(component: Component): { min?: number; max?: number; integer: boolean } {
  const rules = validations(component);
  return {
    ...(rules["minValue"] === undefined ? {} : { min: numberOr(rules["minValue"], 0) }),
    ...(rules["maxValue"] === undefined ? {} : { max: numberOr(rules["maxValue"], 0) }),
    integer: rules["allowDecimals"] === false || rules["allowDecimal"] === false,
  };
}

/** Force a value into the component's validations, rounding when integers only. */
function clamp(component: Component, value: number): number {
  const { min, max, integer } = rulesOf(component);
  let next = value;
  if (integer) next = Math.round(next);
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && max > 0 && next > max) next = max;
  if (integer) next = Math.round(next);
  return next;
}

function withinRules(component: Component, value: number): boolean {
  const { min, max, integer } = rulesOf(component);
  if (!Number.isFinite(value)) return false;
  if (integer && !Number.isInteger(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && max > 0 && value > max) return false;
  return true;
}

/** A value that passes the component's own validations. */
function safeNumeric(component: Component, mode: "low" | "mid" | "high" = "mid"): number {
  const rules = validations(component);
  const min = rules["minValue"] === undefined ? 0 : numberOr(rules["minValue"], 0);
  const max = rules["maxValue"] === undefined ? 0 : numberOr(rules["maxValue"], 0);
  const integer = rules["allowDecimals"] === false || rules["allowDecimal"] === false;
  let value: number;
  if (mode === "low") value = min;
  else if (mode === "high") value = max > 0 ? max : Math.max(min, 1);
  else value = max > 0 ? Math.min(Math.max(min, 1), max) : Math.max(min, 1);
  if (integer) value = Math.round(value);
  if (max > 0) value = Math.min(value, max);
  if (value < min) value = min;
  return value;
}

/** A valid baseline value for one input component, or undefined for display-only. */
function baselineValue(component: Component): unknown {
  const subtype = text(component.subType);
  switch (subtype) {
    case "numericInput":
    case "percentInput": {
      const declared = component["defaultValue"];
      const numeric = declared === undefined || declared === "" ? undefined : Number(declared);
      // Several definitions ship `defaultValue: 0` with `minValue: 1`; the live
      // form shows a validation error until the user types a value, so a
      // baseline fixture must supply a valid one.
      if (numeric !== undefined && withinRules(component, numeric)) return numeric;
      return safeNumeric(component);
    }
    case "dropdown": {
      const declared = text(component["defaultDropDownItem"] ?? component["defaultValue"]);
      if (declared && optionIds(component).includes(declared)) return declared;
      return optionIds(component)[0];
    }
    case "fileSize": {
      const declared = component["defaultValue"];
      const unit = defaultFileUnit(component);
      const outputSize = text(component["outputSize"]) || "gb";
      const size = unit.split("|")[0] ?? outputSize;
      const { min } = rulesOf(component);
      const numeric = declared === undefined || declared === "" ? undefined : Number(declared);
      if (numeric !== undefined && Number.isFinite(numeric)) {
        const output = convertSize(numeric, size, outputSize);
        if (min === undefined || output >= min) return { value: numeric, unit };
      }
      const perUnit = convertSize(1, size, outputSize);
      const needed = perUnit > 0 ? Math.ceil(Math.max(min ?? 0, 1) / perUnit) : Math.max(min ?? 0, 1);
      return { value: needed, unit };
    }
    case "throughput": {
      const declared = component["defaultValue"];
      const unit = text(rec(component["outputThroughput"])?.["value"]) || "mbps";
      if (declared === undefined || declared === "") return { value: safeNumeric(component), unit };
      return { value: declared, unit };
    }
    case "frequency": {
      const declared = component["defaultValue"];
      const unit = text(component["defaultFrequency"]) || optionIds(component)[0] || "perMonth";
      if (declared === undefined || declared === "") {
        return { value: Math.max(numberOr(validations(component)["minValue"], 0), 10), unit };
      }
      return { value: declared, unit };
    }
    case "durationInput": {
      const declared = component["defaultValue"];
      const unit = text(component["defaultDuration"]) || text(component["outputDurationUnit"]) || "sec";
      if (declared === undefined || declared === "") {
        return { value: Math.max(numberOr(validations(component)["minValue"], 0), 30), unit };
      }
      return { value: declared, unit };
    }
    case "checkbox":
      return component["defaultValue"] === true;
    case "columnFormIPM":
      return undefined;
    case "dataTransferV2":
      return undefined;
    default:
      return undefined;
  }
}

function baselineSet(components: Component[]): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const component of components) {
    const value = baselineValue(component);
    if (value === undefined) continue;
    set[component.id] = value;
  }
  return set;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tierBoundaries(component: Component): Array<{ label: string; value: number }> {
  const tiers = rec(component["tiers"]);
  const out: Array<{ label: string; value: number }> = [];
  for (const [region, list] of Object.entries(tiers ?? {})) {
    for (const [index, raw] of arr(list).entries()) {
      const tier = rec(raw);
      if (!tier) continue;
      const start = numberOr(tier["startOfTier"], 0);
      const end = numberOr(tier["endOfTier"], -1);
      out.push({ label: `${region}#${index}.start`, value: start });
      if (end > 0) {
        out.push({ label: `${region}#${index}.end`, value: end });
        out.push({ label: `${region}#${index}.end+1`, value: end + 1 });
      } else {
        out.push({ label: `${region}#${index}.inside`, value: start * 2 + 1 });
      }
    }
  }
  return out;
}

function eksDriverFor(target: number): { numberOfHybridNodes: unknown; numberOfVCPUperNode: number } | undefined {
  // Both inputs are integers; pick the node count that lands in range.
  for (const nodes of [1, 2, 5, 10, 20, 50, 100]) {
    const vcpu = Math.ceil(target / (nodes * 730));
    if (vcpu >= 1 && vcpu <= 1000) {
      return { numberOfHybridNodes: { value: nodes, unit: "perMonth" }, numberOfVCPUperNode: vcpu };
    }
  }
  return undefined;
}

function enumerateService(definition: ServiceDefinition, label: string): ConformanceCase[] {
  const cases: ConformanceCase[] = [];
  const code = definition.serviceCode;
  for (const region of REGIONS) {
    for (const template of templates(definition)) {
      const components = componentsOf(template.cards);
      const base = baselineSet(components);
      const prefix = `${code}/${template.id}/${region}`;
      const add = (suffix: string, set: Record<string, unknown>, covers: string[]): void => {
        cases.push({
          id: `${prefix}/${suffix}`,
          code,
          label,
          template: template.id,
          region,
          set,
          covers,
        });
      };

      add("baseline", clone(base), [`${template.id}:baseline`]);

      for (const component of components) {
        const subtype = text(component.subType);
        const id = component.id;

        if (subtype === "dropdown") {
          const options = optionIds(component);
          if (options.length === 0) continue;
          for (const option of options) {
            add(`dropdown:${id}=${option}`, { ...clone(base), [id]: option }, [`${id}:option`]);
          }
          if (options.length > 1 && options.length <= 12) {
            // Pairwise with every other small dropdown in the same template.
            for (const other of components) {
              if (other.id === id || text(other.subType) !== "dropdown") continue;
              const otherOptions = optionIds(other);
              if (otherOptions.length < 2 || otherOptions.length > 12) continue;
              for (const left of options) {
                for (const right of otherOptions) {
                  add(
                    `pair:${id}=${left},${other.id}=${right}`,
                    { ...clone(base), [id]: left, [other.id]: right },
                    [`${id}:option`, `${other.id}:option`]
                  );
                }
              }
            }
          }
          continue;
        }

        if (subtype === "numericInput" || subtype === "percentInput") {
          const { min, max, integer } = rulesOf(component);
          const values = new Map<string, number>();
          if (min !== undefined) values.set("min", min);
          if (min !== undefined && max !== undefined && max > min) {
            const mid = integer ? Math.round((min + max) / 2) : Math.round(((min + max) / 2) * 100) / 100;
            values.set("mid", mid);
            // The definition maximum (up to 1e9) makes the live editor hang on
            // recompute, so the oracle uses a high-but-renderable value. The
            // true maximum is covered by native validation tests.
            if (max <= ORACLE_MAX_INPUT) values.set("max", max);
            else values.set("high", ORACLE_MAX_INPUT);
          }
          for (const [name, value] of values) {
            const safe = clamp(component, value);
            add(`boundary:${id}=${name}`, { ...clone(base), [id]: safe }, [`${id}:${name}`]);
          }
          continue;
        }

        if (subtype === "fileSize") {
          const unit = defaultFileUnit(component);
          const outputSize = text(component["outputSize"]) || "gb";
          const { min, max } = rulesOf(component);
          const minOutput = min ?? 0;
          const maxOutput = max ?? 0;
          // Validations apply to the output unit, so pick a source amount that
          // converts into range (100 MB is below the 1 GB minimum on EBS).
          const amountFor = (size: string): number => {
            const perUnit = convertSize(1, size, outputSize);
            if (perUnit <= 0) return 1;
            let amount = Math.ceil(Math.max(minOutput, 1) / perUnit);
            if (maxOutput > 0 && amount * perUnit > maxOutput) {
              amount = Math.floor(maxOutput / perUnit);
            }
            return Math.max(amount, 1);
          };
          for (const size of sizeIds(component)) {
            add(
              `unit:${id}=${size}`,
              { ...clone(base), [id]: { value: amountFor(size), unit: `${size}|${unit.split("|")[1] ?? "NA"}` } },
              [`${id}:size:${size}`]
            );
          }
          for (const frequency of frequencyIds(component)) {
            const size = sizeIds(component)[0] ?? "gb";
            add(
              `unit:${id}=${size}|${frequency}`,
              { ...clone(base), [id]: { value: amountFor(size), unit: `${size}|${frequency}` } },
              [`${id}:frequency:${frequency}`]
            );
          }
          continue;
        }

        if (subtype === "frequency" || subtype === "durationInput") {
          // min/max on these inputs apply to the converted value, so bound the
          // typed amount by the conversion factor for the selected unit.
          const { min, max } = rulesOf(component);
          const output =
            subtype === "frequency"
              ? text(rec(component["outputFrequency"])?.["id"]) || "perMonth"
              : text(component["outputDurationUnit"]) || "sec";
          const units =
            subtype === "frequency"
              ? optionIds(component)
              : arr(component["dropDownDuration"])
                  .map((option) => rec(option))
                  .filter((option): option is Rec => option !== undefined)
                  .map((option) => text(option["value"] ?? option["id"]))
                  .filter(Boolean);
          for (const unit of units) {
            const perUnit =
              subtype === "frequency"
                ? convertFrequency(1, unit, output)
                : convertDuration(1, unit, output, 6);
            if (!Number.isFinite(perUnit) || perUnit <= 0) continue;
            // The engine validates the converted value, and the live input
            // rounds before validating. Pick typed amounts by checking the
            // round-tripped value rather than dividing and rounding blindly.
            const convert = (amount: number): number =>
              subtype === "frequency"
                ? roundConverted(convertFrequency(amount, unit, output), 2)
                : convertDuration(amount, unit, output, 2);
            const inRange = (amount: number): boolean => {
              if (amount <= 0) return false;
              const converted = convert(amount);
              if (!Number.isFinite(converted)) return false;
              if (min !== undefined && converted < min) return false;
              if (max !== undefined && max > 0 && converted > max) return false;
              return true;
            };
            const search = (anchor: number, direction: 1 | -1): number | undefined => {
              for (let step = 0; step <= 40; step += 1) {
                const candidate = Math.round(anchor) + step * direction;
                if (candidate <= 0) break;
                if (inRange(candidate)) return candidate;
              }
              return undefined;
            };
            const low = search(Math.round(Math.max(min ?? 0, 1) / perUnit), 1);
            const cappedMax = max && max > 0 ? Math.min(max, ORACLE_MAX_INPUT) : undefined;
            const high = search(
              Math.round((cappedMax ?? (min ?? 1) * 100) / perUnit),
              -1
            );
            const pairs: Array<[string, number | undefined]> = [
              ["min", low],
              ["max", high],
            ];
            for (const [name, value] of pairs) {
              if (value === undefined) continue;
              add(
                `boundary:${id}=${unit}:${name}`,
                { ...clone(base), [id]: { value, unit } },
                [`${id}:${name}:${unit}`]
              );
            }
          }
          continue;
        }

        if (subtype === "throughput") {
          const units =
            subtype === "throughput"
              ? arr(component["options"])
                  .map((option) => rec(option))
                  .filter((option): option is Rec => option !== undefined)
                  .map((option) => text(option["value"] ?? option["id"]))
                  .filter(Boolean)
              : subtype === "frequency"
                ? optionIds(component)
                : arr(component["dropDownDuration"])
                    .map((option) => rec(option))
                    .filter((option): option is Rec => option !== undefined)
                    .map((option) => text(option["value"] ?? option["id"]))
                    .filter(Boolean);
          const current = clone(base);
          const entry = rec(current[id]);
          const value = entry ? numberOr(entry["value"], 10) : 10;
          for (const unit of units) {
            add(`unit:${id}=${unit}`, { ...clone(base), [id]: { value, unit } }, [`${id}:unit:${unit}`]);
          }
        }
      }

      // Pricing tier coverage.
      for (const component of components) {
        if (text(component.subType) !== "tieredPricing") continue;
        for (const boundary of tierBoundaries(component)) {
          if (code === "awsEks") {
            const driver = eksDriverFor(boundary.value);
            if (!driver) continue;
            add(
              `tier:${boundary.label}=${boundary.value}`,
              { ...clone(base), ...driver },
              [`tier:${text(component.id)}:${boundary.label}`]
            );
            continue;
          }
          // Generic tiered components take the tier input from a numeric input
          // with the same name as the maths `inputRefer`; fall back to the
          // component with the closest id when there is no direct driver.
          const driverId = text(component["inputRefer"]) || text(component["id"]);
          const driver = components.find((candidate) => candidate.id === driverId);
          if (!driver) continue;
          add(
            `tier:${boundary.label}=${boundary.value}`,
            { ...clone(base), [driver.id]: boundary.value },
            [`tier:${text(component.id)}:${boundary.label}`]
          );
        }
      }
    }
  }
  // Deduplicate by the effective set.
  const seen = new Set<string>();
  return cases.filter((item) => {
    const key = `${item.code}|${item.template}|${item.region}|${JSON.stringify(item.set)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function batchesFor(cases: ConformanceCase[]): Batch[] {
  const byService = new Map<string, ConformanceCase[]>();
  for (const item of cases) {
    const list = byService.get(item.code) ?? [];
    list.push(item);
    byService.set(item.code, list);
  }
  const batches: Batch[] = [];
  for (const [code, list] of byService) {
    for (let index = 0; index < list.length; index += BATCH_SIZE) {
      const slice = list.slice(index, index + BATCH_SIZE);
      const number = String(batches.filter((batch) => batch.code === code).length + 1).padStart(3, "0");
      const id = `${code}-${number}`;
      const hash = createHash("sha256")
        .update(JSON.stringify(slice.map((item) => [item.code, item.region, item.template, item.set])))
        .digest("hex")
        .slice(0, 16);
      batches.push({
        id,
        code,
        label: slice[0]?.label ?? code,
        region: slice[0]?.region ?? "us-east-2",
        cases: slice,
        specPath: join(OUT, code, `batch-${number}.yaml`),
        receiptPath: join(ROOT, "receipts", "conformance", `${id}.json`),
        hash,
      });
    }
  }
  return batches;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function generate(): Promise<void> {
  const cases: ConformanceCase[] = [];
  const blocked: Manifest["blocked"] = [];
  for (const target of TARGETS) {
    const definition = await loadDefinition(target.code, {});
    cases.push(...enumerateService(definition, target.label));
  }
  for (const target of BLOCKED_TARGETS) {
    let definition: ServiceDefinition;
    try {
      definition = await loadDefinition(target.code, {});
    } catch {
      blocked.push({ ...target, cases: 0 });
      continue;
    }
    const enumerated = enumerateService(definition, target.label).map((item) => ({
      ...item,
      blocked: target.reason,
    }));
    blocked.push({ ...target, cases: enumerated.length });
    cases.push(...enumerated);
  }
  const batches = batchesFor(cases);
  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    cases,
    batches,
    blocked,
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`, "utf8");

  // Drop spec files from earlier generations so a renamed batch cannot linger.
  const expected = new Set(batches.map((batch) => batch.specPath));
  for (const code of new Set(batches.map((batch) => batch.code))) {
    let files: string[] = [];
    try {
      files = await readdir(join(OUT, code));
    } catch {
      files = [];
    }
    for (const file of files) {
      const path = join(OUT, code, file);
      if (file.endsWith(".yaml") && !expected.has(path)) await rm(path, { force: true });
    }
  }
  // Prune progress for batches this generation no longer produces.
  const stateFile = await readJson<State>(STATE);
  if (stateFile) {
    const ids = new Set(batches.map((batch) => batch.id));
    for (const key of Object.keys(stateFile.batches)) {
      if (!ids.has(key)) delete stateFile.batches[key];
    }
    await writeFile(STATE, `${JSON.stringify(stateFile, null, 1)}\n`, "utf8");
  }

  // One estimate file per batch: up to ten service rows in one link.
  for (const batch of batches) {
    const services = batch.cases.map((item) => ({
      code: item.code,
      region: item.region,
      ...(item.template ? { template: item.template } : {}),
      set: item.set,
    }));
    const spec = {
      name: `axi-conformance ${batch.id}`,
      currency: "USD",
      locale: "en_US",
      services,
    };
    await mkdir(dirname(batch.specPath), { recursive: true });
    await writeFile(batch.specPath, stringifyYaml(spec), "utf8");
  }
  const covered = new Map<string, number>();
  for (const item of cases) {
    for (const cover of item.covers) covered.set(cover, (covered.get(cover) ?? 0) + 1);
  }
  process.stdout.write(
    `generated ${cases.length} cases in ${batches.length} batches across ${TARGETS.length} services\n`
  );
  process.stdout.write(`covers ${covered.size} distinct dimensions\n`);
  process.stdout.write(`blocked services enumerated: ${blocked.map((item) => `${item.code} (${item.cases})`).join(", ")}\n`);
}

function fresh(state: State, batch: Batch): State["batches"][string] | undefined {
  const entry = state.batches[batch.id];
  if (!entry) return undefined;
  if (entry.hash !== batch.hash) return undefined;
  return entry;
}

async function evaluateNative(): Promise<void> {
  const manifest = await readJson<Manifest>(MANIFEST);
  if (!manifest) throw new Error("run `generate` first");
  const state = (await readJson<State>(STATE)) ?? { batches: {} };
  let ok = 0;
  let failed = 0;
  for (const batch of manifest.batches) {
    const blocked = batch.cases.every((item) => item.blocked !== undefined);
    if (blocked) {
      state.batches[batch.id] = {
        hash: batch.hash,
        status: "native-error",
        ...(batch.cases[0]?.blocked ? { nativeError: batch.cases[0].blocked } : {}),
        at: new Date().toISOString(),
      };
      failed += 1;
      continue;
    }
    let monthly = 0;
    let upfront = 0;
    let rows = 0;
    let error: string | undefined;
    for (const item of batch.cases) {
      try {
        const result = await evaluateService({ code: item.code, region: item.region, template: item.template, set: item.set }, { cache: {} });
        monthly += result.serviceCost.monthly ?? 0;
        upfront += result.serviceCost.upfront ?? 0;
        rows += 1;
      } catch (caught) {
        const code = caught instanceof EngineError ? caught.code : "ERROR";
        error = `${item.id}: ${code}: ${caught instanceof Error ? caught.message.slice(0, 160) : String(caught)}`;
        break;
      }
    }
    if (error) {
      state.batches[batch.id] = {
        hash: batch.hash,
        status: "native-error",
        nativeError: error,
        at: new Date().toISOString(),
      };
      failed += 1;
    } else {
      state.batches[batch.id] = {
        hash: batch.hash,
        status: "pending",
        monthly: Math.round(monthly * 100) / 100,
        upfront: Math.round(upfront * 100) / 100,
        rows,
        at: new Date().toISOString(),
      };
      ok += 1;
    }
  }
  await writeFile(STATE, `${JSON.stringify(state, null, 1)}\n`, "utf8");
  process.stdout.write(`native: ${ok} batches evaluate, ${failed} batches fail closed\n`);
}

/** Native total for a batch, used to detect engine changes between runs. */
async function nativeTotal(batch: Batch): Promise<{ monthly: number; upfront: number }> {
  let monthly = 0;
  let upfront = 0;
  for (const item of batch.cases) {
    const result = await evaluateService(
      { code: item.code, region: item.region, template: item.template, set: item.set },
      { cache: {} }
    );
    monthly += result.serviceCost.monthly ?? 0;
    upfront += result.serviceCost.upfront ?? 0;
  }
  return { monthly: Math.round(monthly * 100) / 100, upfront: Math.round(upfront * 100) / 100 };
}

async function publish(limit: number): Promise<void> {
  const manifest = await readJson<Manifest>(MANIFEST);
  if (!manifest) throw new Error("run `generate` first");
  const state = (await readJson<State>(STATE)) ?? { batches: {} };
  let published = 0;
  let passed = 0;
  let failed = 0;
  for (const batch of manifest.batches) {
    if (published >= limit) break;
    const previous = fresh(state, batch);
    if (previous?.status === "native-error") continue;
    const native = await nativeTotal(batch);
    // Reuse a passing link only when the engine still produces the same total;
    // otherwise the stored estimate on that link is stale and must be replaced.
    if (
      previous?.status === "pass" &&
      previous.monthly === native.monthly &&
      (previous.upfront ?? 0) === native.upfront
    ) {
      continue;
    }
    const flags: ParsedArgs["flags"] = {};
    let receipt;
    try {
      ({ receipt } = await runPublish({
        specPath: batch.specPath,
        receiptPath: batch.receiptPath,
        oracleEditor: true,
        forcePublish: true,
        flags,
      }));
    } catch (caught) {
      state.batches[batch.id] = {
        hash: batch.hash,
        status: "error",
        nativeError: caught instanceof Error ? caught.message.slice(0, 200) : String(caught),
        at: new Date().toISOString(),
      };
      await writeFile(STATE, `${JSON.stringify(state, null, 1)}\n`, "utf8");
      process.stdout.write(`${batch.id}: ERROR ${state.batches[batch.id]?.nativeError}\n`);
      failed += 1;
      continue;
    }
    published += 1;
    const ok = receipt.verdict === "pass" && receipt.oracle?.verdict === "pass";
    state.batches[batch.id] = {
      hash: batch.hash,
      status: ok ? "pass" : "fail",
      url: receipt.url,
      savedKey: receipt.savedKey,
      ...(receipt.rendered.monthlyValue === null ? {} : { monthly: receipt.rendered.monthlyValue }),
      ...(receipt.rendered.upfrontValue === null ? {} : { upfront: receipt.rendered.upfrontValue }),
      rows: receipt.rendered.services.length,
      mismatches: [...receipt.mismatches, ...(receipt.oracle?.mismatches ?? [])].slice(0, 20),
      at: new Date().toISOString(),
    };
    if (ok) passed += 1;
    else failed += 1;
    await writeFile(STATE, `${JSON.stringify(state, null, 1)}\n`, "utf8");
    process.stdout.write(
      `${batch.id}: ${ok ? "pass" : "FAIL"} ${receipt.rendered.monthlyValue ?? "-"} ${receipt.url}\n`
    );
  }
  process.stdout.write(`published ${published} batches: ${passed} pass, ${failed} fail\n`);
}

async function report(): Promise<void> {
  const manifest = await readJson<Manifest>(MANIFEST);
  const state = (await readJson<State>(STATE)) ?? { batches: {} };
  if (!manifest) throw new Error("run `generate` first");
  const byService = new Map<string, { cases: number; pass: number; fail: number; pending: number; blocked: number }>();
  for (const batch of manifest.batches) {
    const entry = byService.get(batch.code) ?? { cases: 0, pass: 0, fail: 0, pending: 0, blocked: 0 };
    entry.cases += batch.cases.length;
    const status = fresh(state, batch)?.status ?? "pending";
    if (status === "pass") entry.pass += batch.cases.length;
    else if (status === "fail") entry.fail += batch.cases.length;
    else if (status === "native-error") entry.blocked += batch.cases.length;
    else entry.pending += batch.cases.length;
    byService.set(batch.code, entry);
  }
  const rows: string[] = [];
  rows.push("# P0 conformance matrix");
  rows.push("");
  rows.push(`Generated: ${manifest.generatedAt}`);
  rows.push("");
  rows.push(`Cases: ${manifest.cases.length}. Batches: ${manifest.batches.length} (max ${BATCH_SIZE} rows per link).`);
  rows.push("");
  rows.push("| Service | Cases | Editor-verified | Failed | Blocked | Pending |");
  rows.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const [code, entry] of [...byService.entries()].sort()) {
    rows.push(
      `| ${code} | ${entry.cases} | ${entry.pass} | ${entry.fail} | ${entry.blocked} | ${entry.pending} |`
    );
  }
  rows.push("");
  rows.push("## Blocked services");
  rows.push("");
  rows.push("| Service | Reason | Enumerated cases |");
  rows.push("| --- | --- | ---: |");
  for (const item of manifest.blocked) {
    rows.push(`| ${item.code} | ${item.reason} | ${item.cases} |`);
  }
  rows.push("");
  rows.push("## Batches");
  rows.push("");
  rows.push("| Batch | Cases | Status | Monthly | Link |");
  rows.push("| --- | ---: | --- | ---: | --- |");
  for (const batch of manifest.batches) {
    const entry = fresh(state, batch);
    const link = entry?.url ? `https://calculator.aws/#/estimate?id=${entry.savedKey}` : "-";
    rows.push(
      `| ${batch.id} | ${batch.cases.length} | ${entry?.status ?? "pending"} | ${entry?.monthly ?? "-"} | ${link} |`
    );
  }
  await writeFile(REPORT, `${rows.join("\n")}\n`, "utf8");
  const verified = [...byService.values()].reduce((sum, entry) => sum + entry.pass, 0);
  process.stdout.write(
    `report: ${verified}/${manifest.cases.length} cases editor-verified, ${manifest.batches.length} batches -> ${REPORT}\n`
  );
}

const command = process.argv[2] ?? "generate";
if (command === "generate") await generate();
else if (command === "native") await evaluateNative();
else if (command === "publish") {
  const index = process.argv.indexOf("--limit");
  const limit = index >= 0 ? Number(process.argv[index + 1]) : 10;
  await publish(Number.isFinite(limit) ? limit : 10);
} else if (command === "report") await report();
else {
  process.stderr.write(`unknown command "${command}" (generate|native|publish|report)\n`);
  process.exitCode = 2;
}

void readdir;
void stringFlag;
void numberFlag;
