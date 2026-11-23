import {
  supportPricing,
  supportPlans,
  type FrontEndUi,
  type SupportPlanPricing,
  type SupportTier,
} from "../data/support.ts";
import type { EstimateSupport } from "../contract.ts";

export const SUPPORT_PLAN_IDS = {
  basic: "basic-support",
  business: "business-support",
  enterprise: "enterprise-support",
  unified: "unified-operations",
} as const;

export type SupportPlanKey = keyof typeof SUPPORT_PLAN_IDS;

export interface SupportCost {
  /** Ongoing monthly support cost. */
  monthly: number;
  /** Support cost in the first month, including upfront-fee support. */
  firstMonth: number;
}

function planPricing(config: FrontEndUi, planId: string): SupportPlanPricing {
  const pricing = supportPricing(config)[planId]?.pricing;
  if (!pricing) throw new Error(`no support pricing for plan "${planId}"`);
  return pricing;
}

function tiersOf(pricing: SupportPlanPricing): SupportTier[] {
  const table = pricing.tier ?? pricing.tiers ?? {};
  return Object.values(table).sort((left, right) => right.percentage - left.percentage);
}

/**
 * Tiered support price for a spend amount, mirroring the live
 * `tierPriceCalculation`: walk percentage tiers high to low, bill the slice of
 * spend that falls in each, round each slice to cents, then apply the plan
 * minimum when no explicit spend tier was chosen.
 */
export function supportCostForSpend(
  pricing: SupportPlanPricing,
  spend: number,
  options: { selectedPercentage?: number; regions?: number } = {}
): number {
  const tiers = tiersOf(pricing);
  if (tiers.length === 0) {
    const flat = pricing.percentage ?? 0;
    const cost = Math.round(spend * (flat / 100) * 100) / 100;
    return Math.max(pricing.min, cost);
  }

  let remaining = Math.max(spend, 0);
  let total = 0;
  for (const tier of tiers) {
    // The live engine compares the tier percentage with the chosen spend tier,
    // so picking a spend tier skips every higher percentage tier.
    if (options.selectedPercentage !== undefined && tier.percentage > options.selectedPercentage) {
      continue;
    }
    const span =
      tier.max === null || tier.max === undefined || tier.max < tier.min ? null : tier.max - tier.min;
    const slice = span === null ? remaining : Math.min(remaining, span);
    if (slice > 0) {
      total += Math.round(slice * (tier.percentage / 100) * 100) / 100;
      remaining -= slice;
    }
  }

  if (options.selectedPercentage !== undefined) return total;
  const regions = options.regions ?? 1;
  const minimum = regions > 1 ? pricing.min / regions : pricing.min;
  return Math.max(minimum, total);
}

export function computeSupportCost(
  config: FrontEndUi,
  plan: SupportPlanKey,
  monthlyServiceCost: number,
  upfrontServiceCost: number,
  options: { selectedPercentage?: number } = {}
): SupportCost {
  const planId = SUPPORT_PLAN_IDS[plan];
  const pricing = planPricing(config, planId);

  if (pricing.min === 0 && tiersOf(pricing).length === 0) {
    return { monthly: 0, firstMonth: 0 };
  }

  const monthly = supportCostForSpend(pricing, monthlyServiceCost, options);
  const firstMonth = supportCostForSpend(
    pricing,
    monthlyServiceCost + Math.max(upfrontServiceCost, 0),
    options
  );
  return { monthly, firstMonth };
}

/** The support object stored in the estimate; the share page recomputes cost. */
export function supportPayload(config: FrontEndUi, plan: SupportPlanKey): EstimateSupport {
  const planId = SUPPORT_PLAN_IDS[plan];
  const plans = supportPlans(config);
  const entry = plans[planId];
  if (!entry) throw new Error(`no support plan metadata for "${planId}"`);
  return {
    calculationComponents: {
      selectedContract: null,
      technicalSupportLevel: { value: { id: "self-service" } },
      technicalSupportResponseTime: { value: { id: "none" } },
      supportPlan: { value: { id: planId } },
      supportSpend: { value: { id: "", plan: "" } },
    },
    description: "",
    supportTitle: entry.title,
  };
}

export function supportTitle(config: FrontEndUi, plan: SupportPlanKey): string {
  return supportPlans(config)[SUPPORT_PLAN_IDS[plan]]?.title ?? SUPPORT_PLAN_IDS[plan];
}
