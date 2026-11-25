/**
 * Static column-form rules for the coverage tracker.
 *
 * These read the definition data only, so the tracker stays offline and
 * deterministic. A rule belongs here only when the definition shape alone
 * proves that a default configuration cannot reach a price with the current
 * engine, and the evidence for that is recorded in `analysis/FINDINGS.md`.
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The selector a column form prices first.
 *
 * `src/engine/column-form.ts` reads `primaryKey` (a string, or an object whose
 * first key is the primary selector) and keeps that selector's declared value
 * verbatim instead of resolving it through the option tree, so this mirrors
 * `primarySelectorOf`.
 */
export function primarySelectorId(component: Record<string, unknown>): string | undefined {
  const primaryKey = component["primaryKey"];
  if (typeof primaryKey === "string") return primaryKey;
  const record = asRecord(primaryKey);
  if (!record) return undefined;
  return Object.keys(record)[0];
}

export interface PrimaryRemapToken {
  selectorId: string;
  /** The declared default, which is a `remap.keyValue` key (a price token). */
  token: string;
  /** The form label the same key maps to. */
  label: string;
}

/**
 * A primary selector whose declared default is a `remap.keyValue` **key**.
 *
 * `remap.keyValue` maps a price token (key) to the label the form shows
 * (value): the live engine remaps aggregation rows and price records forward
 * and maps labels back to tokens for price sets and the index path
 * (`analysis/FINDINGS.md` section 14.2, bundle offsets 1227218 and 1466571).
 * The option tree therefore offers labels, and the live form drops a default it
 * does not offer in favour of the first offered value (section 14.3).
 *
 * This engine applies the same remap, but it keeps the primary selector's
 * declared value verbatim (`resolveColumnFormSelectors` in
 * `src/engine/column-form.ts`), so a default that is a raw token stays a raw
 * token while every option and aggregation row holds the label. No aggregation
 * row can match, and the service is statically clean but cannot price its own
 * default. Proof and the one definition it hits:
 * `analysis/FINDINGS.md` section 15 and `receipts/selector-children-probe.json`.
 */
export function primaryRemapToken(component: Record<string, unknown>): PrimaryRemapToken | undefined {
  const selectorId = primarySelectorId(component);
  if (!selectorId) return undefined;
  const keyValue = asRecord(asRecord(component["remap"])?.["keyValue"]);
  if (!keyValue) return undefined;
  const rows = Array.isArray(component["row"]) ? component["row"] : [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row || row["selectorId"] !== selectorId) continue;
    const fallback = row["defaultValue"];
    if (typeof fallback !== "string" || fallback === "") return undefined;
    const label = keyValue[fallback];
    if (typeof label !== "string" || label === fallback) return undefined;
    return { selectorId, token: fallback, label };
  }
  return undefined;
}
