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
6. `analysis/FINDINGS.md` (especially sections 9 and 10)
7. `.agents/skills/axi/SKILL.md`

## Current state

- `npm run typecheck`, `npm run lint`, `npm test` (87), `npm run e2e` (19), `npm run ledger`
  (12 rows) all pass.
- 12 ledger rows have public links, rendered-DOM receipts, oracles, and screenshots.
- Non-empty `dataTransferV2` pricing is native. Because the read-only share page drops these
  rows, those receipts use `publish --oracle-editor` (click "Update estimate" and diff the
  editor). Receipts record `oracle.kind`.
- `columnFormIPM` is native for the simple PLC_2.0 subset. `examples/dax.yaml` (558.45) is the
  first row; the scanner now reports 106 of 160 services inside the implemented subtype set and
  57 evaluating with defaults.
- The publish budget for 2026-11-23 is spent (46 links; see D-017). A new UTC day starts fresh.
  Do not raise the cap without a documented reason, and reuse receipts where the spec hash
  matches.

## Next tasks (in order)

1. `columnFormIPM` coverage, one service at a time:
   - Add the live "first available selector value" fallback (the live form takes the first
     option from the component tree when a selector has no default), then re-run
     `SCAN_EVALUATE=1 node scripts/scan.ts`.
   - Pick services whose defaults then resolve, publish with `--oracle`, add a ledger row and a
     screenshot.
   - Extend the adapter in the order the data demands: dependent selectors, `remap.constant`,
     utilization rows, then tiered PLC_2.0 patterns. Keep everything else fail-closed.
2. Implement `throughput` (29 services) and `utilization` (12 services) inputs from the live
   bundle formulas (`performThroughputCalculation`, `calculateUtilizationValue`), with unit
   tests, a fixture, a receipt, and a ledger row.
3. Add a data transfer destination-override fixture (inter-region to a region with its own
   meter) to pin the uncommon-group path in a published receipt.

## Constraints and pitfalls

- No pushes, no main, no force pushes, no branch deletion. Commit small changes on `develop`.
- Never use an em dash; use a plain hyphen. Never edit `CHANGELOG.md` or generated files.
- No interactive prompts. No skipped or weakened tests. Fix flakiness instead of retrying.
- Estimate names must start with `axi-e2e`. Links are public; no secrets in estimates.
- `publish --receipt <path>` reuses the stored link when the spec hash matches.
  `--force-publish` only when the fixture or the saved contract genuinely changed.
- Publishing writes `source: "calculator-platform"`. Math parity comes from the oracle, not from
  clicking "Update estimate" on a normal row (that path recomputes stale estimates and has a
  unit-migration quirk). Data transfer is the documented exception.
- The calculator addresses estimates in the URL fragment. The verifier appends a cache-busting
  query before the fragment; never open two estimates without it.
- Definition defaults follow the live UI fallbacks (dropdown: first option; declared default
  missing from options: first option). Explicit user overrides with unknown values fail closed.
- File size validations use the output unit; frequency and duration validations use the entered
  amount; percent inputs keep the fraction in state and summary.
- Untouched `dataTransferV2` rows are saved with `unit: "tb_month"`, matching native payloads.
- PLC_2.0 mappings are selector trees, not flat metered unit maps; keep them out of the flat
  price loader.

## Definition of done for this session

- All gates pass: `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`,
  `npm run ledger`.
- At least one new ledger row with a rendered receipt and a passing oracle, plus regression
  tests, for each new adapter.
- `STATUS.md` is current. `docs/DECISIONS.md` records any decision made without the plan owner.
  `analysis/FINDINGS.md` records new live evidence.

## Stop conditions

Stop when the tasks are green, a hard external blocker makes progress impossible (document it in
`STATUS.md` with evidence), or no progress is made on the same issue after three distinct
attempts with no alternative path. Leave the repo clean, commit all work, and close the
agent-browser session.
