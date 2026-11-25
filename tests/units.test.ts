import test from "node:test";
import assert from "node:assert/strict";
import {
  convertThroughput,
  convertFrequency,
  convertDuration,
  roundConverted,
  convertSize,
  convertTime,
  convertRateTime,
  normalizeTimeUnit,
  utilizationHours,
  UTILIZATION_DURATIONS,
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

test("frequency conversion rounds like the live input", () => {
  // 10 hours/week -> hours/day: live rounds to two decimals (1.43), not 1/7.
  assert.equal(roundConverted(convertFrequency(10, "perWeek", "perDay"), 2), 1.43);
  assert.equal(roundConverted(convertFrequency(1, "perWeek", "perDay"), 2), 0.14);
  // The live input honours an explicit decimalPlaces.
  assert.equal(roundConverted(convertFrequency(1, "perWeek", "perDay"), 4), 0.1429);
});

test("duration conversion uses exact seconds and rounds up", () => {
  // Live `calculateDuration` uses secondsPerUnit and ROUND_UP.
  assert.equal(convertDuration(1, "sec", "min"), 0.02);
  assert.equal(convertDuration(1, "min", "sec"), 60);
  assert.equal(convertDuration(24, "day", "hour", 2), 576);
  assert.equal(convertDuration(1, "hour", "month"), 0.01);
  // Same unit is a pass-through, like the live input.
  assert.equal(convertDuration(7, "hour", "hour"), 7);
});

test("utilization durations are the live option table", () => {
  assert.deepEqual(Object.keys(UTILIZATION_DURATIONS), [
    "percentagePerMonth",
    "hoursPerDay",
    "hoursPerWeek",
    "hoursPerMonth",
    "minutesPerDay",
    "minutesPerMonth",
  ]);
  assert.deepEqual(UTILIZATION_DURATIONS["percentagePerMonth"], {
    label: "% Utilization/Month",
    max: 100,
    outputLabel: "%",
  });
  assert.equal(UTILIZATION_DURATIONS["hoursPerMonth"]?.max, 730);
  assert.equal(UTILIZATION_DURATIONS["minutesPerMonth"]?.max, 43800);
});

test("utilization rounds hours up with Math.ceil when roundUpToHours is set", () => {
  // 33% of 730 hours is 240.9; the live form stores a whole hour.
  assert.equal(utilizationHours(33, "percentagePerMonth", true), 241);
  assert.equal(utilizationHours(100, "percentagePerMonth", true), 730);
  assert.equal(utilizationHours(50, "percentagePerMonth", true), 365);
  assert.equal(utilizationHours(730, "hoursPerMonth", true), 730);
  assert.equal(utilizationHours(0, "percentagePerMonth", true), 0);
});

test("utilization without roundUpToHours rounds the float up to decimalPlaces", () => {
  // decimal.js ROUND_UP is away from zero, so 243.33333... becomes 243.3334.
  assert.equal(utilizationHours(33, "percentagePerMonth", false, 4), 240.9);
  assert.equal(utilizationHours(100 / 3, "percentagePerMonth", false, 4), 243.3334);
  assert.equal(utilizationHours(1, "minutesPerMonth", false, 4), 0.0167);
  assert.equal(utilizationHours(1, "minutesPerDay", false, 4), 0.507);
  assert.equal(utilizationHours(100, "percentagePerMonth", false), 730);
});

test("utilization rejects duration ids the live form does not offer", () => {
  assert.throws(() => utilizationHours(1, "hoursPerYear", true), /unknown utilization duration/);
});
