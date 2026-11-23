/** Engine errors carry enough definition evidence to fix the cause. */
export class EngineError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.details = details;
  }
}

export class UnsupportedComponentError extends EngineError {
  constructor(details: {
    serviceCode: string;
    templateId: string;
    cardTitle?: string | undefined;
    componentId: string;
    kind: string;
    subType: string;
  }) {
    super(
      `unsupported ${details.kind} subtype "${details.subType}" ` +
        `(${details.serviceCode}/${details.templateId}` +
        `${details.cardTitle ? `/${details.cardTitle}` : ""}/${details.componentId}); ` +
        `refusing to guess a value`,
      "UNSUPPORTED_COMPONENT",
      { ...details }
    );
    this.name = "UnsupportedComponentError";
  }
}

export class MissingInputError extends EngineError {
  constructor(details: {
    serviceCode: string;
    templateId: string;
    componentId: string;
    label: string;
    hint?: string;
  }) {
    super(
      `required input "${details.componentId}" (${details.label}) has no value ` +
        `in ${details.serviceCode}/${details.templateId}. ` +
        (details.hint ?? `Set it with --set ${details.componentId}=<value>`),
      "MISSING_INPUT",
      { ...details }
    );
    this.name = "MissingInputError";
  }
}

export class InputValidationError extends EngineError {
  constructor(details: {
    serviceCode: string;
    componentId: string;
    label: string;
    problem: string;
    value: unknown;
  }) {
    super(
      `invalid value for "${details.componentId}" (${details.label}): ${details.problem}`,
      "VALIDATION_ERROR",
      { ...details }
    );
    this.name = "InputValidationError";
  }
}

export class UnknownComponentReferenceError extends EngineError {
  constructor(details: { serviceCode: string; componentId: string; referencedId: string }) {
    super(
      `component "${details.componentId}" references unknown component ` +
        `"${details.referencedId}" in ${details.serviceCode}`,
      "UNKNOWN_REFERENCE",
      { ...details }
    );
    this.name = "UnknownComponentReferenceError";
  }
}
