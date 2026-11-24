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
