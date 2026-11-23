import type { CacheOptions } from "../cache.ts";
import { loadDefinition, templateById, type ServiceDefinition } from "../data/definitions.ts";
import { loadServiceMappings, createPriceResolver } from "../data/pricing.ts";
import { loadLocations } from "../data/catalog.ts";
import { CURRENCY } from "../endpoints.ts";
import type { Catalog } from "../data/catalog.ts";
import type { Cost } from "../contract.ts";
import { costOf, costMonthly, sumCosts, toCents } from "../contract.ts";
import { evaluateTemplate } from "./template.ts";
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

async function regionNameFor(regionCode: string, cache?: CacheOptions): Promise<string> {
  const locations = await loadLocations(cache ?? {});
  const record = Object.values(locations).find((entry) => entry.code === regionCode);
  if (!record) {
    throw new EngineError(
      `unknown region "${regionCode}"; run \`aws-calc-axi services --all\` for valid regions`,
      "UNKNOWN_REGION",
      { region: regionCode }
    );
  }
  return record.name;
}

function serviceNameFor(spec: ServiceSpec, definition: ServiceDefinition, catalog?: Catalog): string {
  const entry = catalog?.awsServices.find((candidate) => candidate.serviceCode === spec.code);
  return entry?.name.trim() ?? definition.serviceName;
}

async function evaluateSimpleService(
  spec: ServiceSpec,
  regionName: string,
  options: ServiceEvaluationOptions
): Promise<EvaluatedService> {
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

  const { mappings } = await loadServiceMappings(
    definition.mappingDefinitions ?? [],
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

  const evaluated = evaluateTemplate({
    definition,
    template,
    regionCode: spec.region,
    regionName,
    prices,
    overrides: spec.set ?? {},
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
  const regionName = await regionNameFor(spec.region, options.cache);

  if (!isSelectorDefinition(definition)) {
    if (spec.subServices && spec.subServices.length > 0) {
      throw new EngineError(
        `service "${spec.code}" is not a sub-service selector; remove subServices`,
        "INVALID_SPEC",
        { serviceCode: spec.code }
      );
    }
    return evaluateSimpleService(spec, regionName, options);
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
        regionName,
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
