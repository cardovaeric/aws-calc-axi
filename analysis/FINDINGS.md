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
  selectors, additional pricing data, reserved/upfront payment models, sub-components,
  unsupported row types). `regex-remap` was in that list and is retired; see section 15.
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
  (Database Savings Plans) or `remap.constant`. The `regex-remap` gap this section counted was
  retired in section 15: the remap is a plain lookup on both sides.

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

## 15. Selector children are real gaps; two WorkSpaces children do not exist (2026-11-24)

The tracker scored `subServiceSelector` rows "by their children" and the six P1 services it
blocked with `Resolve the non-clean children` needed a verdict. Evidence, live links, and the
exact bundle lines are in `receipts/selector-children-probe.json`.

### What the rule did

`selector_children` counted the codes in the selector definition's `templates`. A child was
non-clean when its own row's `static_class` was not `clean`, and a child with no row at all was
scored `missing-definition`. The parent then collapsed every blocked child to
`blocked:column-form`, kept its own `missing_subtypes`/`hard_blockers`/`deep_gaps` empty, and got
the constant action `Resolve the non-clean children`.

### What the live calculator does

A selector is a menu of child services. The parent has no form and no price; the user configures
exactly one child, and the parent's runtime columns are the evaluation of its `defaultTemplates`
children. And the menu is built from the live service list, so a declared child that the manifest
does not define is never offered at all.

### The six services, child by child

| Service | Non-clean children | Cause | Verdict |
| --- | --- | --- | --- |
| amazonChimeSdk | ptsnAudio, sipTrunking | `remap.constant` | real gap |
| amazonEMR | amazonEmrMasterNode, amazonEmrCoreNode, amazonEmrTaskNode | `utilization` row | real gap |
| amazonMainframeModernization | mainframeBluAge, mainframeMicroFocus | `input:utilization` + `remap.constant` | real gap |
| amazonWorkSpaces | amazonWorkspaces, workSpacesCore, workSpacesInstances, workSpacesPools | utilization row, dependent selectors, upfront totals | real gap, and 2 phantom children |
| awsElementalMediaLive | mediaLiveInput1, mediaLiveOutput1, mediaLiveAudioAddOns | dependent selectors | real gap |
| elementalMediaConvert | outputConfiguration1, outputConfiguration2 | dependent selectors (+ remap direction) | real gap |

- **Chime SDK.** ptsnAudio has five column forms whose primary key (`NumberType` or `CallType`)
  has no row: the value can only come from `remap.constant`. Supplying it in the spec is rejected
  (`INVALID_SPEC`, valid selectors: `FromCountry`), and the engine throws `UNSUPPORTED_INPUT` for
  `remap.constant` before pricing. The live engine filters candidate price rows by the constant
  and drops that selector from the label match (bundle offsets 1464986 and 1469061).
- **EMR.** Each node child has a column-form row of type `utilization` with a `selectorId`.
  `columnFormIPM "masterNode_generated_0" has a "utilization" row, which is not implemented yet`.
  The live component exports the row's object value as hours (`{const{totalHour:e}=...}`, offset
  2890391), so it is a pricing input.
- **Mainframe Modernization.** Both children use the `utilization` input subtype (the
  `w1-utilization` branch implements it) and both also carry a component-level
  `remap.constant`, so they stay blocked after that lands. The parent now reports
  `blocked:subtype` in `Phase 5 - long tail` instead of claiming a column-form block.
- **WorkSpaces.** The Personal/Core children have a utilization "Billing option" row (default
  `{unit:"730",selectedId:"Monthly"}`) and dependent selectors; workSpacesPools has dependent
  selectors only. The parent fails closed with `Running Mode: "[object Object]"`, because a
  utilization row's object value is stringified before matching.
- **MediaLive.** Pipeline, Resolution, Bit Rate, Video Quality, Frame Rate and Reserve Type are
  dependent rows with no default on most cards. `mediaLiveInput1` prices at defaults (7.30) and
  `mediaLiveAnywhereChannel` is clean, but the default child pair includes `mediaLiveOutput1`,
  which fails closed.
- **MediaConvert.** The live UI resolves the dependent rows to Single pass / 4K / <=30fps / 4 and
  prices 1000 hours at 1,492.00: `60,000 basic minutes x 4 normalization ratio = 240,000
  normalized minutes`, then 100,000 x 0.0075 + 140,000 x 0.0053. This engine skips the empty
  dependent values and matches nothing.

### The one artifact: Amazon WorkSpaces declares two children that do not exist

The live `amazonWorkSpaces` manifest entry lists six `templates`, but the manifest has no service
entry for `workSpacesThinClient` or `workSpacesSecureBrowser`, and
`https://d1qsjq9pzbk1k6.cloudfront.net/data/workSpacesThinClient/en_US.json` answers **403**.
`https://calculator.aws/#/createCalculator/WorkSpaces` offers exactly four children (Personal,
Core Bundles, Core Managed Instances, and a disabled Pools) and no Thin Client or Secure Browser.
So those two are dangling references in the live data plane: there is no surface to cover, and
scoring them `missing-definition` made the parent count two phantom blockers.

### The rule now

- A selector's class is the union of its **served** children, using the same precedence a single
  service uses (`blocked:subtype` > `blocked:column-form` > `partial:column-form` > `clean`). A
  parent whose children are blocked by a missing input subtype no longer claims a column-form gap.
- A declared child with no manifest entry is `selector_unserved`: recorded in its own column,
  never scored as non-clean, and never hidden. If every declared child is unserved the parent is
  `no-surface`, which is what the calculator shows.
- `selector_blockers` names each blocker and the children that carry it
  (`utilization-selector (amazonEmrMasterNode, amazonEmrCoreNode, amazonEmrTaskNode)`), the
  parent's `missing_subtypes`/`hard_blockers`/`deep_gaps` carry the union, and `next_action`
  repeats the concrete child actions. `Resolve the non-clean children` is gone from the tracker.
- Worked example, Amazon WorkSpaces: `selector_children=6`, `selector_nonclean` is the four real
  children, `selector_unserved=workSpacesThinClient;workSpacesSecureBrowser`.

Coverage delta from `main` at the time of the selector rule (`blocked:subtype` 9, `clean` 399,
`partial:column-form` 16, `blocked:column-form` 17, P1 14, P2 139): `blocked:subtype` 10 (Amazon
Mainframe Modernization reclassified), `blocked:column-form` 16 after the two WorkSpaces children
stopped being scored, `clean` and `partial` unchanged, P1 unchanged. No service became clean by
dropping an unserved child, and the two unserved children are listed on the Amazon WorkSpaces row.
The remap re-test below adds a second blocked service and its parent, which is where the final
numbers in the last subsection come from.

### Second finding: the direction was fixed; the primary selector still keeps its token

The first version of this section recorded that `src/engine/column-form.ts` looked up
`remap[uiValue]` while the live engine maps the other way. That is fixed (w3, `bf27e34`):
`src/data/column-form.ts` applies `remapValue` **forward** to the aggregation rows and the price
records and `reverseRemapValue` to the meter tokens and the index path, which is exactly live `b`,
`o` and `u` (offsets 1227218, 1466571). The coverage rule proposed here then,
`remap.keyValue-direction`, is **retired**: its premise is gone, and a rule that fires on the
direction would now be flagging services that work.

The symptom it caught was real, so the section was re-tested against the merged engine
(`80bbda0`, this branch rebased) instead of trusting the earlier note. `realTimeDocumentTranslation`
still cannot price its own default, and the cause is narrower than the direction:

| Probe (us-east-1, offline cache) | Result |
| --- | --- |
| `evaluateService` with defaults | `MISSING_PRICE columnFormIPM selector values {"FileType":"Basic"} do not match a PLC_2.0 aggregation row` |
| same, `--set columnFormIPM={"FileType":"Basic - Text, HTML"}` + 1M characters | 15.00 USD/month, config summary `Document Type (Basic - Text, HTML)` |

The evidence lines up with section 14.2 and 14.3:

- The definition's remap is `{"Basic": "Basic - Text, HTML", "Office": "Office - Docx"}` and its
  single row is `{selectorId: "FileType", defaultValue: "Basic"}` on `primaryKey: "FileType"`.
- `.../translate-document-calc/metadata.json` declares `primarySelectors`
  `["Location", "operation", "FileType"]`, and the aggregation rows carry the **price tokens**
  (`FileType: "Basic"` / `"Office"`), so the form's options are the remapped labels
  (`Basic - Text, HTML`, `Office - Docx`). Live `getInitialValue` keeps a default only when the
  option set offers it, otherwise takes the first offered value (section 14.3), so the live form
  saves the label.
- `resolveColumnFormSelectors` in `src/engine/column-form.ts` keeps the **primary** selector's
  value verbatim and only resolves every other row through the narrowed option tree. The raw token
  `Basic` therefore survives into the value map while every aggregation row has been remapped to
  the label, and no row can match.

The tracker names that cause with a static, offline rule instead of trusting the clean label:
`remap.keyValue-primary` (`primaryRemapToken` in `scripts/coverage-column-form.ts`, unit tested).
It fires when the primary selector's declared default is a `remap.keyValue` key that maps to a
different label, which is one definition today, `realTimeDocumentTranslation`. It moves to
`blocked:column-form` with `Implement column-form remap.keyValue-primary`, and Amazon Translate,
which offers it as a child, moves from `clean`/P2 to `blocked:column-form`/P1 and names the child.
The mirror state from the first version (the default is already the label, so 14.3 keeps it) is
**not** a defect now that the direction is right; those six definitions' remaining failures have
other causes (`amazonFSxForLustre` is the `replace` boundary in 14.9).

`amazonGameLiftStreams`, the open question in the first version, is **closed: it prices**.
There is no remap; its primary selector is composite (`{"Stream Class": ["VCPU", "VRAM", "RAM"]}`)
and one supplied value could not fill the index path before the merge. The aggregation row now
supplies the rest, and the numbers match the price data:

| Evidence | Value |
| --- | --- |
| aggregation row (us-east-1) | `Product Family: Compute Instance, Stream Class: gen5n_ultra, Reservation Class: OnDemand, VCPU: 8, VRAM: 24, RAM: 32` |
| index record at that path | `price: "1.4544000000"` |
| engine, 100 users x 2 hours/day | 8,726.40 USD/month = 100 x 2 x 30 x 1.4544 |

### Tracker honesty fixes from the re-test

Two reporting defects came out of the same pass:

- `regex-remap` is retired. D-027 already recorded that the live forward remap is a plain object
  lookup, so `"/1\\s?yr/"` is an inert literal key on both sides, and the only regex use is the
  reversed key as a price-set token, which `columnFormMeterFragments` and `filterColumnFormMeters`
  do too (`bundle` offsets 1466571 and 1468802). There was never a fail-closed path behind the
  label, and it never classified a row on its own: all 13 definitions that carry one also carry
  `additional-pricing-data`. Tests: `remapValue`/`reverseRemapValue` parity and the reversed
  regex-shaped token in `tests/column-form.test.ts`.
- The runtime pass reported `error` for `MissingPriceError`, because that class is not an
  `EngineError`. `runtimeLabel` in `scripts/coverage-runtime.ts` now maps it to `missing-price`
  and gives an uncached offline fetch its own `not-cached` bucket (unit tested). That is why 27
  us-east-1 and 66 us-east-2 rows changed label without changing class, and why the generic
  `error` bucket is now one row per region (`amazonLookoutForEquipment`, below) plus `awsBackup`
  (`not-cached`).

Two defects are left alone because they live in other workers' files, not in the tracker:

- `resolveColumnFormSelectors` (above): the primary selector needs the same 14.3 resolution every
  other row gets. `src/engine/column-form.ts` belongs to the column-form worker.
- `amazonLookoutForEquipment` is statically clean and throws `VALIDATION_ERROR` at defaults: its
  `fileSize` component declares `defaultOption: {size: "gb", frequency: "month"}`, but
  `src/engine/inputs.ts` only accepts a frequency from `dropDownFrequency` or `outputFrequency`
  (`allowsFrequency = frequencyOptions.length > 0 || outputFrequency !== "NA"`), and this component
  declares neither. The live form shows "GB per month".

Coverage delta from `main` after the re-test (P1 14, `clean` 399, `partial:column-form` 16,
`blocked:column-form` 17, `blocked:subtype` 9): `clean` 397, `partial:column-form` 16,
`blocked:column-form` 18, `blocked:subtype` 10, P1 15, P2 138. Three services changed class:
`realTimeDocumentTranslation` and Amazon Translate are blocked by the primary-remap rule, and
Amazon Mainframe Modernization is `blocked:subtype` because a missing input subtype outranks a
column-form feature. Nothing became clean.
