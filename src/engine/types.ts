import type { CalculationComponents, Cost } from "../contract.ts";
import type { Component } from "../data/definitions.ts";

export interface Subtotal {
  componentId: string;
  label: string;
  costType: string;
  value: number;
}

export interface EvaluatedService {
  serviceCode: string;
  estimateFor: string;
  version: string;
  region: string;
  regionName: string;
  serviceName: string;
  description: null;
  calculationComponents: CalculationComponents;
  subServices?: Array<{
    calculationComponents: CalculationComponents;
    serviceCode: string;
    region: string;
    estimateFor: string;
    version: string;
    description: null;
    serviceCost: Cost;
  }>;
  configSummary: string;
  serviceCost: Cost;
  subtotals: Subtotal[];
  /** Template card titles in evaluation order, useful for `cost --full`. */
  cards: string[];
}

export interface EvaluatedTemplate {
  calculationComponents: CalculationComponents;
  configSummary: string;
  serviceCost: Cost;
  subtotals: Subtotal[];
  values: Map<string, unknown>;
  /** True when the template declares an Upfront cost display at all. */
  hasUpfront: boolean;
  cards: string[];
}

export type ComponentValueMap = Map<string, unknown>;

export function componentLabel(component: Component): string {
  const label = component["label"] ?? component["title"] ?? component.id;
  return typeof label === "string" ? label : component.id;
}
