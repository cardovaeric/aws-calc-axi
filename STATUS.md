# Status

Updated: 2026-11-23 (session 1)

## What works now

- TypeScript Node project with a real binary (`bin/aws-calc-axi.js`), native TS execution,
  `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`, `npm run ledger`.
- Fast version path: `--version`, `-v`, `-V` answer before the CLI graph loads.
- Catalog: manifest, region map, locations, exact region-aware rule. Parity with the live UI:
  181 us-east-1, 160 us-east-2 (`e2e/catalog.test.ts`).
- Definition and pricing clients: disk cache, retry/backoff, offline mode, region-less price
  merging (`Any` bucket), gzip via fetch.
- Engine: inputs (`numericInput`, `dropdown`, `fileSize`, `frequency`, `durationInput`,
  `percentInput`, `checkbox`, `dataTransferV2` for empty rows, display-only text), `displayIf`,
  `singlePricePoint`, `tieredPricing`/`tieredPricingMath`, `pricingComboV2`, `replace`,
  `concatenate`, `basicMaths`, `maxMin`, `rounding`, `variable`, `priceDisplay`, `[ZERO_COST]`,
  config summaries, subtotals. Unknown subtypes fail closed with the component path.
- Selector parents emit `subServices[]`; user groups nest with `Name-uuid` ids; support plans
  compute from the published tier table.
- Publisher: `saveAs`, public URL, saved-key retrieval, daily link budget, link reuse from a
  receipt when the spec hash matches, recompute probe links for the live UI oracle.
- Verifier: opens the public URL in a named agent-browser session, waits for the estimate name,
  reads the banner, totals, service/group rows, group tree, and support row; diffs to the cent.
- CLI: home, `services`, `schema`, `pricing`, `estimate init`, `cost`, `apply`, `publish`
  (`--oracle`, `--receipt`, link reuse), `verify`, `doctor`.

## Verified receipts

| Row | Native monthly | Rendered monthly | Rendered 12m | Oracle | Verdict |
| --- | --- | --- | --- | --- | --- |
| S3 Standard 100 GB | 2.30 | 2.30 USD | 27.60 USD | pass | pass |
| Lambda 10M req / 200 ms / 512 MB | 11.80 | 11.80 USD | 141.60 USD | pass | pass |
| CloudWatch usage mix | 16.52 | 16.52 USD | 198.24 USD | pass | pass |
| SNS 1M requests + 1M HTTP | 0.54 | 0.54 USD | 6.48 USD | pass | pass |
| SQS 1M standard requests | 0.40 | 0.40 USD | 4.80 USD | pass | pass |
| Groups (S3 + Lambda) + Business Support+ | 14.10 (+29.00 support) | 43.10 USD | 517.20 USD | render-recomputed | pass |

Public links and full receipts: `COVERAGE.md` and `receipts/`.

P0 receipt: `receipts/p0-s3-standard.json`.
P1 receipts: `receipts/p1-*.json` (each stores the public link, the stored JSON comparison, the
rendered DOM, and the recompute probe URL).
P2 receipt: `receipts/p2-groups-support.json`.

## Test and lint status

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: 51 tests, pass
- `npm run e2e`: 11 tests, pass (live DOM re-reads, live catalog parity, native goldens, all
  ledger rows); ran twice back to back with identical results
- `npm run ledger`: 6 rows, all pass
- Screenshots of every public link: `receipts/screenshots/`

## Coverage ledger summary

6 rows: 5 service fixtures plus 1 group/support fixture. All native, all pass. Details in
`COVERAGE.md`.

## P3 expansion so far

- `scripts/scan.ts` inventories subtypes and evaluates defaults. Current us-east-2 picture:
  87 of 160 visible services are within the implemented subtype set; 56 evaluate with defaults
  (22 need inputs, 6 hit genuinely missing regional prices, 0 unsupported subtypes).
- Fixed from scanner findings: dropdown fallbacks (declared default missing from options falls
  back to the first option, matching the live UI), display-only components with no `type`
  (Network Firewall alerts), size validations in output units, frequency/duration validations in
  the entered unit, percent summary as a fraction.
- New native fixtures with frozen goldens (no public receipt yet, link budget): X-Ray 50.00,
  CloudFormation 2736.60, EventBridge 10.00, Athena 14.85.
- `update --check|--apply` now shadows the SDK self-update and reports data-plane drift for the
  manifest, region map, runtime config, locations, and (with `--definitions`) every definition.

## Open failures and blockers

- None blocking.
- Publish budget: 25 links/day cap was reached; the P2 gate needed one more link (26 total,
  explicitly raised for that publish). Nothing else was published after it, so the four new
  native fixtures above have goldens but no rendered receipt yet.
- Fail-closed gaps (adapter tasks, not silent zeros): non-empty `dataTransferV2` pricing,
  `columnFormIPM` (63 services), `throughput` (29), `utilization` (12), bespoke EC2/Windows/RDS
  math (`ec2PriceDisplay`, `ec2Variable`, `snapShotMaths`, `workloadInstanceMath`), and pricing
  `sets`-based instance data.
- Six services hit missing regional prices for meters present in the definition but absent from
  the region file (Personalize, Transcribe, ACM, MediaTailor, Firewall Manager, IoT SiteWise).
  The engine fails closed instead of publishing a zero.

## Next three actions

1. Next session: publish receipts for the four native fixtures (X-Ray, CloudFormation,
   EventBridge, Athena), add their ledger rows, and confirm each rendered total.
2. Implement non-empty `dataTransferV2` pricing (the biggest generic gap), then add S3 data
   transfer and NAT-style fixtures.
3. Implement `columnFormIPM` (repeatable rows) and `throughput` to unlock the next coverage tier.

## Last commit

`307dbfc` - P3 scanner fixes, native goldens, `update`, and docs. Screenshot capture and the final
status updates follow in the closing commit.

## Final summary

What shipped:

- A working `aws-calc-axi` CLI (native TypeScript, TOON output, no prompts, exit codes per AXI)
  covering catalog discovery, schemas, prices, estimate files, cost, apply, publish, verify,
  doctor, and data-plane update.
- A deterministic engine for the generic calculator surface: inputs, display conditions, single
  and tiered prices, pricing combos, replaces/concatenations, maths, rounding, config summaries,
  selector sub-services, nested groups, and support plans.
- A publish path that emits the calculator's own estimate contract, reuses links, caps link
  creation, and verifies the public page in a real browser, including a live recompute probe.

What passed:

- `npm run typecheck`, `npm run lint`, `npm test` (57 tests), `npm run e2e` (11 tests, twice),
  `npm run ledger`.
- P0: S3 Standard 100 GB, us-east-2: native 2.30, rendered 2.30 monthly / 27.60 total,
  receipt in `receipts/p0-s3-standard.json`.
- P1: Lambda 11.80, CloudWatch 16.52, SNS 0.54, SQS 0.40. Every link rendered the native total
  and its recompute probe recomputed the same numbers in the live UI.
- P2: nested groups plus Business Support+: service total 14.10, support 29.00 recomputed by the
  page, rendered 43.10 monthly / 517.20 total, group tree and support row asserted.
- P3: catalog scan (87/160 services within the implemented subtype set, 56 evaluate with
  defaults), four new native fixtures frozen as goldens, data-plane update command, screenshots.

What failed (or is not done):

- Non-empty data transfer pricing, `columnFormIPM` tables, throughput/utilization inputs, and the
  bespoke EC2/Windows/RDS math remain fail-closed adapter tasks. They raise a structured error
  with the component path instead of publishing a guessed zero.
- Six services reference meters that are absent from their regional price file; they stay
  unsupported until the mapping or the display condition is understood.
- Four native fixtures (X-Ray, CloudFormation, EventBridge, Athena) have goldens but no public
  receipt yet because the day's 25-link budget (26 with the documented P2 exception) is spent.

What I would do next:

1. Publish receipts for the four native fixtures and add their ledger rows.
2. Implement non-empty data transfer pricing, then S3 data transfer and NAT-style fixtures.
3. Implement `columnFormIPM` to unlock the instance/storage calculator tier, one service at a
   time with the probe oracle.
