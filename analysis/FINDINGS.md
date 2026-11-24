# calculator.aws reverse-engineering findings

Captured 2026-11-23 on https://calculator.aws (prod, en_US, USD).

These are raw observations and reproduction commands, not a spec. Treat all endpoints as unversioned and verify before relying on them.

## 1. Public data endpoints

| Purpose | Endpoint |
| --- | --- |
| Service catalog | `https://d1qsjq9pzbk1k6.cloudfront.net/manifest/en_US.json` |
| Region availability | `https://d1qsjq9pzbk1k6.cloudfront.net/manifest/regionList/publish.json` |
| Service definition | `https://d1qsjq9pzbk1k6.cloudfront.net/data/{serviceCode}/{locale}.json` |
| Service strings | `https://d1qsjq9pzbk1k6.cloudfront.net/data/aWSPricingCalculatorStrings/{locale}.json` |
| Product i18n | `https://i18n-string.us-west-2.prod.pricing.aws.a2z.com/{locale}.json` |
| Region display names | `https://b0.p.awsstatic.com/locations/1.0/aws/current/locations.json` |
| Runtime config | `https://calculator.aws/FrontEndUI/prod-us-east-1.json` |
| Pricing data | `https://calculator.aws/pricing/2.0/meteredUnitMaps/{service}/{currency}/current/{file}.json` |
| EC2 savings plans | `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/computesavingsplan/{path}` |
| Spot prices | `https://spot-bid-advisor.s3.amazonaws.com/spot-advisor-data.json` |

Runtime config (`FrontEndUI/prod-us-east-1.json`) contains:

- `RESOURCES.GET_SAVED_ESTIMATES_API`: `https://d3knqfixx3sbls.cloudfront.net/{estimateKey}`
- `RESOURCES.SAVE_ESTIMATES_API`: `https://dnd5zrqcec4or.cloudfront.net/Prod/v2/saveAs`
- `RESOURCES.SERVICE_DEFINITION_DOMAIN_URL`: `https://d1qsjq9pzbk1k6.cloudfront.net`
- `RESOURCES.PDF.API`: `https://dg7avmwizdsta.cloudfront.net/Prod/pdfexport`
- `RESOURCES.GRAPHQL_API_URL`: `https://7bena91p37.execute-api.us-west-2.amazonaws.com/Prod/v1/graphql`
- Support pricing tiers, plans, recommendation mapping.

Pricing responses are gzip-encoded. Use `curl --compressed` or an HTTP client that decompresses.

## 2. Catalog shape

`manifest/en_US.json` has 442 entries: 441 `AWSService` and 1 `static`.

Important fields:

- `serviceCode`, `name`, `slug`, `type`, `subType`
- `regions`: legacy/partial. Do not use for availability.
- `serviceDefinitionLocation`
- `templates`: child service codes for `subServiceSelector`
- `isActive`, `disableConfigure`, `disableRegionSupport`

`subType` counts: 166 none, 240 `subService`, 34 `subServiceSelector`, 2 `TCOCalculator`.

### Region availability rule (validated exactly)

A top-level service appears in the region-aware "Add service" list when:

1. `isActive === "true"`
2. `subType` is not `subService` or `TCOCalculator`
3. `disableConfigure` is falsy
4. `regionList[serviceCode]` contains the selected region, OR
5. `subType === "subServiceSelector"` and any code in `templates` has the region in `regionList`

Then hide `amazonTechnic` (AWS MDC Rack). "Search all services" mode is broader and includes no-region services.

Verified against the live UI:

- `us-east-2`: computed 160, UI 160
- `us-east-1`: computed 181 after the MDC exclusion, UI 181

## 3. Service definition shape

441 definitions were downloaded, 9.8 MB total. Top-level keys:

`version`, `serviceName`, `serviceCode`, `type`, `slug`, `regions`, `serviceDescription`, `linkUrl`, `mappingDefinitions`, `costType`, `layout`, `templates`.

`layout` counts: 398 `simple`, 33 `loader`, 10 missing.

A definition contains `templates[]`, each with `cards[]`. A card has:

- `inputSection.components[]`
- `mathsSection[].components[]`
- `displayIf` expressions
- `title`, `helpText`, `helpUrl`, `cardType`, `repeatable`

Across all definitions:

- 17,082 components
- Component types: 7,665 `maths`, 4,771 `input`, 2,554 `pricing`, 2,079 `display`, 10 `ec2PriceDisplay`, 3 `variable`
- Math subtypes: 6,041 `basicMaths`, 1,161 `priceDisplay`, 963 `variable`, 895 `conversionDisplay`, 302 `tieredPricingMath`, 179 `rounding`, 172 `maxMin`, plus 10 bespoke EC2/RDS/Windows types
- Basic math operations: 3,661 multiply, 1,102 add, 858 divide, 395 subtract, 25 exponent; max/min 172
- Input subtypes: 1,657 `numericInput`, 641 `dropdown`, 503 `frequency`, 452 `fileSize`, 352 `alert`, 297 `bodyText`, 275 `durationInput`, 184 `percentInput`, 127 `columnFormIPM`, 115 `headerText`, 54 `condition`, 32 `throughput`, 22 `dataTransferV2`, 18 `utilization`, plus a small bespoke tail
- Pricing subtypes: 1,608 `singlePricePoint`, 486 `pricingComboV2`, 309 `tieredPricing`, 77 `concatenate`, 70 `replace`, 3 `ec2PriceFetcher`
- `displayIf` operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `and`, `or`, `not`, `exists`, plus `checkboxChecked`/`checkboxNotChecked`
- `exists` checks `{type:"meteredUnit", mappingDefinitionName, meteredUnit}`. This makes the form region-dependent.

Pricing data maps a human metered unit label per region to a price, for example:

`pricingData.regions["US East (Ohio)"]["Standard Storage First 50 TB per GB Mo"].price`

This label is exactly the `meteredUnit` string in the definition, so no separate label map is needed.

## 4. Estimate contract

A saved estimate is JSON at the GET endpoint. Example public link:

`https://calculator.aws/#/estimate?id=103fa2c4f9ffa7d9a0df178796c308d91102011c`

Shape:

```json
{
  "name": "My Estimate",
  "services": {
    "<serviceCode>-<uuid>": {
      "calculationComponents": {
        "<componentId>": { "value": "..." }
      },
      "serviceCode": "ec2Enhancement",
      "region": "us-east-2",
      "estimateFor": "template",
      "version": "0.0.68",
      "description": null,
      "serviceCost": { "monthly": 1.53, "upfront": 0 },
      "serviceName": "Amazon EC2",
      "regionName": "US East (Ohio)",
      "configSummary": "Tenancy (Shared Instances), ..."
    }
  },
  "groups": {},
  "groupSubtotal": { "monthly": 1.53, "upfront": 0 },
  "totalCost": { "monthly": 1.53, "upfront": 0 },
  "support": {},
  "metaData": {
    "locale": "en_US",
    "currency": "USD",
    "createdOn": "2026-11-23T14:21:14.047Z",
    "source": "calculator-platform",
    "estimateId": "..."
  }
}
```

Observed quirks:

- `serviceCost` and `groupSubtotal` omit `upfront` when it is zero; `totalCost` always has both.
- `configSummary` is stored text; the share page does not rebuild it.
- The share page displays stored `serviceCost` verbatim. A hand-crafted estimate with `monthly` changed to 100 rendered 100. This is the trust boundary: our engine is the source of truth for service costs.
- Support cost is not stored. The share page recomputes it from `support.calculationComponents` and the published tier table.

### Sub-services (S3, DynamoDB, etc.)

A `subServiceSelector` saves one parent service with a `subServices` array, not nested estimate groups:

```json
{
  "serviceCode": "amazonSimpleStorageServiceGroup",
  "estimateFor": "simpleStorageServiceClassesGroup",
  "subServices": [
    {
      "calculationComponents": {
        "s3StandardStorageSize": { "value": "100", "unit": "gb|month" }
      },
      "serviceCode": "amazonS3Standard",
      "serviceCost": { "monthly": 2.3, "upfront": 0 }
    }
  ],
  "serviceCost": { "monthly": 2.3, "upfront": 0 },
  "configSummary": "S3 Standard storage (100 GB per month)"
}
```

### User groups

Groups are a map keyed by `<name-without-spaces>-<uuid>`:

```json
{
  "groups": {
    "Prod-89009454-476a-43a5-8f1e-06bea313a118": {
      "name": "Prod",
      "services": { "<serviceCode>-<uuid>": { "...": "service object" } },
      "groups": {},
      "groupSubtotal": { "monthly": 0 },
      "totalCost": { "monthly": 0, "upfront": 0 }
    }
  },
  "services": {}
}
```

Groups nest through `groups.groups`. The UI renders them and computes subtotals.

### Support

Observed payload:

```json
{
  "support": {
    "calculationComponents": {
      "selectedContract": null,
      "technicalSupportLevel": { "value": { "id": "self-service" } },
      "technicalSupportResponseTime": { "value": { "id": "none" } },
      "supportPlan": { "value": { "id": "business-support" } },
      "supportSpend": { "value": { "id": "", "plan": "" } }
    },
    "description": "",
    "supportTitle": "Business Support+"
  }
}
```

Support plans and tiers come from `FrontEndUI.json` at
`CONTENT.ADD_SUPPORT_PAGE.CONTENT.pricingData`:

- `basic-support`: min 0, 0 percent
- `business-support`: min 29; 9/7/5/3 percent tiers
- `enterprise-support`: min 5000; 10/7/5/3 percent tiers
- `unified-operations`: min 50000; 10/6/5 percent tiers
- `volume-discount` may apply in some partitions

Business Support+ on a 1.53 USD estimate produced 30.53 USD on the shared page, so support is added to the total at render time.

## 5. Publish API

`POST https://dnd5zrqcec4or.cloudfront.net/Prod/v2/saveAs`

Headers: `Content-Type: application/json`. No auth, CORS `*`.

Response:

```json
{"statusCode":201,"body":"{\"message\":\"The file name is ...\",\"savedKey\":\"...\"}","isBase64Encoded":false,"headers":{...}}
```

Public URL: `https://calculator.aws/#/estimate?id=<savedKey>`.

Links expire after 1 year per the share modal. Re-publishing creates a new key.

## 6. Verified accuracy slice

S3 Standard, us-east-2, 100 GB/month:

- Definition tier 1: 0 to 51,200 GB, metered unit `Standard Storage First 50 TB per GB Mo`
- Pricing: 0.023 USD per GB in US East (Ohio)
- Computed: 100 * 0.023 = 2.30
- UI: monthly 2.30 USD, total 12 months 27.60 USD
- Saved JSON: `serviceCost.monthly = 2.3`

## 7. Open questions

- Exact `configSummary` formatting for every component type (uses `configSummaryString`, `displayInConfigSummary`, options, units).
- Bespoke math and display modules for EC2 enhancement, Windows/SQL workloads, RDS custom, and MediaLive/MediaConnect.
- Rounding and intermediate precision rules for every cost type (monthly, upfront, multi-year).
- Whether `Update estimate` recomputes service costs from components and how it handles foreign/edited estimates.
- Bulk import CSV schema and whether it is worth mirroring.
- Locale/currency scope: the public site exposes 11 languages, but observed currency paths are USD only.
- Terms of service for programmatic publishing through the public save endpoint; add rate limiting and a user-agent.

## 8. Reproduction

```sh
# catalog
curl -s --compressed https://d1qsjq9pzbk1k6.cloudfront.net/manifest/en_US.json | jq '.awsServices | length'

# region availability
curl -s --compressed https://d1qsjq9pzbk1k6.cloudfront.net/manifest/regionList/publish.json | jq '."amazonS3Standard"'

# one service definition
curl -s --compressed https://d1qsjq9pzbk1k6.cloudfront.net/data/amazonS3Standard/en_US.json | jq '.mappingDefinitions'

# pricing
curl -s --compressed 'https://calculator.aws/pricing/2.0/meteredUnitMaps/s3/USD/current/s3-standard.json' \
  | jq '.regions["US East (Ohio)"]["Standard Storage First 50 TB per GB Mo"]'

# publish
curl -s -X POST https://dnd5zrqcec4or.cloudfront.net/Prod/v2/saveAs \
  -H 'Content-Type: application/json' \
  --data-binary @estimate.json

# retrieve
curl -s https://d3knqfixx3sbls.cloudfront.net/<savedKey>
```

## 9. Data transfer (`dataTransferV2`) pricing

Observed on 2026-11-23 in us-east-2 (US East (Ohio)), S3 data transfer and the
standalone Data Transfer service.

- Rows are saved as `{value: [{entryType, value, unit, fromRegion|toRegion}]}`
  with `entryType` in `INBOUND`, `OUTBOUND`, `INTRA_REGION`. A fresh row's unit is
  `tb_month`; `gb_month` is the other option. The live UI stores an untouched row
  for every declared type (see the EC2 and S3 payloads in `analysis/`).
- Pricing comes from `datatransfer-calc.json`. Its regional map mixes meter
  labels like `DataTransfer External Outbound Next 10 TB` (tiered) and
  `DataTransfer InterRegion Outbound to <Region>` (flat) plus legacy keys keyed
  by usage type, which the live converter skips.
- The live pipeline (`processPrices` / `calculateTransferBlockPrice`):
  groups meters per destination, derives the region-wide most common tier group,
  keeps the differing groups as destination overrides, and bills a row against
  its destination group (or the common group). `INTRA_REGION` bills twice.
- Every matching meter for one destination is summed. US East (N. Virginia)
  therefore costs `1024 * (0.01 + 0.015) = 25.60` per TB because both the
  inter-region meter and the multipath-resilience meter apply.
- Observed live recomputations in the editor for us-east-2:
  - External 1 TB outbound: 92.16 (`1024 * 0.09`)
  - External 200 GB outbound: 18.00
  - Intra-region 1 GB: 0.02 (`1 * 0.01 * 2`)
  - Inbound External 1 TB: 0.00
  - US East (N. Virginia) 1 TB: 25.60
  - Outbound with a value but no destination: 0.00 with no error. The native
    engine fails closed instead of publishing a zero.
- The config summary is `DT <Inbound|Outbound|Intra-Region>: [<region> ](<n> <unit>)`
  in `INBOUND, OUTBOUND, INTRA_REGION` order, with `External` labelled `Internet`,
  `External-5G-Carrier` labelled `Carrier`, `other` labelled `All other regions`,
  and unselected rows labelled `Not selected`.
- Rehydration gap: the read-only share page drops `dataTransferV2` rows (a
  foreign-source estimate renders 0), while clicking "Update estimate" opens the
  editor, rehydrates the saved rows, and computes the values above. The editor
  recomputation is therefore the live oracle for data transfer receipts.

Reproduce:

```sh
curl -s --compressed \
  'https://calculator.aws/pricing/2.0/meteredUnitMaps/datatransfer/USD/current/datatransfer-calc.json' \
  | jq '.regions["US East (Ohio)"] | with_entries(select(.key | test("Outbound")))'
```

## 10. `columnFormIPM` (PLC_2.0 instance and storage tables)

Observed on 2026-11-23 with `amazonDynamoDbDaxClusters` in us-east-2.

- The saved component value is a list of rows: `{value: [{"<selectorId>":
  {"value": "<string>"}}]}`. Each row holds only the component's own selectors;
  derived tags (vCPU, memory) stay in the component tree.
- A component points at a PLC_2.0 mapping (`mappingDefinitionVersion:
  "PLC_2.0"`) whose `mappingDefinitionURL` ends in `/metadata.json`:
  `pricing/2.0/meteredUnitMaps/<service>/<currency>/current/<source>/metadata.json`.
  Metadata gives `primarySelectors`, `secondarySelectors`, and available
  locations.
- `<base>/primary-selector-aggregations.json` maps selector combinations to
  derived attributes (for example `Instance Type` to `vCPU` and `Memory`).
- `<base>/<primary selector values>/index.json` returns
  `regions[<location>][<metered unit label>]` price records and one `sets` entry
  whose labels are the candidate meters.
- Live math (`oe`): the row count comes from the row with
  `exportValueAs: "count"`, and the pricing model is `Monthly` when a monthly
  price exists, otherwise `Hourly`. Hourly cost is `price * 730 * count`; the
  monthly model adds `hourly * 730 * count + monthly * count`. `calculationId`
  renames the resulting line (`{monthly: "monthly_ipm"}`).
- Observed for DAX: 3 r5.large nodes at 0.255 per hour =
  `0.255 * 730 * 3 = 558.45`, summary `DAX nodes (3), DAX instance type
  (r5.large)`. The share page's recompute probe reproduces both, so the normal
  probe oracle works for column forms.
- Not implemented yet (fail closed): tiered PLC_2.0 patterns,
  reserved/savings-plan models, utilization rows, dependent selectors,
  aggregation remaps, `disableCalculation` components, sub-components, and
  repeatable card rows.

Reproduce:

```sh
curl -s --compressed \
  'https://calculator.aws/pricing/2.0/meteredUnitMaps/dax/USD/current/dax-instances-calc/metadata.json'
curl -s --compressed \
  'https://calculator.aws/pricing/2.0/meteredUnitMaps/dax/USD/current/dax-instances-calc/primary-selector-aggregations.json'
curl -s --compressed \
  'https://calculator.aws/pricing/2.0/meteredUnitMaps/dax/USD/current/dax-instances-calc/US%20East%20(Ohio)/r5.large/2/16/index.json'
```

## 11. PLC_2.0 selector patterns, ElastiCache, and throughput

Observed on 2026-11-24 while building the BINUS eDesk migration estimate in
Asia Pacific (Jakarta).

- `pricingUnitModel.riPricingTypes` arrays are **selector patterns**, not price
  tiers. Each entry is matched field by field against the price record (for
  example `{TermType: "OnDemand", PurchaseOption: ""}`), and the first match
  names the price field (default `price`, override with
  `$overridePriceKeyWith`). Types with no matching pattern (upfront on an
  On-Demand row) stay 0. `additionalPricingData` carries Database Savings Plans
  pricing and is not needed for On-Demand or Reserved.
- RDS for PostgreSQL `rds-postgresql-calc`:
  - Metadata primary selectors: `Location, Deployment Option, Instance Type,
    vCPU, Memory, TermType`; the index path for db.r7g.xlarge/Single-AZ in
    Jakarta is `.../Asia Pacific (Jakarta)/Single-AZ/db.r7g.xlarge/4/32 GiB/OnDemand/index.json`.
  - Price record: `price 0.574`, `TermType OnDemand`, `PurchaseOption ""`.
  - Storage meters are concatenated with **no separator**:
    `Database Storage Single AZ General Purpose-GP3` (500 GB * 0.138 = 69.00).
  - `DatabaseInsightsSelected` defaults to Yes and adds 18.25; set it to "0".
  - Result: `db.r7g.xlarge` + 500 GB gp3 = 488.02/month.
- ElastiCache:
  - The serverless `columnFormIPM_dsp` uses `disableCalculation: true`: it
    exposes the hourly rate through `calculationId` for the surrounding maths
    and adds no subtotal itself.
  - The data tiering metadata has no Jakarta location, so its component must
    not be pre-fetched for this region.
  - Valkey `cache.t4g.micro`, one node, On-Demand = 14.02/month.
- `throughput` inputs convert with binary multiples between kbps, mbps, and
  gbps and output MBps. gp3 defaults to 125 MBps.
- `concatenate` operands join with an empty separator and support `constant`
  operands. Joining with a space produced meter names that do not exist.

Reproduce:

```sh
curl -s --compressed \
  'https://calculator.aws/pricing/2.0/meteredUnitMaps/rds/USD/current/rds-postgresql-calc/primary-selector-aggregations.json' \
  | jq '.aggregations[] | select(.selectors.Location=="Asia Pacific (Jakarta)" and .selectors["Instance Type"]=="db.r7g.xlarge")'
curl -s --compressed \
  'https://calculator.aws/pricing/2.0/meteredUnitMaps/rds/USD/current/rds-postgresql-calc/Asia%20Pacific%20(Jakarta)/Single-AZ/db.r7g.xlarge/4/32%20GiB/OnDemand/index.json'
```

## 12. BINUS eDesk migration estimate (external deliverable)

Final public link (generated on 2026-11-24 by publishing the component payload,
clicking "Update estimate", then "Share" in the calculator editor):

`https://calculator.aws/#/estimate?id=80c119fedeab83ca5fa8a7da79dad61d77c93374`

- Two groups: Production 1,429.13 and Non-production (DEV/UAT) 762.50; total
  2,191.63/month (26,299.56/year). 16 and 14 services.
- The page reloads as a normal read-only estimate with no status column. The
  editor view after Update lists the recomputed rows (the "Cost updated" labels
  are an editor artifact and are not stored in the shared link).
- The stored service costs are the calculator's recomputation. Relative to the
  assessment's Section 7 line items the live Jakarta rates differ for: NAT
  (48.97 vs 48.00), MSK (98.79/93.99 vs 91.59/89.19), SES (16.00/1.60 vs
  10.00/2.00), CloudWatch Logs (73.97/11.05 vs 76.65/12.00), Application
  Signals (28.71 vs 29.00), CloudWatch metrics/alarms (4.00 vs 9.00), and data
  transfer (13.20/1.98 vs 12.00/2.00). EKS, EC2, EBS, ALB, RDS, ElastiCache,
  S3, and Secrets match the assessment.
- Custom line text goes in the `description` field, not `configSummary`. The
  calculator recomputes `configSummary` from components on Update; the
  description survives and renders in the Description column.
- `fileSize` inputs must be saved as `<size>|<frequency>` (`gb|NA`,
  `gb|month`, `gb|hour`). A bare `gb` renders as "(100 undefined)" in the
  recomputed summary and the input is ignored (EBS/RDS/MSK storage showed 0).
  The engine now normalizes bare size overrides to the component's default
  frequency before saving.
- EC2 read-only cause: the captured EC2 payload carried components from an
  older template (`dataTransferForEC2`, `detailedMonitoringCheckbox`,
  `ec2AdvancedPricingMetrics`) and an invalid On-Demand pricing strategy
  (`model: "ondemand"`). Rebuilding it with the current template inputs and
  `{selectedOption: "on-demand", term: "1 year", utilizationValue: "100",
  utilizationUnit: "%Utilized/Month"}` makes it editable and it recomputes
  `3 x m6i.large = 262.80` (and `2 x m6i.large = 175.20`).
- The pre-Share payload is reproducible with `binus-edesk-q/make-aws-estimate.ts`
  (link `f957a0d8...`); the shared link above is the authoritative result.

## 13. `columnFormIPM` row cardinality: one row per component (2026-11-24)

The coverage tracker used to assume every column form was "repeatable" and therefore partial.
The live calculator says otherwise. Evidence is in `receipts/column-form-rows-probe.json`,
which records the bundle path, the live links, and the DOM values.

- The bundle (`analysis/bundle.js`, sha256 `adbd5f41...`, identical to the live
  `https://calculator.aws/42c3e45d-da28-4f7f-9043-598b787291c1/static/js/bundle.js`) module
  `712` exports one function, `ae`, the column form recompute:
  `const {..}=r, h=n[0], m={}; for (const p in h) {..}`. Everything after it - prices,
  `configSummaryString: ee(h,u)`, `initialState: {value: h}` - is built from `n[0]`.
- The save converter writes `{value: [...rows]}` (`Mn.convertToSaveFormat`), but the
  convert-from-save path (`ge`) and the recompute path (`ae`) both read `value[0]`. The
  SaveAndShare module (which the "Update estimate" button calls) imports `a=r(712)` and
  calls `Object(a.b)(...value...)`, so the editor recompute is that same function.
- The component UI renders one control per row definition (`createRows` keys `state.rows`
  by `row.selectorId`); it has no add or remove row control.
- Live check, DAX: a saved payload with two rows (`r5.large x3`, `r5.xlarge x1`) keeps both
  rows in storage, and the editor recompute shows `558.45 USD` (row 0) with summary
  `DAX nodes (3), DAX instance type (r5.large)`, not the `930.75` sum.
- Live check, CodeBuild: two rows (`arm1.2xlarge`, `arm1.large`) recompute to `9.00`; reversing
  the array recomputes to `1.50`. The behaviour is positional row 0, not a sum or a max.
- A real user's multi-row configuration: an estimate created through the live UI
  (`axi-e2e ui-made rows probe`) stores two CodeBuild configurations as two services with
  distinct `awsCodeBuild-<uuid>` ids, each with its own `columnFormIPM` value of exactly one
  row. So "several rows" in the live calculator is "several services".
- The data plane has no repeatable cards: `repeatable`/`repeatableInstance` appear in 0 of the
  441 captured definition files, and `aws-calc-axi update --check --definitions` reports 0
  changed definitions against the live site. The bundle's card-level `repeatable`
  (`repeatableCardsFn`, which clones cards and suffixes component ids with an instance id) is a
  different, unused feature.

Consequences:

- The engine keeps failing closed on more than one row per `columnFormIPM`, with an error that
  names this behaviour. Pricing row 0 and silently dropping the rest would publish a number
  whose stored service cost differs from the editor recompute.
- Users express a second configuration as a second service, which is what the live UI does.
- The coverage tracker no longer emits a `repeatable-rows` gap. It also no longer treats a
  column form itself as partial; only the features that still fail closed do (dependent
  selectors, additional pricing data, regex key remaps, reserved/upfront payment models,
  sub-components, unsupported row types).
- While proving this, two engine gaps surfaced and were fixed: `displayIf` gating for column
  form prefetch (every CodeBuild compute type card used to demand the selected card's
  selectors), and count exports with a suffix (`countDT`, `count_1`, ...), which the live
  engine prefix-matches.

## 14. Dependent selectors in `columnFormIPM`

Observed on 2026-11-24 against `analysis/bundle.js` (sha256 `adbd5f41...`, the live
`.../static/js/bundle.js`), the live definitions, and the live UI in us-east-2. Bundle offsets
below are byte offsets into `analysis/bundle.js`.

### 14.1 What the declaration means

A row may declare `dependent: "<parent selectorId>"` (or an array of parents). The parent is
always an earlier row in the same component. Examples:

| Service | Component | Child | Parent |
| --- | --- | --- | --- |
| Amazon FSx for Lustre | `columnFormIPM` | `Cache Type` | `Storage type` (the primary key) |
| Amazon ElastiCache | `columnFormIPM` | `PurchaseOption` | `LeaseContractLength` |
| Amazon OpenSearch Service | `columnFormIPM_1/2` | `LeaseContractLength` | `PurchaseOption` |
| Amazon Redshift | `columnFormIPM` | `LeaseContractLength` | `PurchaseOption` |

`dependent` is not a visibility flag. It gates the **option set** of the child.

### 14.2 Where a selector's options come from

Two sources, both fetched per component (`getData`, offset 1471365):

1. **Aggregation rows.** The live engine fetches
   `.../{mapping}/{location}/primary-selector-aggregations.json` - one file per region - and
   builds the component tree from the rows of the selected primary value (`h`, offset 1467325;
   option insert `d`, offset 1466859):

   ```js
   for (const {selectors:f} of aggregations) {
     if (r[primary] !== f[primary]) continue;
     for (const id of secondaryKey) {
       // no dependent: tree[id][f[id]] = null
       // dependent:    tree[id][f[parent]][f[id]] = null
     }
   }
   ```

2. **Price records.** A selector that is *absent* from the aggregation row (`!(id in selectors)`)
   is marked, and after the loop its tree is rebuilt from the regional price records of
   `index.json` (`if (0 !== u.length)` block, offsets 1467700-1468300):

   ```js
   for (const meter in regionPrices) tree[id] = nest(record[parent] ...) [record[id]] = null;
   tree[id] = sortKeysAscending(tree[id]);
   ```

   This is why `Term` and `Purchase option` exist only for Reserved: On-Demand records carry
   `LeaseContractLength: ""` and `PurchaseOption: ""`, so the rebuilt tree is empty and the live
   form *deletes* those rows from the component state (`getValue`, offset 2882623:
   `return void delete r[selectorId]`).

`remap.keyValue` is applied **forward** to both sources before the tree is built
(remap helpers at offset 1227218: `b` for aggregation rows, `o` for records,
`d = (e,t) => t.keyValue[e] || e`), so the tree and the saved values hold the label the form
shows (`1000 MBps/TiB`, `No Cache`). The index path and the price-set tokens map the other way
(`u`, offset 1466571: `for (const r in remap.keyValue) if (remap.keyValue[r] === t) { t = r; break }`).
Regex-looking keys (`"/1\\s?yr/"`) are inert literal keys in that plain lookup; they never match
a value, so they change nothing.

### 14.3 Value selection, cascade, and the "no default" rule

`getInitialValue` (offset 2881852) runs per row, in definition order, against the parent-narrowed
option set (`getValue`). For a dropdown:

```js
const options = Object.keys(narrowedOptions);
o === "" || !options.includes(o)
  ? (defaultValue && options.includes(defaultValue) ? defaultValue : options[0])
  : o
```

So: keep the current value when the parent still offers it; otherwise fall back to the row's
`defaultValue` when that is offered, otherwise to the **first offered value**. If the parent
narrows the set to nothing, the row is dropped from the component state.

`createRows` (offset 2880258) mutates the value map in place during that loop, so each row sees
the parent's value already resolved in the same pass - the cascade is definition-order, not a
second render. `generateRowkey` (offset 2883449) prefixes the React key with the parent value
(`Cache Type_HDD`) purely to force a remount.

Live observations (us-east-2, `window` values read from the DOM):

| Probe | Live result |
| --- | --- |
| ElastiCache, Pricing model OnDemand | Rows: Nodes, Instance, Utilization, Cache Engine, Cache Node Type, Pricing model. **No** Term, **no** Purchase option |
| ElastiCache, Pricing model Reserved | Term `1yr`, Purchase option `All Upfront` appear |
| OpenSearch, Reserved + All Upfront | Term options `[1yr, 3yr]`, `1yr` selected |
| OpenSearch, Reserved + No Upfront | Term options `[3yr, 1yr]` - a different set *and* order; `1yr` kept because it is still offered |
| FSx Lustre, Storage type SSD (default) | Cache Type `No Cache` (only option), Throughput `1000 MBps/TiB` |
| FSx Lustre, Storage type HDD | Cache Type gains `SSD cache`, Throughput becomes `12 MBps/TiB` |
| FSx Lustre, HDD + `SSD cache`, then switch to SSD | Cache Type resets to `No Cache`, Throughput to `1000 MBps/TiB` |

The FSx defaults are the proof of the "first offered value" rule: the definition default is
`50 MBps/TiB`, which no price row carries, so the form selects `1000 MBps/TiB` and the value it
saves is that label. The `[3yr, 1yr]` order under No Upfront is the price-record order below the
sorted top level; the sorted top level is what `p` (offset 1467128) produces for record-backed
selectors only, and it is why `Purchase option` always lists
`[All Upfront, No Upfront, Partial Upfront]`.

### 14.4 What the saved component holds

`{value: [{selectorId: {value: "<label>"}}]}` with exactly the rows the form rendered, in
definition order, including auto-selected values, and with dropped selectors absent. Two
consequences matter for publishing:

- An On-Demand ElastiCache component must **not** carry `LeaseContractLength`/`PurchaseOption`;
  the editor's rehydration (`getState`, `ae`, offset 2889182) feeds the saved values straight into
  `getData`, and a value for a dropped selector has no tree to walk.
- `ae` throws `Best Match produced invalid options` when the saved values do not match an
  aggregation row (`bestMatchFound` from `c`, offset 1464080), so the published selector state has
  to be one the aggregation file carries exactly (for the values it supplies).

### 14.5 Price set token selection

`y` (offset 1468802) builds one token per selector, then filters the price set labels
(`e.filter`) with `String.match`, so tokens are regular expressions:

- token = the value; a selector with `dependent` walks `[parent..., selectorId]` through the
  option tree (`b`, offset 1468691) and returns the last path element, falling back to the first
  key where the path breaks;
- `remap.keyValue` maps a label back to its key;
- if a token equals a key of `pricingUnitModel.riPaymentOptions`, its unit (`Hrs`, `Quantity`, or
  `(Quantity|Hrs)`) is added as an extra token - this is what separates an `All Upfront`
  `Quantity` record from the `Hrs` record of the same term;
- the service id `es` (and `directconnect`) also matches after commas are stripped from the label
  (`m`, offset 1468327), which is why `r5.2xlarge.search` matches `r5 2xlarge.search ...`;
- a price set with exactly one metered unit is returned unfiltered (`1 === e.length`).

`w` (offset 1470103) then prices each type in `riPricingTypes` against every matching metered
unit, last match wins, so `Partial Upfront` can take its hourly rate from the `Hrs` record and its
upfront from the `Quantity` record.

### 14.6 Cost model

`re` (offset 2887824) picks the model from the row whose `exportValueAs` starts with
`pricingModel` via its `mappingValue`, falling back to `Monthly` when a monthly price exists and
`Hourly` otherwise. `U` (offset 2873279) is the `Reserved` model:
`monthly = hourly * 730 * count`, `upfront = upfront * count`. `G` is `Hourly`,
`V` is `Monthly` (`hourly * 730 * count + monthly * count`), `z` is Savings Plans.

### 14.7 Engine state after this section

`src/engine/column-form.ts` now reproduces 14.2-14.6: option tree per region, forward remap,
record-backed selectors, definition-order resolution with the first-offered default, drop,
reverse remap for tokens and for the index path, `riPaymentOptions` units, the `es` comma rule,
per-meter pattern pricing, the four cost models, and the upfront total.
`src/engine/column-form-loader.ts` resolves the values before it fetches, iterates until they
settle (a resolved value can be an index-path selector), and refuses a component whose selectors
only best-match an aggregation row.

Receipt: `receipts/p1-dependent-selectors.json`
(`https://calculator.aws/#/estimate?id=b03c7fc75c828c53cb388b87aa8dae6f421e2153`).
Editor recompute pass, mismatches `[]`: ElastiCache 0.00 monthly + 3,482.00 upfront,
OpenSearch 748.98, Redshift 3,331.72, total 4,080.70 + 3,482.00 upfront, annual 52,450.40.

### 14.8 Which services are genuinely blocked by this

The static tracker listed `dependent-selectors` for 36 services (14 of them P1). That count is
right about the *presence* of the declaration, but it is not the same as "blocked by dependent
selectors":

- **Genuinely gated by a parent in the data:** Amazon FSx for Lustre (`Cache Type` under
  `Storage type`). This is the only one of the four targets where the parent/child pair exists in
  the aggregation file, so the option set really differs per parent.
- **Record-derived pairs** (ElastiCache, OpenSearch, Redshift, and the RDS family): the pair is
  declared in the definition but absent from the aggregation, so the options come from the
  Reserved price records. Without the record-backed branch the rows never render at all, which is
  why these services failed: the engine either demanded values nobody could supply, or matched
  no/ambiguous price sets.
- **Not a dependency at all:** `awsDeadlineCloud` and `awsDirectConnect` carry the label but their
  real blocker is `input:utilization`; 24 of the 36 also still need `additional-pricing-data`
  (Database Savings Plans), `regex-remap`, or `remap.constant`.

While proving this, one further engine bug surfaced inside the same mechanism and was fixed:
`remap.keyValue` was applied in the wrong direction for price-set tokens, so a service such as
`realTimeDocumentTranslation` (`{"Basic": "Basic - Text, HTML"}`) looked for the label instead of
the key.

### 14.9 Still blocked, outside this worktree's ownership

- `FSx for Lustre` resolves its dependent selectors correctly and then fails in
  `src/engine/template.ts`: the `replace` pricing subtype is implemented as an exact-match
  lookup, while the live one is a global regex replacement of `originalString` inside the value
  (`.../bundle.js` offset 2844449, `e.replace(new RegExp(escape(r), "g"), n)`). FSx builds
  `persThrouput = replace(concatenate(ThroughputCapacity, " test"), " test" -> "")`, so it needs
  the substring behaviour.
- `utilization` rows that carry a `selectorId`, `remap.constant`, `additionalPricingData` joins,
  `subComponentsList`, `exportTagsAsValue`, multiple price sets, and tiered PLC_2.0 patterns
  (`StartingRange`/`EndingRange`) remain fail-closed.
