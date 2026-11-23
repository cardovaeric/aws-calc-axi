/**
 * Coverage scanner: find definitions the engine can evaluate today.
 *
 * Stage 1 inventories component subtypes across the catalog (definitions only).
 * Stage 2 evaluates candidate services with default inputs (no overrides) and
 * classifies the outcome. Run with `node scripts/scan.ts [--limit N] [--all]`.
 */
import { loadCatalog, loadRegionMap, visibleServices } from "../src/data/catalog.ts";
import { loadDefinition, type ServiceDefinition } from "../src/data/definitions.ts";
import { evaluateService } from "../src/engine/service.ts";
import { EngineError } from "../src/engine/errors.ts";

const KNOWN = {
  input: new Set([
    "numericInput",
    "dropdown",
    "fileSize",
    "frequency",
    "durationInput",
    "percentInput",
    "checkbox",
    "bodyText",
    "headerText",
    "alert",
    "condition",
    "dataTransferV2",
  ]),
  pricing: new Set(["singlePricePoint", "tieredPricing", "pricingComboV2", "replace", "concatenate"]),
  maths: new Set(["basicMaths", "maxMin", "rounding", "tieredPricingMath", "variable", "conversionDisplay", "priceDisplay"]),
};

interface Inventory {
  supported: string[];
  missing: Map<string, string[]>;
}

function inventory(definition: ServiceDefinition): Inventory {
  const supported = new Set<string>();
  const missing = new Map<string, string[]>();
  const note = (kind: string, subType: string, code: string): void => {
    const known = kind === "input" ? KNOWN.input : kind === "pricing" ? KNOWN.pricing : KNOWN.maths;
    if (known.has(subType)) return;
    const key = `${kind}:${subType}`;
    const list = missing.get(key) ?? [];
    list.push(code);
    missing.set(key, list);
  };

  for (const template of definition.templates ?? []) {
    for (const card of template.cards ?? []) {
      for (const component of card.inputSection?.components ?? []) {
        if (component.type === "input" || component.type === "pricing") {
          note(component.type, component.subType ?? "unknown", definition.serviceCode);
        }
        if (
          component.type === "display" &&
          component.subType !== "priceDisplay" &&
          component.subType !== "conversionDisplay" &&
          component.subType !== "alert" &&
          component.subType !== "condition" &&
          component.subType !== "bodyText" &&
          component.subType !== "headerText"
        ) {
          note("maths", component.subType ?? "unknown", definition.serviceCode);
        }
      }
      for (const section of card.mathsSection ?? []) {
        for (const component of section.components ?? []) {
          note("maths", component.subType ?? "unknown", definition.serviceCode);
        }
      }
    }
  }
  return { supported: [...supported], missing };
}

const args = process.argv.slice(2);
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;
const includeAll = args.includes("--all");

const [catalog, regionMap] = await Promise.all([loadCatalog({}), loadRegionMap({})]);
const region = "us-east-2";
const services = includeAll
  ? catalog.awsServices
  : visibleServices(catalog, regionMap, { region });
const targets = limit ? services.slice(0, limit) : services;

const missingBySubtype = new Map<string, string[]>();
const reachable: string[] = [];
const selectorChildren: string[] = [];
let scanned = 0;

for (const entry of targets) {
  let definition: ServiceDefinition;
  try {
    definition = await loadDefinition(entry.serviceCode);
  } catch (error) {
    process.stderr.write(`skip ${entry.serviceCode}: ${String(error)}\n`);
    continue;
  }
  scanned += 1;
  const result = inventory(definition);
  for (const [key, codes] of result.missing) {
    const list = missingBySubtype.get(key) ?? [];
    list.push(...codes);
    missingBySubtype.set(key, list);
  }
  if (result.missing.size === 0) {
    if (definition.subType === "subServiceSelector") selectorChildren.push(entry.serviceCode);
    else reachable.push(entry.serviceCode);
  }
}

process.stdout.write(`scanned ${scanned} definitions (${region}${includeAll ? ", all" : ""})\n`);
process.stdout.write(`fully supported: ${reachable.length} services, ${selectorChildren.length} selectors\n`);
process.stdout.write(`\nmissing subtypes by service count:\n`);
for (const [key, codes] of [...missingBySubtype.entries()].sort((a, b) => b[1].length - a[1].length)) {
  process.stdout.write(`  ${key}: ${codes.length}\n`);
}

if (process.env["SCAN_EVALUATE"] === "1") {
  process.stdout.write(`\nevaluating ${reachable.length} supported services with defaults...\n`);
  const outcomes = { ok: [] as string[], needsInput: [] as string[], unsupported: [] as string[], error: [] as string[] };
  for (const code of reachable) {
    try {
      const evaluated = await evaluateService({ code, region });
      outcomes.ok.push(`${code} = ${evaluated.serviceCost.monthly}`);
    } catch (error) {
      if (error instanceof EngineError && error.code === "MISSING_INPUT") {
        outcomes.needsInput.push(`${code}: ${error.message.slice(0, 120)}`);
      } else if (error instanceof EngineError && error.code === "UNSUPPORTED_COMPONENT") {
        outcomes.unsupported.push(`${code}: ${String(error.details["subType"])}`);
      } else if (error instanceof EngineError && error.code === "UNSUPPORTED_INPUT") {
        outcomes.unsupported.push(`${code}: ${String(error.details["subType"])}`);
      } else {
        outcomes.error.push(`${code}: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
      }
    }
  }
  for (const [kind, list] of Object.entries(outcomes)) {
    process.stdout.write(`\n${kind}: ${list.length}\n`);
    for (const line of list.slice(0, 40)) process.stdout.write(`  ${line}\n`);
  }
}
