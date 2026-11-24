import test from "node:test";
import assert from "node:assert/strict";
import {
  convertThroughput,
  convertFrequency,
  convertSize,
  convertTime,
  convertRateTime,
  normalizeTimeUnit,
} from "../src/engine/units.ts";

test("file size conversions use binary multiples", () => {
  assert.equal(convertSize(1, "tb", "gb"), 1024);
  assert.equal(convertSize(1024, "gb", "tb"), 1);
  assert.equal(convertSize(1024, "mb", "gb"), 1);
  assert.equal(convertSize(100, "gb", "gb"), 100);
});

test("time conversions follow the live table", () => {
  assert.equal(convertTime(1, "month", "hour"), 730);
  assert.ok(Math.abs(convertTime(730, "hour", "month") - 1) < 1e-5);
  assert.equal(convertTime(1, "hr", "min"), 60);
});

test("rate time conversion is the inverse of duration conversion", () => {
  assert.ok(Math.abs(convertRateTime(1024, "month", "hour") - 1024 / 730) < 1e-12);
  assert.ok(Math.abs(convertRateTime(1024 / 730, "hour", "month") - 1024) < 0.01);
  assert.equal(convertRateTime(100, "month", "month"), 100);
});

test("time unit aliases collapse to table keys", () => {
  assert.equal(normalizeTimeUnit("hr"), "hour");
  assert.equal(normalizeTimeUnit("Hours"), "hour");
  assert.equal(normalizeTimeUnit("sec"), "sec");
  assert.equal(normalizeTimeUnit("days"), "day");
});

test("frequency conversion is oriented input -> output", () => {
  const perMonth = convertFrequency(1, "perDay", "perMonth");
  assert.ok(Math.abs(perMonth - 30.416666666666668) < 1e-12);
  assert.ok(Math.abs(convertFrequency(730, "perDay", "perMonth") - 22204.166666666664) < 1e-6);
  assert.equal(convertFrequency(730, "perMonth", "perHour"), 1);
  assert.equal(convertFrequency(1, "perMonth", "perMonth"), 1);
});

test("prefixed frequency families convert through the base unit", () => {
  assert.equal(convertFrequency(1, "millionPerMonth", "perMonth"), 1_000_000);
  assert.equal(convertFrequency(1, "perMonth", "millionPerMonth"), 0.000001);
  assert.equal(convertFrequency(1, "millionPerDay", "millionPerMonth"), 30.416666666666668);
});

test("throughput conversion uses binary multiples", () => {
  assert.equal(convertThroughput(125, "mbps", "mbps"), 125);
  assert.equal(convertThroughput(1024, "kbps", "mbps"), 1);
  assert.equal(convertThroughput(1, "gbps", "mbps"), 1024);
  assert.equal(convertThroughput(1, "mbps", "kbps"), 1024);
  assert.equal(convertThroughput(1, "gbps", "kbps"), 1048576);
});
