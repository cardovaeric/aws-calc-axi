# aws-calc-axi plan

An agent-facing CLI that builds AWS Pricing Calculator estimates and publishes normal
`https://calculator.aws/#/estimate?id=...` links with the same capability as the web app.

## Locked decisions

- **Engine:** native, deterministic. The browser is not in the hot path.
- **Coverage:** all public services in v1. Tier A/B are native. Tier C gets native modules,
  with a headless oracle bridge only until each module lands.
- **Spec format:** YAML primary, JSON accepted. JSON Schema is the contract.
- **Final truth:** the rendered public page. A saved key is not a receipt. Every publish is
  opened, rendered, and asserted against the live UI and expected totals.

## Why this works

The web app is definition-driven:

- Catalog: `https://d1qsjq9pzbk1k6.cloudfront.net/manifest/en_US.json`
- Region availability: `.../manifest/regionList/publish.json`
- Service definition: `.../data/{serviceCode}/{locale}.json`
- Pricing: `https://calculator.aws/pricing/2.0/meteredUnitMaps/{service}/{currency}/current/{file}.json`
- Support tiers: `https://calculator.aws/FrontEndUI/prod-us-east-1.json`
- Publish: `POST https://dnd5zrqcec4or.cloudfront.net/Prod/v2/saveAs`
- Retrieve: `GET https://d3knqfixx3sbls.cloudfront.net/{savedKey}`

The save endpoint is public (CORS `*`) and returns a `savedKey`. The public page renders the
stored estimate JSON. See `analysis/FINDINGS.md` for the full evidence and reproduction commands.

## Architecture

1. **Catalog** - manifest, region map, locations. Resolve region-aware service availability.
2. **Definitions** - fetch and cache service definitions. Resolve templates, cards, visibility,
   defaults, validations, and pricing references per region.
3. **Pricing** - fetch only the mapping definitions a template uses. Resolve metered unit labels
   to regional prices. Fail closed on a missing meter.
4. **Engine** - evaluate inputs, prices, math, rounding, subtotals, and config summaries.
   Support sub-services (`subServices[]`), nested user groups, and AWS Support plans.
5. **Publisher** - emit the estimate JSON, POST to `saveAs`, build the public URL.
6. **Verifier** - open the public URL, read `[data-monthly-cost]`, `[data-upfront-cost]`,
   `[data-annual-cost]`, group rows, support row, and expiry banner. Compare with the native
   result and the live UI oracle. This is the only PASS.
7. **Ledger** - one row per service, template, region, and fixture. Each row records native
   output, oracle output, saved key, rendered DOM receipt, and whether the service is native or
   bridged.

## Coverage tiers

- **Tier A: generic** - 398 `layout: simple` definitions. One declarative interpreter for
  inputs, `displayIf`, pricing lookup, math, rounding, and cost subtotals. 14 math subtypes,
  6 basic operations (add, subtract, multiply, divide, exponent, max/min).
- **Tier B: composite** - 33 loaders + 34 selectors. Sub-service selection, dynamic definitions,
  parent aggregation, and `subServices[]`.
- **Tier C: bespoke** - a short, enumerated roster (EC2 enhancement, Windows/SQL, RDS custom,
  media edge cases). Native modules are the destination. A headless oracle bridge keeps
  capability complete and carries a burn-down task.

## CLI surface

```text
aws-calc-axi                                  # home: catalog state + next steps
aws-calc-axi services [--region ...] [--all] [--query ...]
aws-calc-axi schema <code> [--region ...] [--full]
aws-calc-axi pricing <code> --region ... [--unit ...]
aws-calc-axi estimate init "Name"
aws-calc-axi add <code> --region ... --set k=v [--set ...]
aws-calc-axi group create "Name"
aws-calc-axi group move <service-id> --to "Name"
aws-calc-axi support business|enterprise|unified [--spend-tier ...]
aws-calc-axi cost [--full]
aws-calc-axi apply estimate.yaml [--publish]
aws-calc-axi publish estimate.yaml         # POST, open, render verify
aws-calc-axi verify <url>
aws-calc-axi doctor
aws-calc-axi update --check|--apply
```

Output is TOON on stdout. Progress and diagnostics go to stderr. Unknown flags fail with exit
code 2 and the valid set. No interactive prompts. Publishing is a separate, explicit mutation.
A publish is only successful after the rendered-page assertion passes.

## Accuracy gates

1. Schema snapshot: manifest, definitions, regions, support tiers hashed.
2. Catalog parity: derive the region list and compare it with the live UI.
3. Price resolution: every referenced metered unit resolves or the input is hidden.
4. Cost parity: native and live-UI totals match to 0.01 USD for every fixture.
5. Publish + render: open the public URL and assert the visible totals, groups, support, expiry.

The canonical matrix is `441 definitions x representative regions x fixtures`. Fixtures cover
defaults, min/max, every dropdown option, repeatable rows, and a generated nonzero profile.
Only gate 5 can declare a service done.

## Change management

The data plane is unversioned. Treat it as a dependency:

- **Detect** - nightly fetch and hash of manifest, region map, definitions, prices, support tiers.
- **Classify** - new service, template, input/math subtype, region, price, default, or API shape.
- **Regenerate** - schema docs, SDK types, fixtures, ledger rows, test matrix.
- **Verify** - live UI oracle plus rendered public page for every affected cell.
- **Release** - a pinned snapshot with a changelog and rollback. Agents can pin or go offline.
- **Fail closed** - unknown subtype, unresolved meter, or changed save response blocks publishing
  with an actionable error. Never publish a guessed zero.

New instance types (EC2, RDS, ElastiCache, OpenSearch) are normally data-only changes: the price
label appears in the mapping file and the affected fixtures re-run. New input or math subtypes
are code changes and require an adapter.

## Delivery

1. Week 1 - foundation: catalog, definitions, pricing, contract types, publisher, S3 slice.
2. Weeks 2-3 - generic engine and Tier A parity.
3. Week 4 - composition: loaders, selectors, groups, support.
4. Weeks 5-6 - bespoke native modules and tracked oracle bridges.
5. Week 7 - change-management pipeline, hardening, docs, skill, release gate.

## Artifacts

- `.lavish/plan.html` - reviewable plan with evidence, diagrams, and decisions.
- `analysis/FINDINGS.md` - raw live-site findings and reproduction commands.
- `analysis/` - captured HARs, service definitions, pricing samples, and estimate payloads.
