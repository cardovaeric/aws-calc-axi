# Status

Updated: 2026-11-23 (session 2)

## What works now

- Public repository: https://github.com/cardovaeric/aws-calc-axi (default branch `develop`).
  Agents can install the guide with `npx skills add cardovaeric/aws-calc-axi --skill aws-calc-axi`;
  the CLI itself installs from a clone with `npm install && npm link`.
- TypeScript Node project with a real binary (`bin/aws-calc-axi.js`), native TS execution,
  `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`, `npm run ledger`.
- Fast version path: `--version`, `-v`, `-V` answer before the CLI graph loads.
- Catalog: manifest, region map, locations, exact region-aware rule. Parity with the live UI:
  181 us-east-1, 160 us-east-2 (`e2e/catalog.test.ts`).
- Definition and pricing clients: disk cache, retry/backoff, offline mode, region-less price
  merging (`Any` bucket), gzip via fetch. PLC_2.0 column-form data (metadata, selector
  aggregations, index price trees) is fetched and cached the same way.
- Engine: inputs (`numericInput`, `dropdown`, `fileSize`, `frequency`, `durationInput`,
  `percentInput`, `checkbox`, `dataTransferV2`, `columnFormIPM`, display-only text), `displayIf`,
  `singlePricePoint`, `tieredPricing`/`tieredPricingMath`, `pricingComboV2`, `replace`,
  `concatenate`, `basicMaths`, `maxMin`, `rounding`, `variable`, `priceDisplay`, `[ZERO_COST]`,
  config summaries, subtotals. Unknown subtypes fail closed with the component path.
- Data transfer pricing is native: per-destination tier groups, the region-wide most-common
  group, destination overrides, the intra-region double charge, and the live
  `DT <type>: <region> (<n> <unit>)` summary. Unselected rows and unknown destinations fail
  closed.
- `columnFormIPM` is native for the simple PLC_2.0 subset: one row set per component,
  `textInput`/`autoSuggest`/`dropDown` selectors, no dependent selectors, no remaps, one price
  set, hourly or monthly model, `calculationId` targets exposed to the maths section, live save
  format and summary. Unsupported features fail closed with the component id.
- Selector parents emit `subServices[]`; user groups nest with `Name-uuid` ids; support plans
  compute from the published tier table.
- Publisher: `saveAs`, public URL, saved-key retrieval, daily link budget, link reuse from a
  receipt when the spec hash matches, recompute probe links for the live UI oracle, and an
  editor-recompute oracle (`--oracle-editor`) for components the read-only probe drops.
- Verifier: opens the public URL in a named agent-browser session, waits for the estimate name,
  reads the banner, totals, service/group rows, group tree, and support row; diffs to the cent.
  The editor mode clicks "Update estimate" and reads the same DOM.
- CLI: home, `services`, `schema`, `pricing`, `estimate init`, `cost`, `apply`, `publish`
  (`--oracle`, `--oracle-editor`, `--receipt`, link reuse), `verify`, `doctor`, `update`.

## Verified receipts

| Row | Native monthly | Rendered monthly | Oracle | Verdict |
| --- | --- | --- | --- | --- |
| S3 Standard 100 GB | 2.30 | 2.30 USD | probe pass | pass |
| Lambda 10M req / 200 ms / 512 MB | 11.80 | 11.80 USD | probe pass | pass |
| CloudWatch usage mix | 16.52 | 16.52 USD | probe pass | pass |
| SNS 1M requests + 1M HTTP | 0.54 | 0.54 USD | probe pass | pass |
| SQS 1M standard requests | 0.40 | 0.40 USD | probe pass | pass |
| X-Ray 10M requests | 50.00 | 50.00 USD | probe pass | pass |
| CloudFormation 100 extensions | 2736.60 | 2,736.60 USD | probe pass | pass |
| EventBridge 10M custom events | 10.00 | 10.00 USD | probe pass | pass |
| Athena 100 queries/day + 4 DPUs | 14.85 | 14.85 USD | probe pass | pass |
| S3 outbound 1 TB to the internet | 92.16 | 92.16 USD | editor recompute pass | pass |
| DAX 3 x r5.large nodes | 558.45 | 558.45 USD | probe pass | pass |
| Groups (S3 + Lambda) + Business Support+ | 14.10 (+29.00 support) | 43.10 USD | none | pass |

Public links and full receipts: `COVERAGE.md` and `receipts/`.

Receipts: `receipts/p0-s3-standard.json`, `receipts/p1-*.json` (S3, Lambda, CloudWatch, SNS,
SQS), `receipts/p2-groups-support.json`, `receipts/p3-*.json` (X-Ray, CloudFormation,
EventBridge, Athena, S3 data transfer, DAX). Each stores the public link, the stored JSON
comparison, the rendered DOM, the oracle, and the verdict.

## Test and lint status

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: 87 tests, pass
- `npm run e2e`: 19 tests, pass (live DOM re-reads, live catalog parity, native goldens, all
  ledger rows including the editor-recompute oracle)
- `npm run ledger`: 12 rows, all pass
- Screenshots of every public link: `receipts/screenshots/` (12 PNGs)

## Coverage ledger summary

12 rows: 11 service fixtures plus 1 group/support fixture. All native, all pass. Details in
`COVERAGE.md`.

## Scanner picture (us-east-2)

- `node scripts/scan.ts`: 106 of 160 visible services are within the implemented subtype set
  (was 87 before `columnFormIPM`), 31 selector children.
- `SCAN_EVALUATE=1`: 57 evaluate with defaults, 40 need inputs (most column forms need an
  explicit selector because the live form picks the first available option and this engine
  fails closed instead), plus the remaining errors on bespoke EC2/Windows/RDS definitions.
- `update --check|--apply` shadows the SDK self-update and reports data-plane drift for the
  manifest, region map, runtime config, locations, and (with `--definitions`) every definition.

## Open failures and blockers

- None blocking.
- Publish budget: the day started at 26/25 from session 1. This session's mandated receipts and
  research probes used 20 more links (counter at 46). The default cap is still 25; see
  `docs/DECISIONS.md` D-017. A new UTC day starts fresh.
- The read-only share page drops `dataTransferV2` when it recomputes a foreign-source estimate
  (it renders 0). The editor recompute is correct, so data transfer receipts use
  `--oracle-editor`. Evidence in `analysis/FINDINGS.md` section 9.
- Fail-closed gaps (adapter tasks, not silent zeros): `throughput` (29 services), `utilization`
  (12), bespoke EC2/Windows/RDS math (`ec2PriceDisplay`, `ec2Variable`, `snapShotMaths`,
  `workloadInstanceMath`), pricing `sets`-based instance data, and the advanced `columnFormIPM`
  surface listed in `docs/DECISIONS.md` D-020.
- Six services reference meters that are absent from their regional price file (Personalize,
  Transcribe, ACM, MediaTailor, Firewall Manager, IoT SiteWise). The engine fails closed
  instead of publishing a zero.

## Next three actions

1. Continue `columnFormIPM` service by service: start with services whose defaults resolve
   (DAX is done), then add the live "first available selector value" fallback so the 40
   needs-input column forms can evaluate with defaults.
2. Implement `throughput` (29 services) and `utilization` (12) inputs; both are generic adapters
   with live formulas in `analysis/bundle.js`.
3. Add a data transfer fixture with a destination override (for example inter-region to a region
   with its own meter) to pin the uncommon-group path, which is already unit tested.

## Last commit

`e952b90` - skill install docs for the public repository.
Previous: `691d2fa` skill install documentation, `f049bc3` agent skill and schema/pricing fixes,
`8e6a89f` session findings, `ebb3f0a` data transfer pricing and `columnFormIPM`.

## Final summary

What shipped:

- Receipts for the four P3 fixtures (X-Ray, CloudFormation, EventBridge, Athena), each rendered
  and recomputed by a probe.
- Native non-empty `dataTransferV2` pricing with the live pipeline and summary shape, plus
  `--oracle-editor` for the live editor recomputation the read-only page cannot provide.
- Native `columnFormIPM` for the simple PLC_2.0 subset with the live save format and summary,
  the DAX fixture and receipt, and the scanner update.

What passed:

- `npm run typecheck`, `npm run lint`, `npm test` (87), `npm run e2e` (19), `npm run ledger`
  (12 rows).
- P0-P2 receipts unchanged and still pass. SNS and SQS were republished after the untouched
  data transfer row moved to the live `tb_month` default; costs unchanged.

What failed (or is not done):

- Advanced `columnFormIPM` features, `throughput`, `utilization`, and the bespoke EC2/Windows/RDS
  math remain fail-closed adapter tasks.
- Column-form services without selector defaults need explicit values instead of the live
  "first option" fallback.
- The publish budget for the day is spent (46); new links wait for the next UTC day.
