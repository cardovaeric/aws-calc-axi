import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { rollupSelector, type SelectorChildFacts } from "../scripts/coverage-selector.ts";

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
    child("a", "blocked:column-form", { hard: "remap.constant" }, "Implement column-form remap.constant"),
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

test("Amazon WorkSpaces keeps six declared children, four non-clean and two unserved", async () => {
  const rows = await trackerRows();
  const row = rows.find((entry) => entry["service_code"] === "amazonWorkSpaces");
  assert.ok(row, "amazonWorkSpaces is in the tracker");
  assert.equal(row["selector_children"], "6");
  assert.equal(row["selector_unserved"], "workSpacesThinClient;workSpacesSecureBrowser");
  assert.deepEqual(
    row["selector_nonclean"]!.split(";"),
    ["amazonWorkspaces", "workSpacesCore", "workSpacesInstances", "workSpacesPools"]
  );
  assert.match(row["selector_blockers"]!, /utilization-selector \(amazonWorkspaces, workSpacesCore, workSpacesInstances\)/);
  assert.match(row["selector_blockers"]!, /dependent-selectors \(amazonWorkspaces, workSpacesCore, workSpacesInstances, workSpacesPools\)/);
});

test("Amazon EMR names the utilization row on all three node children", async () => {
  const rows = await trackerRows();
  const row = rows.find((entry) => entry["service_code"] === "amazonEMR");
  assert.ok(row, "amazonEMR is in the tracker");
  assert.equal(row["static_class"], "blocked:column-form");
  assert.equal(
    row["selector_blockers"],
    "utilization-selector (amazonEmrMasterNode, amazonEmrCoreNode, amazonEmrTaskNode)"
  );
});

test("AWS Mainframe Modernization reports the missing input subtype it is blocked by", async () => {
  const rows = await trackerRows();
  const row = rows.find((entry) => entry["service_code"] === "amazonMainframeModernization");
  assert.ok(row, "amazonMainframeModernization is in the tracker");
  assert.equal(row["static_class"], "blocked:subtype");
  assert.equal(row["missing_subtypes"], "input:utilization:2;input:utilization:3");
  assert.equal(row["plan_phase"], "Phase 5 - long tail");
});

test("AWS Elemental MediaLive and MediaConvert attribute dependent selectors to the child that carries them", async () => {
  const rows = await trackerRows();
  const live = rows.find((entry) => entry["service_code"] === "awsElementalMediaLive")!;
  assert.equal(
    live["selector_blockers"],
    "dependent-selectors (mediaLiveInput1, mediaLiveOutput1, mediaLiveAudioAddOns)"
  );
  const convert = rows.find((entry) => entry["service_code"] === "elementalMediaConvert")!;
  assert.equal(convert["selector_blockers"], "dependent-selectors (outputConfiguration1, outputConfiguration2)");
});

test("Amazon Chime SDK names the constant remap rows that block it", async () => {
  const rows = await trackerRows();
  const row = rows.find((entry) => entry["service_code"] === "amazonChimeSdk")!;
  assert.equal(row["static_class"], "blocked:column-form");
  assert.equal(row["selector_blockers"], "remap.constant (ptsnAudio, sipTrunking)");
});
