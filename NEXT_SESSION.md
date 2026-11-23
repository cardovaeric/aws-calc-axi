# Next session prompt

Paste this into a new session to continue implementation.

---

You are the implementation agent for `aws-calc-axi` in `/Users/cardova/Git/aws-calc-axi`.
Work autonomously and single-threaded. Do not spawn subagent swarms or dynamic workflows.

## Read first, in this order

1. `AGENTS.md`
2. `STATUS.md` (current state, receipts, open gaps)
3. `PLAN.md`
4. `COVERAGE.md` and `docs/DECISIONS.md`
5. `README.md` (usage and how verification works)
6. `analysis/FINDINGS.md`
7. `.agents/skills/axi/SKILL.md`

## Current state (as of commit 5503b00, branch develop)

- P0, P1, and P2 are green. `npm run typecheck`, `npm run lint`, `npm test` (57), `npm run e2e`
  (11, stable across runs), `npm run ledger` all pass.
- Six ledger rows have public links, rendered-DOM receipts, recompute-probe oracles, and
  screenshots in `receipts/screenshots/`.
- Four fixtures compute natively but have no public receipt yet because the 25-link day budget was
  exhausted: `examples/xray.yaml` (50.00), `examples/cloudformation.yaml` (2736.60),
  `examples/eventbridge.yaml` (10.00), `examples/athena.yaml` (14.85). They are frozen in
  `e2e/golden-natives.test.ts`.
- The publish budget file `~/.cache/aws-calc-axi/publishes.json` counts per UTC day; it still says
  2026-11-23 with 26 publishes, so a new day starts fresh. Do not raise the cap without a
  documented reason.

## Task 1 (do this first): publish the four native fixtures

For each of the four examples above:

1. `aws-calc-axi publish examples/<name>.yaml --oracle --receipt receipts/p3-<name>.json`
   (use `--name "axi-e2e <Name>"` on the first publish so the link carries the canonical name).
2. Confirm `render: pass` and `oracle: pass`. The oracle is a second link whose
   `metaData.source` is not the calculator, so the share page recomputes it from
   `calculationComponents`.
3. Add a row to `LEDGER` in `src/ledger.ts` with the frozen expected cents and the receipt path.
4. `npm run ledger` and `npm run e2e`; both must pass. Capture a screenshot with
   `node scripts/screenshots.ts`.

Acceptance: four new ledger rows, each with a public link, a passing rendered DOM, and a passing
recompute oracle. If a rendered total differs from the native golden, treat the native value as
suspect until the UI explains it, then fix the engine (not the expectation).

## Task 2: non-empty data transfer pricing

This is the biggest generic gap. The engine currently accepts empty `dataTransferV2` rows and
fails closed on non-empty ones (`src/engine/inputs.ts`).

1. Reproduce end to end: build an estimate with S3 outbound transfer (for example
   `amazonSimpleStorageServiceGroup` with `awsS3DataTransfer` and a non-empty OUTBOUND row), then
   compare with a recompute probe.
2. Study the live implementation in `analysis/bundle.js`: `dataTransferPricing`,
   `getDataTransferUnitConversion`, `calculateTransferBlockPrice`, the `Inbound`/`Outbound`/
   `Intra-Region` summary builder, and free-tier behavior. Pricing data lives under the
   definition's `datatransfer-calc` mapping.
3. Implement it in the engine as a native module. Fail closed on unknown destination regions or
   missing meters. The config summary must match the live `DT <type>: <region> (<n> <unit>)` shape.
4. Add unit tests with a small pricing fixture, a golden fixture spec, and a published receipt.
5. Add the ledger row.

## Task 3: columnFormIPM (repeatable table inputs)

63 services in us-east-2 use `input.subType: columnFormIPM` (EBS volumes, instance rows, RDS
storage, and similar). This is the gate to the next coverage tier.

1. Inspect several definitions and the live component code (search `columnFormIPM` in the bundle)
   to learn the value shape, per-row validations, `subComponentsList`, and config summaries.
2. Implement the input and its save format (`{value: [...]}`), keeping unknown subcomponents
   fail-closed.
3. Pick one simple service that only needs `columnFormIPM` (run `node scripts/scan.ts` after the
   change), add a fixture, verify against the recompute probe, and add the ledger row.
4. Then work through the next services one at a time. Do not add a row until its public page
   renders.

## Constraints and pitfalls

- No pushes, no main, no force pushes, no branch deletion. Commit small changes on `develop`.
- Never use an em dash; use a plain hyphen. Never edit `CHANGELOG.md` or generated files.
- No interactive prompts. No skipped or weakened tests. Fix flakiness instead of retrying.
- Estimate names must start with `axi-e2e`. Links are public; no secrets in estimates.
- Reuse links: `publish --receipt <path>` reuses the stored link when the spec hash matches. Use
  `--force-publish` only when the fixture genuinely changed and needs a new link.
- Publishing writes `source: "calculator-platform"` so the page renders stored costs like a native
  estimate. Math parity comes from the `--oracle` probe, not from clicking "Update estimate"
  (that path only recomputes stale estimates and has a unit-migration quirk).
- The calculator addresses estimates in the URL fragment. The verifier appends a cache-busting
  query before the fragment; never open two estimates without it or you will read the old page.
- Definition defaults follow the live UI fallbacks: a dropdown with no default selects its first
  option; a declared default missing from the options falls back to the first. Explicit user
  overrides with unknown values must fail closed.
- File size validations use the output unit (validate after conversion). Frequency and duration
  validations use the entered amount. Definition defaults are not rejected for violating their own
  validations; user overrides are.
- Percent inputs keep the fraction in state and in the config summary.
- The share page recomputes support at render time. Group landing pages list top-level group rows
  with subtotals, not the services inside them.

## Definition of done for this session

- All gates pass: `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`, `npm run ledger`.
- Task 1 has four new passing ledger rows with receipts and screenshots.
- Task 2 or Task 3 has at least one new ledger row with a rendered receipt and oracle pass, plus
  regression tests.
- `STATUS.md` is current (what works, gates, ledger summary, blockers, next three actions, last
  commit). `docs/DECISIONS.md` records any decision made without the plan owner.

## Stop conditions

Stop when all tasks above are green, a hard external blocker makes progress impossible (document
it in `STATUS.md` with evidence), or no progress is made on the same issue after three distinct
attempts with no alternative path. Leave the repo clean, commit all work, and close the
agent-browser session.
