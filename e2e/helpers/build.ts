import { buildEstimate, type BuildResult } from "../../src/estimate/builder.ts";
import { loadCatalog } from "../../src/data/catalog.ts";
import { loadRuntimeConfig } from "../../src/data/support.ts";
import type { EstimateSpec } from "../../src/estimate/spec.ts";

export interface BuildOutcome {
  result: BuildResult;
}

/** Build an estimate for E2E checks using the cached live data plane. */
export async function buildFromSpec(spec: EstimateSpec): Promise<BuildOutcome> {
  const catalog = await loadCatalog({});
  const supportConfig = spec.support ? await loadRuntimeConfig({}) : undefined;
  const result = await buildEstimate(spec, {
    catalog,
    ...(supportConfig ? { supportConfig } : {}),
  });
  return { result };
}
