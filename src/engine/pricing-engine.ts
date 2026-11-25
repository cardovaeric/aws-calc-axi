import { EngineError } from "./errors.ts";
import { MissingPriceError, type PriceResolver } from "../data/pricing.ts";
import type { Component } from "../data/definitions.ts";

export interface TierDefinition {
  startOfTier: number;
  endOfTier: number;
  meteredUnit: string;
}

export interface Tier {
  startOfTier: number;
  endOfTier: number;
  price: number;
}

/** Metered unit labels the live engine resolves without a price file. */
export const MAGIC_PRICES: Record<string, number> = {
  "[ZERO_COST]": 0,
};

export function magicPrice(label: string): number | undefined {
  return Object.hasOwn(MAGIC_PRICES, label) ? MAGIC_PRICES[label] : undefined;
}

export interface PricingContext {
  regionCode: string;
  regionName: string;
  prices: PriceResolver;
  get(componentId: string): unknown;
  serviceCode: string;
}

function mappingName(component: Component): string {
  const name = component["mappingDefinitionName"];
  if (typeof name !== "string" || name === "") {
    throw new EngineError(
      `pricing component "${component.id}" has no mappingDefinitionName`,
      "BAD_DEFINITION",
      { componentId: component.id }
    );
  }
  return name;
}

/** Resolve the metered unit label for this region (or another component's value). */
function meteredUnitFor(component: Component, context: PricingContext): string {
  const meteredUnit = component["meteredUnit"];
  if (typeof meteredUnit === "string") return meteredUnit;
  if (typeof meteredUnit === "object" && meteredUnit !== null) {
    const record = meteredUnit as Record<string, unknown>;
    const originalId = record["originalId"];
    if (typeof originalId === "string" && originalId !== "") {
      const referenced = context.get(originalId);
      if (typeof referenced === "string" && referenced !== "") return referenced;
      throw new EngineError(
        `pricing component "${component.id}" needs component "${originalId}" ` +
          `to select a metered unit`,
        "MISSING_INPUT",
        { componentId: component.id, referencedId: originalId }
      );
    }
    const regional = record[context.regionCode];
    if (typeof regional === "string" && regional !== "") return regional;
    const allRegions = record["allRegions"];
    if (typeof allRegions === "string" && allRegions !== "") return allRegions;
  }
  throw new EngineError(
    `pricing component "${component.id}" has no metered unit for ${context.regionCode}`,
    "BAD_DEFINITION",
    { componentId: component.id }
  );
}

/**
 * Resolve a `singlePricePoint` price.
 *
 * Live reads the meter out of the regional map and falls back to 0 when the
 * map does not carry it (`n = a[o] ? a[o] : 0; if (!n) return {value: 0}`,
 * `analysis/bundle.js` offset 497900). Workspaces Personal/Core rely on that:
 * `additionalBundleUnitPrice2` names
 * `Application Bundle Performance Plus License BYOL Windows Office 2019
 * AlwaysOn`, a meter no region carries. A mapping that never loaded its region
 * is a data gap rather than a live zero, so that still fails closed.
 */
export function singlePricePoint(component: Component, context: PricingContext): number {
  const meter = meteredUnitFor(component, context);
  const magic = magicPrice(meter);
  if (magic !== undefined) return magic;
  const mapping = mappingName(component);
  if (context.prices.meters(mapping) === undefined) {
    throw new MissingPriceError(meter, context.regionName, mapping);
  }
  if (!context.prices.has(mapping, meter)) return 0;
  return context.prices.requirePrice(mapping, meter);
}

/** Resolve a `tieredPricing` component into concrete tiers with regional prices. */
export function resolveTiers(component: Component, context: PricingContext): Tier[] {
  const tiers = component["tiers"];
  if (typeof tiers !== "object" || tiers === null) {
    throw new EngineError(`tiered pricing "${component.id}" has no tiers`, "BAD_DEFINITION", {
      componentId: component.id,
    });
  }
  const record = tiers as Record<string, unknown>;
  const regional = record[context.regionCode];
  const selected = Array.isArray(regional) ? regional : record["allRegions"];
  if (!Array.isArray(selected)) {
    throw new EngineError(
      `tiered pricing "${component.id}" has no tiers for ${context.regionCode}`,
      "BAD_DEFINITION",
      { componentId: component.id }
    );
  }
  const mapping = mappingName(component);
  return selected.map((entry) => {
    const tier = entry as TierDefinition;
    if (!tier || typeof tier.meteredUnit !== "string") {
      throw new EngineError(
        `tiered pricing "${component.id}" has a tier without a meteredUnit`,
        "BAD_DEFINITION",
        { componentId: component.id }
      );
    }
    if (!context.prices.has(mapping, tier.meteredUnit)) {
      throw new MissingPriceError(tier.meteredUnit, context.regionName, mapping);
    }
    return {
      startOfTier: Number(tier.startOfTier),
      endOfTier: Number(tier.endOfTier),
      price: context.prices.requirePrice(mapping, tier.meteredUnit),
    };
  });
}

/**
 * Tiered cost from the live engine: walk tiers in order, bill the slice of the
 * input that falls in each tier, and sum. A tier with `endOfTier: -1` is open
 * ended.
 */
export function tieredCost(tiers: Tier[], input: number): number {
  let total = 0;
  tiers.forEach((tier, index) => {
    const { startOfTier, endOfTier, price } = tier;
    let amount = 0;
    if (index === 0) {
      const tierSize = endOfTier === -1 ? Number.POSITIVE_INFINITY : endOfTier - startOfTier;
      amount = Math.max(Math.min(tierSize, input), 0);
    } else {
      const previous = tiers[index - 1];
      const previousEnd = previous ? previous.endOfTier : 0;
      if (endOfTier !== -1) {
        amount = Math.max(Math.min(endOfTier - previousEnd, input - previousEnd), 0);
      } else {
        amount = Math.max(input - previousEnd, 0);
      }
    }
    total += amount * price;
  });
  return total;
}
