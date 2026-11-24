# Dependent selectors: investigation, implementation, and receipts

Date: 2026-11-24. Branch: `cardovaeric/w3-dependent-selectors`, cut from `main` (`3c5b7e1`).
Commits: `a1007d2` (engine, data, loader, tests, fixtures, receipt, ledger, goldens) and the
follow-up docs/tracker commit.

## Verdict on the premise: the gap is real, but the count is not the blocker list

Unlike repeatable rows, dependent selectors are a live mechanism. `row.dependent` gates a
child's *option set* from data, the options come from the aggregation rows and the regional price
records, and the live form rewrites the child value when the parent changes. That mechanism was
absent from this engine. Full evidence, with bundle offsets, is in `analysis/FINDINGS.md`
section 14.

What the tracker's blanket rule overstated is the *consequence*: 36 services carry the
declaration, 14 of them P1, but only one of the four target services is gated by a real
parent/child pair in the data. The split:

- **Genuinely parent-gated:** Amazon FSx for Lustre, `Cache Type` under `Storage type` (the
  aggregation file carries both, and SSD offers only `No Cache` while HDD also offers
  `SSD cache`).
- **Record-derived pairs** (ElastiCache, OpenSearch, Redshift, RDS family, MemoryDB, Neptune,
  DocumentDB, Keyspaces): `Term`/`Purchase option` are declared but absent from the aggregation,
  so their options exist only for Reserved price records. Without the record-backed branch the
  rows never render, and the engine failed with "needs a value" or "no price set matches".
- **Nothing to do with dependency:** `awsDeadlineCloud` and `awsDirectConnect` are blocked by
  `input:utilization`; 24 of the 36 also need `additional-pricing-data`, `regex-remap`, or
  `remap.constant`.

So "fewer than 14 are genuinely blocked by dependent selectors" is the honest answer: 3 of the 4
targets were blocked by the *record-backed* half of the same mechanism, FSx by the *parent-gated*
half, and none of the P1 services needed anything about dependencies that this change does not
provide.

## What was built

`src/engine/column-form.ts`

- `buildColumnFormSelectorTree`: per-region aggregation rows for the selected primary value, a
  nested tree under the parent's value for rows with `dependent`, a rebuilt tree from the
  regional price records for selectors the mapping does not carry, and the live ordering rules
  (top level sorted for record-backed selectors, record order below it, aggregation order
  otherwise).
- `resolveColumnFormSelectors`: definition-order resolution matching `createRows` - keep the
  current value when it is offered, else the definition default when offered, else the first
  offered value, else drop the selector. A user-supplied value that is not offered raises
  `INVALID_SELECTION` with the offered values instead of being silently rewritten.
- `columnFormMeterFragments` / `filterColumnFormMeters`: one token per selector, the dependent
  tree walk returning the last path element, `remap.keyValue` reverse mapping, the
  `riPaymentOptions` unit token, the `es`/`directconnect` comma rule, regex token matching, and
  the single-meter short circuit.
- Pricing: per-meter pattern matching (last match wins, like live `w`), the four cost models
  (`Reserved`, `Monthly`, `Hourly`, Savings Plans fail-closed), and a real upfront total.
- Saved rows: exactly the rendered selectors, in definition order, dropped selectors absent.

`src/engine/column-form-loader.ts`

- Resolve before fetch, iterate to a fixed point (max four passes), then require an exact
  aggregation match, because the live editor refuses a `Best Match` component.
- Pass `remap.keyValue` so the data layer can map aggregation values and price records forward
  into the labels the form shows.

`src/data/column-form.ts`

- `resolveAggregationMatch` (live `c`): first row that carries every supplied value, region
  filtered, with the weighted `prioritizedKey` fallback and its `diffs`.
- `remapValue` / `reverseRemapValue` and the aggregation/record remapping the live engine applies
  before matching.
- `ColumnFormPricingData` carries `aggregations` and `exactMatch`.

Tests: 11 new unit tests in `tests/column-form.test.ts` (option gating, first-offered defaults,
cascade, user-value fail-closed, dropped record-backed selectors, reserved defaults, upfront and
no-upfront models, saved-row round trip, dependent token, reverse remap) plus a native golden in
`e2e/golden-natives.test.ts` and a ledger row that re-reads the public link and its editor
recompute.

## Receipts

`receipts/p1-dependent-selectors.json`, one link,
`https://calculator.aws/#/estimate?id=b03c7fc75c828c53cb388b87aa8dae6f421e2153`:

| Row | Native | Rendered | Editor recompute |
| --- | --- | --- | --- |
| Amazon ElastiCache, Reserved 1yr All Upfront, 2 x cache.m5.xlarge | 0.00 + 3,482.00 upfront | 0.00 + 3,482.00 | 0.00 + 3,482.00 |
| Amazon OpenSearch Service, Reserved 1yr No Upfront, 2 x r5.2xlarge.search | 748.98 | 748.98 | 748.98 |
| Amazon Redshift, Reserved 1yr No Upfront, 2 x ra3.4xlarge | 3,331.72 | 3,331.72 | 3,331.72 |
| Total | 4,080.70 + 3,482.00 upfront | 4,080.70 + 3,482.00 | 4,080.70 + 3,482.00 |

Oracle: `editor-recompute`, verdict `pass`, mismatches `[]`. Annual 52,450.40. The rendered
config summaries are the dependent-selector proof:
`Pricing strategy (Reserved 1yr All Upfront)`, `Pricing strategy (Reserved No Upfront 1yr)`.

FSx for Lustre has no receipt: its selectors now resolve exactly like live (Storage type SSD ->
`No Cache` + `1000 MBps/TiB`; HDD -> gains `SSD cache`; HDD + `SSD cache` -> resets to
`No Cache` + `1000 MBps/TiB`), and then pricing stops in `src/engine/template.ts`. See "Boundary"
below.

Live UI evidence behind the mechanism (screenshots not captured, DOM read in the
`w3-depsel-probe` session): ElastiCache shows *no* Term/Purchase option on On-Demand and both on
Reserved; OpenSearch lists `[1yr, 3yr]` under All Upfront and `[3yr, 1yr]` under No Upfront; FSx
defaults to `No Cache` + `1000 MBps/TiB` on SSD despite a definition default of `50 MBps/TiB`,
and switching Storage type to HDD yields `12 MBps/TiB`.

## Coverage delta

`npm run coverage` on this branch (parent `3c5b7e1`), static pass:

| Class | Before | After |
| --- | ---: | ---: |
| clean | 382 | 399 |
| partial:column-form | 33 | 16 |
| blocked:column-form | 17 | 17 |
| blocked:subtype | 9 | 9 |

| Priority | Before | After |
| --- | ---: | ---: |
| P0 | 31 | 31 |
| P1 | 23 | 14 |
| P2 | 132 | 139 |
| P3 | 255 | 257 |

`dependent-selectors` occurrences: 36 before, 0 after. `ri-payment-upfront`: 20 before, 0 after
(replaced by `tiered-plc2-patterns`, which currently matches 0 services).

Runtime pass (`npm run coverage -- --evaluate`, defaults only, both regions) moved as well,
because the engine now resolves the selector state instead of demanding it:

| Runtime verdict (us-east-1) | Before | After |
| --- | ---: | ---: |
| ok | 215 | 223 |
| needs-input | 170 | 176 |
| ambiguous | 5 | 0 |
| missing-price | 16 | 1 |
| unsupported | 5 | 9 |
| bad-definition | 1 | 3 |
| error | 29 | 29 |

us-east-2 changes: `amazonAuroraMySQLCompatible`, `amazonRdsCustomForOracle`, `amazonDocumentDB`,
`amazonGameLift`, `amazonGameLiftStreams`, `awsElementalMediaLive`, `mediaLiveOutput1` went from
`ambiguous`/`missing-price` to `ok`; the WorkSpaces family now reaches its real `utilization`
blocker instead of `missing-price`; `amazonFSxForLustre`, `amazonRdsCustomForSqlServer` and
`amazonAppStream` moved to `bad-definition`/`needs-input` (FSx is the `replace` boundary below).
No service regressed to a generic `error`; the offline pass reports `error` only for index paths
that are not in the shared cache, which is expected because those services could not resolve a
path at all before this change.

Rows that changed, before -> after (38 rows; the 17 that became clean):

| Service | Before | After |
| --- | --- | --- |
| amazonRdsCustomForSqlServer | P0 partial, `dependent-selectors;ri-payment-upfront` | P0 clean |
| amazonRdsForOutposts | P0 partial, `dependent-selectors` | P0 clean |
| amazonAppStream | P1 partial, `dependent-selectors` | P2 clean |
| amazonElasticsearchService | P1 partial, `dependent-selectors;ri-payment-upfront` | P3 clean |
| amazonFSxForLustre | P1 partial, `dependent-selectors` | P2 clean |
| amazonGameLift | P1 partial, `dependent-selectors` | P2 clean |
| amazonManagedBlockchain | P1 partial, `dependent-selectors` | P2 clean |
| amazonMemoryDbForRedis | P1 partial, `dependent-selectors;ri-payment-upfront` | P2 clean |
| amazonRedshift | P1 partial, `dependent-selectors;ri-payment-upfront` | P3 clean |
| awsElementalMediaLive | P1 partial, no gaps (selector children) | P2 clean |
| elementalMediaConvert | P1 partial, no gaps (selector children) | P2 clean |
| mediaLiveAudioAddOns | P3 partial, `dependent-selectors` | P3 clean |
| mediaLiveInput1 | P3 partial, `dependent-selectors` | P3 clean |
| mediaLiveOutput1 | P3 partial, `dependent-selectors` | P3 clean |
| outputConfiguration1 | P3 partial, `dependent-selectors` | P3 clean |
| outputConfiguration2 | P3 partial, `dependent-selectors` | P3 clean |
| workSpacesPools | P3 partial, `dependent-selectors` | P3 clean |

The other 21 rows lost the gap but keep another: `amazonElastiCache`, `amazonAuroraMySQLCompatible`,
`amazonRDSAuroraPostgreSQLCompatibleDB`, `amazonRdsCustomForOracle`, `amazonRdsForDb2`,
`amazonRdsForOracle`, `amazonRDSForSQLServer`, `amazonRDSMariaDB`, `amazonRDSMySQLDB`,
`amazonRDSPostgreSQLDB` keep `additional-pricing-data;regex-remap`; `amazonKeyspaces`, `amazonNeptune`
the same; `amazonDocumentDB`, `amazonTimestream`, `awsDatabaseMigrationService` keep
`additional-pricing-data`; `awsDeadlineCloud`, `awsDirectConnect`, `amazonWorkspaces`,
`workSpacesCore`, `workSpacesInstances` keep their real blocker (`utilization`, `remap.constant`,
`blocked:subtype`).

Baseline note from the coordinator: the tracker worker's own branch (`9b0e215`) splits the blocked
classes as `blocked:column-form=16` / `blocked:subtype=10` after settling the phantom WorkSpaces
children. This branch is cut from `main` (`3c5b7e1`, 17/9) and does not merge that work, so the
blocked rows here are unchanged 17/9; against that baseline the delta is the same
`partial:column-form -> clean: -17/+17` and `P1: -9`.

## Boundary: what I did not touch, and what still fails closed

- **`src/engine/template.ts` `replace` is a live-behaviour bug and it is the only thing left
  between FSx for Lustre and a receipt.** Live replaces `originalString` inside the value
  (`e.replace(new RegExp(escape(r), "g"), n)`, `.../bundle.js` offset 2844449); this engine looks
  for an exact match of the whole value and throws
  `replace "persThrouput" has no mapping for persThrouputConcat=1000 MBps/TiB test`. FSx builds
  `persThrouput = replace(concatenate(ThroughputCapacity, " test"), " test" -> "")`. The fix is
  local to the `case "replace"` branch: reduce over `replacements` with
  `value.split(originalString).join(replaceString)`. That file belongs to another worker, so it is
  reported, not edited.
- `utilization` rows that carry a `selectorId`, `remap.constant`, `additionalPricingData` joins,
  `subComponentsList`, `exportTagsAsValue`, multiple price sets, and tiered PLC_2.0 patterns stay
  fail-closed. They are the remaining `partial:column-form` rows.
- `regex-remap` stays in the tracker although the evidence says it is inert: the live `keyValue`
  remap is a plain object lookup, so `"/1\\s?yr/"` keys never match. Removing that rule changes
  eight P0 rows and is the tracker owner's call.
- The tracker edit in this branch is limited to two rules plus the legend line in
  `scripts/coverage.ts`; the generated table and CSV are regenerated from it. `STATUS.md` was not
  touched.

## Gates

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: 118 tests, pass
- `npm run e2e`: 30 tests, pass with a dedicated `AGENT_BROWSER_SESSION` (the default session is
  shared with the other workers and times out under contention)
- `npm run ledger`: 17 rows, 17 with a passing rendered receipt
