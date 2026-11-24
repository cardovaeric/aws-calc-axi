/**
 * Scoring rule for `subServiceSelector` rows in the coverage tracker.
 *
 * A selector is the live calculator's service menu: the parent has no form and
 * no price, and the user configures exactly one child. Its coverage is
 * therefore the union of the children the live calculator actually serves.
 *
 * Two consequences drive this module:
 *
 * 1. A selector template code that has no catalog entry is a dangling
 *    reference in the live manifest, not a service we failed to cover. The live
 *    UI builds the child menu from the service list, so a code that is not in
 *    the list is never shown (Amazon WorkSpaces offers 4 of its 6 declared
 *    children; WorkSpaces Thin Client and Secure Browser are absent from the
 *    manifest and their definition URLs answer 403). Those children have no
 *    surface to score and must not make the parent look blocked.
 * 2. A parent row has to name the children that block it and the blocker each
 *    one carries. A generic "resolve the non-clean children" hides whether the
 *    work is a missing input subtype, an unsupported column-form feature, or a
 *    gap that only needs a fixture.
 *
 * Evidence: analysis/FINDINGS.md section 14 and receipts/selector-children-probe.json.
 */

export type StaticClass =
  | "clean"
  | "partial:column-form"
  | "blocked:column-form"
  | "blocked:subtype"
  | "no-surface"
  | "missing-definition";

/** The child facts the roll-up needs, mirroring the tracker row columns. */
export interface SelectorChildFacts {
  code: string;
  /** Present when the child is a catalog service the tracker has a row for. */
  row?:
    | {
        static_class: string;
        missing_subtypes: string;
        hard_blockers: string;
        deep_gaps: string;
        next_action: string;
      }
    | undefined;
  /** False when the live manifest has no entry for the child code. */
  inCatalog: boolean;
}

export interface SelectorRollup {
  klass: StaticClass;
  /** Children the live calculator serves and the tracker has a row for. */
  served: string[];
  /** Declared children with no manifest entry: no live surface to score. */
  unserved: string[];
  /** Declared children that are catalog services but have no loaded definition. */
  missingDefinition: string[];
  /** Served children that are not clean, in declaration order. */
  nonclean: string[];
  /** Union of the non-clean children's blockers, verbatim. */
  missingSubtypes: string;
  hardBlockers: string;
  deepGaps: string;
  /** `<blocker> (<child>, <child>)` pairs, in first-seen order. */
  blockers: string;
  /** One entry per distinct child action, naming the children that need it. */
  nextAction: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function splitList(value: string): string[] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** The blocker name the matrix uses, without the `kind:` prefix or count. */
function blockerName(entry: string): string {
  const parts = entry.split(":");
  // `missing_subtypes` is `kind:subType:count`; hard blockers and gaps are bare names.
  return (parts.length >= 2 ? parts[1] : parts[0])?.trim() ?? entry;
}

/**
 * Score a selector from its children.
 *
 * Precedence matches `classifyStatic`, so a parent reports the same class its
 * children would: a missing subtype outranks an unsupported column-form
 * feature, which outranks a partial feature.
 */
export function rollupSelector(children: SelectorChildFacts[]): SelectorRollup {
  const served: string[] = [];
  const unserved: string[] = [];
  const missingDefinition: string[] = [];
  const nonclean: string[] = [];
  const groups = new Map<string, string[]>();
  const actions = new Map<string, string[]>();
  const missingSubtypes: string[] = [];
  const hardBlockers: string[] = [];
  const deepGaps: string[] = [];

  for (const child of children) {
    if (!child.inCatalog) {
      unserved.push(child.code);
      continue;
    }
    const row = child.row;
    if (!row || row.static_class === "missing-definition") {
      missingDefinition.push(child.code);
      nonclean.push(child.code);
      const action = "Fetch the missing definition and re-run coverage";
      actions.set(action, [...(actions.get(action) ?? []), child.code]);
      continue;
    }
    served.push(child.code);
    if (row.static_class === "clean") continue;
    nonclean.push(child.code);
    missingSubtypes.push(...splitList(row.missing_subtypes));
    hardBlockers.push(...splitList(row.hard_blockers));
    deepGaps.push(...splitList(row.deep_gaps));
    for (const entry of [
      ...splitList(row.missing_subtypes),
      ...splitList(row.hard_blockers),
      ...splitList(row.deep_gaps),
    ]) {
      const name = blockerName(entry);
      groups.set(name, [...(groups.get(name) ?? []), child.code]);
    }
    const action = row.next_action === "" ? "Resolve this child" : row.next_action;
    actions.set(action, [...(actions.get(action) ?? []), child.code]);
  }

  const blocked = served.filter((code) => {
    const klass = children.find((child) => child.code === code)?.row?.static_class ?? "";
    return klass.startsWith("blocked");
  });
  let klass: StaticClass;
  // No declared children, or only dangling references: the live calculator has
  // nothing to configure, so there is no surface to score.
  if (children.length === 0 || (served.length === 0 && missingDefinition.length === 0)) {
    klass = "no-surface";
  } else if (missingDefinition.length > 0) klass = "blocked:column-form";
  else if (
    blocked.some(
      (code) => children.find((child) => child.code === code)?.row?.static_class === "blocked:subtype"
    )
  ) {
    klass = "blocked:subtype";
  } else if (blocked.length > 0) klass = "blocked:column-form";
  else if (nonclean.length > 0) klass = "partial:column-form";
  else klass = "clean";

  return {
    klass,
    served,
    unserved,
    missingDefinition,
    nonclean,
    missingSubtypes: unique(missingSubtypes).join(";"),
    hardBlockers: unique(hardBlockers).join(";"),
    deepGaps: unique(deepGaps).join(";"),
    blockers: [...groups.entries()]
      .map(([name, codes]) => `${name} (${unique(codes).join(", ")})`)
      .join("; "),
    nextAction: [...actions.entries()]
      .map(([action, codes]) => `${action} (${unique(codes).join(", ")})`)
      .join("; "),
  };
}
