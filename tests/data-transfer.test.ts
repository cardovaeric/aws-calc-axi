import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTransferPricing,
  evaluateTransferRows,
  normalizeRows,
  toSavedRows,
  transferSummary,
  type TransferRow,
} from "../src/engine/data-transfer.ts";
import type { PricingFile } from "../src/data/pricing.ts";
import { evaluateInput } from "../src/engine/inputs.ts";
import { regionMaps, resolverFor } from "./helpers.ts";

const OHIO = "US East (Ohio)";

/**
 * Small stand-in for `datatransfer-calc.json` with the same key shapes the live
 * converter reads. Prices are the observed US East (Ohio) values.
 */
const TRANSFER_FILE: PricingFile = {
  regions: {
    [OHIO]: {
      "DataTransfer External Inbound": { price: "0.0000000000" },
      "DataTransfer External Outbound Next 10 TB": {
        price: "0.0900000000",
        StartingRange: "0",
        EndingRange: "10240",
      },
      "DataTransfer External Outbound Next 40 TB": {
        price: "0.0850000000",
        StartingRange: "10240",
        EndingRange: "51200",
      },
      "DataTransfer External Outbound Greater than 150 TB": {
        price: "0.0700000000",
        StartingRange: "51200",
        EndingRange: "Inf",
      },
      "DataTransfer InterRegion Outbound to US East N Virginia": {
        price: "0.0100000000",
        "To Location": "US East (N. Virginia)",
      },
      "DataTransfer InterRegion Outbound MultipathResilience to US East N Virginia": {
        price: "0.0150000000",
        "To Location": "US East (N. Virginia)",
      },
      "DataTransfer InterRegion Outbound to US West Oregon": {
        price: "0.0200000000",
        "To Location": "US West (Oregon)",
      },
      "DataTransfer InterRegion Outbound to US East Ohio": {
        price: "0.0200000000",
        "To Location": "US East (Ohio)",
      },
      "DataTransfer IntraRegion": { price: "0.0100000000" },
      // Legacy PLC_2.0 rows are keyed by usage type and must be ignored.
      "43SVRH2NZVAKYEXT JRTCKXETXF.6YS6EN2CT7 0": {
        price: "0.0100000000",
        "To Location": "US East (N. Virginia)",
      },
    },
  },
};

function context() {
  const maps = regionMaps();
  return {
    componentId: "dataTransfer",
    regionName: OHIO,
    mapping: "datatransfer-calc",
    prices: resolverFor({ "datatransfer-calc": TRANSFER_FILE }),
    ...maps,
  };
}

function row(overrides: Partial<TransferRow> & Pick<TransferRow, "entryType">): TransferRow {
  return { value: "", unit: "tb_month", priceKey: "", ...overrides };
}

test("external outbound uses the regional tier ladder", () => {
  const result = evaluateTransferRows(
    [row({ entryType: "OUTBOUND", value: "1", unit: "tb_month", priceKey: "External" })],
    context()
  );
  assert.equal(result.monthly, 92.16);
});

test("gigabyte rows skip the terabyte conversion", () => {
  const result = evaluateTransferRows(
    [row({ entryType: "OUTBOUND", value: "200", unit: "gb_month", priceKey: "External" })],
    context()
  );
  assert.equal(result.monthly, 18);
});

test("intra-region transfer bills both directions", () => {
  const result = evaluateTransferRows(
    [row({ entryType: "INTRA_REGION", value: "1", unit: "gb_month" })],
    context()
  );
  assert.equal(result.monthly, 0.02);
});

test("external inbound is free", () => {
  const result = evaluateTransferRows(
    [row({ entryType: "INBOUND", value: "1", unit: "tb_month", priceKey: "External" })],
    context()
  );
  assert.equal(result.monthly, 0);
});

test("a destination with a region-specific override uses it", () => {
  const result = evaluateTransferRows(
    [row({ entryType: "OUTBOUND", value: "1", unit: "tb_month", priceKey: "us-west-2" })],
    context()
  );
  assert.equal(result.monthly, 20.48);
});

test("a destination without an override falls back to the common pricing", () => {
  const result = evaluateTransferRows(
    [row({ entryType: "OUTBOUND", value: "1", unit: "tb_month", priceKey: "us-east-2" })],
    context()
  );
  assert.equal(result.monthly, 20.48);
});

test("the live pipeline accumulates every meter for one destination", () => {
  // The calculator charges both the inter-region rate and the multipath
  // resilience rate for US East (N. Virginia): 1024 * (0.01 + 0.015) = 25.60.
  // analysis/FINDINGS.md section 9 records the live recomputation.
  const result = evaluateTransferRows(
    [row({ entryType: "OUTBOUND", value: "1", unit: "tb_month", priceKey: "us-east-1" })],
    context()
  );
  assert.equal(result.monthly, 25.6);
  assert.deepEqual(
    result.pricing.outbound.get("us-east-1")?.tiers.map((tier) => tier.price),
    [0.01, 0.015]
  );
});

test("an unknown destination region fails closed", () => {
  assert.throws(
    () =>
      evaluateTransferRows(
        [row({ entryType: "OUTBOUND", value: "1", priceKey: "us-mars-1" })],
        context()
      ),
    /is not a known region code/
  );
});

test("a value without a destination fails closed", () => {
  assert.throws(
    () => evaluateTransferRows([row({ entryType: "OUTBOUND", value: "1" })], context()),
    /no destination region/
  );
});

test("an unknown unit fails closed", () => {
  assert.throws(
    () => normalizeRows([{ entryType: "OUTBOUND", value: 1, unit: "pb_month" }], ["OUTBOUND"]),
    /unit "pb_month" is not supported/
  );
});

test("a row type the service does not offer fails closed", () => {
  assert.throws(
    () => normalizeRows([{ entryType: "INTRA_REGION", value: 1 }], ["INBOUND", "OUTBOUND"]),
    /is not offered by this service/
  );
});

test("missing types become an untouched row with the live default unit", () => {
  const rows = normalizeRows([{ entryType: "OUTBOUND", value: 1, toRegion: "External" }], [
    "INBOUND",
    "OUTBOUND",
  ]);
  assert.deepEqual(rows, [
    { entryType: "INBOUND", value: "", unit: "tb_month", priceKey: "" },
    { entryType: "OUTBOUND", value: "1", unit: "tb_month", priceKey: "External" },
  ]);
});

test("the config summary matches the live DT shape", () => {
  const rows = normalizeRows(
    [
      { entryType: "OUTBOUND", value: 1, unit: "tb_month", toRegion: "External" },
      { entryType: "INTRA_REGION", value: 5, unit: "gb_month" },
      { entryType: "INBOUND", value: 2, unit: "tb_month", fromRegion: "us-east-1" },
    ],
    ["INBOUND", "OUTBOUND", "INTRA_REGION"]
  );
  const maps = regionMaps();
  assert.equal(
    transferSummary(rows, maps.regionNameByCode),
    "DT Inbound: US East (N. Virginia) (2 TB per month), " +
      "DT Outbound: Internet (1 TB per month), " +
      "DT Intra-Region: (5 GB per month)"
  );
});

test("the save format only carries the live converter's fields", () => {
  const rows = normalizeRows(
    [
      { entryType: "OUTBOUND", value: 1, unit: "tb_month", toRegion: "External" },
      { entryType: "INBOUND", value: 2, unit: "gb_month", fromRegion: "us-east-1" },
    ],
    ["INBOUND", "OUTBOUND"]
  );
  assert.deepEqual(toSavedRows(rows), [
    { entryType: "INBOUND", value: "2", unit: "gb_month", fromRegion: "us-east-1" },
    { entryType: "OUTBOUND", value: "1", unit: "tb_month", toRegion: "External" },
  ]);
});

test("an unknown meter kind is skipped, like the live converter", () => {
  const pricing = buildTransferPricing(
    {
      ...TRANSFER_FILE.regions[OHIO]!,
      "DataTransfer Mystery Outbound to Nowhere": { price: "1" },
    },
    {
      codeByName: regionMaps().regionCodeByName,
      regionName: OHIO,
      mappingDefinitionName: "datatransfer-calc",
    }
  );
  assert.equal(pricing.commonOutbound?.tiers.length, 1);
  assert.equal(pricing.outbound.has("us-east-1"), true);
});

test("the input component saves rows and returns the priced subtotal", () => {
  const result = evaluateInput(
    {
      type: "input",
      subType: "dataTransferV2",
      id: "dataTransfer",
      label: "Data Transfer",
      mappingDefinitionName: "datatransfer-calc",
      dataTransferTypes: ["INBOUND", "OUTBOUND"],
      preferredUnit: "gb",
      displayInConfigSummary: true,
    },
    {
      serviceCode: "awsS3DataTransfer",
      templateId: "awsS3DataTransfer",
      overrides: {
        dataTransfer: {
          value: [
            { entryType: "OUTBOUND", value: 1, unit: "tb_month", toRegion: "External" },
          ],
        },
      },
      regionName: OHIO,
      prices: resolverFor({ "datatransfer-calc": TRANSFER_FILE }),
      ...regionMaps(),
      columnForms: new Map(),
    }
  );
  assert.equal(result.value, 92.16);
  assert.deepEqual(result.saved, {
    value: [
      { entryType: "INBOUND", value: "", unit: "tb_month", fromRegion: "" },
      { entryType: "OUTBOUND", value: "1", unit: "tb_month", toRegion: "External" },
    ],
  });
  assert.equal(
    result.configSummary,
    "DT Inbound: Not selected (0 TB per month), DT Outbound: Internet (1 TB per month)"
  );
});
