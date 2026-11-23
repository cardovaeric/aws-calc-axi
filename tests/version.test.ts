import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../src/version.ts";

const ROOT = join(import.meta.dirname, "..");
const BIN = join(ROOT, "bin", "aws-calc-axi.js");

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
});

for (const flag of ["--version", "-v", "-V"]) {
  test(`${flag} prints the bare version`, () => {
    const output = execFileSync(process.execPath, [BIN, flag], { encoding: "utf8" });
    assert.equal(output.trim(), VERSION);
  });
}

test("version fast path is not slower than the node floor by much", () => {
  const floorStart = performance.now();
  execFileSync(process.execPath, ["-e", "console.log(1)"], { encoding: "utf8" });
  const floor = performance.now() - floorStart;

  const versionStart = performance.now();
  execFileSync(process.execPath, [BIN, "--version"], { encoding: "utf8" });
  const version = performance.now() - versionStart;

  // The fast path must avoid loading the CLI graph. Allow generous headroom for
  // process startup noise, but reject a full module graph load (200ms+).
  assert.ok(
    version < floor + 150,
    `version took ${version.toFixed(1)}ms vs node floor ${floor.toFixed(1)}ms`
  );
});
