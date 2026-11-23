import { EngineError } from "./errors.ts";

export type EngineValue =
  | number
  | string
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | unknown[];

export interface Operand {
  type?: string;
  id?: string;
  variableId?: string;
  constant?: number;
  mappingDefinitionName?: string;
  meteredUnit?: string;
  [key: string]: unknown;
}

export interface ExprContext {
  get(componentId: string): EngineValue;
  hasMeteredUnit(mappingDefinitionName: string, meteredUnit: string): boolean;
}

function isOperandObject(value: unknown): value is Operand {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve one displayIf operand. Literals pass through unchanged. */
export function resolveOperand(operand: unknown, context: ExprContext): EngineValue {
  if (!isOperandObject(operand)) return operand as EngineValue;
  if (operand.constant !== undefined) return operand.constant;
  const id = operand.variableId ?? operand.id;
  if (operand.type === "component" || operand.variableId) {
    if (!id) throw new EngineError("displayIf component operand has no id", "BAD_EXPRESSION");
    return context.get(id);
  }
  if (operand.type === "meteredUnit") {
    // Handled by `exists`; a bare metered unit operand compares to nothing.
    return undefined;
  }
  if (id) return context.get(id);
  return operand as unknown as EngineValue;
}

function numeric(value: EngineValue): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function equalValues(left: EngineValue, right: EngineValue): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return left === right;
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber === rightNumber;
  return String(left) === String(right);
}

function compare(
  operator: string,
  left: EngineValue,
  right: EngineValue
): boolean {
  if (operator === "==") return equalValues(left, right);
  if (operator === "!=") return !equalValues(left, right);
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);
  if (leftNumber === undefined || rightNumber === undefined) return false;
  switch (operator) {
    case ">":
      return leftNumber > rightNumber;
    case ">=":
      return leftNumber >= rightNumber;
    case "<":
      return leftNumber < rightNumber;
    case "<=":
      return leftNumber <= rightNumber;
    default:
      return false;
  }
}

/**
 * Evaluate a definition `displayIf` expression.
 *
 * Supported: ==, !=, >, >=, <, <=, and, or, not, exists, checkboxChecked,
 * checkboxNotChecked. Unknown operators fail closed instead of showing a card
 * the web app would hide.
 */
export function evaluateDisplayIf(expr: unknown, context: ExprContext): boolean {
  if (expr === undefined || expr === null) return true;
  if (typeof expr === "boolean") return expr;
  if (!isOperandObject(expr)) {
    throw new EngineError(`unsupported displayIf expression: ${JSON.stringify(expr)}`, "BAD_EXPRESSION");
  }

  if ("and" in expr) {
    const list = asArray(expr.and);
    return list.every((item) => evaluateDisplayIf(item, context));
  }
  if ("or" in expr) {
    const list = asArray(expr.or);
    return list.some((item) => evaluateDisplayIf(item, context));
  }
  if ("not" in expr) {
    return !evaluateDisplayIf(expr.not, context);
  }
  if ("exists" in expr) {
    const target = expr.exists;
    if (!isOperandObject(target)) return false;
    if (target.type === "meteredUnit") {
      if (!target.mappingDefinitionName || !target.meteredUnit) return false;
      return context.hasMeteredUnit(target.mappingDefinitionName, target.meteredUnit);
    }
    if (target.type === "component") {
      if (!target.id) return false;
      const value = context.get(target.id);
      return value !== undefined && value !== null && value !== "";
    }
    return false;
  }
  if ("checkboxChecked" in expr) {
    return Boolean(context.get(String(expr.checkboxChecked)));
  }
  if ("checkboxNotChecked" in expr) {
    return !context.get(String(expr.checkboxNotChecked));
  }

  for (const operator of ["==", "!=", ">=", "<=", ">", "<"]) {
    if (operator in expr) {
      const pair = asArray(expr[operator]);
      if (pair.length < 2) return false;
      const left = resolveOperand(pair[0], context);
      const right = resolveOperand(pair[1], context);
      return compare(operator, left, right);
    }
  }

  throw new EngineError(
    `unsupported displayIf operator: ${Object.keys(expr).join(",")}`,
    "BAD_EXPRESSION"
  );
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}
