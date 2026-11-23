import { EngineError, InputValidationError, MissingInputError } from "./errors.ts";
import { convertSize, convertTime, convertFrequency } from "./units.ts";
import {
  evaluateTransferRows,
  normalizeRows,
  toSavedRows,
  transferSummary,
  type TransferContext,
} from "./data-transfer.ts";
import type { PriceResolver } from "../data/pricing.ts";
import type { ColumnFormPricingData } from "../data/column-form.ts";
import { asColumnFormComponent, evaluateColumnForm } from "./column-form.ts";
import type { Component } from "../data/definitions.ts";
import type { CalculationComponentValue } from "../contract.ts";
import type { EngineValue } from "./expression.ts";

export interface InputComponentResult {
  value: EngineValue;
  saved?: CalculationComponentValue;
  configSummary?: string;
  /** Additional values other components reference (IPM calculation ids). */
  extraValues?: Record<string, number | string>;
  /** False when the input carries no value (left empty), so nothing is saved. */
  present: boolean;
}

interface Option {
  id: string;
  label: string;
}

function optionId(option: Record<string, unknown>): string {
  const id = option["id"] ?? option["value"];
  return typeof id === "string" || typeof id === "number" ? String(id) : "";
}

function optionLabel(option: Record<string, unknown>): string {
  const label = option["label"] ?? option["name"] ?? optionId(option);
  return typeof label === "string" ? label : String(label ?? "");
}

function asOptions(value: unknown): Option[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({ id: optionId(entry), label: optionLabel(entry) }))
    .filter((option) => option.id !== "");
}

interface OverrideShape {
  value?: unknown;
  unit?: string;
  checked?: boolean;
  selected?: string;
}

function isOverrideObject(value: unknown): value is OverrideShape {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function overridesOf(component: Component, overrides: Record<string, unknown>): OverrideShape {
  const raw = overrides[component.id];
  if (raw === undefined) return {};
  if (isOverrideObject(raw) && ("value" in raw || "unit" in raw || "checked" in raw)) {
    return raw;
  }
  return { value: raw };
}

function validationsOf(component: Component): Record<string, unknown> {
  const value = component["validations"];
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function validationProblem(component: Component, numeric: number): string | undefined {
  const validations = validationsOf(component);
  const minValue = validations["minValue"];
  const maxValue = validations["maxValue"];
  if (validations["allowDecimals"] === false && !Number.isInteger(numeric)) {
    return "decimals are not allowed";
  }
  if (typeof minValue === "number" && numeric < minValue) return `must be at least ${minValue}`;
  if (typeof maxValue === "number" && numeric > maxValue) return `must be at most ${maxValue}`;
  return undefined;
}

function required(component: Component): boolean {
  return validationsOf(component)["required"] === true;
}

interface InputValidationContext {
  serviceCode: string;
  templateId: string;
}

/** Parse a numeric input, enforcing presence for required components. */
function numericValue(component: Component, raw: unknown, context: InputValidationContext): number {
  if (raw === undefined || raw === null || raw === "") {
    if (required(component)) {
      throw new MissingInputError({
        serviceCode: context.serviceCode,
        templateId: context.templateId,
        componentId: component.id,
        label: String(component["label"] ?? component.id),
      });
    }
    return 0;
  }
  const numeric = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(numeric)) {
    throw new InputValidationError({
      serviceCode: context.serviceCode,
      componentId: component.id,
      label: String(component["label"] ?? component.id),
      problem: `"${String(raw)}" is not a number`,
      value: raw,
    });
  }
  return numeric;
}

/** Validations apply to the value in the component's output unit. */
function assertValid(
  component: Component,
  value: number,
  raw: unknown,
  context: InputValidationContext,
  fromOverride = true
): void {
  if (!fromOverride) return;
  if (raw === undefined || raw === null || raw === "") return;
  const problem = validationProblem(component, value);
  if (problem) {
    throw new InputValidationError({
      serviceCode: context.serviceCode,
      componentId: component.id,
      label: String(component["label"] ?? component.id),
      problem,
      value: raw,
    });
  }
}

function requireNumeric(component: Component, raw: unknown, context: InputValidationContext): number {
  const numeric = numericValue(component, raw, context);
  assertValid(component, numeric, raw, context);
  return numeric;
}

interface InputContext {
  serviceCode: string;
  templateId: string;
  overrides: Record<string, unknown>;
  regionName: string;
  prices: PriceResolver;
  /** Region code -> display name, including the calculator's virtual keys. */
  regionNameByCode: Map<string, string>;
  /** Region display name -> code. */
  regionCodeByName: Map<string, string>;
  /** Prefetched PLC_2.0 data for the template's columnFormIPM components. */
  columnForms: Map<string, ColumnFormPricingData>;
}

/**
 * Evaluate one input component.
 *
 * The returned `value` is the engine-facing value (converted to the component's
 * output unit); `saved` is the wire representation used in
 * `calculationComponents`.
 */
export function evaluateInput(component: Component, context: InputContext): InputComponentResult {
  const subType = component.subType ?? "unknown";
  const label = String(component["label"] ?? component.id);
  const displayInSummary = component["displayInConfigSummary"] === true;
  const override = overridesOf(component, context.overrides);

  switch (subType) {
    case "bodyText":
    case "headerText":
    case "alert":
    case "condition":
      return { value: undefined, present: false };

    case "numericInput": {
      const raw = override.value ?? component["defaultValue"];
      const numeric =
        override.value === undefined
          ? numericValue(component, raw, context)
          : requireNumeric(component, raw, context);
      const present = raw !== undefined && raw !== null && raw !== "";
      return {
        value: numeric,
        present,
        ...(present ? { saved: { value: numeric } } : {}),
        ...(displayInSummary && present ? { configSummary: `${label} (${formatNumber(numeric)})` } : {}),
      };
    }

    case "percentInput": {
      const raw = override.value ?? component["defaultValue"];
      const numeric =
        override.value === undefined
          ? numericValue(component, raw, context)
          : requireNumeric(component, raw, context);
      const present = raw !== undefined && raw !== null && raw !== "";
      // The live engine keeps the fraction in state and in the summary.
      const fraction = numeric / 100;
      return {
        value: fraction,
        present,
        ...(present ? { saved: { value: fraction } } : {}),
        ...(displayInSummary && present
          ? { configSummary: `${label} (${formatNumber(fraction)})` }
          : {}),
      };
    }

    case "dropdown": {
      const options = asOptions(component["options"]);
      const noDefault = component["noDefaultItem"] === true;
      const fallback = noDefault ? undefined : options[0]?.id;
      const explicit = override.value ?? override.selected;
      const declared = component["defaultDropDownItem"];
      let raw = explicit ?? declared ?? fallback;
      const present = raw !== undefined && raw !== null && raw !== "";
      let selectedId = present ? String(raw) : "";
      if (
        present &&
        options.length > 0 &&
        !options.some((option) => option.id === selectedId)
      ) {
        if (explicit !== undefined) {
          throw new InputValidationError({
            serviceCode: context.serviceCode,
            componentId: component.id,
            label,
            problem: `"${selectedId}" is not one of ${options.map((option) => option.id).join(", ")}`,
            value: raw,
          });
        }
        // A definition default that is not in its own option list falls back
        // the way the live dropdown does: keep the default, select options[0].
        raw = fallback;
        selectedId = fallback ?? "";
      }
      if (!present && required(component)) {
        throw new MissingInputError({
          serviceCode: context.serviceCode,
          templateId: context.templateId,
          componentId: component.id,
          label,
        });
      }
      const option = options.find((entry) => entry.id === selectedId);
      return {
        value: selectedId === "" ? undefined : selectedId,
        present,
        ...(present ? { saved: { value: selectedId } } : {}),
        ...(displayInSummary && present
          ? { configSummary: `${label} (${option?.label ?? selectedId})` }
          : {}),
      };
    }

    case "checkbox": {
      const raw = override.checked ?? override.value ?? component["defaultValue"];
      const present = raw !== undefined && raw !== null;
      const checked = raw === true || raw === "true";
      return {
        value: checked,
        present,
        ...(present ? { saved: { value: checked } } : {}),
        ...(displayInSummary && present
          ? { configSummary: `${label} (${checked ? "enabled" : "disabled"})` }
          : {}),
      };
    }

    case "fileSize": {
      const sizeOptions = asOptions(component["dropDownSize"]);
      const frequencyOptions = asOptions(component["dropDownFrequency"]);
      const outputSize = String(component["outputSize"] ?? "gb");
      const outputFrequency = String(component["outputFrequency"] ?? "NA");
      const defaultOption = isOverrideObject(component["defaultOption"])
        ? (component["defaultOption"] as Record<string, unknown>)
        : undefined;

      const defaultId = defaultOption
        ? `${String(defaultOption["size"] ?? outputSize)}|${String(
            defaultOption["frequency"] ?? "NA"
          )}`
        : `${sizeOptions[0]?.id ?? outputSize}|${frequencyOptions[0]?.id ?? "NA"}`;
      const selectedId = override.unit ?? defaultId;
      const [sizeUnit = outputSize, frequencyUnit = "NA"] = selectedId.split("|");

      if (sizeOptions.length > 0 && !sizeOptions.some((option) => option.id === sizeUnit)) {
        throw new InputValidationError({
          serviceCode: context.serviceCode,
          componentId: component.id,
          label,
          problem:
            `unit "${sizeUnit}" is not one of ` +
            sizeOptions.map((option) => option.id).join(", "),
          value: selectedId,
        });
      }
      if (
        frequencyUnit !== "NA" &&
        (!isOverrideObject(component["outputFrequency"]) ||
          String((component["outputFrequency"] as Record<string, unknown>)["id"]) !== "NA")
      ) {
        const allowed = new Set([
          ...frequencyOptions.map((option) => option.id),
          "month",
          "day",
          "hour",
          "min",
          "sec",
          "week",
          "year",
        ]);
        if (!allowed.has(frequencyUnit)) {
          throw new InputValidationError({
            serviceCode: context.serviceCode,
            componentId: component.id,
            label,
            problem: `frequency "${frequencyUnit}" is not supported by this input`,
            value: selectedId,
          });
        }
      }

      const raw = override.value ?? component["defaultValue"];
      const fromOverride = override.value !== undefined || override.unit !== undefined;
      // Size validations are expressed in the output unit, so validate after conversion.
      const numeric = numericValue(component, raw, context);
      const present = raw !== undefined && raw !== null && raw !== "";

      let value = convertSize(numeric, sizeUnit, outputSize);
      if (frequencyUnit !== "NA" && outputFrequency !== "NA") {
        value = convertTime(value, frequencyUnit, outputFrequency);
      }
      assertValid(component, value, raw, context, fromOverride);

      const sizeLabel =
        sizeOptions.find((option) => option.id === sizeUnit)?.label ?? sizeUnit.toUpperCase();
      const frequencyLabel = frequencyOptions.find((option) => option.id === frequencyUnit)?.label;
      const optionLabelText =
        frequencyUnit === "NA" || !frequencyLabel
          ? sizeLabel
          : `${sizeLabel} per ${frequencyLabel}`;

      return {
        value,
        present,
        ...(present ? { saved: { value: raw as string | number, unit: selectedId } } : {}),
        ...(displayInSummary && present
          ? { configSummary: `${label} (${String(raw)} ${optionLabelText})` }
          : {}),
      };
    }

    case "frequency": {
      const options = asOptions(component["options"]);
      const outputFrequency = isOverrideObject(component["outputFrequency"])
        ? String((component["outputFrequency"] as Record<string, unknown>)["id"] ?? "perMonth")
        : String(component["outputFrequency"] ?? "perMonth");
      const raw = override.value ?? component["defaultValue"];
      const fromOverride = override.value !== undefined || override.unit !== undefined;
      const numeric = fromOverride
        ? requireNumeric(component, raw, context)
        : numericValue(component, raw, context);
      const present = raw !== undefined && raw !== null && raw !== "";
      const defaultFrequency = component["defaultFrequency"];
      const selectedId = override.unit ?? (defaultFrequency === undefined ? "" : String(defaultFrequency));
      const option = options.find((entry) => entry.id === selectedId);
      if (present && !selectedId) {
        throw new EngineError(
          `frequency input "${component.id}" has a value but no selected frequency`,
          "MISSING_UNIT",
          { componentId: component.id }
        );
      }
      const converted = convertFrequency(numeric, selectedId, outputFrequency);
      // Frequency validations apply to the entered amount, not the converted rate.
      assertValid(component, numeric, raw, context, fromOverride);
      return {
        value: converted,
        present,
        ...(present ? { saved: { value: raw as string | number, unit: selectedId } } : {}),
        ...(displayInSummary && present
          ? { configSummary: `${label} (${String(raw)} ${option?.label ?? selectedId})` }
          : {}),
      };
    }

    case "durationInput": {
      const options = asOptions(component["dropDownDuration"]);
      const outputUnit = String(component["outputDurationUnit"] ?? "sec");
      const raw = override.value ?? component["defaultValue"];
      const fromOverride = override.value !== undefined || override.unit !== undefined;
      const numeric = fromOverride
        ? requireNumeric(component, raw, context)
        : numericValue(component, raw, context);
      const present = raw !== undefined && raw !== null && raw !== "";
      const selectedId = override.unit ?? String(component["defaultDuration"] ?? outputUnit);
      const option = options.find((entry) => entry.id === selectedId);
      const converted = convertTime(numeric, selectedId, outputUnit);
      // Duration validations apply to the entered amount, not the converted value.
      assertValid(component, numeric, raw, context, fromOverride);
      return {
        value: converted,
        present,
        ...(present ? { saved: { value: numeric, unit: selectedId } } : {}),
        ...(displayInSummary && present
          ? { configSummary: `${label} (${formatNumber(numeric)} ${option?.label ?? selectedId})` }
          : {}),
      };
    }

    case "columnFormIPM": {
      const data = context.columnForms.get(component.id);
      if (!data) {
        throw new EngineError(
          `columnFormIPM "${component.id}" has no prefetched PLC_2.0 data in ` +
            `${context.serviceCode}/${context.templateId}`,
          "UNSUPPORTED_INPUT",
          {
            serviceCode: context.serviceCode,
            templateId: context.templateId,
            componentId: component.id,
            subType,
          }
        );
      }
      const result = evaluateColumnForm(
        asColumnFormComponent(component),
        data,
        override.value
      );
      return {
        value: result.monthly,
        present: true,
        saved: result.saved,
        ...(result.configSummary !== "" ? { configSummary: result.configSummary } : {}),
        extraValues: result.extraValues,
      };
    }

    case "dataTransferV2": {
      const rows = normalizeRows(
        override.value,
        component["dataTransferTypes"]
      );
      const mapping = component["mappingDefinitionName"];
      if (typeof mapping !== "string" || mapping === "") {
        throw new EngineError(
          `dataTransferV2 "${component.id}" has no mappingDefinitionName`,
          "BAD_DEFINITION",
          { componentId: component.id }
        );
      }
      const transferContext: TransferContext = {
        componentId: component.id,
        regionName: context.regionName,
        mapping,
        prices: context.prices,
        regionNameByCode: context.regionNameByCode,
        regionCodeByName: context.regionCodeByName,
      };
      const evaluated = evaluateTransferRows(rows, transferContext);
      return {
        value: evaluated.monthly,
        present: true,
        saved: { value: toSavedRows(rows) },
        ...(displayInSummary
          ? { configSummary: transferSummary(rows, context.regionNameByCode) }
          : {}),
      };
    }

    default:
      throw new EngineError(
        `no handler for input subtype "${subType}" (${context.serviceCode}/${context.templateId}/${component.id})`,
        "UNSUPPORTED_INPUT",
        {
          serviceCode: context.serviceCode,
          templateId: context.templateId,
          componentId: component.id,
          subType,
        }
      );
  }
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}
