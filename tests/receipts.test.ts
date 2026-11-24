import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const RECEIPTS = join(import.meta.dirname, "..", "receipts");

/**
 * Receipts are evidence, and evidence has to be readable by a machine. An
 * unescaped quote in a probe receipt once shipped because nothing loaded it;
 * this is the cheap check that would have caught it.
 */
test("every receipts/*.json file parses", async () => {
  const files = (await readdir(RECEIPTS)).filter((file) => file.endsWith(".json")).sort();
  assert.ok(files.length > 0, "receipts/ holds JSON evidence");
  for (const file of files) {
    const text = await readFile(join(RECEIPTS, file), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      assert.fail(`receipts/${file} is not valid JSON: ${(error as Error).message}`);
    }
    assert.ok(
      parsed !== null && typeof parsed === "object",
      `receipts/${file} is a JSON object or array`
    );
  }
});
