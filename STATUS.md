# Status

Updated: 2026-11-23 (session 1)

## What works now

- TypeScript Node project with a real binary (`bin/aws-calc-axi.js`), native TS execution,
  `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`.
- Fast version path: `--version`, `-v`, `-V` print the bare version before the CLI graph loads
  (guarded by a relative timing test).
- Catalog client: manifest, region map, locations, and the exact region-aware top-level rule
  (`isActive`, exclude `subService`/`TCOCalculator`, `disableConfigure`, region map or selector
  children, hide `amazonTechnic`). Derived counts match the live UI: 181 us-east-1, 160 us-east-2.
- Definition client and pricing client with disk cache, text fetch cache, gzip via fetch, retry
  with exponential backoff, stale-cache fallback, and `AWSCALC_OFFLINE=1`.
- Estimate contract types matching the saved JSON quirks (`serviceCost` omits `upfront` when the
  template has no upfront display; `totalCost` always carries both).
- Engine (native, deterministic): inputs (`numericInput`, `dropdown`, `fileSize`, `frequency`,
  `durationInput`, `percentInput`, `checkbox`, display-only text), `displayIf` expressions,
  `singlePricePoint`, `tieredPricing` + `tieredPricingMath`, `basicMaths` (add/subtract/multiply/
  divide/exponent/max/min), `rounding`, `variable`, `priceDisplay`, config summaries, subtotals.
  Unit conversion tables are extracted from the live bundle (size, time, frequency), including
  frequency table orientation.
- Selector parents emit `subServices[]` (S3 group -> S3 Standard + data transfer).
- Publisher: `POST /Prod/v2/saveAs`, public URL, saved-key retrieval, daily publish budget (25).
- Verifier: opens the public URL with agent-browser in a named session, waits for
  `[data-monthly-cost]`, and reads the banner, totals, service table, group tree, and support row.
- CLI: home, `services`, `schema`, `pricing`, `estimate init`, `cost`, `apply`, `publish`,
  `verify`, `doctor`. TOON output via `axi-sdk-js`; unknown flags exit 2 with the valid set.
- Support pricing model from `FrontEndUI.json` (basic/business/enterprise/unified, tier table,
  minimum floor, spend-tier skipping) and the stored support payload.
- Groups: nested user groups with `Name-uuid` ids, per-group subtotals, top-level `groupSubtotal`,
  `totalCost`.

## Verified receipts

| Estimate | Region | Fixture | Native monthly | Rendered monthly | Rendered 12m | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| axi-e2e S3 Standard | us-east-2 | 100 GB Standard | 2.30 | 2.30 USD | 27.60 USD | pass |

Receipt: `receipts/p0-s3-standard.json` (url
`https://calculator.aws/#/estimate?id=c2801d129ca309b709d0c514b117fb877b781f36`).

## Test and lint status

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: 51 tests, pass
- `npm run e2e`: not yet populated (P0 receipt captured manually through the CLI)

## Coverage ledger summary

| Service | Template | Region | Fixture | Path | Status |
| --- | --- | --- | --- | --- | --- |
| amazonS3Standard | s3Standard | us-east-2 | 100 GB | native | pass |
| awsS3DataTransfer | awsS3DataTransfer | us-east-2 | empty rows | native | pass (0.00) |

Full ledger lives in `COVERAGE.md`. Only a rendered public page marks a row `pass`.

## Open failures and blockers

- None blocking.
- Known scope gaps (fail closed, not silently zero): `pricingComboV2`, `concatenate`, `replace`,
  `dataTransferV2`, `columnFormIPM`, `throughput`, `utilization`, bespoke EC2/Windows/RDS math.
  These raise `UNSUPPORTED_COMPONENT` with the component path.

## Next three actions

1. Add `pricingComboV2`, `concatenate`, `replace`, `dataTransferV2` and usage inputs, then wire
   Lambda, CloudWatch, SNS, SQS fixtures into the E2E matrix.
2. Build `COVERAGE.md` generation from the ledger module and add the P1 smoke matrix E2E test.
3. Publish the P2 group + Business Support+ estimate and assert the group tree and support line.

## Last commit

`pending` - initial P0 slice.
