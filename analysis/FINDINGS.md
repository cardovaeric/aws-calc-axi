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

- `FSx for Lustre` resolved here rather than in the w3 worktree: `replace` is now the live global
  regex replacement (`.../bundle.js` offset 2844449, `e.replace(new RegExp(escape(r), "g"), n)`),
  and one further gap sat behind it, the live `displayIf` ordering coercion
  (`analysis/FINDINGS.md` section 16.3). It evaluates at `174.32`
  (`receipts/p2-fsx-lustre.json`).
- `remap.constant`, `additionalPricingData` joins, `subComponentsList`, `exportTagsAsValue`,
  multiple price sets, and tiered PLC_2.0 patterns (`StartingRange`/`EndingRange`) remain
  fail-closed. `utilization` rows that carry a `selectorId` are native since section 17.

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
| amazonEMR | amazonEmrMasterNode, amazonEmrCoreNode, amazonEmrTaskNode | `utilization` row | real gap, resolved in section 17 |
| amazonMainframeModernization | mainframeBluAge, mainframeMicroFocus | `input:utilization` + `remap.constant` | real gap |
| amazonWorkSpaces | amazonWorkspaces, workSpacesCore, workSpacesInstances, workSpacesPools | utilization row, dependent selectors, upfront totals | real gap, and 2 phantom children; utilization row resolved in section 17 |
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
## 16. `utilization` inputs (2026-11-24)

Observed in us-east-2 with AWS PCS and AWS Elemental MediaConnect, and in the live
frontend bundle at `https://calculator.aws/<build>/static/js/bundle.js`.

- The subtype's duration list is not in the definition. It is the bundle's
  `DEFAULT_UTILIZATION_OPTIONS` (module 160): `percentagePerMonth` (max 100),
  `hoursPerDay` (24), `hoursPerWeek` (168), `hoursPerMonth` (730),
  `minutesPerDay` (1440), `minutesPerMonth` (43800). The default duration is
  `percentagePerMonth`, the default value is 100, and the validation fallback is
  0..730 (`HOURS_IN_MONTH`).
- `calculateUtilizationValue(value, option, label, roundUpToHours, decimalPlaces)`:
  `hours = (value / option.max) * 730`. With `roundUpToHours` the result is
  `Math.ceil(hours)`; otherwise the float is wrapped in decimal.js and rounded up
  away from zero to `decimalPlaces` (default 4). So 33% is 241 hours with
  `roundUpToHours` and 240.9 without.
- The saved component is `{value: <typed text>, unit: <duration id>}`. The
  editor's `convertToSaveFormat` for utilization is
  `{value: e.value, unit: e.selectedId}` and the redux state keeps
  `initialState.value` as the input's string value.
- The string matters at zero. The rehydrator (`Ne`) treats a value as empty with
  lodash `isEmpty`, which is true for the number 0: a stored `{value: 0}` loses
  its `unit`, the conversion throws, and the live editor drops that component's
  summary. A stored `{value: "0"}` keeps the unit and the
  `(0 % Utilization/Month)` summary. Verified by publishing the same PCS rows
  with numeric and with string values and clicking Update estimate.
- Validations run on the converted hours, not the entry: PCS declares no
  min/max and still rejects more than 730 hours; Deadline Cloud and Direct
  Connect declare 0..730 hours explicitly.
- Config summary is `<label> (<entry> <duration label>)`, for example
  `Flow utilization (730 Hours/Month)` and
  `Length of time cluster is running (100 % Utilization/Month)`, and only when
  `displayInConfigSummary` is true.
- Two neighbouring live behaviors surfaced while making MediaConnect evaluate:
  - `pricingComboV2` reads a composed meter name and falls back to 0 when the
    region's price map has no such meter. MediaConnect's "None" reserved
    bandwidth composes `DataProcessedReserved0Mbps1Yr`, which exists in no
    region; the live editor bills 0.
  - `replace` applies every replacement as a global regex substitution and
    keeps the original string when nothing matches (the `sourceType` default
    "0" has no JPEG replacement).

## 16.1 `percentInput` rehydrates through a second division (2026-11-25)

The live percent input keeps the percent the user typed in state and saves it
verbatim: `Xe.handleInput` holds the raw string, `Je.convertToSaveFormat` writes
`{value: e.value}`, and the rehydrator divides by 100 on the way back in. This
engine used to save the fraction, so a rehydrated 100% read as 1%.

Live check, Amazon Keyspaces in us-east-2 with 1M writes, 1M reads, 100 GB, and
the default percent inputs: the editor recompute of the published estimate
(`receipts/p1-keyspaces.json`, link `17757fae...`) shows
`LOCAL_ONE reads (1)` and `25.69 USD`, matching the native result to the cent.
Saving the fraction produced `LOCAL_ONE reads (0.01)` and `25.63` - the `0.06`
gap recorded in D-026.

While re-verifying this, the P0 run's typed-amount fix turned out to be
required as well: live validates `allowDecimals` on the amount the user typed
and min/max on the converted value, so 1000 operations per day (30416.67 per
month) is a valid integer entry. `assertDecimals` owns the first check.

## 16.2 Region gating and the index path's location selectors (2026-11-25)

Direct Connect was the one `utilization` service left: it stopped before any
pricing at `PLC_2.0 price data is not available in US East (N. Virginia)`.

- The live `getData` gate is
  `Array.isArray(availableLocation) && !availableLocation.includes(location)`
  (bundle offset 1471833). A price map that declares no
  `regionAttributes.Location` is therefore not region-scoped. Direct Connect's
  metadata carries only `regionAttributes["From Location"]` (74 on-prem
  locations) and one 123,111-row aggregation file for every region, so the old
  unconditional `includes()` rejected every region.
- The index path injects the region name for both location selectors right
  before it is built: `h = {...state, Location: regionName, "From Location":
  regionName}` (offset 1466476, `u`). Direct Connect declares `From Location` as
  a primary selector but never puts it in the form, so without the injection the
  path takes whichever location the aggregation file lists first
  (`AWS GovCloud (US)`) and the index has no prices for the region.
- With both, `Direct Connect / US East (N. Virginia) / Dedicated / 10G /
  Equinix LD4 - LD6` resolves ($2.25/port-hour) and 3 rows at 0, 365, and 730
  hours recompute to `2463.75` live and natively
  (`receipts/p2-direct-connect-utilization.json`).

Deadline Cloud needed nothing further: its spaced price-set labels
(`c5 large Linux Compute Instance 4 GiB 2`) resolve through the dependent
selector work, and 3 rows at 0%, 50%, and 100% recompute to `409.08` live and
natively (`receipts/p2-deadline-cloud-utilization.json`).

## 16.3 Two live maths behaviours FSx for Lustre needed (2026-11-25)

- `replace` is a global regex substitution (`e.replace(new RegExp(escape(r),
  "g"), n)`, offset 2844449), not a whole-value lookup. FSx builds
  `persThrouput = replace(concatenate(ThroughputCapacity, " test"), " test" ->
  "")`, so the exact-match version dropped the throughput label entirely.
- A `displayIf` ordering comparison coerces (`s(e,t)` at offset 817504):
  `Number(x)`, and a `NaN` side becomes 0; only two non-numeric strings fall
  back to string comparison. FSx gates
  `persistant_billed_storage_low` on `persistent_generated_4 <= 2400`, but that
  subtraction is declared *later* in the same maths section, so live compares 0
  and takes the 1200 GB round-up branch. This engine returned false for any
  undefined operand, hid all four rounding branches, and billed 0.00.
- With both, 1200 GB SSD at 125 MBps/TiB and 50% compression savings is
  `1200 x (0.145 / 730 rounded to 6dp) x 730 = 174.32`, the live editor's number
  (`receipts/p2-fsx-lustre.json`). The division is rounded up to 6 decimals and
  multiplied back, which is why the total is not the plain `174.00`.

Reproduce:

```sh
curl -s --compressed https://calculator.aws/ | grep -o 'src="[^"]*bundle.js"'
# then, in the bundle: DEFAULT_UTILIZATION_OPTIONS, calculateUtilizationValue,
# convertToSaveFormat, and the rehydrator's Ne() isEmpty guard
```

## 17. Column-form `utilization` rows (2026-11-25)

The P1 `utilization-selector` blocker named eight rows: the three Amazon EMR node
children, WorkSpaces Personal, WorkSpaces Core Bundles, WorkSpaces Core Managed
Instances, and the two selector parents. The premise check found a real gap with
two parts, not a phantom: the row type itself, plus a `singlePricePoint` zero
that WorkSpaces Personal/Core need before they can price at all. Bundle offsets
below are into `analysis/bundle.js` (sha256 `adbd5f41...`, the live
`.../static/js/bundle.js` re-fetched 2026-11-25, same bytes).

### What a column-form utilization row is

A `utilization` row is not a plain selector. Its saved value is an object
`{unit, selectedId}`, where `unit` is the number the user typed and `selectedId`
is the duration label the unit dropdown shows:

```json
"Utilization": { "value": { "unit": "50", "selectedId": "%Utilized/Month" } }
```

That shape is in a live save (`#/estimate?id=a35e2436...`, master node at 50%),
not inferred. Three live functions consume it:

- `L` (the row component, offset 2870678): `createOptions` offers the four
  durations `P` (`%Utilized/Month`, `Hours/Day`, `Hours/Week`, `Hours/Month`) when
  the row is not a pricing selector, and otherwise the keys of the component
  tree node the form resolved for it. `D` (offset 2870901) is the unit a duration
  gets when the form has to reselect it: `%Utilized/Month` 100, `Hours/Day` 24,
  `Hours/Week` 168, `Hours/Month` 730, `Hourly` 160, `Monthly` 730.
  `validateChange` validates the typed unit (not the converted hours) as a whole
  number in `1..max(duration)`.
- `q.a` (module 311, offset 1271617): `hours = unit / duration.max * 730`, except
  `Hours/Month` and `Hourly` where hours are the unit itself, and any other
  `selectedId` (the WorkSpaces `Monthly`) which means a full 730-hour month. It
  does not round - 25% is 182.5 hours.
- `K` (offset 2876200) chooses the price model. `G` (Hourly) is
  `hourly x totalHour x count`; `V` (Monthly) is
  `(hourly x totalHour x count) + monthly x count`, and skips the hourly term
  when the hourly price is 0. So the row replaces the hardcoded 730 in both
  models.

When the row also carries a `selectorId` that the component tree holds, its
`selectedId` is the value the price set matches. WorkSpaces is exactly that:
its `Running Mode` row declares `secondaryKey` membership and
`remap.keyValue {AlwaysOn: "Monthly", AutoStop: "Hourly"}`, so the aggregation
rows (which carry `AlwaysOn`/`AutoStop`) are remapped forward to the row's
labels, and the meter fragments are remapped back to the raw aggregation value.
The saved object and the config summary are built from the value map; live joins
an object value's members with a space, so EMR prints
`Utilization (50 %Utilized/Month)` and WorkSpaces prints nothing because the row
sets `displayInConfigSummary: false`.

### The second real cause: `singlePricePoint` bills 0 for an absent meter

Live `singlePricePoint` (offset 497900) reads the meter from the regional map
and returns `{value: 0}` when the map does not carry it
(`n = a[o] ? a[o] : 0; if (!n) return {value: 0}`). WorkSpaces Personal and
Core both declare `additionalBundleUnitPrice2` on
`Application Bundle Performance Plus License BYOL Windows Office 2019 AlwaysOn`,
a meter no region carries, so the live form bills it at 0 and our engine threw
`no price for metered unit` instead. This engine now returns 0 for an absent
meter in a region whose map loaded, and still fails closed when the mapping
never loaded that region (that is a data gap, not a live zero). Evidence:
`tests/engine-edge.test.ts` keeps the missing-region fail-closed case.

### Verified numbers (us-east-2, live editor recompute)

| Service | Configuration | Live | Native |
| --- | --- | --- | --- |
| EMR master node | m5.xlarge, 1 node, 50% | 17.52 | 17.52 |
| EMR core node | m5.xlarge, 2 nodes, 100% | 70.08 | 70.08 |
| EMR task node | m5.xlarge, 3 nodes, 25% | 26.28 | 26.28 |
| WorkSpaces Personal | 1 space, Monthly | 33.00 | 33.00 |
| WorkSpaces Personal | 1 space, Hourly 160 h | 55.25 | 55.25 |
| WorkSpaces Core | 1 space, Monthly | 29.00 | 29.00 |
| WorkSpaces Core Managed Instances | 1 c5.12xlarge, Monthly | 2,180.33 | 2,180.33 |

The EMR calculation string live prints for the master row is
`1 instance(s) x 0.048 USD hourly x (50 / 100 Utilized/Month) x 730 hours in a
month = 17.5200`, and WorkSpaces Hourly prints
`(1 instance(s) x 7.25 USD monthly) + (1 instance(s) x 0.3 USD hourly x 160
hours in a month) = 55.2500`, which is the hours multiplication in both models.
Receipts: `receipts/p1-utilization-emr.json` (113.88) and
`receipts/p1-utilization-workSpaces.json` (2,297.58), both editor recompute with
zero mismatches, screenshots `receipts/screenshots/utilization-selector-{emr,workspaces}-use2.png`.

### The WorkSpaces phantom check

The premise warning held for the *count*, not for the gaps. `amazonWorkSpaces`
declares six children; `workSpacesThinClient` and `workSpacesSecureBrowser` are
still absent from the manifest and 403, so they remain `selector_unserved` and
cover no surface. The other four children (`amazonWorkspaces`, `workSpacesCore`,
`workSpacesInstances`, `workSpacesPools`) were genuinely blocked; the three that
carried `utilization-selector` price now, and `workSpacesPools` was already
clean. Nothing about the utilization row was inert: at 50% the EMR price halves,
and the WorkSpaces Hourly option changes the model from flat monthly to
hours-based.

### Coverage delta

`npm run coverage -- --evaluate --offline` from `45fd950` (clean 401,
partial:column-form 16, blocked:column-form 21, blocked:subtype 3, P1 10):

- clean 401 -> 409 (+8: three EMR node children, three WorkSpaces children, and
  the two selector parents)
- blocked:column-form 21 -> 13 (-8)
- P1 10 -> 8 (P2 137 -> 139)
- partial:column-form 16 unchanged, blocked:subtype 3 unchanged
- the `utilization-selector` rule is gone from `scripts/coverage.ts`, so no row
  carries a stale label

The `singlePricePoint` zero is wider than WorkSpaces: 27 rows whose runtime used
to read `missing-price` now read `ok` or `needs-input` (Personalize, Polly,
QBusiness, QuickSight, IoT SiteWise, the FSx backup rows, the Bedrock/Titan
rows, and others), because their regional map really does not carry the meter
and live bills 0. No class or priority moved for those rows - they were already
`clean` but could not evaluate their default; the `missing-price` label remains
on 10 us-east-1 and 27 us-east-2 rows whose lookup is still unresolved. The
runtime column is the honest reflection of that.

### Left alone deliberately

Live's value map is seeded with the rows that declare a truthy `defaultValue`
first and then appends the rest, so a natively saved WorkSpaces row and its
config summary list the defaulted rows before `Number of WorkSpaces`. This
engine keeps definition order, which is what the already-published receipts
(ElastiCache, OpenSearch, Redshift) store. Matching live's key order is
cost-neutral and would invalidate those receipts, so it is left for a wave that
can republish them; the editor oracle ignores summary text, and the numbers are
identical either way.
## 18. `additionalPricingData`: the joined Database Savings Plans artifact (2026-11-25)

The tracker used to call this a column-form v2 gap. It is one mechanism, and it
is the Database Savings Plans join: every one of the 16 definitions that carry
the property carries a single cargo item named `Database Savings Plans`, whose
manifest points at `databasesavingsplans` with a `dsp-join-*` source. Nothing
else in the catalog uses it.

- Live `getData` (offset 1466650) builds
  `item: [{name: "default", manifest, pricingUnitModel, remap}, ...additionalPricingData]`
  and passes the list to the aggregation resolver `c` (offset 1465000).
- `c` fetches `/{serviceId}/{currency}/current/{source}/{region}/primary-selector-aggregations.json`
  for every item. The first item's failure is fatal; a joined item's failure is
  swallowed (`Additional Pricing Artifacts API failed quietly for the reason
  below`). An item with `manifest.excludedRegions` naming the region is skipped.
- Each item's rows go through `s.b` (offset 1227400): `keyName` renames selector
  keys, `keyValue` maps raw price tokens to the labels the form shows, and
  `constant` both filters rows that contradict it and injects fixed values.
  The Database Savings Plans rows therefore become ordinary rows with
  `TermType: "Database Savings Plans"`, `PurchaseOption: "No Upfront"`, and the
  joined selectors (`LeaseContractLength`, ...). The row order is the item
  order, and `c` keeps a cumulative boundary table so it can return the item a
  matched row came from (`selectedCargoItem`).
- `u` (offset 1467000) then builds the index path from *that item's*
  `manifest.primarySelectors`, `remap.keyName`, and `remap.keyValue`, and
  `w`/`y` price with that item's `pricingUnitModel`. `getData` passes
  `selectedCargoItem` in both places. The component's own `pricingUnitModel` and
  `remap` are only used while the component's artifact is the selected one.
- The Saving Plans math is `z` (offset 2874076) with `B.b` (offset 362304):
  `hours = years * 365 * 24`, `commitment = rate * hours`, `upfront = fraction *
  commitment`, `effective = (commitment - upfront) / hours`, `monthly =
  effective * 730`, and the monthly total is rounded **up** to the cent before
  the display rounds two decimals. `H` reads the term years from the leading
  digit of the exported term (`"1yr"` -> 1).
- The pricing model label is the component row's `mappingValue`:
  `"Database Savings Plans" -> "SavingsPlan"`.

Reachable proof (live editor, US East (Ohio), DocumentDB standard):

- `db.t3.medium` offers only `OnDemand`. `db.r8g.12xlarge` offers `OnDemand` and
  `Database Savings Plans`. The joined rows only price the r8g family, and
  secondary selectors are offered per selected primary value, so the option is
  instance-type dependent exactly like this.
- Selecting `Database Savings Plans` reveals `Term (1yr)` and
  `Payment option (No Upfront)`, and the component's `Show calculations` reads
  `5.30005152 USD x 8760 hours = 46428.4513 USD`, `Hourly cost ... 5.3001`,
  `Instances cost (monthly): 3,869.04 USD`.
- The live app requests both files on every column-form mount:
  `docdb/USD/current/docdb-calc/US East (Ohio)/primary-selector-aggregations.json`
  and
  `databasesavingsplans/USD/current/dsp-join-with-docdb-calc/US East (Ohio)/primary-selector-aggregations.json`
  (both 200).
- The joined index for that selection is
  `.../dsp-join-with-docdb-calc/US East (Ohio)/OnDemand/db.r8g.12xlarge/48/384 GiB/1 year/No Upfront/index.json`
  with `price 5.30005152`, `PurchaseOption "No Upfront"`, `plc:LeaseContract
  "1 year"`. The path uses the prefixed `docdb:TermType` value (`OnDemand`) and
  the reverse-remapped `1 year`; the record remaps `plc:LeaseContract` onto
  `LeaseContractLength` as `1yr`, which is why the form shows `1yr`.

The four P1 rows the tracker still named were not blocked by this in the sense
of "cannot price at all": DocumentDB already evaluated with defaults, and
Neptune, Timestream, and DMS were `needs-input` because their primary selector
rows carry no `defaultValue` (the engine's documented fail-closed stance,
D-020), not because of the join. What *was* missing is one live-offered pricing
model. It is implemented now, and the receipts price that model:

| Service | Live editor | Native | Receipt |
| --- | ---: | ---: | --- |
| DocumentDB `db.r8g.12xlarge` DSP 1yr No Upfront | 3,869.04 | 3,869.04 | `receipts/p1-documentdb-dsp.json` |
| Neptune `db.r7g.12xlarge` DSP + 1 GB storage/backup | 5,229.55 | 5,229.55 | `receipts/p1-neptune-dsp.json` |
| Timestream InfluxDB2 MAZ read replica `db.influx.12xlarge` DSP | 6,701.98 | 6,701.98 | `receipts/p1-timestream-dsp.json` |
| DMS `c7i.12xlarge` Multiple AZ DSP + 100 GB gp2 | 4,513.78 | 4,513.78 | `receipts/p1-dms-dsp.json` |

Timestream is `disableCalculation`: the 4.5904 joined hourly rate is exported
through `calculationId` and the template maths multiplies it by two nodes and
730 hours (`6701.984`, displayed `6,701.98`). Neptune's storage and backup are
separate inputs (`1 GB` each) that the live form also accepts; DMS adds its
100 GB gp2 storage.

Reproduce:

```sh
curl -s --compressed \
  'https://d1qsjq9pzbk1k6.cloudfront.net/data/amazonDocumentDB/en_US.json' \
  | jq '.templates[0].cards[1].inputSection.components[0].additionalPricingData'
curl -s --compressed \
  'https://calculator.aws/pricing/2.0/meteredUnitMaps/databasesavingsplans/USD/current/dsp-join-with-docdb-calc/US%20East%20(Ohio)/primary-selector-aggregations.json'
curl -s --compressed \
  'https://calculator.aws/pricing/2.0/meteredUnitMaps/databasesavingsplans/USD/current/dsp-join-with-docdb-calc/US%20East%20(Ohio)/OnDemand/db.r8g.12xlarge/48/384%20GiB/1%20year/No%20Upfront/index.json'
```

## 19. The two remap surfaces: `remap.constant` and the primary selector (2026-11-25)

Observed in the live UI (us-east-2 and us-east-1) and in the bundle behind
`https://calculator.aws/42c3e45d-da28-4f7f-9043-598b787291c1/static/js/bundle.js`
(sha256 `adbd5f41...`, still the live build). Evidence for every number and screenshot:
`receipts/remap-surfaces-probe.json`.

### What the live engine does

- **A constant filters, then fills.** Before the option tree exists, the live aggregation fetch
  keeps only the rows that do not contradict the constant - a row whose value is missing or equal
  survives, a row that carries a different value is dropped (offset 1464986). The forward remap
  `b` then maps `keyValue` and writes the constant into every row (`for(const r in o)s[r]=o[r]`,
  offset 1227218), and `o` does the same to the regional price records. `src/data/column-form.ts`
  does this per cargo item, which is the same path section 18 uses for the joined Savings Plans
  artifact.
- **A constant never names a price set.** In the metered-unit filter `y`
  (offset 1469061) a selector whose value equals a constant value returns `null` and is dropped,
  so the selector contributes no fragment; the same loop maps a display value back to its
  `keyValue` token for the remaining fragments.
- **The primary selector resolves through its own tree.** `h` (offset 1467544) fills
  `primaryKey.value[primary]` with a tree of every row's primary value, and `y` takes the
  selected value or the deepest first key of that tree. `getInitialValue` (offset 2880490) keeps
  a value only when the option tree offers it, otherwise takes the row's declared `defaultValue`
  when that is offered, otherwise the first offered value. A declared default that is a
  `remap.keyValue` **key** is therefore a price token the form never shows; the form lands on the
  label the remapped aggregation rows carry.
- **A text input with no declared default holds 1.** `componentType.textInput.defaultValue` is
  `"1"` (offset 2877758) and `getInitialValue` uses it when the row declares no default. A
  dropdown with no default stays empty and resolves from the option tree. This is why Mainframe
  Modernization's instance count and Directory Service's directory count render as 1 while the
  definition declares nothing, and why `remap.constant` alone was not the whole Mainframe gap.

### The four services the tracker blocked, and what the live form shows

| Service | Live form | Live monthly | Engine before |
| --- | --- | ---: | --- |
| Amazon Translate / Real-Time Document Translation | Document Type `Basic - Text, HTML` (the default `Basic` is the price token) | 15.00 for 1M characters | `MISSING_PRICE {"FileType":"Basic"}` |
| AWS Directory Service | Microsoft AD 1 directory / `Enterprise`, AD Connector 1 / `Large`, Simple AD 1 / `Large` | 292.00 + 109.50 + 109.50 on one estimate | `MISSING_INPUT "Directory Type"` |
| AWS Mainframe Modernization | Blu Age and Micro Focus, 1 instance of `m5.large` at 160 hours/month on every card | 99.20 Blu Age alone, 2,118.40 Micro Focus alone, 2,217.60 with both | `MISSING_INPUT "Product Name"` |
| Amazon Chime SDK / PSTN Audio + SIP Trunking | DID `Australia`, inbound `Australia`, outbound `Andorra`; price data only in us-east-1 / us-west-2 | 3,705.88 + 211.10 + 38.99 = 3,955.97 | `MISSING_INPUT "NumberType"` / `"CallType"` |

So none of the four is a tracker mislabel: every one of them has a live surface that prices and an
engine that failed closed. Two honest corrections to the tracker come out of the same proof:

- `remap.constant` was counted **per declaration, not per blocker**. All 19 components across 9
  definitions use the same mechanism, and the selector roll-up gave four parents the label from
  their children. Both are now native, so the rule is retired rather than narrowed.
- **Mainframe Modernization needed a second live fallback.** After the utilization wave its only
  remaining gap was not solely the constant: the instance-count text input has no declared
  default, the engine read that as empty and billed zero, and the live form shows 1. That
  fallback is part of the same `getInitialValue` contract and is now native for every column-form
  text input.

### What changed

- `src/data/column-form.ts`: the per-item remap filters the aggregation rows by `remap.constant`
  before the forward remap, then writes the constant into the rows and the price records (the
  filter helpers section 18 introduced). A missing index for a path the aggregation file lists now
  fails closed as `MISSING_PRICE` naming the path (Simple AD is not sold in us-east-2) instead of
  surfacing an HTTP 404.
- `src/engine/column-form.ts`: the constant seeds a selector value that has no row; the primary
  selector resolves through its own option tree with the same keep/replace rule as every other
  row; a constant value is dropped from the metered-unit fragments; a text input with no declared
  default holds 1; the config summary iterates rendered rows, so a constant-only selector never
  appears in it (live has no row for it either).
- `src/engine/column-form-loader.ts`: the prefetch no longer demands a primary value up front. A
  constant supplies it, and a remapped default settles into the label on the first fetch, which
  is what the fixed-point loop already handles.
- The `remap.constant` and `remap.keyValue-primary` coverage rules are retired (D-034), and
  `scripts/coverage-column-form.ts` (which existed only for the primary-remap rule) is deleted.

### Receipts

All four were published from this engine and recomputed by the live editor with `mismatches []`:

| Receipt | Live monthly | Upfront | Annual |
| --- | ---: | ---: | ---: |
| `receipts/p1-remap-directory-service.json` | 511.00 | 0.00 | 6,132.00 |
| `receipts/p1-remap-mainframe-modernization.json` | 2,217.60 | 0.00 | 26,611.20 |
| `receipts/p1-remap-chime-sdk.json` | 3,955.97 | 0.00 | 47,471.64 |
| `receipts/p1-remap-primary-translate.json` | 15.00 | 0.00 | 180.00 |

### Coverage delta

Re-measured on the final base (`main` at `85ba1d7`, which made column-form `utilization` rows and
the `additionalPricingData` join native). Baseline: clean 425, partial:column-form 0,
blocked:column-form 13, blocked:subtype 3; P1 4, P2 139, P3 267. After this change:
clean 438, partial:column-form 0, blocked:column-form 0, blocked:subtype 3; P1 0, P2 141,
P3 269.

All 13 blocked:column-form rows at that base carried one of the two remap rules, so this change
closes the class: the four P1 rows (amazonChimeSdk, aWSDirectoryService,
amazonMainframeModernization, amazonTranslate) and nine P3 rows (amazonChime,
chimeBusinessCallingAnalysis, chimeCostAnalysis, mainframeBluAge, mainframeMicroFocus,
proxyPhoneSession, ptsnAudio, realTimeDocumentTranslation, sipTrunking) became clean. The two P1
selectors stay P2 (visible and clean, ledger incomplete because only the children proven here have
receipts), and the two P1 services move to P3 because all of their children now have receipts.
P1 is therefore 0: no visible service is blocked or partial. That does not mean everything is
proven - 141 P2 rows are statically clean and still need fixtures and receipts.

No service became clean by relaxing a rule, and the two retired rules had no fail-closed path left
behind them. The column-form surface that remains is `subComponentsList`, tiered PLC_2.0
patterns, and multiple price sets, none of which a catalog definition uses.
