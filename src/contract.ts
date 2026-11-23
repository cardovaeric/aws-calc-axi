/**
 * The calculator.aws estimate contract (wire format accepted by `saveAs` and
 * returned by the GET endpoint). Field quirks observed in analysis/FINDINGS.md
 * are preserved: `serviceCost` and `groupSubtotal` omit a zero `upfront`, while
 * `totalCost` always carries both.
 */

export interface Cost {
  monthly?: number;
  upfront?: number;
}

export interface TotalCost {
  monthly: number;
  upfront: number;
}

export interface CalculationComponentValue {
  value: unknown;
  unit?: string;
}

export type CalculationComponents = Record<string, CalculationComponentValue>;

export interface SubService {
  calculationComponents: CalculationComponents;
  serviceCode: string;
  region: string;
  estimateFor: string;
  version: string;
  description: string | null;
  serviceCost: Cost;
}

export interface EstimateService {
  calculationComponents: CalculationComponents;
  serviceCode: string;
  region: string;
  estimateFor: string;
  version: string;
  description: string | null;
  serviceCost: Cost;
  serviceName: string;
  regionName: string;
  configSummary: string;
  subServices?: SubService[];
}

export interface EstimateGroup {
  name: string;
  services: Record<string, EstimateService>;
  groups: Record<string, EstimateGroup>;
  groupSubtotal: Cost;
  totalCost: TotalCost;
}

export interface SupportComponent {
  value: unknown;
}

export interface EstimateSupport {
  calculationComponents: Record<string, SupportComponent | null>;
  description: string;
  supportTitle: string;
}

export interface EstimateMetaData {
  locale: string;
  currency: string;
  createdOn?: string;
  source?: string;
  estimateId?: string;
}

export interface Estimate {
  name: string;
  services: Record<string, EstimateService>;
  groups: Record<string, EstimateGroup>;
  groupSubtotal: Cost;
  totalCost: TotalCost;
  support: EstimateSupport | Record<string, never>;
  metaData: EstimateMetaData;
}

export const CONTRACT_DEFAULTS = {
  locale: "en_US",
  currency: "USD",
  /**
   * The share page trusts stored service costs for estimates the calculator
   * itself produced and recomputes everything else. We publish the same source
   * value so a link renders exactly like a native estimate; the native UI
   * recomputation stays the oracle for math parity.
   */
  source: "calculator-platform",
} as const;

/** Round to cents without accumulating binary float error. */
export function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Cost object that omits `upfront` when zero, matching the web app's services. */
export function costOf(monthly: number, upfront: number): Cost {
  const rounded = toCents(monthly);
  const roundedUpfront = toCents(upfront);
  if (roundedUpfront === 0) return { monthly: rounded };
  return { monthly: rounded, upfront: roundedUpfront };
}

export function totalCostOf(monthly: number, upfront: number): TotalCost {
  return { monthly: toCents(monthly), upfront: toCents(upfront) };
}

export function sumCosts(costs: Cost[]): TotalCost {
  let monthly = 0;
  let upfront = 0;
  for (const cost of costs) {
    monthly += cost.monthly ?? 0;
    upfront += cost.upfront ?? 0;
  }
  return totalCostOf(monthly, upfront);
}

export function costMonthly(cost: Cost | undefined): number {
  return cost?.monthly ?? 0;
}

export function costUpfront(cost: Cost | undefined): number {
  return cost?.upfront ?? 0;
}
