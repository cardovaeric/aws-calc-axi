import test from "node:test";
import assert from "node:assert/strict";
import { loadCatalog, loadRegionMap, visibleServices } from "../src/data/catalog.ts";

const EXPECTED = { "us-east-1": 181, "us-east-2": 160 } as const;

test("region-aware catalog parity matches the live UI", async () => {
  const [catalog, regionMap] = await Promise.all([loadCatalog({}), loadRegionMap({})]);
  for (const [region, expected] of Object.entries(EXPECTED)) {
    const visible = visibleServices(catalog, regionMap, { region });
    assert.equal(
      visible.length,
      expected,
      `${region} should list ${expected} top-level services (derived ${visible.length})`
    );
    assert.equal(
      visible.some((service) => service.serviceCode === "amazonTechnic"),
      false,
      "MDC Rack stays hidden"
    );
    assert.equal(
      visible.some((service) => service.subType === "subService"),
      false,
      "sub-services are not top-level entries"
    );
  }
});
