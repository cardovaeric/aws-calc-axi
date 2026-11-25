/**
 * Exhaustive coverage table for every catalog service.
 *
 * Static pass: inventory the component subtypes each definition uses and flag
 * deep column-form features the engine does not implement yet.
 * Runtime pass (optional): evaluate every definition with defaults in one or
 * more regions and classify the result.
 *
 * Usage:
 *   node --experimental-strip-types scripts/coverage.ts
 *   node --experimental-strip-types scripts/coverage.ts --evaluate --offline
 *
 * Outputs `analysis/coverage-matrix.csv` and `analysis/COVERAGE_TABLE.md`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadCatalog,
  loadRegionMap,
  visibleServices,
} from "../src/data/catalog.ts";
import { loadDefinition, type Card, type Component, type ServiceDefinition } from "../src/data/definitions.ts";
import { evaluateService } from "../src/engine/service.ts";
import {
  rollupSelector,
  type SelectorChildFacts,
  type StaticClass,
} from "./coverage-selector.ts";
import { primaryRemapToken } from "./coverage-column-form.ts";
import { runtimeLabel } from "./coverage-runtime.ts";

const SUPPORTED_INPUT = new Set([
  "bodyText",
  "headerText",
  "alert",
  "condition",
  "numericInput",
  "percentInput",
  "dropdown",
  "checkbox",
  "fileSize",
  "throughput",
  "frequency",
  "durationInput",
  "columnFormIPM",
  "dataTransferV2",
]);

const SUPPORTED_PRICING = new Set([
  "singlePricePoint",
  "tieredPricing",
  "replace",
  "concatenate",
  "pricingComboV2",
]);

const SUPPORTED_MATHS = new Set([
  "basicMaths",
  "maxMin",
  "rounding",
  "tieredPricingMath",
  "variable",
  "conversionDisplay",
  "priceDisplay",
  "snapShotMaths",
]);

const TOP_CODES = new Set([
  "ec2Enhancement",
  "eC2Next",
  "windowsWorkloads",
  "amazonEc2DedicatedHosts",
  "amazonElasticBlockStore",
  "awsEks",
  "amazonVirtualPrivateCloud",
]);

const TOP_PREFIXES = [
  "amazonRDS",
  "amazonRds",
  "amazonAurora",
  "amazonRDSAurora",
  "ebsBackup",
  "vpnConnectionVpc",
  "networkAccessAnalyzerVpc",
  "reachabilityAnalyzerVpc",
  "trafficMirroringVpc",
  "publicIpv4Address",
  "ipamVpc",
  "dataTransferVpc",
  "vpcRouteServer",
  "networkAddressTranslationNatGatewayVpc",
  "transitGatewayVpc",
  "awsPrivateLinkVpc",
  "gatewayLoadBalancerVpc",
  "cloudWan",
];

interface Args {
  evaluate: boolean;
  offline: boolean;
  regions: string[];
  csv: string;
  markdown: string;
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    evaluate: argv.includes("--evaluate"),
    offline: argv.includes("--offline"),
    regions: ["us-east-1", "us-east-2"],
    csv: value("--csv") ?? "analysis/coverage-matrix.csv",
    markdown: value("--md") ?? "analysis/COVERAGE_TABLE.md",
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function cleanCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

interface Row {
  priority: string;
  plan_phase: string;
  service_code: string;
  service_name: string;
  kind: "service" | "selector" | "missing-definition";
  visible_use1: string;
  visible_use2: string;
  templates: number;
  cards: number;
  components_supported: number;
  components_total: number;
  surface_pct: string;
  static_class: StaticClass | string;
  missing_subtypes: string;
  column_forms: number;
  hard_blockers: string;
  deep_gaps: string;
  selector_children: number;
  selector_nonclean: string;
  selector_unserved: string;
  selector_blockers: string;
  runtime_use1: string;
  runtime_use2: string;
  ledger_receipt: string;
  simulation_receipt: string;
  conformance_receipt: string;
  next_action: string;
}

function inventory(definition: ServiceDefinition): {
  cards: number;
  total: number;
  supported: number;
  missing: Map<string, number>;
  columnForms: Component[];
  hard: Set<string>;
  gaps: Set<string>;
} {
  const missing = new Map<string, number>();
  const columnForms: Component[] = [];
  const hard = new Set<string>();
  const gaps = new Set<string>();
  let cards = 0;
  let total = 0;
  let supported = 0;

  const count = (kind: string, subtype: string): void => {
    total += 1;
    const known =
      kind === "input" ? SUPPORTED_INPUT : kind === "pricing" ? SUPPORTED_PRICING : SUPPORTED_MATHS;
    if (known.has(subtype)) {
      supported += 1;
      return;
    }
    const key = `${kind}:${subtype}`;
    missing.set(key, (missing.get(key) ?? 0) + 1);
  };

  for (const template of definition.templates ?? []) {
    if (typeof template === "string") continue;
    for (const card of (template.cards ?? []) as Card[]) {
      cards += 1;
      for (const component of card.inputSection?.components ?? []) {
        if (component.type === "input" || component.type === "pricing") {
          const subtype = text(component.subType) || "unknown";
          count(component.type, subtype);
          if (component.type === "input" && subtype === "columnFormIPM") {
            columnForms.push(component);
          }
        } else if (
          component.type === "display" &&
          !["priceDisplay", "conversionDisplay", "alert", "condition", "bodyText", "headerText"].includes(
            text(component.subType)
          )
        ) {
          count("maths", text(component.subType) || "unknown");
        }
      }
      for (const section of card.mathsSection ?? []) {
        for (const component of section.components ?? []) {
          count("maths", text(component.subType) || "unknown");
        }
      }
    }
  }

  for (const component of columnForms) {
    // A component holds exactly one row, which is what the live calculator
    // does. Its save format is an array, but both rehydration paths read
    // `value[0]` and the live form adds a second configuration as a second
    // service, so a column form is not a repeatable-rows gap. Evidence:
    // analysis/FINDINGS.md section 13 and receipts/column-form-rows-probe.json.
    if (component["additionalPricingData"] !== undefined && component["additionalPricingData"] !== null) {
      gaps.add("additional-pricing-data");
    }
    if (component["subComponentsList"] !== undefined && component["subComponentsList"] !== null) {
      hard.add("subComponentsList");
    }
    const remap = asRecord(component["remap"]);
    const constant = asRecord(remap?.["constant"]);
    if (constant && Object.keys(constant).length > 0) hard.add("remap.constant");
    // `remap.keyValue` is a price-token (key) to form-value (value) map in the
    // live engine, applied forward to aggregation rows and price records and in
    // reverse to meter lists and the index path. `src/data/column-form.ts`
    // implements both directions (`remapValue`, `reverseRemapValue`), so a
    // remap direction is not a gap. The live forward remap is a plain object
    // lookup (`d = (e,t) => t.keyValue[e] || e`), so a regex-shaped key is an
    // inert literal key there and here, and the reversed key is used as the
    // price-set token regex, which `columnFormMeterFragments` also does. The
    // `regex-remap` gap this replaced had no fail-closed path behind it, so it
    // is retired (docs/DECISIONS.md D-027, D-029). What is left is the primary
    // selector: its value is never resolved through the remapped tree.
    // Evidence: analysis/FINDINGS.md sections 14.2, 14.3, 15.
    if (primaryRemapToken(component)) hard.add("remap.keyValue-primary");
    if (component["exportTagsAsValue"] !== undefined) gaps.add("export-tags");
    const unitModel = asRecord(component["pricingUnitModel"]);
    const pricingTypes = asRecord(unitModel?.["riPricingTypes"]);
    // Selector price patterns (`[{TermType: "Reserved", PurchaseOption: "All
    // Upfront"}]`) and their upfront component are native, so a pattern list is
    // not a gap. Tiered PLC_2.0 price patterns (a contiguous StartingRange /
    // EndingRange ladder) are still unimplemented.
    if (
      pricingTypes &&
      Object.values(pricingTypes).some(
        (value) =>
          Array.isArray(value) &&
          value.some(
            (pattern) =>
              asRecord(pattern)?.["StartingRange"] !== undefined ||
              asRecord(pattern)?.["EndingRange"] !== undefined
          )
      )
    ) {
      gaps.add("tiered-plc2-patterns");
    }
    for (const raw of asArray(component["row"])) {
      const row = asRecord(raw);
      if (!row) continue;
      const type = text(row["type"]);
      const selectorId = text(row["selectorId"]);
      // Dependent selectors are native: the option tree is rebuilt from the
      // aggregation rows and the price records, a value the parent no longer
      // offers falls to the fixture default or the first offered value, and a
      // selector with no offered value is dropped from the saved row. Evidence:
      // analysis/FINDINGS.md section 14 and receipts/p1-dependent-selectors.json.
      if (type === "utilization" && selectorId !== "") hard.add("utilization-selector");
      if (type !== "" && !["textInput", "autoSuggest", "dropDown", "utilization"].includes(type)) {
        hard.add(`row:${type}`);
      }
    }
  }

  return { cards, total, supported, missing, columnForms, hard, gaps };
}

function topService(code: string): boolean {
  // Backups and restore helpers are separate pages; keep them out of the top
  // family so P0 stays the five services the plan is written around.
  if (code.toLowerCase().includes("backup")) return false;
  return TOP_CODES.has(code) || TOP_PREFIXES.some((prefix) => code.startsWith(prefix));
}

function classifyStatic(
  isSelector: boolean,
  total: number,
  missing: Map<string, number>,
  hard: Set<string>,
  gaps: Set<string>
): StaticClass {
  if (isSelector) return "no-surface";
  if (total === 0) return "no-surface";
  if (missing.size > 0) return "blocked:subtype";
  if (hard.size > 0) return "blocked:column-form";
  // A column form by itself is not a gap: the supported subset (one row,
  // selector patterns, utilization, disableCalculation) is native. Only the
  // features the engine still fails closed on keep a service partial.
  if (gaps.size > 0) return "partial:column-form";
  return "clean";
}

/**
 * Facts for one declared selector child. A declared child that is absent from
 * the catalog is a dangling live reference: the manifest has no entry for it,
 * so it has no surface. See `scripts/coverage-selector.ts`.
 */
function selectorChildFacts(
  children: string[],
  byCode: Map<string, Row>,
  catalogCodes: Set<string>
): SelectorChildFacts[] {
  return children.map((code) => {
    const row = byCode.get(code);
    return {
      code,
      inCatalog: catalogCodes.has(code),
      row: row
        ? {
            static_class: row.static_class,
            missing_subtypes: row.missing_subtypes,
            hard_blockers: row.hard_blockers,
            deep_gaps: row.deep_gaps,
            next_action: row.next_action,
          }
        : undefined,
    };
  });
}

function phaseFor(code: string, klass: string, action: string): string {
  if (klass === "missing-definition") return "Phase 0 - data";
  if (klass === "clean") {
    return TOP_CODES.has(code) ? "Phase 1 - certify" : "Phase 1 - receipts";
  }
  if (code.startsWith("ec2") || code === "eC2Next" || code === "windowsWorkloads" || code === "amazonEc2DedicatedHosts") {
    return "Phase 3 - EC2 module";
  }
  if (code.startsWith("amazonRDS") || code.startsWith("amazonRds") || code.startsWith("amazonAurora") || code.startsWith("amazonRDSAurora")) {
    return "Phase 2 - column-form v2";
  }
  if (TOP_CODES.has(code)) return "Phase 1 - certify";
  if (klass.startsWith("blocked:column-form") || klass.startsWith("partial")) {
    return "Phase 2 - column-form v2";
  }
  if (klass.startsWith("blocked:subtype")) {
    return action.includes("utilization") ? "Phase 5 - long tail" : "Phase 2 - column-form v2";
  }
  return "Phase 1 - receipts";
}

function phaseForRow(
  code: string,
  klass: string,
  ledger: boolean,
  simulated: boolean,
  conformance: boolean,
  action: string
): string {
  if (klass === "clean" && ledger) return "Done - ledger receipt";
  if (klass === "clean" && conformance) return "Conformance passed - add ledger";
  if (klass === "clean" && simulated) return "Phase 1 - promote simulation";
  return phaseFor(code, klass, action);
}

function priorityFor(code: string, visible: boolean, klass: string, verified: boolean): string {
  if (topService(code)) return "P0";
  if (visible && !verified && (klass.startsWith("blocked") || klass.startsWith("partial"))) return "P1";
  if (visible && !verified) return "P2";
  return "P3";
}

function nextAction(
  klass: string,
  missing: string,
  hard: string,
  gaps: string,
  ledger: boolean,
  simulated: boolean,
  conformance: boolean,
  selector: boolean
): string {
  if (ledger && klass === "clean") {
    return "Keep the rendered receipt and add regression coverage";
  }
  if (klass === "missing-definition") return "Fetch the missing definition and re-run coverage";
  if (selector) {
    // A selector is a menu: its blockers are always the children's, and the
    // parent row names them in `selector_blockers`.
    if (klass !== "clean") return "Resolve the blockers named in selector_blockers";
    if (conformance) return "Add a ledger receipt and keep the conformance batch";
    return simulated
      ? "Promote the simulation to a ledger receipt"
      : "Verify all children with fixtures and a receipt";
  }
  if (klass === "blocked:subtype") return `Implement ${missing}`;
  if (klass === "blocked:column-form") return `Implement column-form ${hard}`;
  if (klass === "partial:column-form") return `Column-form v2: ${gaps}`;
  if (klass === "no-surface") return "Utility definition; no calculator surface";
  if (conformance) return "Add a ledger receipt and keep the conformance batch";
  return simulated
    ? "Promote the simulation to a ledger receipt"
    : "Add fixtures and a rendered receipt";
}

async function runtimeFor(
  code: string,
  region: string,
  offline: boolean
): Promise<string> {
  try {
    await evaluateService({ code, region }, { cache: { offline } });
    return `${region}:ok`;
  } catch (error) {
    return `${region}:${runtimeLabel(error)}`;
  }
}

async function receipts(): Promise<{
  ledger: Set<string>;
  simulation: Set<string>;
  conformance: Set<string>;
}> {
  const ledger = new Set<string>();
  const simulation = new Set<string>();
  const conformance = new Set<string>();
  let files: string[] = [];
  try {
    files = await readdir("receipts");
  } catch {
    return { ledger, simulation, conformance };
  }
  const collect = (value: unknown, target: Set<string>): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item, target);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const serviceCode = record["serviceCode"];
    if (typeof serviceCode === "string") target.add(serviceCode);
    // Simulation receipts list `code` plus a cost or group on each service.
    if (
      typeof record["code"] === "string" &&
      (record["monthly"] !== undefined || record["group"] !== undefined)
    ) {
      target.add(record["code"]);
    }
    for (const item of Object.values(record)) collect(item, target);
  };
  for (const file of files) {
    if (!file.endsWith(".json") || file.endsWith("-estimate.json")) continue;
    try {
      const parsed = JSON.parse(await readFile(join("receipts", file), "utf8")) as unknown;
      // Research probes document a live behaviour; they are not render receipts
      // and must not mark services as verified.
      const kind = asRecord(parsed)?.["kind"];
      if (kind === "research-probe") continue;
      if (file.startsWith("conformance-")) collect(parsed, conformance);
      else collect(parsed, file.startsWith("sim-") ? simulation : ledger);
    } catch {
      // Old or partial receipts are ignored; the table records what parsed.
    }
  }
  return { ledger, simulation, conformance };
}

const args = parseArgs(process.argv.slice(2));
const cache = { offline: args.offline };
const [catalog, regionMap, receiptSets] = await Promise.all([
  loadCatalog(cache),
  loadRegionMap(cache),
  receipts(),
]);
const visible1 = new Set(
  visibleServices(catalog, regionMap, { region: "us-east-1" }).map((entry) => entry.serviceCode)
);
const visible2 = new Set(
  visibleServices(catalog, regionMap, { region: "us-east-2" }).map((entry) => entry.serviceCode)
);

const rowsByCode = new Map<string, Row>();
const definitions = new Map<string, ServiceDefinition>();
const skipped: string[] = [];
for (const entry of catalog.awsServices) {
  if (entry.type !== "AWSService") continue;
  try {
    const definition = await loadDefinition(entry.serviceCode, cache);
    definitions.set(entry.serviceCode, definition);
  } catch (error) {
    skipped.push(`${entry.serviceCode}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const runtime = new Map<string, Record<string, string>>();
if (args.evaluate) {
  for (const region of args.regions) {
    for (const [code] of definitions) {
      const result = await runtimeFor(code, region, args.offline);
      const byRegion = runtime.get(code) ?? {};
      byRegion[region] = result.split(":")[1] ?? "unknown";
      runtime.set(code, byRegion);
    }
  }
}

// A selector template code is only a service if the live manifest lists it.
const catalogCodes = new Set(catalog.awsServices.map((entry) => entry.serviceCode));

for (const entry of catalog.awsServices) {
  if (entry.type !== "AWSService" || definitions.has(entry.serviceCode)) continue;
  rowsByCode.set(entry.serviceCode, {
    priority: visible2.has(entry.serviceCode) || visible1.has(entry.serviceCode) ? "P1" : "P3",
    plan_phase: "Phase 0 - data",
    service_code: entry.serviceCode,
    service_name: entry.name.trim(),
    kind: "missing-definition",
    visible_use1: visible1.has(entry.serviceCode) ? "yes" : "no",
    visible_use2: visible2.has(entry.serviceCode) ? "yes" : "no",
    templates: 0,
    cards: 0,
    components_supported: 0,
    components_total: 0,
    surface_pct: "",
    static_class: "missing-definition",
    missing_subtypes: "",
    column_forms: 0,
    hard_blockers: "",
    deep_gaps: "",
    selector_children: 0,
    selector_nonclean: "",
    selector_unserved: "",
    selector_blockers: "",
    runtime_use1: "not-run",
    runtime_use2: "not-run",
    ledger_receipt: "no",
    simulation_receipt: "no",
    conformance_receipt: "no",
    next_action: "Fetch the missing definition and re-run coverage",
  });
}

for (const [code, definition] of definitions) {
  const inv = inventory(definition);
  const isSelector = definition.subType === "subServiceSelector";
  const children = isSelector
    ? asArray(definition.templates).map((item) => (typeof item === "string" ? item : "")).filter(Boolean)
    : [];
  const missing = [...inv.missing.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key}:${count}`)
    .join(";");
  const hard = [...inv.hard].sort().join(";");
  const gaps = [...inv.gaps].sort().join(";");
  const staticClass = isSelector
    ? rollupSelector(selectorChildFacts(children, rowsByCode, catalogCodes)).klass
    : classifyStatic(false, inv.total, inv.missing, inv.hard, inv.gaps);
  const ledger = receiptSets.ledger.has(code);
  const sim = receiptSets.simulation.has(code);
  const conform = receiptSets.conformance.has(code);
  const verified = ledger || sim || conform;
  const visible = visible2.has(code) || visible1.has(code);
  // Selector children are resolved after this pass, so a selector row is
  // finalized below once every child row exists.
  const rollup = isSelector ? rollupSelector(selectorChildFacts(children, rowsByCode, catalogCodes)) : undefined;
  const missingColumn = isSelector ? (rollup?.missingSubtypes ?? "") : missing;
  const hardColumn = isSelector ? (rollup?.hardBlockers ?? "") : hard;
  const gapsColumn = isSelector ? (rollup?.deepGaps ?? "") : gaps;
  const action = isSelector
    ? rollup?.nextAction || ""
    : nextAction(staticClass, missing, hard, gaps, ledger, sim, conform, isSelector);
  const row: Row = {
    priority: priorityFor(code, visible, staticClass, verified),
    plan_phase: phaseForRow(code, staticClass, ledger, sim, conform, action),
    service_code: code,
    service_name: text(definition.serviceName).trim() || text(catalog.awsServices.find((x) => x.serviceCode === code)?.name),
    kind: isSelector ? "selector" : "service",
    visible_use1: visible1.has(code) ? "yes" : "no",
    visible_use2: visible2.has(code) ? "yes" : "no",
    templates: asArray(definition.templates).length,
    cards: inv.cards,
    components_supported: inv.supported,
    components_total: inv.total,
    surface_pct: inv.total === 0 ? "" : `${((100 * inv.supported) / inv.total).toFixed(1)}%`,
    static_class: staticClass,
    missing_subtypes: isSelector ? missingColumn : missing,
    column_forms: inv.columnForms.length,
    hard_blockers: isSelector ? hardColumn : hard,
    deep_gaps: isSelector ? gapsColumn : gaps,
    selector_children: children.length,
    selector_nonclean: isSelector ? (rollup?.nonclean ?? []).join(";") : "",
    selector_unserved: isSelector ? (rollup?.unserved ?? []).join(";") : "",
    selector_blockers: isSelector ? (rollup?.blockers ?? "") : "",
    runtime_use1: runtime.get(code)?.["us-east-1"] ?? "not-run",
    runtime_use2: runtime.get(code)?.["us-east-2"] ?? "not-run",
    ledger_receipt: ledger ? "yes" : "no",
    simulation_receipt: sim ? "yes" : "no",
    conformance_receipt: conform ? "yes" : "no",
    next_action: action,
  };
  rowsByCode.set(code, row);
}

// Selectors depend on child rows, so resolve them after the first pass.
for (const [code, definition] of definitions) {
  if (definition.subType !== "subServiceSelector") continue;
  const row = rowsByCode.get(code);
  if (!row) continue;
  const children = asArray(definition.templates)
    .map((item) => (typeof item === "string" ? item : ""))
    .filter(Boolean);
  const rollup = rollupSelector(selectorChildFacts(children, rowsByCode, catalogCodes));
  row.static_class = rollup.klass;
  row.selector_nonclean = rollup.nonclean.join(";");
  row.selector_unserved = rollup.unserved.join(";");
  row.selector_blockers = rollup.blockers;
  row.missing_subtypes = rollup.missingSubtypes;
  row.hard_blockers = rollup.hardBlockers;
  row.deep_gaps = rollup.deepGaps;
  const childRows = children
    .map((child) => rowsByCode.get(child))
    .filter((child): child is Row => child !== undefined);
  const childTotal = childRows.reduce((sum, child) => sum + Number(child.components_total || 0), 0);
  const childSupported = childRows.reduce(
    (sum, child) => sum + Number(child.components_supported || 0),
    0
  );
  row.cards = childRows.reduce((sum, child) => sum + Number(child.cards || 0), 0);
  row.components_total = childTotal;
  row.components_supported = childSupported;
  row.surface_pct = childTotal === 0 ? "" : `${((100 * childSupported) / childTotal).toFixed(1)}%`;
  if (children.length > 0 && children.every((child) => rowsByCode.get(child)?.simulation_receipt === "yes")) {
    row.simulation_receipt = "yes";
  }
  if (children.length > 0 && children.every((child) => rowsByCode.get(child)?.conformance_receipt === "yes")) {
    row.conformance_receipt = "yes";
  }
  // A selector is only receipt-complete when every child has its own receipt.
  if (!(children.length > 0 && children.every((child) => rowsByCode.get(child)?.ledger_receipt === "yes"))) {
    row.ledger_receipt = "no";
  }
  row.next_action =
    rollup.nextAction ||
    nextAction(
      row.static_class,
      row.missing_subtypes,
      row.hard_blockers,
      row.deep_gaps,
      row.ledger_receipt === "yes",
      row.simulation_receipt === "yes",
      row.conformance_receipt === "yes",
      true
    );
  row.priority = priorityFor(
    code,
    row.visible_use2 === "yes" || row.visible_use1 === "yes",
    row.static_class,
    row.ledger_receipt === "yes" ||
      row.simulation_receipt === "yes" ||
      row.conformance_receipt === "yes"
  );
  row.plan_phase = phaseForRow(
    code,
    row.static_class,
    row.ledger_receipt === "yes",
    row.simulation_receipt === "yes",
    row.conformance_receipt === "yes",
    row.next_action
  );
}

const rows = [...rowsByCode.values()].sort((a, b) => {
  const priority = a.priority.localeCompare(b.priority);
  if (priority !== 0) return priority;
  const klass = a.static_class.localeCompare(b.static_class);
  if (klass !== 0) return klass;
  return a.service_code.localeCompare(b.service_code);
});

const columns: Array<keyof Row> = [
  "priority",
  "plan_phase",
  "service_code",
  "service_name",
  "kind",
  "visible_use1",
  "visible_use2",
  "templates",
  "cards",
  "components_supported",
  "components_total",
  "surface_pct",
  "static_class",
  "missing_subtypes",
  "column_forms",
  "hard_blockers",
  "deep_gaps",
  "selector_children",
  "selector_nonclean",
  "selector_unserved",
  "selector_blockers",
  "runtime_use1",
  "runtime_use2",
  "ledger_receipt",
  "simulation_receipt",
  "conformance_receipt",
  "next_action",
];

const csv = [
  columns.join(","),
  ...rows.map((row) =>
    columns
      .map((column) => {
        const value = String(row[column]);
        return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      })
      .join(",")
  ),
].join("\n");
await writeFile(args.csv, `${csv}\n`, "utf8");

const counts = new Map<string, number>();
for (const row of rows) counts.set(row.static_class, (counts.get(row.static_class) ?? 0) + 1);
const priorityCounts = new Map<string, number>();
for (const row of rows) priorityCounts.set(row.priority, (priorityCounts.get(row.priority) ?? 0) + 1);
const phaseCounts = new Map<string, number>();
for (const row of rows) phaseCounts.set(row.plan_phase, (phaseCounts.get(row.plan_phase) ?? 0) + 1);
const blockerCounts = new Map<string, Set<string>>();
for (const row of rows) {
  const keys = [
    // missing_subtypes uses `kind:subType:count`; keep the subtype, not the kind.
    ...row.missing_subtypes.split(";").map((item) => item.split(":")[1] ?? item),
    ...row.hard_blockers.split(";"),
    ...row.deep_gaps.split(";"),
  ];
  for (const key of keys) {
    const name = key.split(":")[0]?.trim();
    if (!name) continue;
    const set = blockerCounts.get(name) ?? new Set<string>();
    set.add(row.service_code);
    blockerCounts.set(name, set);
  }
}

function table(items: Row[], columnsToShow: Array<keyof Row>): string {
  const header = `| ${columnsToShow.join(" | ")} |`;
  const divider = `| ${columnsToShow.map(() => "---").join(" | ")} |`;
  const body = items.map(
    (row) => `| ${columnsToShow.map((column) => cleanCell(String(row[column])) || "-").join(" | ")} |`
  );
  return [header, divider, ...body].join("\n");
}

const compact: Array<keyof Row> = [
  "priority",
  "service_code",
  "service_name",
  "visible_use2",
  "surface_pct",
  "static_class",
  "deep_gaps",
  "runtime_use1",
  "runtime_use2",
  "ledger_receipt",
  "conformance_receipt",
  "plan_phase",
  "next_action",
];

const p0 = rows.filter((row) => row.priority === "P0");
const p1 = rows.filter((row) => row.priority === "P1");
const p2 = rows.filter((row) => row.priority === "P2");
const p3 = rows.filter((row) => row.priority === "P3");

const markdown = `# Service coverage table

Generated by \`scripts/coverage.ts\` on ${new Date().toISOString().slice(0, 10)}.
Runtime columns: ${args.evaluate ? args.regions.join(", ") : "not evaluated (pass --evaluate)"}.

Machine-readable source: \`${args.csv}\`.
The catalog's \`aWSPricingCalculatorStrings\` static string table is excluded because it has
no calculator surface.

## Summary

| Class | Services |
| --- | ---: |
${[...counts.entries()].sort().map(([key, value]) => `| ${key} | ${value} |`).join("\n")}

| Priority | Services |
| --- | ---: |
${[...priorityCounts.entries()].sort().map(([key, value]) => `| ${key} | ${value} |`).join("\n")}

| Plan phase | Services |
| --- | ---: |
${[...phaseCounts.entries()].sort().map(([key, value]) => `| ${key} | ${value} |`).join("\n")}

| Blocker | Services |
| --- | ---: |
${[...blockerCounts.entries()].sort((a, b) => b[1].size - a[1].size).map(([key, value]) => `| ${key} | ${value.size} |`).join("\n")}

Priority rules:

- **P0** - EC2, RDS/Aurora, EBS, EKS, and VPC families.
- **P1** - visible service with a blocked or partial static class.
- **P2** - visible and statically clean, but no receipt yet.
- **P3** - non-visible, child, or already covered services.

The static class is intentionally conservative. A \`columnFormIPM\` service is
\`partial\` only while it uses a feature the engine still fails closed on:
additional pricing data, tiered PLC_2.0 price patterns, sub-components, or
unsupported row types. A plain one-row column form is native, and so are
dependent selectors, reserved/upfront payment models, selector price patterns,
and a \`remap.keyValue\` in either direction (\`analysis/FINDINGS.md\` section 14).
One remap case is still blocked: a primary selector whose declared default is a
\`remap.keyValue\` key. The form's options are the remapped labels and the live
form replaces an unoffered default with the first offered value, while this
engine keeps the primary value verbatim, so the default cannot match an
aggregation row (section 15). It is \`blocked\` when the engine cannot reach a
price at all. Runtime \`needs-input\` is not a failure; it means the service needs
a fixture with explicit required values. Runtime \`not-cached\` is a property of
this offline run, not of the service.

Selector rules (\`subServiceSelector\` rows, \`kind: selector\`):

- A selector is the live calculator's service menu. The parent has no form and
  no price; the user configures exactly one child. Its class is therefore the
  union of the children the live calculator serves, with the same precedence a
  single service uses (\`blocked:subtype\` > \`blocked:column-form\` >\n  \`partial:column-form\` > \`clean\`).
- \`selector_children\` counts the children the definition declares.\n  \`selector_unserved\` lists declared children that the live manifest does not
  define at all: the calculator never offers them (Amazon WorkSpaces shows 4 of
  its 6 declared children) and their definition URLs answer 403, so they have no
  surface to score and do not make the parent look blocked.
- \`selector_blockers\` names the blocker and the children that carry it, and
  \`next_action\` repeats the concrete child actions instead of a generic
  "resolve the non-clean children". Nothing is hidden by excluding a child: an
  unserved child is recorded in its own column.
- The \`runtime\` columns of a selector are the evaluation of its
  \`defaultTemplates\` children, which is what the calculator configures when the
  service is added with defaults.

## P0 - top services

${table(p0, compact)}

## P1 - visible blocked or partial

${table(p1, compact)}

## P2 - visible clean without a receipt

${table(p2, compact)}

## P3 - remaining services

${table(p3, compact)}

## Rebuild

\`\`\`sh
npm run coverage
npm run coverage -- --evaluate --offline
\`\`\`
`;
await writeFile(args.markdown, markdown, "utf8");

if (skipped.length > 0) {
  process.stderr.write(`skipped ${skipped.length} definitions:\n${skipped.join("\n")}\n`);
}
process.stdout.write(`wrote ${rows.length} rows to ${args.csv} and ${args.markdown}\n`);
process.stdout.write(`classes: ${[...counts.entries()].map(([key, value]) => `${key}=${value}`).join(", ")}\n`);
process.stdout.write(`priorities: ${[...priorityCounts.entries()].map(([key, value]) => `${key}=${value}`).join(", ")}\n`);
