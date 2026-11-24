# Repeatable rows: investigation, verdict, and the column-form coverage correction

Date: 2026-11-24. Branch: `cardovaeric/w2-repeatable-rows`.
Commits: `872db36` (engine), `c0cb9bf` (receipts, fixtures, ledger, goldens), `c13b82e`
(tracker and docs).

## Verdict: the task premise was wrong, and the proof is reproducible

The live calculator's column form holds **exactly one row per component**. The saved value is an
array, but both rehydration paths read `value[0]`, and the live form represents a second
configuration as a **second service**. So "repeatable rows" is not a live feature, and the
coverage tracker's blanket `repeatable-rows` gap was an unfounded assumption.

Bundle evidence (`analysis/bundle.js`, sha256 `adbd5f41...`, identical to the live
`https://calculator.aws/42c3e45d-da28-4f7f-9043-598b787291c1/static/js/bundle.js`):

- Module `712` (`columnFormIPM`) exports one symbol: `r.d(t,"b",()=>ae)`.
- `ae` (the recompute) starts `... const {..}=r, h=n[0], m={}; for (const p in h) {..}` and every
  later use is built from `h`: prices, `configSummaryString: ee(h,u)`,
  `initialState: {value: h}`.
- The SaveAndShare module (module at offset 2970878) imports `a=r(712)` and, in its
  `columnFormIPM` branch, calls `Object(a.b)(region, manifest, component, value, ...)`. The
  editor's "Update estimate" button calls `onSaveEstimate`, i.e. this path.
- The convert-from-save path `ge` normalises the array to `{value: [row[0]]}`.
- The save converter (`Mn.convertToSaveFormat`) writes `{value: [...rows]}`, but the component
  state is one row, so a native save is a one-element array.
- The component UI (`createRows`/`render`) renders one control per row definition, keyed by
  `row.selectorId`; there is no add/remove row control.
- A card-level repeatable mechanism exists (`repeatableCardsFn`; cards clone with
  `<componentId>_<instanceId>` ids), but 0 of 441 definitions declare `repeatable` or
  `repeatableInstance`, and `aws-calc-axi update --check --definitions` reports 0 changed
  definitions against the live site.

Live observations (all in `receipts/column-form-rows-probe.json`):

| Probe | Stored rows | Editor recompute | Sum if rows counted |
| --- | --- | --- | --- |
| DAX two rows (`b84b9ef...`) | r5.large x3, r5.xlarge x1 | 558.45 (row 0) | 930.75 |
| CodeBuild two rows (`88e2779...`) | arm1.2xlarge, arm1.large | 9.00 (row 0) | 10.50 |
| CodeBuild two rows reversed (`611b9a1...`) | arm1.large, arm1.2xlarge | 1.50 (new row 0) | 10.50 |

Reversing the array flips 9.00 to 1.50, so the behaviour is positional row 0, not a sum and not
a maximum. Storage keeps both rows; the editor's summary names row 0 only.

A real user's estimate made in the live UI (`axi-e2e ui-made rows probe`,
`ff02068c...`) stores two CodeBuild configurations as two services,
`awsCodeBuild-e2f76b57-...` (9.00) and `awsCodeBuild-1a2b207d-...` (4.50), each with its own
`columnFormIPM` value of exactly one row. Repeated component ids do not appear. Screenshots:
`receipts/screenshots/probe-two-rows.png`, `probe-two-rows-reversed.png`.

## What changed

Engine (`src/engine/column-form-loader.ts`, `src/engine/column-form.ts`):

- `columnFormIPM` prefetch is gated by card and component `displayIf`, evaluated from overrides
  plus definition defaults. Before this, every CodeBuild compute type card was prefetched, so an
  explicit CodeBuild spec still failed closed on a hidden card's selector. This is why CodeBuild
  could not evaluate at all.
- Count exports with a suffix (`countDT`, `count_1`, `count_db`) drive the row count, matching
  the live engine's prefix match (`te`). ElastiCache data tiering with 0 nodes used to bill one
  node; it now bills 0.
- A strategy-only config summary no longer starts with a separator (`", Pricing strategy (...)"`).
- More than one row fails closed with a message that names the proven live behaviour and points
  at the evidence, instead of the old "not implemented yet".

Tests (`tests/column-form.test.ts`, `e2e/golden-natives.test.ts`):

- multi-row fail-closed message, one-element-array equivalence, suffixed count, strategy-only
  summary, `displayIf` visibility (default, override, unknown reference stays visible), and a
  native golden per proven service plus a repeated-service batch golden.

Tracker (`scripts/coverage.ts`, regenerated `analysis/COVERAGE_TABLE.md` and
`analysis/coverage-matrix.csv`):

- Removed the blanket `repeatable-rows` gap and the "any column form is partial" rule.
- Added `regex-remap` for `remap.keyValue` keys that start with `/` (the live engine treats them
  as regular expressions; this engine does a plain lookup).
- `receipts()*.json` files with `"kind": "research-probe"` no longer count as render receipts.

Proof artifacts:

- `receipts/p2-column-form-rows.json` - editor receipt, verdict pass.
- `receipts/column-form-rows-probe.json` - the bundle path and live DOM evidence.
- `examples/{codebuild,elasticache,msk,keyspaces}-column-form.yaml`,
  `examples/column-form-rows.yaml`.
- `src/ledger.ts` row `column-form-rows-use2`, `COVERAGE.md` regenerated.
- `analysis/FINDINGS.md` section 13, `docs/DECISIONS.md` D-024 to D-026, `STATUS.md`.

## Coverage delta

`npm run coverage -- --evaluate --offline`, before (`HEAD~3`) to after:

| Class | Before | After |
| --- | ---: | ---: |
| clean | 353 | 382 |
| partial:column-form | 62 | 33 |
| blocked:column-form | 17 | 17 |
| blocked:subtype | 9 | 9 |

| Priority | Before | After |
| --- | ---: | ---: |
| P1 | 35 | 23 |
| P2 | 123 | 132 |
| P3 | 252 | 255 |

`repeatable-rows` occurrences in the tracker: 72 before, 0 after.

The 29 definitions that moved `partial:column-form -> clean`:

amazonDynamoDb, amazonDynamoDbDaxClusters, amazonElasticGraphics, amazonElasticVMwareService,
amazonGameLiftStreams, amazonLightsail, amazonManagedStreamingForApacheKafkaMsk, amazonOmics,
amazonSageMaker, amazonTranslate, awsCodeBuild, lightsailContainers, lightsailManagedDatabases,
lightsailObjectStorage, lightsailVirtualServers, omicsReady2RunWorkflows, omicsWorkflows,
realTimeDocumentTranslation, sageMakerAsynchronousInference, sageMakerBatchTransform,
sageMakerCodeEditor, sageMakerDataWrangler, sageMakerOnDemandNotebookInstances,
sageMakerProcessing, sageMakerRStudioOnSageMaker, sageMakerRealTimeInference,
sageMakerStudioNotebooks, sageMakerTraining, simSpaceWeaver.

Representative rows, before and after:

| Service | Before | After |
| --- | --- | --- |
| awsCodeBuild | P1 partial, gaps `repeatable-rows` | P3 clean, no gaps |
| amazonManagedStreamingForApacheKafkaMsk | P1 partial, gaps `repeatable-rows` | P3 clean, no gaps |
| amazonKeyspaces | P1 partial, gaps `additional-pricing-data;dependent-selectors;repeatable-rows` | P1 partial, gaps `additional-pricing-data;dependent-selectors;regex-remap` |
| amazonElastiCache | P1 partial, gaps `additional-pricing-data;dependent-selectors;repeatable-rows;ri-payment-upfront` | P3 partial, gaps `additional-pricing-data;dependent-selectors;regex-remap;ri-payment-upfront` |
| amazonTimestream | P1 partial, gaps `additional-pricing-data;dependent-selectors;repeatable-rows` | P1 partial, gaps `additional-pricing-data;dependent-selectors` |
| amazonFSxForLustre | P1 partial, gaps `dependent-selectors;repeatable-rows` | P1 partial, gaps `dependent-selectors` |
| amazonRedshift | P1 partial, gaps `dependent-selectors;repeatable-rows;ri-payment-upfront` | P1 partial, gaps `dependent-selectors;ri-payment-upfront` |

Two of the 29 (`amazonGameLiftStreams`, `realTimeDocumentTranslation`) are statically clean but
their default selector has no price set in the region (`runtime: missing-price`). They need a
fixture with an available selector value, not a repeatable-rows fix.

## Receipts and verdicts

`receipts/p2-column-form-rows.json`
(`https://calculator.aws/#/estimate?id=0a75b381ce55078a95880d40349e5ab6f2a44fed`):

- oracle: editor-recompute, verdict pass, mismatches `[]`.
- services: AWS CodeBuild 9.00, AWS CodeBuild 4.50 (the live "second row" shape), Amazon
  ElastiCache 454.06, Amazon MSK 489.90. Total 957.46, annual 11,489.52. Read-only render also
  passed.

`receipts/column-form-rows-probe.json` - research probe links listed above; storage and DOM
values recorded. Not a render receipt, and the tracker ignores it.

## Gates

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: 107 tests, pass
- `npm run e2e`: 28 tests, pass (including the new ledger row re-read and the new goldens)
- `npm run ledger`: 16 rows, all pass

## What still fails closed

- **Multi-row column forms** are intentionally rejected: the live editor prices row 0 only, so
  publishing a sum would not be reproducible. Add the service once per configuration, which is
  what the live UI does.
- **Dependent selectors** (ElastiCache, Keyspaces, Timestream, FSx for Lustre, Redshift and the
  rest of the 33 partial column-form definitions) remain unimplemented and out of scope here.
- **Additional pricing data** (Database Savings Plans joins), **regex key remaps**, and
  **reserved/upfront totals** remain fail-closed.
- **`percentInput` save format** (D-026): the live component saves the entered percent and
  divides by 100 on rehydrate; this engine saves the fraction. A first batch receipt that
  included Keyspaces failed the editor oracle by exactly 0.06 (native 25.69, editor 25.63).
  The fix belongs in `src/engine/inputs.ts`, which another worker owns this session. Keyspaces
  therefore has a native fixture and golden but no receipt yet.
- **Publish budget**: this session used 4 publishes plus 1 live-UI save against a shared counter
  that the main worktree's conformance run was using. Each publish above the default 25 used an
  explicit `AWSCALC_MAX_PUBLISHES_PER_DAY` value (80-95) for that single publish; the default cap
  is unchanged. Details in `docs/DECISIONS.md` D-025.
