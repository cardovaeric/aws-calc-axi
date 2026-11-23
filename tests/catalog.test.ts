import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogEntryType,
  serviceSupportsRegion,
  visibleServices,
  type Catalog,
  type CatalogEntry,
  type RegionMap,
} from "../src/data/catalog.ts";

function entry(code: string, extra: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    name: code,
    serviceCode: code,
    type: "AWSService",
    isActive: "true",
    ...extra,
  };
}

const catalog: Catalog = {
  awsServices: [
    entry("plain", { name: "Plain Service" }),
    entry("unavailable"),
    entry("inactive", { isActive: "false" }),
    entry("noConfigure", { disableConfigure: true }),
    entry("aChild", { subType: "subService" }),
    entry("tco", { subType: "TCOCalculator" }),
    entry("amazonTechnic"),
    entry("selector", {
      name: "Selector",
      subType: "subServiceSelector",
      templates: ["childOne", "childTwo"],
    }),
    entry("deadSelector", { subType: "subServiceSelector", templates: ["childOne"] }),
    entry("keyword", { name: "Searchable", searchKeywords: ["fancy keyword"] }),
  ],
};

const regions: RegionMap = {
  plain: ["us-east-1"],
  inactive: ["us-east-1"],
  noConfigure: ["us-east-1"],
  aChild: ["us-east-1"],
  tco: ["us-east-1"],
  amazonTechnic: ["us-east-1"],
  childTwo: ["us-east-1"],
  keyword: ["us-east-1"],
};

test("region availability follows the live rule", () => {
  const codes = visibleServices(catalog, regions, { region: "us-east-1" })
    .map((service) => service.serviceCode)
    .sort();
  assert.deepEqual(codes, ["keyword", "plain", "selector"]);
});

test("a selector is available through any of its templates", () => {
  const selector = catalog.awsServices.find((service) => service.serviceCode === "selector");
  assert.ok(selector);
  assert.equal(serviceSupportsRegion(selector, regions, "us-east-1"), true);
  assert.equal(serviceSupportsRegion(selector, regions, "us-west-2"), false);
});

test("all mode ignores regional coverage but keeps the other rules", () => {
  const codes = visibleServices(catalog, regions, { region: "us-west-2", all: true })
    .map((service) => service.serviceCode)
    .sort();
  assert.deepEqual(codes, ["deadSelector", "keyword", "plain", "selector", "unavailable"]);
});

test("query filters on name, code, and keywords", () => {
  const byName = visibleServices(catalog, regions, { region: "us-east-1", query: "plain" });
  assert.deepEqual(byName.map((service) => service.serviceCode), ["plain"]);
  const byKeyword = visibleServices(catalog, regions, { region: "us-east-1", query: "fancy" });
  assert.deepEqual(byKeyword.map((service) => service.serviceCode), ["keyword"]);
});

test("catalog entry types distinguish selectors and TCO tools", () => {
  assert.equal(catalogEntryType(entry("x", { subType: "subServiceSelector" })), "selector");
  assert.equal(catalogEntryType(entry("x", { subType: "TCOCalculator" })), "tco");
  assert.equal(catalogEntryType(entry("x")), "service");
});
