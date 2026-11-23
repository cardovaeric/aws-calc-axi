import type { CacheOptions } from "../cache.ts";
import { loadDefinition, templateById, type ServiceDefinition } from "../data/definitions.ts";
import { loadServiceMappings, createPriceResolver } from "../data/pricing.ts";
import { loadLocations } from "../data/catalog.ts";
import { CURRENCY } from "../endpoints.ts";
import type { Catalog } from "../data/catalog.ts";
import type { Cost } from "../contract.ts";
import { costOf, costMonthly, sumCosts, toCents } from "../contract.ts";
import { evaluateTemplate } from "./template.ts";
import { prepareColumnForms } from "./column-form-loader.ts";
import { EngineError } from "./errors.ts";
import type { EvaluatedService } from "./types.ts";

export interface SubServiceSpec {
  code: string;
  template?: string;
  set?: Record<string, unknown>;
}

export interface ServiceSpec {
  code: string;
  region: string;
  template?: string;
  set?: Record<string, unknown>;
  subServices?: SubServiceSpec[];
}

export interface ServiceEvaluationOptions {
  catalog?: Catalog | undefined;
  currency?: string;
  cache?: CacheOptions;
  /** Force evaluating a selector child directly instead of its parent. */
  allowSubServices?: boolean;
}

export function isSelectorDefinition(definition: ServiceDefinition): boolean {
  return definition.subType === "subServiceSelector";
}

interface RegionLookup {
  name: string;
  nameByCode: Map<string, string>;
  codeByName: Map<string, string>;
}

async function regionLookup(regionCode: string, cache?: CacheOptions): Promise<RegionLookup> {
  const locations = await loadLocations(cache ?? {});
  const records = Object.values(locations);
  const record = records.find((entry) => entry.code === regionCode);
  if (!record) {
    throw new EngineError(
      `unknown region "${regionCode}"; run \`aws-calc-axi services --all\` for valid regions`,
      "UNKNOWN_REGION",
      { region: regionCode }
    );
  }
  const nameByCode = new Map(records.map((entry) => [entry.code, entry.name]));
  const codeByName = new Map(records.map((entry) => [entry.name, entry.code]));
  return { name: record.name, nameByCode, codeByName };
}

function serviceNameFor(spec: ServiceSpec, definition: ServiceDefinition, catalog?: Catalog): string {
  const entry = catalog?.awsServices.find((candidate) => candidate.serviceCode === spec.code);
  return entry?.name.trim() ?? definition.serviceName;
}

async function evaluateSimpleService(
  spec: ServiceSpec,
  regions: RegionLookup,
  options: ServiceEvaluationOptions
): Promise<EvaluatedService> {
  const regionName = regions.name;
  const definition = await loadDefinition(spec.code, options.cache ?? {});
  const template = templateById(definition, spec.template);
  if (!template) {
    throw new EngineError(
      `service "${spec.code}" has no template "${spec.template ?? ""}"`,
      "UNKNOWN_TEMPLATE",
      {
        serviceCode: spec.code,
        template: spec.template,
        available: (definition.templates ?? []).map((entry) => entry.id),
      }
    );
  }

  // PLC_2.0 mappings are selector trees loaded per columnFormIPM component.
  const flatMappings = (definition.mappingDefinitions ?? []).filter(
    (mapping) => mapping.mappingDefinitionVersion !== "PLC_2.0"
  );
  const { mappings } = await loadServiceMappings(
    flatMappings,
    options.currency ?? CURRENCY,
    options.cache ?? {}
  );
  const prices = createPriceResolver({
    currency: options.currency ?? CURRENCY,
    regionName,
    mappings,
    mappingByName: new Map(
      (definition.mappingDefinitions ?? []).map((mapping) => [
        mapping.mappingDefinitionName,
        mapping,
      ])
    ),
  });

  const overrides = spec.set ?? {};
  const columnForms = await prepareColumnForms({
    definition,
    template,
    overrides,
    regionName,
    ...(options.currency ? { currency: options.currency } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
  });
  const evaluated = evaluateTemplate({
    definition,
    template,
    regionCode: spec.region,
    regionName,
    prices,
    overrides,
    regionNameByCode: regions.nameByCode,
    regionCodeByName: regions.codeByName,
    columnForms,
  });

  return {
    serviceCode: definition.serviceCode,
    estimateFor: template.id,
    version: definition.version,
    region: spec.region,
    regionName,
    serviceName: serviceNameFor(spec, definition, options.catalog),
    description: null,
    calculationComponents: evaluated.calculationComponents,
    configSummary: evaluated.configSummary,
    serviceCost: evaluated.serviceCost,
    subtotals: evaluated.subtotals,
    cards: evaluated.cards,
  };
}

/** Evaluate a service spec, expanding selector parents into `subServices[]`. */
export async function evaluateService(
  spec: ServiceSpec,
  options: ServiceEvaluationOptions = {}
): Promise<EvaluatedService> {
  const definition = await loadDefinition(spec.code, options.cache ?? {});
  const regions = await regionLookup(spec.region, options.cache);
  const regionName = regions.name;

  if (!isSelectorDefinition(definition)) {
    if (spec.subServices && spec.subServices.length > 0) {
      throw new EngineError(
        `service "${spec.code}" is not a sub-service selector; remove subServices`,
        "INVALID_SPEC",
        { serviceCode: spec.code }
      );
    }
    return evaluateSimpleService(spec, regions, options);
  }

  const requested = spec.subServices;
  const childSpecs: SubServiceSpec[] =
    requested && requested.length > 0
      ? requested
      : (definition.defaultTemplates ?? []).map((code) => ({ code }));
  if (childSpecs.length === 0) {
    throw new EngineError(
      `selector "${spec.code}" needs at least one sub-service; ` +
        `set subServices (for example amazonS3Standard)`,
      "MISSING_INPUT",
      { serviceCode: spec.code }
    );
  }

  const children = await Promise.all(
    childSpecs.map(async (child) =>
      evaluateSimpleService(
        {
          code: child.code,
          region: spec.region,
          ...(child.template ? { template: child.template } : {}),
          set: child.set ?? {},
        },
        regions,
        options
      )
    )
  );

  const childCosts: Cost[] = children.map((child) => child.serviceCost);
  const total = sumCosts(childCosts);
  const hasUpfront = children.some((child) => "upfront" in child.serviceCost);
  const summary = children
    .map((child) => child.configSummary)
    .filter((part) => part !== "")
    .join(" ");

  return {
    serviceCode: definition.serviceCode,
    estimateFor: definition.templateId ?? definition.templates?.[0]?.id ?? spec.template ?? "",
    version: definition.version,
    region: spec.region,
    regionName,
    serviceName: serviceNameFor(spec, definition, options.catalog),
    description: null,
    calculationComponents: {},
    subServices: children.map((child) => ({
      calculationComponents: child.calculationComponents,
      serviceCode: child.serviceCode,
      region: child.region,
      estimateFor: child.estimateFor,
      version: child.version,
      description: null,
      serviceCost: child.serviceCost,
    })),
    configSummary: summary,
    serviceCost: hasUpfront
      ? { monthly: toCents(costMonthly(total)), upfront: toCents(total.upfront) }
      : costOf(costMonthly(total), 0),
    subtotals: children.flatMap((child) => child.subtotals),
    cards: children.flatMap((child) => child.cards),
  };
}

export async function loadDefinitionForSpec(spec: ServiceSpec): Promise<ServiceDefinition> {
  return loadDefinition(spec.code);
}
