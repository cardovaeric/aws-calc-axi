import { Decimal } from "decimal.js";
import { EngineError } from "./errors.ts";
import type { Component } from "../data/definitions.ts";
import type { EngineValue, Operand } from "./expression.ts";

export interface OperandValue {
  value: EngineValue;
  /** required operand missing/zero, so the web app would not compute the math */
  invalid: boolean;
}

export function resolveOperandValue(
  operand: Operand,
  get: (id: string) => EngineValue
): OperandValue {
  if (operand.constant !== undefined) {
    const value = operand.constant;
    return { value, invalid: !Number.isFinite(value) };
  }
  const id = operand.variableId ?? operand.id;
  if (!id) throw new EngineError("maths operand has no variableId", "BAD_MATHS");
  const raw = get(id);
  if (raw === undefined || raw === null || raw === "") return { value: undefined, invalid: true };
  if (typeof raw === "boolean") return { value: raw ? 1 : 0, invalid: false };
  if (typeof raw === "number") return { value: raw, invalid: !Number.isFinite(raw) };
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return { value: parsed, invalid: false };
    return { value: raw, invalid: false };
  }
  return { value: raw, invalid: false };
}

function numbers(values: OperandValue[]): number[] {
  return values.map((entry) => {
    const value = entry.value;
    if (typeof value === "number") return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function toFixedString(value: number, decimalPlaces: number): string {
  return Number(value).toFixed(decimalPlaces);
}

const DECIMAL_ROUNDING: Record<string, Decimal.Rounding> = {
  standard: Decimal.ROUND_HALF_UP,
  roundUp: Decimal.ROUND_CEIL,
  roundDown: Decimal.ROUND_FLOOR,
};

const FACTOR_ROUNDING: Record<string, (value: number, factor: number) => number> = {
  roundUp: (value, factor) => (factor === 0 ? value : Math.ceil(value / factor) * factor),
  roundDown: (value, factor) => (factor === 0 ? value : Math.floor(value / factor) * factor),
  standard: (value, factor) => (factor === 0 ? value : Math.round(value / factor) * factor),
};

/** Apply the component's decimalPlaces exactly as the web app does (toFixed). */
export function applyMathsDecimals(
  component: Component,
  value: EngineValue
): EngineValue {
  const places = component["decimalPlaces"];
  if (typeof places === "number" && places !== 0 && Number.isFinite(Number(value))) {
    return toFixedString(Number(value), places);
  }
  return value;
}

export interface BasicMathsResult {
  value: EngineValue;
  computed: boolean;
}

/**
 * Evaluate `basicMaths`, `maxMin` and `rounding` components.
 *
 * Semantics mirror the live `calculator` command set: single-operand
 * multiplication/division/exponent yield 0, a zero divisor yields 0, and a
 * required operand that is zero or missing suppresses the whole computation.
 */
export function evaluateMaths(
  component: Component,
  operands: Operand[],
  get: (id: string) => EngineValue
): BasicMathsResult {
  const subType = component.subType ?? "basicMaths";
  const operation = String(component["operation"] ?? subType);

  if (subType === "rounding" || operation === "rounding") {
    return evaluateRounding(component, operands, get);
  }

  const resolved = operands.map((operand) => resolveOperandValue(operand, get));
  const isZeroValid = component["isZeroValid"] === true;
  const isValid = (entry: OperandValue): boolean => {
    const numericValue = Number(entry.value);
    if (isZeroValid) return numericValue >= 0;
    if (operation === "multiplication" || operation === "addition") {
      return numericValue !== 0 && Number.isFinite(numericValue);
    }
    return Number.isFinite(numericValue);
  };
  const suppressed = resolved.some(
    (entry, index) =>
      (operands[index]?.required === true ||
        (operands[index]?.constant !== undefined && operation === "subtraction")) &&
      !isValid(entry)
  );
  if (suppressed) return { value: undefined, computed: false };

  const values = numbers(resolved);
  let result: number;

  switch (operation) {
    case "addition":
      result = values.reduce((acc, value) => new Decimal(acc).add(value).toNumber(), 0);
      break;
    case "subtraction": {
      const minValue = component["minValue"];
      result = values.reduce((acc, value) => {
        const next = new Decimal(acc).sub(value).toNumber();
        return typeof minValue === "number" && minValue > next ? minValue : next;
      });
      break;
    }
    case "multiplication":
      if (values.length <= 1) return { value: 0, computed: true };
      result = values.reduce((acc, value) => new Decimal(acc).mul(value).toNumber(), 1);
      break;
    case "division":
      if (values.length <= 1) return { value: 0, computed: true };
      result = values.reduce((acc, value) => {
        if (parseFloat(String(value)) === 0) return 0;
        return new Decimal(acc).div(value).toNumber();
      });
      break;
    case "exponent":
      if (values.length <= 1) return { value: 0, computed: true };
      result = values.reduce((acc, value) => new Decimal(acc).pow(value).toNumber());
      break;
    case "Maximum":
    case "maximum":
      result = Math.max(...values);
      break;
    case "Minimum":
    case "minimum":
      result = Math.min(...values);
      break;
    default:
      throw new EngineError(`unsupported maths operation "${operation}"`, "UNSUPPORTED_MATHS", {
        componentId: component.id,
        operation,
      });
  }

  return { value: applyMathsDecimals(component, result), computed: true };
}

function evaluateRounding(
  component: Component,
  operands: Operand[],
  get: (id: string) => EngineValue
): BasicMathsResult {
  const first = operands[0];
  if (!first) return { value: undefined, computed: false };
  const resolved = resolveOperandValue(first, get);
  const value = Number(resolved.value);
  if (!Number.isFinite(value)) return { value: undefined, computed: false };

  const method = String(component["method"] ?? "standard");
  const factor = Number(component["factor"] ?? 1);
  const toDecimal = component["toDecimal"] === true;
  const places = Number(component["decimalPlaces"] ?? 0);

  if (toDecimal) {
    const rounding = DECIMAL_ROUNDING[method];
    if (!rounding) throw new EngineError(`unsupported rounding method "${method}"`, "UNSUPPORTED_MATHS");
    return {
      value: new Decimal(value).toDecimalPlaces(places, rounding).toNumber(),
      computed: true,
    };
  }

  const rounder = FACTOR_ROUNDING[method];
  if (!rounder) throw new EngineError(`unsupported rounding method "${method}"`, "UNSUPPORTED_MATHS");
  return { value: rounder(value, factor), computed: true };
}
