import { randomUUID } from "node:crypto";
import type {
  CalculationComponents,
  Cost,
  Estimate,
  EstimateGroup,
  EstimateService,
  EstimateSupport,
  TotalCost,
} from "../contract.ts";
import { CONTRACT_DEFAULTS, sumCosts, toCents, totalCostOf } from "../contract.ts";
import type { CacheOptions } from "../cache.ts";
import type { Catalog } from "../data/catalog.ts";
import { evaluateService } from "../engine/service.ts";
import type { EvaluatedService } from "../engine/types.ts";
import { computeSupportCost, supportPayload, supportTitle, type SupportCost } from "./support.ts";
import type { FrontEndUi } from "../data/support.ts";
import type { EstimateSpec, GroupSpec } from "./spec.ts";

export interface BuildOptions {
  catalog?: Catalog | undefined;
  cache?: CacheOptions;
  now?: Date;
  supportConfig?: FrontEndUi | undefined;
}

export interface BuiltService {
  id: string;
  path: string;
  evaluated: EvaluatedService;
}

export interface BuiltGroup {
  id: string;
  name: string;
  path: string;
  monthly: number;
  upfront: number;
}

export interface BuildResult {
  estimate: Estimate;
  services: BuiltService[];
  groups: BuiltGroup[];
  /** Service-only totals (support is not stored in the estimate). */
  serviceTotal: TotalCost;
  support?:
    | {
        plan: string;
        title: string;
        cost: SupportCost;
      }
    | undefined;
}

function serviceId(serviceCode: string): string {
  return `${serviceCode}-${randomUUID()}`;
}

function groupId(name: string): string {
  return `${name.replace(/\s+/g, "")}-${randomUUID()}`;
}

function wireService(evaluated: EvaluatedService): EstimateService {
  const service: EstimateService = {
    calculationComponents: evaluated.calculationComponents,
    serviceCode: evaluated.serviceCode,
    region: evaluated.region,
    estimateFor: evaluated.estimateFor,
    version: evaluated.version,
    description: null,
    serviceCost: evaluated.serviceCost,
    serviceName: evaluated.serviceName,
    regionName: evaluated.regionName,
    configSummary: evaluated.configSummary,
  };
  if (evaluated.subServices) service.subServices = evaluated.subServices;
  return service;
}

function compactCost(monthly: number, upfront: number): Cost {
  if (monthly === 0 && upfront === 0) return {};
  return { monthly: toCents(monthly), upfront: toCents(upfront) };
}

interface GroupAccumulator {
  group: EstimateGroup;
  monthly: number;
  upfront: number;
}

async function buildGroup(
  spec: GroupSpec,
  path: string,
  options: BuildOptions,
  collected: BuiltService[],
  collectedGroups: BuiltGroup[]
): Promise<GroupAccumulator> {
  const services: Record<string, EstimateService> = {};
  let monthly = 0;
  let upfront = 0;
  const groups: Record<string, EstimateGroup> = {};

  for (const [index, serviceSpec] of spec.services.entries()) {
    const evaluated = await evaluateService(serviceSpec, buildFlavor(options));
    const id = serviceId(evaluated.serviceCode);
    services[id] = wireService(evaluated);
    monthly += evaluated.serviceCost.monthly ?? 0;
    upfront += evaluated.serviceCost.upfront ?? 0;
    collected.push({ id, path: `${path}.services[${index}]`, evaluated });
  }

  for (const [index, child] of spec.groups.entries()) {
    const childPath = `${path}.groups[${index}]`;
    const built = await buildGroup(child, childPath, options, collected, collectedGroups);
    groups[groupId(child.name)] = built.group;
    monthly += built.monthly;
    upfront += built.upfront;
  }

  const id = groupId(spec.name);
  const group: EstimateGroup = {
    name: spec.name,
    services,
    groups,
    groupSubtotal: compactCost(
      Object.values(services).reduce((total, service) => total + (service.serviceCost.monthly ?? 0), 0),
      Object.values(services).reduce((total, service) => total + (service.serviceCost.upfront ?? 0), 0)
    ),
    totalCost: totalCostOf(monthly, upfront),
  };

  collectedGroups.push({ id, name: spec.name, path, monthly, upfront });
  return { group, monthly, upfront };
}

function buildFlavor(options: BuildOptions): {
  catalog?: Catalog | undefined;
  cache?: CacheOptions;
  allowSubServices?: boolean;
} {
  return {
    ...(options.catalog ? { catalog: options.catalog } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
  };
}

export async function buildEstimate(spec: EstimateSpec, options: BuildOptions = {}): Promise<BuildResult> {
  const now = options.now ?? new Date();
  const collected: BuiltService[] = [];
  const collectedGroups: BuiltGroup[] = [];
  const services: Record<string, EstimateService> = {};
  const groups: Record<string, EstimateGroup> = {};
  let monthly = 0;
  let upfront = 0;
  let topLevelMonthly = 0;
  let topLevelUpfront = 0;

  for (const [index, serviceSpec] of spec.services.entries()) {
    const evaluated = await evaluateService(serviceSpec, buildFlavor(options));
    const id = serviceId(evaluated.serviceCode);
    services[id] = wireService(evaluated);
    monthly += evaluated.serviceCost.monthly ?? 0;
    upfront += evaluated.serviceCost.upfront ?? 0;
    topLevelMonthly += evaluated.serviceCost.monthly ?? 0;
    topLevelUpfront += evaluated.serviceCost.upfront ?? 0;
    collected.push({ id, path: `services[${index}]`, evaluated });
  }

  for (const [index, child] of spec.groups.entries()) {
    const built = await buildGroup(child, `groups[${index}]`, options, collected, collectedGroups);
    groups[groupId(child.name)] = built.group;
    monthly += built.monthly;
    upfront += built.upfront;
  }

  let support: EstimateSupport | Record<string, never> = {};
  let supportReport: BuildResult["support"];
  if (spec.support) {
    if (!options.supportConfig) {
      throw new Error("support was requested but the runtime config is not loaded");
    }
    support = supportPayload(options.supportConfig, spec.support.plan);
    const selectedPercentage =
      typeof spec.support.spendTier === "number" ? spec.support.spendTier : undefined;
    const cost = computeSupportCost(
      options.supportConfig,
      spec.support.plan,
      monthly,
      upfront,
      selectedPercentage === undefined ? {} : { selectedPercentage }
    );
    supportReport = {
      plan: spec.support.plan,
      title: supportTitle(options.supportConfig, spec.support.plan),
      cost,
    };
  }

  const estimate: Estimate = {
    name: spec.name,
    services,
    groups,
    groupSubtotal: compactCost(topLevelMonthly, topLevelUpfront),
    totalCost: totalCostOf(monthly, upfront),
    support,
    metaData: {
      locale: spec.locale || CONTRACT_DEFAULTS.locale,
      currency: spec.currency || CONTRACT_DEFAULTS.currency,
      createdOn: now.toISOString(),
      source: CONTRACT_DEFAULTS.source,
    },
  };

  return {
    estimate,
    services: collected,
    groups: collectedGroups,
    serviceTotal: sumCosts(collected.map((entry) => entry.evaluated.serviceCost)),
    ...(supportReport ? { support: supportReport } : {}),
  };
}

export function totalMonthlyWithSupport(result: BuildResult): number {
  return toCents(result.serviceTotal.monthly + (result.support?.cost.monthly ?? 0));
}

export function totalUpfrontWithSupport(result: BuildResult): number {
  return toCents(result.serviceTotal.upfront + (result.support?.cost.firstMonth ?? 0));
}

export type { Cost, CalculationComponents };
