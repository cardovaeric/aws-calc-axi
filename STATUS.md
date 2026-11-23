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
- `npm run e2e`: 7 tests, pass (live DOM, live catalog parity, all ledger rows)
- `npm run ledger`: 6 rows, all pass

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

`cf69c6a` - P1/P2 matrix. P3 scanner fixes, native goldens, `update`, and docs follow in the next
commit.
