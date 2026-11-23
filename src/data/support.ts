import { fetchCachedJson, type CacheOptions } from "../cache.ts";
import { ENDPOINTS } from "../endpoints.ts";

export interface SupportTier {
  min: number;
  max: number | null;
  percentage: number;
}

export interface SupportPlanPricing {
  min: number;
  max?: number | null;
  percentage?: number;
  tier?: Record<string, SupportTier>;
  tiers?: Record<string, SupportTier>;
}

export interface SupportPricingData {
  [planId: string]: { pricing: SupportPlanPricing };
}

export interface SupportPlan {
  id: string;
  title: string;
  label?: string;
  value?: string;
}

export interface RuntimeConfig {
  content?: {
    ADD_SUPPORT_PAGE?: {
      CONTENT?: {
        configuration?: {
          supportRecommendation?: { plans?: Record<string, SupportPlan> };
        };
        pricingData?: SupportPricingData;
      };
    };
    RESOURCES?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

/** The runtime config nests everything under CONTENT in the published file. */
export interface FrontEndUi {
  CONTENT: {
    RESOURCES: Record<string, unknown>;
    ADD_SUPPORT_PAGE: {
      CONTENT: {
        configuration: {
          supportRecommendation: { plans: Record<string, SupportPlan> };
        };
        pricingData: SupportPricingData;
      };
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function loadRuntimeConfig(options: CacheOptions = {}): Promise<FrontEndUi> {
  return fetchCachedJson<FrontEndUi>(ENDPOINTS.runtimeConfig, options);
}

export function supportPricing(config: FrontEndUi): SupportPricingData {
  const pricing = config.CONTENT.ADD_SUPPORT_PAGE.CONTENT.pricingData;
  if (!pricing || typeof pricing !== "object") {
    throw new Error("runtime config has no ADD_SUPPORT_PAGE pricingData");
  }
  return pricing;
}

export function supportPlans(config: FrontEndUi): Record<string, SupportPlan> {
  return config.CONTENT.ADD_SUPPORT_PAGE.CONTENT.configuration.supportRecommendation.plans;
}
