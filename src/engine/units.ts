/**
 * Unit conversion tables reproduced from the live calculator bundle
 * (`calculateFileSize`, `performFrequencyCalculation`). The multipliers are
 * deliberately copied verbatim, including their rounding, so the engine lands
 * on the same numbers as the web app.
 */

export interface Conversion {
  operation: "multiply" | "divide";
  rate: number;
}

/** File size conversions, keyed by source unit then target unit. */
export const SIZE_CONVERSIONS: Record<string, Record<string, Conversion>> = {
  bytes: {
    kb: { operation: "multiply", rate: 0.0009765625 },
    mb: { operation: "multiply", rate: 9.5367432e-7 },
    gb: { operation: "multiply", rate: 9.31323e-10 },
    tb: { operation: "multiply", rate: 9.094947e-13 },
    pb: { operation: "multiply", rate: 8.8817e-16 },
  },
  kb: {
    bytes: { operation: "multiply", rate: 1024 },
    mb: { operation: "multiply", rate: 0.0009765625 },
    gb: { operation: "multiply", rate: 9.5367432e-7 },
    tb: { operation: "multiply", rate: 9.31323e-10 },
    pb: { operation: "multiply", rate: 9.094947e-13 },
  },
  mb: {
    bytes: { operation: "multiply", rate: 1048576 },
    kb: { operation: "multiply", rate: 1024 },
    gb: { operation: "multiply", rate: 0.0009765625 },
    tb: { operation: "multiply", rate: 9.5367432e-7 },
    pb: { operation: "multiply", rate: 9.31322e-10 },
  },
  gb: {
    bytes: { operation: "multiply", rate: 1073741824 },
    kb: { operation: "multiply", rate: 1048576 },
    mb: { operation: "multiply", rate: 1024 },
    tb: { operation: "multiply", rate: 0.0009765625 },
    pb: { operation: "multiply", rate: 9.53674e-7 },
  },
  tb: {
    bytes: { operation: "multiply", rate: 1099511627776 },
    kb: { operation: "multiply", rate: 1099511627.78 },
    mb: { operation: "multiply", rate: 1048576 },
    gb: { operation: "multiply", rate: 1024 },
    pb: { operation: "multiply", rate: 0.00097656 },
  },
  pb: {
    bytes: { operation: "multiply", rate: 1125899906842624 },
    kb: { operation: "multiply", rate: 1099511627776 },
    mb: { operation: "multiply", rate: 1073741824 },
    gb: { operation: "multiply", rate: 1048576 },
    tb: { operation: "multiply", rate: 1024 },
  },
};

/** Time conversions, keyed by target unit then source unit (live table order). */
export const TIME_CONVERSIONS: Record<string, Record<string, Conversion>> = {
  sec: {
    min: { operation: "multiply", rate: 60 },
    hour: { operation: "multiply", rate: 3600 },
    day: { operation: "multiply", rate: 86400 },
    week: { operation: "multiply", rate: 604800 },
    month: { operation: "multiply", rate: 2628000 },
  },
  min: {
    sec: { operation: "multiply", rate: 0.016667 },
    hour: { operation: "multiply", rate: 60 },
    day: { operation: "multiply", rate: 1440 },
    week: { operation: "multiply", rate: 10080 },
    month: { operation: "multiply", rate: 43800 },
  },
  hour: {
    sec: { operation: "multiply", rate: 0.000277778 },
    min: { operation: "multiply", rate: 0.0166667 },
    day: { operation: "multiply", rate: 24 },
    week: { operation: "multiply", rate: 168 },
    month: { operation: "multiply", rate: 730 },
  },
  month: {
    sec: { operation: "multiply", rate: 3.8e-8 },
    min: { operation: "multiply", rate: 0.000002 },
    hour: { operation: "multiply", rate: 0.00136986 },
    day: { operation: "multiply", rate: 0.0328767 },
    week: { operation: "multiply", rate: 0.230137 },
  },
  week: {
    sec: { operation: "multiply", rate: 1.65e-7 },
    min: { operation: "multiply", rate: 0.00000992 },
    hour: { operation: "multiply", rate: 0.00595 },
    day: { operation: "multiply", rate: 0.142857 },
    month: { operation: "multiply", rate: 4.34524 },
  },
  day: {
    sec: { operation: "multiply", rate: 0.000011574 },
    min: { operation: "multiply", rate: 0.000694444 },
    hour: { operation: "multiply", rate: 0.0416667 },
    week: { operation: "multiply", rate: 7 },
    month: { operation: "multiply", rate: 30.4167 },
  },
};

/** Frequency conversions (per X), reproduced from `performFrequencyCalculation`. */
export const FREQUENCY_CONVERSIONS: Record<string, Record<string, Conversion>> = {
  perMillisecond: {
    perSecond: { operation: "divide", rate: 1000 },
    perMinute: { operation: "divide", rate: 60000 },
    perHour: { operation: "divide", rate: 3600000 },
    perDay: { operation: "divide", rate: 86400000 },
    perWeek: { operation: "divide", rate: 604800000 },
    perMonth: { operation: "divide", rate: 2628000000 },
  },
  perSecond: {
    perMillisecond: { operation: "multiply", rate: 1000 },
    perMinute: { operation: "divide", rate: 60 },
    perHour: { operation: "divide", rate: 3600 },
    perDay: { operation: "divide", rate: 86400 },
    perWeek: { operation: "divide", rate: 604800 },
    perMonth: { operation: "divide", rate: 2628000 },
  },
  perMinute: {
    perMillisecond: { operation: "multiply", rate: 60000 },
    perSecond: { operation: "multiply", rate: 60 },
    perHour: { operation: "divide", rate: 60 },
    perDay: { operation: "divide", rate: 1440 },
    perWeek: { operation: "divide", rate: 10080 },
    perMonth: { operation: "divide", rate: 43800 },
  },
  perHour: {
    perMillisecond: { operation: "multiply", rate: 3600000 },
    perSecond: { operation: "multiply", rate: 3600 },
    perMinute: { operation: "multiply", rate: 60 },
    perDay: { operation: "divide", rate: 24 },
    perWeek: { operation: "divide", rate: 168 },
    perMonth: { operation: "divide", rate: 730 },
  },
  perDay: {
    perMillisecond: { operation: "multiply", rate: 86400000 },
    perSecond: { operation: "multiply", rate: 86400 },
    perMinute: { operation: "multiply", rate: 1440 },
    perHour: { operation: "multiply", rate: 24 },
    perWeek: { operation: "divide", rate: 7 },
    perMonth: { operation: "multiply", rate: 0.03287671232876712 },
  },
  perWeek: {
    perMillisecond: { operation: "multiply", rate: 604800000 },
    perSecond: { operation: "multiply", rate: 604800 },
    perMinute: { operation: "multiply", rate: 10080 },
    perHour: { operation: "multiply", rate: 168 },
    perDay: { operation: "multiply", rate: 7 },
    perMonth: { operation: "multiply", rate: 0.23013698630136986 },
  },
  perMonth: {
    perMillisecond: { operation: "multiply", rate: 2628000000 },
    perSecond: { operation: "multiply", rate: 2628000 },
    perMinute: { operation: "multiply", rate: 43800 },
    perHour: { operation: "multiply", rate: 730 },
    perDay: { operation: "multiply", rate: 30.416666666666668 },
    perWeek: { operation: "multiply", rate: 4.345238095238095 },
  },
};

/** Definition ids sometimes use short forms. */
const TIME_ALIASES: Record<string, string> = {
  hour: "hour",
  hours: "hour",
  hr: "hour",
  hrs: "hour",
  h: "hour",
  s: "sec",
  secs: "sec",
  second: "sec",
  seconds: "sec",
  m: "min",
  mins: "min",
  minute: "min",
  minutes: "min",
  d: "day",
  days: "day",
  w: "week",
  weeks: "week",
  mo: "month",
  months: "month",
};

export function normalizeTimeUnit(unit: string): string {
  const trimmed = unit.trim().toLowerCase();
  const alias = TIME_ALIASES[trimmed];
  if (alias) return alias;
  if (TIME_CONVERSIONS[trimmed]) return trimmed;
  if (trimmed.endsWith("s") && TIME_CONVERSIONS[trimmed.slice(0, -1)]) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

function apply(value: number, conversion: Conversion | undefined): number {
  if (!conversion) return value;
  return conversion.operation === "multiply"
    ? value * conversion.rate
    : value / conversion.rate;
}

export function convertSize(value: number, from: string, to: string): number {
  if (!from || !to || from === to) return value;
  const table = SIZE_CONVERSIONS[from];
  if (!table) throw new Error(`unknown file size unit "${from}"`);
  return apply(value, table[to]);
}

export function convertTime(value: number, from: string, to: string): number {
  const source = normalizeTimeUnit(from);
  const target = normalizeTimeUnit(to);
  if (!source || !target || source === target) return value;
  const table = TIME_CONVERSIONS[target];
  if (!table) throw new Error(`unknown time unit "${to}"`);
  const conversion = table[source];
  if (!conversion) throw new Error(`unknown time conversion ${from} -> ${to}`);
  return apply(value, conversion);
}

/**
 * Frequency conversion. The live table is indexed `[output][input]`: it returns
 * the multiplier that turns an input rate into the output rate.
 */
export function convertFrequency(value: number, from: string, to: string): number {
  if (!from || !to || from === to) return value;
  const conversion = FREQUENCY_CONVERSIONS[to]?.[from];
  if (conversion) return apply(value, conversion);

  // Prefixed families (millionPerMonth, ...) are only tabulated from a base
  // output unit. Derive them from the base rate and the prefix scale.
  const fromParts = splitFrequency(from);
  const toParts = splitFrequency(to);
  const base =
    fromParts.base === toParts.base
      ? { operation: "multiply" as const, rate: 1 }
      : FREQUENCY_CONVERSIONS[toParts.base]?.[fromParts.base];
  if (!base) throw new Error(`unknown frequency conversion ${from} -> ${to}`);
  return apply(value, base) * (fromParts.scale / toParts.scale);
}

const FREQUENCY_PREFIXES: Record<string, number> = {
  thousand: 1e3,
  hundredThousand: 1e5,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};

function splitFrequency(id: string): { base: string; scale: number } {
  const match = /^(thousand|hundredThousand|million|billion|trillion)Per(.+)$/.exec(id);
  if (!match) return { base: id, scale: 1 };
  const suffix = match[2];
  return {
    base: suffix ? `per${suffix}` : id,
    scale: FREQUENCY_PREFIXES[match[1] ?? ""] ?? 1,
  };
}

/** Frequency selects one of these; anything else is a definition defect. */
export const KNOWN_FREQUENCIES = new Set([
  "perMillisecond",
  "perSecond",
  "perMinute",
  "perHour",
  "perDay",
  "perWeek",
  "perMonth",
  "thousandPerMonth",
  "hundredThousandPerMonth",
  "millionPerMonth",
  "billionPerMonth",
  "trillionPerMonth",
]);

/**
 * Throughput units as the live calculator converts them (binary multiples).
 * The output unit is always MBps.
 */
const THROUGHPUT_FACTORS: Record<string, Record<string, { rate: number; operation: "multiply" | "divide" }>> = {
  kbps: { mbps: { rate: 1024, operation: "divide" }, gbps: { rate: 1048576, operation: "multiply" } },
  mbps: { kbps: { rate: 1024, operation: "multiply" }, gbps: { rate: 1024, operation: "divide" } },
  gbps: { kbps: { rate: 1048576, operation: "multiply" }, mbps: { rate: 1024, operation: "multiply" } },
};

export function convertThroughput(value: number, from: string, to: string): number {
  if (from === to) return value;
  const factor = THROUGHPUT_FACTORS[from]?.[to];
  if (!factor) {
    throw new Error(`no throughput conversion from "${from}" to "${to}"`);
  }
  return factor.operation === "multiply" ? value * factor.rate : value / factor.rate;
}
