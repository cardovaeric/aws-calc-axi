import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { rollupSelector, type SelectorChildFacts } from "../scripts/coverage-selector.ts";
import { runtimeLabel } from "../scripts/coverage-runtime.ts";
import { EngineError } from "../src/engine/errors.ts";
import { MissingPriceError } from "../src/data/pricing.ts";

const ROOT = join(import.meta.dirname, "..");

function child(
  code: string,
  klass: string,
  blockers: { missing?: string; hard?: string; gaps?: string } = {},
  action = "",
  inCatalog = true
): SelectorChildFacts {
  return {
    code,
    inCatalog,
    row: {
      static_class: klass,
      missing_subtypes: blockers.missing ?? "",
      hard_blockers: blockers.hard ?? "",
      deep_gaps: blockers.gaps ?? "",
      next_action: action,
    },
  };
}

test("a selector with no declared children has no surface", () => {
  assert.equal(rollupSelector([]).klass, "no-surface");
});

test("clean children make a clean selector", () => {
  const rollup = rollupSelector([child("a", "clean"), child("b", "clean")]);
  assert.equal(rollup.klass, "clean");
  assert.deepEqual(rollup.served, ["a", "b"]);
  assert.deepEqual(rollup.nonclean, []);
  assert.equal(rollup.blockers, "");
  assert.equal(rollup.nextAction, "");
});

test("a declared child outside the manifest has no surface and does not block the parent", () => {
  const rollup = rollupSelector([
    child("a", "clean"),
    { code: "ghost", inCatalog: false },
  ]);
  assert.equal(rollup.klass, "clean");
  assert.deepEqual(rollup.unserved, ["ghost"]);
  assert.deepEqual(rollup.served, ["a"]);
  assert.deepEqual(rollup.nonclean, []);
});

test("a selector whose declared children are all unserved has no surface", () => {
  const rollup = rollupSelector([
    { code: "ghost", inCatalog: false },
    { code: "ghost2", inCatalog: false },
  ]);
  assert.equal(rollup.klass, "no-surface");
  assert.deepEqual(rollup.unserved, ["ghost", "ghost2"]);
});

test("an unserved child is never reported as non-clean", () => {
  const rollup = rollupSelector([
    child("a", "blocked:column-form", { hard: "utilization-selector" }, "Implement column-form utilization-selector"),
    { code: "ghost", inCatalog: false },
  ]);
  assert.deepEqual(rollup.nonclean, ["a"]);
  assert.deepEqual(rollup.unserved, ["ghost"]);
});

test("a missing child subtype propagates as blocked:subtype, not blocked:column-form", () => {
  const rollup = rollupSelector([
    child("a", "blocked:subtype", { missing: "input:utilization:2" }, "Implement input:utilization:2"),
    child("b", "blocked:subtype", { missing: "input:utilization:3" }, "Implement input:utilization:3"),
  ]);
  assert.equal(rollup.klass, "blocked:subtype");
  assert.equal(rollup.missingSubtypes, "input:utilization:2;input:utilization:3");
  assert.equal(rollup.blockers, "utilization (a, b)");
  assert.equal(rollup.nextAction, "Implement input:utilization:2 (a); Implement input:utilization:3 (b)");
});

test("a missing subtype outranks an unsupported column-form feature", () => {
  const rollup = rollupSelector([
    child("a", "blocked:column-form", { hard: "subComponentsList" }, "Implement column-form subComponentsList"),
    child("b", "blocked:subtype", { missing: "input:utilization:2" }, "Implement input:utilization:2"),
  ]);
  assert.equal(rollup.klass, "blocked:subtype");
});

test("a blocked child outranks a partial child and carries both blockers", () => {
  const rollup = rollupSelector([
    child("a", "blocked:column-form", { hard: "utilization-selector" }, "Implement column-form utilization-selector"),
    child("b", "partial:column-form", { gaps: "dependent-selectors" }, "Column-form v2: dependent-selectors"),
  ]);
  assert.equal(rollup.klass, "blocked:column-form");
  assert.equal(rollup.hardBlockers, "utilization-selector");
  assert.equal(rollup.deepGaps, "dependent-selectors");
  assert.equal(
    rollup.nextAction,
    "Implement column-form utilization-selector (a); Column-form v2: dependent-selectors (b)"
  );
});

test("partial children make a partial selector and name the gap", () => {
  const rollup = rollupSelector([
    child("a", "partial:column-form", { gaps: "dependent-selectors" }, "Column-form v2: dependent-selectors"),
    child("b", "partial:column-form", { gaps: "dependent-selectors" }, "Column-form v2: dependent-selectors"),
  ]);
  assert.equal(rollup.klass, "partial:column-form");
  assert.equal(rollup.deepGaps, "dependent-selectors");
  assert.equal(rollup.blockers, "dependent-selectors (a, b)");
  assert.equal(rollup.nextAction, "Column-form v2: dependent-selectors (a, b)");
});

test("a catalog child without a definition is a real data gap", () => {
  const rollup = rollupSelector([{ code: "pending", inCatalog: true }]);
  assert.equal(rollup.klass, "blocked:column-form");
  assert.deepEqual(rollup.missingDefinition, ["pending"]);
  assert.equal(rollup.nextAction, "Fetch the missing definition and re-run coverage (pending)");
});

test("a catalog child whose definition failed to load stays a blocked data gap", () => {
  const rollup = rollupSelector([child("broken", "missing-definition")]);
  assert.equal(rollup.klass, "blocked:column-form");
  assert.deepEqual(rollup.missingDefinition, ["broken"]);
  assert.deepEqual(rollup.nonclean, ["broken"]);
});

test("blockers group by name across children and are de-duplicated", () => {
  const rollup = rollupSelector([
    child("a", "partial:column-form", { gaps: "dependent-selectors;ri-payment-upfront" }, "Column-form v2: dependent-selectors;ri-payment-upfront"),
    child("b", "partial:column-form", { gaps: "dependent-selectors" }, "Column-form v2: dependent-selectors"),
  ]);
  assert.equal(rollup.blockers, "dependent-selectors (a, b); ri-payment-upfront (a)");
  assert.equal(rollup.deepGaps, "dependent-selectors;ri-payment-upfront");
});

interface CsvRow {
  [column: string]: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

async function trackerRows(): Promise<CsvRow[]> {
  const table = parseCsv(await readFile(join(ROOT, "analysis/coverage-matrix.csv"), "utf8"));
  const header = table[0]!;
  return table.slice(1).map((line) => {
    const row: CsvRow = {};
    for (const [index, column] of header.entries()) row[column] = line[index] ?? "";
    return row;
  });
}

test("every non-clean selector row names its blocker and its children", async () => {
  const rows = await trackerRows();
  const selectors = rows.filter((row) => row["kind"] === "selector");
  assert.ok(selectors.length > 0, "the tracker contains selector rows");
  for (const row of selectors) {
    if (row["static_class"] === "clean") continue;
    assert.notEqual(row["selector_blockers"], "", `${row["service_code"]} names its blockers`);
    assert.notEqual(row["next_action"], "", `${row["service_code"]} has an action`);
    for (const name of row["selector_nonclean"]!.split(";").filter(Boolean)) {
      assert.ok(
        row["selector_blockers"]!.length > 0,
        `${row["service_code"]} attributes ${name} to a blocker`
      );
    }
  }
});

test("no row falls back to the generic non-clean-children action", async () => {
  const rows = await trackerRows();
  assert.deepEqual(
    rows.filter((row) => (row["next_action"] ?? "").includes("non-clean children")),
    []
  );
});

test("an unserved child is recorded but never scored as non-clean", async () => {
  const rows = await trackerRows();
  for (const row of rows) {
    const unserved = (row["selector_unserved"] ?? "").split(";").filter(Boolean);
    if (unserved.length === 0) continue;
    const nonclean = (row["selector_nonclean"] ?? "").split(";").filter(Boolean);
    for (const code of unserved) {
      assert.ok(!nonclean.includes(code), `${row["service_code"]} does not score ${code}`);
    }
  }
});

test("Amazon WorkSpaces keeps six declared children, four served and two unserved", async () => {
  const rows = await trackerRows();
  const row = rows.find((entry) => entry["service_code"] === "amazonWorkSpaces");
  assert.ok(row, "amazonWorkSpaces is in the tracker");
  assert.equal(row["selector_children"], "6");
  assert.equal(row["selector_unserved"], "workSpacesThinClient;workSpacesSecureBrowser");
  // All four served children are clean now: the utilization row is native, so
  // nothing is non-clean and the parent has no blocker to name.
  assert.equal(row["selector_nonclean"], "");
  assert.equal(row["selector_blockers"], "");
  assert.equal(row["static_class"], "clean");
  assert.equal(row["priority"], "P2");
});

test("Amazon EMR's three node children are clean now that utilization rows are native", async () => {
  const rows = await trackerRows();
  const row = rows.find((entry) => entry["service_code"] === "amazonEMR");
  assert.ok(row, "amazonEMR is in the tracker");
  assert.equal(row["static_class"], "clean");
  assert.equal(row["selector_blockers"], "");
  assert.equal(row["hard_blockers"], "");
  assert.equal(row["next_action"], "Verify all children with fixtures and a receipt");
});

test("AWS Mainframe Modernization is clean now that utilization and remap.constant are native", async () => {
  const rows = await trackerRows();
  const row = rows.find((entry) => entry["service_code"] === "amazonMainframeModernization");
  assert.ok(row, "amazonMainframeModernization is in the tracker");
  // `utilization` and `remap.constant` are both native, so the parent's two
  // children (mainframeBluAge, mainframeMicroFocus) are clean and the selector
  // has nothing left to report (analysis/FINDINGS.md section 17).
  assert.equal(row["static_class"], "clean");
  assert.equal(row["missing_subtypes"], "");
  assert.equal(row["hard_blockers"], "");
  assert.equal(row["selector_blockers"], "");
  assert.equal(row["selector_nonclean"], "");
  assert.equal(row["kind"], "selector");
});

test("AWS Elemental MediaLive and MediaConvert are clean now that dependent selectors are native", async () => {
  const rows = await trackerRows();
  const live = rows.find((entry) => entry["service_code"] === "awsElementalMediaLive")!;
  assert.equal(live["static_class"], "clean");
  assert.equal(live["selector_blockers"], "");
  const convert = rows.find((entry) => entry["service_code"] === "elementalMediaConvert")!;
  assert.equal(convert["static_class"], "clean");
  assert.equal(convert["selector_blockers"], "");
});

test("Amazon Chime SDK and Amazon Translate are clean after the remap rules were retired", async () => {
  const rows = await trackerRows();
  for (const code of ["amazonChimeSdk", "amazonTranslate"]) {
    const row = rows.find((entry) => entry["service_code"] === code)!;
    assert.equal(row["static_class"], "clean", `${code} is clean`);
    assert.equal(row["hard_blockers"], "", `${code} names no hard blocker`);
    assert.equal(row["selector_blockers"], "", `${code} names no selector blocker`);
  }
  const chime = rows.find((entry) => entry["service_code"] === "amazonChimeSdk")!;
  // The children are still enumerated even though none is blocked, so a future
  // regression names the child instead of hiding it.
  assert.equal(chime["selector_children"], "5");
  assert.equal(chime["selector_nonclean"], "");
});

test("no row carries a retired remap blocker", async () => {
  const rows = await trackerRows();
  // D-027 retired `regex-remap`, D-029 the remap direction, and D-030
  // `remap.constant` and `remap.keyValue-primary`: the engine implements the
  // live mechanism for each, so a row that claims one is stale.
  for (const row of rows) {
    for (const column of ["hard_blockers", "deep_gaps", "selector_blockers"]) {
      assert.doesNotMatch(
        row[column] ?? "",
        /remap\.constant|remap\.keyValue|regex-remap/,
        `${row["service_code"]} does not carry a retired remap blocker in ${column}`
      );
    }
  }
});

test("the two services the retired primary-remap rule blocked are clean and price", async () => {
  const rows = await trackerRows();
  const child = rows.find((entry) => entry["service_code"] === "realTimeDocumentTranslation")!;
  assert.equal(child["static_class"], "clean");
  // `--evaluate` fills the runtime columns; a plain run leaves them `not-run`.
  if (child["runtime_use1"] !== "not-run") assert.equal(child["runtime_use1"], "ok");
  const parent = rows.find((entry) => entry["service_code"] === "amazonTranslate")!;
  assert.equal(parent["static_class"], "clean");
  assert.equal(parent["priority"], "P2");
});

test("a regex-shaped remap key is not a gap the engine fails closed on", async () => {
  const rows = await trackerRows();
  // docs/DECISIONS.md D-027 asked for this cleanup: the live forward remap is a
  // plain object lookup, a regex-shaped key is an inert literal key there and
  // here, and the reversed key is used as the price-set token regex, which
  // `columnFormMeterFragments` also does. No row may claim it as a gap again.
  const flagged = rows.filter((row) => row["deep_gaps"]!.includes("regex-remap"));
  assert.deepEqual(flagged.map((row) => row["service_code"]), []);
});

test("a runtime label separates an engine gap from a cache gap and a crash", () => {
  // `MissingPriceError` is not an `EngineError`, so it used to land in the
  // generic `error` bucket. Only a missing meter is a coverage gap; an
  // uncached offline fetch says something about this machine, not the service.
  assert.equal(runtimeLabel(new MissingPriceError("meter", "US East (Ohio)", "mapping")), "missing-price");
  assert.equal(runtimeLabel(new EngineError("no price", "MISSING_PRICE")), "missing-price");
  assert.equal(runtimeLabel(new EngineError("needs a value", "MISSING_INPUT")), "needs-input");
  assert.equal(runtimeLabel(new EngineError("unsupported", "UNSUPPORTED_INPUT")), "unsupported");
  assert.equal(
    runtimeLabel(new Error("offline and no cached copy of https://example/x (run once without AWSCALC_OFFLINE)")),
    "not-cached"
  );
  assert.equal(runtimeLabel(new TypeError("boom")), "error");
  assert.equal(runtimeLabel(undefined), "error");
});
