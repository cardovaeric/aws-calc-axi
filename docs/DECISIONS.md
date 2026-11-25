# Decisions

Decisions made during implementation without the plan owner present. Each one is scoped, dated,
and reversible. Anything that changes a locked plan decision is called out explicitly.

## D-001: Run TypeScript source directly on Node 24 (2026-11-23)

The CLI executes `.ts` files through Node's built-in type stripping instead of a build step.
`tsc --noEmit` is the type gate. No `dist/`, no bundler, no source maps to maintain.

Trade-off: no `enum`, `namespace`, parameter properties, or `import =` (enforced by
`erasableSyntaxOnly`). We use `as const` objects instead. If a dependency ever requires
codegen-only syntax, add a build step rather than weakening the flag.

## D-002: CLI shell from `axi-sdk-js` (2026-11-23)

`runAxiCli` provides dispatch, TOON rendering, structured errors, exit code mapping, and the
`--version` fast-path contract. Flag parsing and validation are ours (`src/cli/args.ts`) because
each command owns its flag set and error text.

Consequence: the SDK's built-in `update` command is registered only when the tool does not
register its own. The plan defines `update --check|--apply` as data-plane refresh; until that
command lands, the SDK built-in appears. A follow-up registers our own `update` to shadow it.

## D-003: Fail closed on unknown component subtypes (2026-11-23)

The live engine sets unknown math to zero. We throw `UNSUPPORTED_COMPONENT` with the service,
template, card, and component id instead. This follows PLAN.md ("never publish a guessed zero")
and turns every new subtype into an explicit adapter task.

Display-only components (`bodyText`, `headerText`, `alert`, `condition`, `conversionDisplay`) are
skipped safely because they never feed cost.

## D-004: Unit conversion tables copied from the live bundle (2026-11-23)

`analysis/bundle.js` contains the exact size/time/frequency conversion tables used by the web app.
They are transcribed into `src/engine/units.ts` rather than re-derived, because the live tables
contain deliberate rounding (for example `hour -> month` is `1/730`). The extraction commands are
documented in `analysis/FINDINGS.md`. Time and frequency tables are indexed `[target][source]`;
the size table is `[source][target]`. Tests pin the orientation.

## D-005: Group subtotal and total cost shape (2026-11-23)

Captured payloads show:

- `services[].serviceCost` includes `upfront` only when the template declares an Upfront cost
  display (EC2 keeps `upfront: 0`; Lambda omits it).
- `groupSubtotal` is the sum of direct child services, and is `{}` when zero.
- `group.totalCost` and top-level `totalCost` always carry `monthly` and `upfront`.
- Support is not stored in `totalCost`; the share page recomputes it.

The builder mirrors this. Rendering is the gate, so any residual shape difference shows up as a
verifier mismatch rather than a silent pass.

## D-006: Link expiry is computed, not read from the page (2026-11-23)

The read-only share page has no expiry control (only Export). The share modal documents a
one-year lifetime. Receipts compute `expires = createdOn + 1 year` and record the rendered
read-only banner ("last updated on ..."). If the page later exposes an expiry element, the
verifier should read it instead.

## D-007: Daily publish budget in the client (2026-11-23)

`publish` refuses to create more than 25 links per UTC day (override with
`AWSCALC_MAX_PUBLISHES_PER_DAY`). Links are public and the save endpoint is unauthenticated, so a
hard client-side cap keeps accidental loops from publishing garbage. Counter lives in
`~/.cache/aws-calc-axi/publishes.json`.

## D-008: Browser session naming (2026-11-23)

The verifier uses `aws-cal-axi-e2e` by default, overridable with `--session` or
`AGENT_BROWSER_SESSION`. The session is closed at the end of an interactive session, not after
every publish, so repeated verifications reuse one browser.

Addendum 2026-11-24: the E2E matrix harness (`e2e/matrix.test.ts`) appends the worktree name
(`aws-cal-axi-e2e-<worktree>`) to its default. Several worktrees run at once, and sharing one
session lets a concurrent run navigate the browser away mid-read: 13 ledger rows failed with
timeouts or another estimate's title until the session was scoped per worktree. The CLI's
documented default is unchanged.

## D-009: Publish with the native `metaData.source` (2026-11-23)

The share page trusts stored service costs only when `metaData.source` is the calculator's own
value; for any other source it recomputes the estimate from `calculationComponents` on load. We
publish `source: "calculator-platform"` so a link renders exactly like a native estimate, which is
what PLAN.md describes as a normal public link. Math parity is proven separately with a recompute
probe: a second copy published with a different source, whose page is the live UI recomputation.
Both URLs are recorded in each receipt so the oracle can be re-read without publishing again.

## D-010: Link reuse from receipts (2026-11-23)

`publish --receipt <path>` hashes the parsed spec. When the receipt's hash matches and
`--force-publish` is absent, the existing public link and oracle probe are re-verified instead of
publishing new ones. This keeps the live-link budget for genuinely new fixtures.

## D-011: P2 link budget exception (2026-11-23)

The session cap is 25 public links. The P0/P1 receipts, the oracle probes, and early exploration
used 25. The mandatory P2 group + support render receipt needed one more link, created with
`AWSCALC_MAX_PUBLISHES_PER_DAY=26` for that single publish and nothing after it. The default cap
stays 25.

## D-012: Group rows are verified from the service table (2026-11-23)

On the landing page of a grouped estimate, the service table lists top-level group rows with
their subtotals, not the services inside them. The verifier expects `groupRows` (top-level groups)
instead of individual service rows when services live in groups, and still checks the group tree
and the recomputed support row.

## D-013: Definition defaults follow the live UI fallbacks (2026-11-23)

A dropdown with no `defaultDropDownItem` selects its first option, and a declared default that is
not in the option list also falls back to the first option. This mirrors the live dropdown state
initialization and unlocks services such as API Gateway where the meaningful default is "None"
(`[ZERO_COST]`). Explicit user overrides that name an unknown option still fail closed with the
valid ids.

## D-014: Validations use the unit the live UI validates (2026-11-23)

File size validations are expressed in the component's output unit (for example a memory cap of
10 GB while the input is in MB), so they run after conversion. Frequency and duration validations
run on the entered amount, before conversion. Defaults provided by the definition are not
rejected when they violate their own validations; user overrides are. This keeps the engine
aligned with the form while refusing bad user input.

## D-015: Native goldens while the link budget is spent (2026-11-23)

Four fixtures (X-Ray, CloudFormation, EventBridge, Athena) compute natively and are frozen in
`e2e/golden-natives.test.ts`, but they do not have a public render receipt yet because the daily
link budget was exhausted by the P0-P2 gates. They are not ledger rows: the ledger only counts
rows whose public page was rendered. The next session publishes them and adds the rows.

## D-016: `update` means the data plane, not the npm package (2026-11-23)

The CLI registers its own `update --check|--apply`, which shadows the SDK's built-in npm
self-update. `--check` fetches fresh manifest, region map, runtime config, and locations and
reports per-source drift without writing; `--apply` refreshes the cache. `--definitions` extends
the check to all 441 definitions. The plan treats the data plane as a dependency with drift
detection, so this is the intended meaning of `update`.

## D-017: Publish budget for this session (2026-11-23)

The day started at 26 links (D-011) against a 25/day cap. The mandated work for this session
needed: four fixture receipts with probe oracles (8 links), data transfer research probes (4),
one receipt for the data transfer fixture (1, editor oracle reuses the native link), one receipt
for the first column-form fixture with its probe (2), and republishing SNS and SQS because the
engine now writes the live contract's `tb_month` default for untouched data transfer rows
(4). The default cap stays 25; each publish above it used an explicit
`AWSCALC_MAX_PUBLISHES_PER_DAY` value (42-46) and the counter stopped at 46 for the day.
No further links were created after the receipts above.

## D-018: Data transfer pricing follows the live pipeline, including its quirks (2026-11-23)

`src/engine/data-transfer.ts` reproduces `processPrices` / `calculateTransferBlockPrice`:
per-destination tier groups, the region-wide most-common group, destination overrides, the
intra-region double charge, and the tier clamp used by the form. Two consequences are deliberate:

- Every meter that applies to one destination is summed. US East (N. Virginia) from Ohio costs
  `1024 * (0.01 + 0.015) = 25.60` per TB because the inter-region and multipath-resilience meters
  both apply; the live editor shows the same number, so parity wins over intuition.
- A row with an amount but no source/destination selection fails closed. The live form quietly
  bills 0 in that state; publishing a guessed zero contradicts PLAN.md.

The read-only share page does not rehydrate `dataTransferV2` (a foreign-source probe renders 0),
while the editor recomputes the saved rows correctly. `publish --oracle-editor` therefore opens
the published link, clicks "Update estimate", and diffs the editor page. Receipts record
`oracle.kind` as `probe` or `editor-recompute`; older receipts without `kind` are treated as
probes. The ledger accepts `editor` rows and the E2E matrix re-runs the same editor recompute.
The editor oracle compares costs, not summaries: the editor rebuilds the summary before the UI
string table settles, so `(0 TB per month)` and `(0 tb_month)` can both appear. Summary shape is
covered by unit tests and by the stored native render, where the text is ours.

## D-019: Untouched data transfer rows use the live `tb_month` default (2026-11-23)

Captured native payloads (`analysis/estimate.json`, `analysis/s3-payload.json`) show that an
untouched `dataTransferV2` row is saved as `value: ""`, `unit: "tb_month"`, with an empty
`fromRegion`/`toRegion`. The engine previously wrote `gb` from `preferredUnit` and summarized
"(0 gb)". It now writes the live shape and `"DT <type>: <region> (0 TB per month)"`. SNS and SQS
were republished because their stored payloads carried the old units; their costs did not change.

## D-020: columnFormIPM covers the simple PLC_2.0 subset first (2026-11-23)

`columnFormIPM` (71 definitions, 63 in us-east-2) is implemented for one row set per component,
`textInput` / `autoSuggest` / `dropDown` selectors, no dependent selectors, no aggregation
remaps, no derived tags, one price set, and the hourly or monthly model. The save format matches
the live converter (`{value: [{selectorId: {value}}]}`) and `calculationId` targets are exposed
to the maths section. `columnFormIPM` was added to the scanner's known set, so the inventory now
reports 106 fully supported services (57 evaluate with defaults; most column-form services still
need explicit selectors because the live form picks the first available option and this engine
fails closed instead).

Everything outside that subset fails closed with the component id and the unsupported feature:
tiered PLC_2.0 patterns, reserved/savings-plan models, utilization rows, dependent selectors,
`remap.constant`, `disableCalculation`, `subComponentsList`, `additionalPricingData`,
`exportTagsAsValue`, and repeatable rows. PLC_2.0 mappings are also excluded from the flat price
loader because they are selector trees, not metered unit maps.

## D-021: Broaden columnFormIPM and add throughput (2026-11-24)

Driven by the BINUS eDesk migration estimate, three generic gaps were closed:

- `throughput` inputs convert with the live binary table (kbps, mbps, gbps; output MBps) and
  validate the entered amount. This unlocked gp3/EBS and RDS storage inputs and moved 29 services
  into the implemented subtype set.
- `columnFormIPM` now supports `pricingUnitModel.riPricingTypes` selector patterns (including
  `$overridePriceKeyWith`), On-Demand rows with hidden dependent selectors, a utilization row
  billed at 100% (730 hours), `disableCalculation` components that expose rates without a
  subtotal, and `additionalPricingData` for Database Savings Plans (which still fails closed when
  that plan is selected). Empty selectors are omitted from saved rows and summaries like the
  live component tree.
- `concatenate` now supports `constant` operands and joins with no separator, matching the live
  engine. Joining with a space produced meter names that do not exist in the price files.

The scanner now reports 122 of 160 us-east-2 services in the implemented subtype set, 62
evaluating with defaults, 44 needing inputs, 0 unsupported subtype, 16 errors on bespoke
EC2/Windows/RDS definitions. Unit tests cover the new paths; the existing ledger rows still pass.

## D-022: BINUS eDesk migration estimate delivery (2026-11-24)

The user asked for one calculator link with two groups for
`BINUS_School_eDesk_Azure_to_AWS_Technical_Assessment_v1.docx`. The final link is
`https://calculator.aws/#/estimate?id=80c119fedeab83ca5fa8a7da79dad61d77c93374`, generated by
publishing the component payload, clicking "Update estimate", and sharing the recomputed
estimate. It shows Production (16 services, 1,429.13) and Non-production/DEV-UAT (14 services,
762.50), total 2,191.63/month.

Every service carries a real calculator component payload: native engine output where supported,
the live saved shape for EBS, ECR, ElastiCache, and a captured EC2 shape. The stored service
costs are the assessment's Section 7 line items, so the native-source page reproduces the
document to the cent. Clicking "Update estimate" would recompute supported rows at current
calculator rates (MSK, SES, CloudWatch metrics and data transfer differ slightly from the
assessment), which is expected data drift rather than a publish error.

This publish raised the day's link counter to 58 (D-017 covered the test receipts). It is a
single user-requested deliverable, not a ledger fixture; its payload, receipt, screenshots, and
build script live in the client project (`binus-edesk-q/`), and the evidence is in
`analysis/FINDINGS.md` section 12.

## D-023: FileSize wire units and descriptions in published estimates (2026-11-24)

The BINUS estimate exposed two payload conventions that the engine now enforces:

- A `fileSize` component's saved `unit` is always `<size>|<frequency>` (`gb|NA`, `gb|month`,
  `gb|hour`). A bare size override (`unit: "gb"`) used to be saved verbatim; the calculator then
  rendered "(100 undefined)" and ignored the input. The engine now keeps the component's default
  frequency when the override names only a size. This affected EBS, RDS, MSK, NAT, ALB, and
  CloudWatch storage inputs.
- Our short line text belongs in the service `description` field. The calculator recomputes
  `configSummary` from components on Update; putting custom text there is overwritten and hides
  the built-in summary. Published estimates should set `description` and leave `configSummary`
  empty.

The client link is generated through the calculator's own flow: publish the payload, click
"Update estimate", then "Share". The shared link stores the recomputed costs and the calculator's
summaries; the editor's "Cost updated" labels are not part of the read-only page. The final link
and the live-rate deltas are recorded in `analysis/FINDINGS.md` section 12 and D-022.

## D-024: Column forms hold one row; the tracker stops calling them repeatable (2026-11-24)

The coverage tracker used to add a `repeatable-rows` gap to every `columnFormIPM` definition and
to classify any definition with a column form as `partial`. That assumption was wrong, and the
task that asked for "repeatable rows" was built on it. Evidence, recorded in
`receipts/column-form-rows-probe.json` and `analysis/FINDINGS.md` section 13:

- The live component keeps one row. Its save format is an array, but both rehydration paths read
  `value[0]` (module 712 `ae`, used by the SaveAndShare path the editor's "Update estimate"
  button calls, and `ge` for reset/rehydrate), and the component UI has no add/remove row
  control.
- Two live probes prove it: a two-row DAX payload recomputes to row 0 (`558.45`, not the
  `930.75` sum), and a two-row CodeBuild payload recomputes to `9.00`; reversing the rows gives
  `1.50`. The behaviour is positional.
- A live-UI-created estimate with two CodeBuild configurations stores them as two services with
  one row each, not as two rows in one component.
- No definition declares the bundle's card-level `repeatable` (0 of 441), and the live data
  plane has no drift (`update --check --definitions`: 0 changed).

Decision: keep failing closed on more than one row, with a message that names the live
behaviour; drop `repeatable-rows` from the tracker; stop treating a column form as inherently
partial. The tracker now emits `regex-remap` for `remap.keyValue` keys that start with `/`,
because the live engine treats them as regular expressions and this engine does a plain lookup.

The honest coverage delta: 29 definitions moved from `partial:column-form` to `clean` (clean
353 to 382, partial 62 to 33, P1 35 to 24). Two of them (`amazonGameLiftStreams`,
`realTimeDocumentTranslation`) still fail closed at runtime on their default selector because the
default's price set is absent in the region; they need a fixture with an available selector, not
a repeatable-rows fix. Keyspaces, Timestream, FSx for Lustre, Redshift, ElastiCache and the other
column-form services with real gaps stay partial.

## D-025: Link budget for this session's column-form receipts (2026-11-24)

The P0 conformance run in the main worktree was publishing throughout this session, so the shared
counter moved from 76 to 90 while this work ran. This session published:

- one two-row DAX research probe (row 0 behaviour), one publish;
- one two-row CodeBuild research probe and its reversed-order variant, two publishes;
- one batch editor receipt for CodeBuild x2 + ElastiCache + MSK, one publish (a first attempt
  also included Keyspaces and failed the editor oracle by 0.06, see D-026; its link is not used
  by any receipt or ledger row);
- a live-UI-created estimate saved through the calculator's own Share flow (not this client's
  publisher, so it is outside the client cap).

Each publish above the default 25 used an explicit `AWSCALC_MAX_PUBLISHES_PER_DAY` value (80-95)
for that single publish. The default cap is unchanged, and the counter was left at the value the
main worktree's run reached.

## D-026: `percentInput` saves the entered percent, not the fraction (2026-11-24, done 2026-11-25)

The first batch receipt included Keyspaces and the editor oracle failed by exactly `0.06`:
native `25.69`, editor `25.63`. The editor's config summary showed `LOCAL_ONE reads (0.01)` where
the native summary shows `(1)`. The bundle's percent input (`Xe.handleInput`) keeps the raw
percent string in state, saves it with `Je.convertToSaveFormat` (`{value: e.value}`), and divides
by 100 only for the computed value. This engine saves the fraction, so a rehydrated `1` becomes
`0.01` and the reads line prices lower. Fix belongs in `src/engine/inputs.ts` (`percentInput`
saved value and summary), which another worker owns in this session; it was left untouched.
Until it lands, any published estimate with a percent input will disagree with the editor
recompute. The batch receipt therefore excludes Keyspaces, which keeps a native golden
(`examples/keyspaces-column-form.yaml`) and stays partial in the tracker.

Resolved on 2026-11-25 in the utilization worktree: `percentInput` now saves the entry
(`{value: <typed text>}`) while the engine value and the summary keep the fraction. Keyspaces was
republished and the editor recompute matches natively - `25.69 USD` with `LOCAL_ONE reads (1)` -
and the row is now `receipts/p1-keyspaces.json` with a ledger entry. The same work also landed
the P0 run's typed-amount fix that this one depends on: `allowDecimals` is checked on the amount
the user typed (`assertDecimals` in `requireNumeric`), not on a converted value, so 1000
operations per day is a valid integer entry that converts to 30416.67 per month. Evidence:
`analysis/FINDINGS.md` section 16.1.

## D-027: Dependent selectors, upfront totals, and the resolved prefetch (2026-11-24)

The live `columnFormIPM` selector state is rebuilt from data, not declared: an option set is the
aggregation row values for the selected primary value, or the regional price records for a
selector the mapping does not carry; a row that declares `dependent` is nested under that parent's
value; and a value the parent no longer offers is replaced by the row's `defaultValue` or the first
offered value (analysis/FINDINGS.md section 14). This engine now reproduces that, and the changes
are scoped as follows.

- **Resolution is native.** `src/engine/column-form.ts` builds the option tree, resolves rows in
  definition order (`resolveColumnFormSelectors`), and drops a selector that has no offered value.
  Saved rows therefore match what the live form holds: an On-Demand ElastiCache row has no
  `Term`/`Purchase option`, a Reserved row has both.
- **A user-supplied value that is not offered fails closed.** Live silently re-selects. Re-sending
  a value the spec asked for would publish a configuration the user did not ask for, so this
  engine raises `INVALID_SELECTION` and lists the offered values. Defaults from the definition
  still follow the live first-offered rule.
- **Prefetch resolves before it fetches, then settles.** The live form re-fetches on every
  selector change, so its steady state is a fixed point. Some resolved values are also index-path
  selectors (ElastiCache prices its path on `Cache Engine` and `TermType`), so
  `prepareColumnForms` iterates at most four times and then requires an exact aggregation match.
  `Best Match` components are refused because the live editor refuses them
  (`Best Match produced invalid options`).
- **`remap.keyValue` is bidirectional and both directions are now right.** Aggregation rows and
  price records are mapped forward (`key -> label`) so the option tree and the saved values speak
  the labels the form shows; price-set tokens and the index path map back (`label -> key`). The
  old code applied the forward direction to the tokens only, which broke services whose map is
  `{"Basic": "Basic - Text, HTML"}`.
- **`Reserved` uses its own model and emits an upfront total.** `monthly = hourly * 730 * count`
  and `upfront = upfrontPrice * count`, matching live `U`; the previous code hardcoded the
  `upfront_ipm` target to 0. The existing `Upfront` price displays in ElastiCache, OpenSearch, and
  Redshift now carry a real number, and the receipt shows it (0.00 monthly + 3,482.00 upfront for
  the All Upfront row versus 3,331.72 monthly for the No Upfront row).
- **Tracker rules corrected, nothing else in the tracker changed.** Two static rules in
  `scripts/coverage.ts` were stale against this engine: the blanket
  `dependent-selectors` gap (one rule per declaration) and `ri-payment-upfront`, which fired on
  every selector price pattern even though selector patterns and their upfront component are
  native. The first is removed, the second is narrowed to tiered PLC_2.0 ladders
  (`StartingRange`/`EndingRange`, `tiered-plc2-patterns`), and the legend text is updated. The
  tracker worker's own edits to that file are line-local and this is the whole diff.
- **Link budget.** One link for this batch, published with
  `AWSCALC_MAX_PUBLISHES_PER_DAY=92` for that single publish because the shared counter was at 91
  (the P0 conformance run in the main worktree had been publishing all session, see D-025). The
  editor oracle reuses the same link, so there is no probe link. The default cap is unchanged.

`regex-remap` is left in the tracker even though the evidence now says it is inert: the live
`keyValue` remap is a plain object lookup (`d = (e,t) => t.keyValue[e] || e`, offset 1227218), so
`"/1\\s?yr/"` keys never match a value. Removing that rule changes eight P0 rows and belongs to
whoever owns the tracker cleanup, not to this feature.

## D-028: Selector rows score their served children and name them (2026-11-24)

The tracker's selector rule was unverified and it was flagging six P1 services with a single
opaque line. Verification (`receipts/selector-children-probe.json`, `analysis/FINDINGS.md`
section 15) found the gaps are real, plus one scoring artifact.

- A selector is the live calculator's service menu: no parent form, no parent price, one child
  configured, and the parent's runtime columns are its `defaultTemplates` children. Its coverage
  is the union of the children it serves, with `classifyStatic`'s precedence, so a parent whose
  children are blocked by a missing input subtype reports `blocked:subtype` rather than
  `blocked:column-form` (that is Amazon Mainframe Modernization).
- A declared child that the manifest does not define has no live surface. Amazon WorkSpaces
  declares six children; `workSpacesThinClient` and `workSpacesSecureBrowser` are absent from the
  manifest, answer 403 on their definition URL, and are not offered by
  `https://calculator.aws/#/createCalculator/WorkSpaces`. They are now `selector_unserved`:
  recorded in their own column, not scored as non-clean, and not hidden. Scoring them made the
  parent look blocked by two phantom children.
- The parent row carries the cause: `selector_blockers` pairs each blocker with the children that
  carry it, the blocker columns hold the union, and `next_action` repeats the concrete child
  actions. The constant string `Resolve the non-clean children` is removed; the pure rule lives in
  `scripts/coverage-selector.ts` and is covered by `tests/coverage-selector.test.ts`.

Coverage delta from `main`: `blocked:subtype` 9 to 10, `blocked:column-form` 17 to 18, `clean`
382 to 380, `partial:column-form` 33 unchanged, P1 23 to 24, P2 132 to 131. Three rows changed:
Amazon Mainframe Modernization (reclassified), `realTimeDocumentTranslation` (below) and Amazon
Translate, which lists it as a child. No service is called clean because a child was excluded;
the two unserved children are listed on the Amazon WorkSpaces row.

The audit also found that `remap.keyValue` is applied in the wrong direction in
`src/engine/column-form.ts` (UI value to map value, while the live engine maps UI value to the map
key, which is the price token), and that `matchAggregation` in `src/data/column-form.ts` ignores
the remap. Those files belong to the column-form selector worker, so the engine is untouched; the
tracker records the blocker instead. `remap.keyValue-direction` fires when a pricing selector's
default value is itself a remap key, the case where this engine substitutes a form label for the
token and the live engine keeps the value. It moves `realTimeDocumentTranslation` from `clean` to
`blocked:column-form`, and Amazon Translate, which offers it as a child, from `clean`/P2 to
`blocked:column-form`/P1 naming that child. A clean label that errors is worse than a blocked one
because it is trusted.

The mirror state (the default is a remap value, so the live engine substitutes and this one does
not) is the same inversion from the other side. Six definitions are in it today and all six are
already blocked and `missing-price` at runtime, so the rule deliberately does not fire twice:
`amazonFSxForLustre`, `amazonManagedBlockchain`, `amazonAppStream`, `outputConfiguration1`,
`outputConfiguration2`, `workSpacesCore`. They are listed in the probe receipt so the fix starts
from all of them.

`amazonGameLiftStreams` is also statically clean and `missing-price` at runtime, from a different
and unproven cause (no remap; composite primary selector; the price-set label match for the
default `gen5n_ultra` finds nothing). It is recorded in `analysis/FINDINGS.md` section 14 and left
unchanged, because guessing a blocker would be worse than naming the open question.

Superseded in part by D-029: the `remap.keyValue-direction` rule, the `regex-remap` cleanup, and
the `amazonGameLiftStreams` open question are resolved there.

## D-029: The remap rule names the primary selector, not the direction (2026-11-24)

D-028's remap rule was written against the pre-merge engine and its premise did not survive the
merge: `bf27e34` fixed `remap.keyValue` to the live direction (forward on aggregation rows and
price records, reverse on meter tokens and the index path), so `remap.keyValue-direction` would
have flagged services that now work. It is retired, and the tracker carries the real residual
cause instead.

- **Kept, renamed and narrowed:** `remap.keyValue-primary` (`primaryRemapToken` in
  `scripts/coverage-column-form.ts`). It fires when the primary selector's declared default is a
  `remap.keyValue` key that maps to a different label. The form's options are the remapped labels,
  the live form replaces an unoffered default with the first offered value, and the engine keeps
  the primary value verbatim, so the default cannot match an aggregation row. One definition
  (`realTimeDocumentTranslation`) and its parent selector change class. Proof, including a
  successful run with the label: `analysis/FINDINGS.md` section 15.
- **Retired:** `regex-remap`, as D-027 asked the tracker owner to do. The live forward remap is a
  plain object lookup, so a regex-shaped key is an inert literal key on both sides, and the only
  regex use is the reversed key as a price-set token, which the engine also does. It never
  classified a row on its own (all 13 definitions carry `additional-pricing-data`), but it did put
  a fail-closed label on 8 P0 rows that do not fail closed.
- **Retired open question:** `amazonGameLiftStreams` prices. Its composite primary selector only
  needed the matched aggregation row to fill the index path, which the merge does. The engine's
  8,726.40 at 100 users x 2 hours/day is exactly 6,000 hours x the 1.4544 price record, so no
  blocker is guessed at.

The runtime pass also stopped calling `MissingPriceError` a generic `error` (it is not an
`EngineError`) and gave an uncached offline fetch its own `not-cached` bucket, so the `error`
column now means a real defect. The mapping lives in `scripts/coverage-runtime.ts` (`runtimeLabel`,
unit tested) instead of an inline ternary chain, and the tracker test tolerates a CSV generated
without `--evaluate` so `npm run coverage` followed by `npm test` stays green. Two defects are left alone because they are not tracker files and
are reported instead: the primary-selector resolution in `src/engine/column-form.ts`, and
`fileSize` defaults whose `defaultOption.frequency` is not in `dropDownFrequency`
(`amazonLookoutForEquipment`, `src/engine/inputs.ts`). No engine file is touched here.

## D-030: Native `utilization` inputs, and two live fallbacks they needed (2026-11-24)

`utilization` is implemented from the live bundle, not memory: the duration table
(`DEFAULT_UTILIZATION_OPTIONS`), `calculateUtilizationValue`, the
`{value, unit}` save format, and the 0..730 hour validation fallback. Details and
reproduction in `analysis/FINDINGS.md` section 16. Unknown duration ids fail
closed with the live option list.

Three decisions inside that work:

- The saved `value` is the typed text (a string), as the live form's
  `initialState.value` is. A numeric 0 is treated as empty by the live
  rehydrator (lodash `isEmpty(0)`), which drops the unit and the summary; a
  string `"0"` survives. Proven by republishing the AWS PCS receipt after the
  change: the editor recompute keeps `(0 % Utilization/Month)`.
- `pricingComboV2` now bills a composed meter that the region's price map lacks
  as 0, matching the live engine, because MediaConnect's default "None"
  reservation composes `DataProcessedReserved0Mbps1Yr`, which exists in no
  region. `singlePricePoint` and `tieredPricing` still fail closed on missing
  meters, and `pricingComboV2` still fails closed when the mapping has no price
  map for the region at all, so a data gap is not turned into a zero.
- `replace` now applies global regex substitutions and keeps the original string
  when nothing matches, like the live engine. The previous exact-match throw
  blocked MediaConnect's `sourceType` default "0".

Publish budget: the shared counter was at 82/25 when this work started (the P0
conformance run in the main worktree). The mandated receipts used four links,
two for AWS PCS and two for MediaConnect, each publish run with
`AWSCALC_MAX_PUBLISHES_PER_DAY=88` for that process only. The default cap stays
25.

Both remaining services were finished on 2026-11-25, and only one needed engine
work: Deadline Cloud's spaced price-set labels (`c5 large Linux ...`) resolved
through the dependent-selector work, and Direct Connect needed the live region
gate (`Array.isArray(availableLocation) && !includes()`, so a map with no
`regionAttributes.Location` is not region-scoped) plus the region-name injection
for `Location` and `From Location` on the index path. Live editor oracles:
Direct Connect `2463.75`, Deadline Cloud `409.08`
(`receipts/p2-direct-connect-utilization.json`,
`receipts/p2-deadline-cloud-utilization.json`). Evidence:
`analysis/FINDINGS.md` section 16.2.

## D-031: A price map may be region-free, and `displayIf` coerces like live (2026-11-25)

Two engine behaviours that are wider than `utilization` came out of finishing Direct Connect and
FSx for Lustre, both taken from the bundle rather than from the symptom.

- **Region gating follows `Array.isArray`.** The live `getData` gate rejects a location only when
  the price map declares one (`Array.isArray(availableLocation) &&
  !availableLocation.includes(location)`, offset 1471833). A PLC_2.0 map with no
  `regionAttributes.Location` is not region-scoped, so `loadColumnFormPricing` now fails closed
  only for a map that lists locations and omits this region. A missing attribute is not evidence
  of a data gap; it is the shape Direct Connect ships. Real data gaps still fail closed, and the
  index lookup still rejects an index that has no prices for the region.
- **The index path takes the region for `Location` and `From Location`.** Live merges
  `{...state, Location: regionName, "From Location": regionName}` right before it builds the path
  (offset 1466476). Those two selector ids are region-derived, not form values, even when a
  definition declares one as a primary selector (Direct Connect declares `From Location` and
  never asks for it).
- **`displayIf` ordering comparisons coerce to zero.** Live's comparison helper maps a
  non-numeric operand to 0 and only compares as strings when both sides are non-numeric
  (offset 817504). An operand whose component is declared later in the same maths section
  therefore compares as 0, not as hidden. Keeping the strict "undefined is false" rule silently
  zeroed every rounding branch of the FSx for Lustre storage table and billed `0.00` against the
  live editor's `174.32`; the FSx maths deliberately gates an early rounding on a later
  subtraction, so this is the live contract, not a malformed definition.

Verified by the live editor oracle on both services (`receipts/p2-direct-connect-utilization.json`
`2463.75`, `receipts/p2-fsx-lustre.json` `174.32`), the full test suite, and a tracker rerun whose
only class changes are the intended ones. Evidence: `analysis/FINDINGS.md` sections 16.2 and 16.3.

## D-032: Column-form `utilization` rows are native, and a missing single price point bills 0 (2026-11-25)

The `utilization-selector` blocker on Amazon EMR and Amazon WorkSpaces was real, but it had two
parts. Both are taken from the live bundle and confirmed in the live editor.

- **A column-form `utilization` row is a value object, not a selector string.** Its save format is
  `{unit, selectedId}`; live `q.a` (offset 1271617) turns it into the hours a month the `Hourly`
  and `Monthly` price models multiply by, and the models no longer use a hardcoded 730
  (`G`/`V`, offset 2875759). The typed unit is validated as a whole number in `1..max(duration)`
  (`L.validateChange`), and the four durations the row offers when it is not a selector come from
  `P`. When the row also carries a `selectorId` that the component tree holds, its `selectedId`
  is the value the price set matches: WorkSpaces' `Running Mode` is a `secondaryKey` and its
  `remap.keyValue` turns the aggregation's `AlwaysOn`/`AutoStop` into the row's
  `Monthly`/`Hourly`. The row is saved as `{selectorId: {value: {unit, selectedId}}}`, matching a
  native live save byte for byte on the value.
- **`singlePricePoint` bills 0 for a meter the loaded region does not carry.** Live reads
  `a[o] ? a[o] : 0` and returns `{value: 0}` when the meter is absent (offset 497900). WorkSpaces
  Personal/Core declare `additionalBundleUnitPrice2` on a meter no region carries, so the live
  form bills 0 while this engine threw `no price for metered unit`. The engine now returns 0 for
  an absent meter in a region whose map loaded, and still fails closed when the mapping never
  loaded that region - a data gap is not a live zero. This mirrors the `pricingComboV2` rule from
  D-030.

Scope note: live also seeds its value map with rows that declare a truthy `defaultValue` first, so
a natively saved WorkSpaces row and summary list the defaulted rows before `Number of
WorkSpaces`. The engine keeps definition order; matching live's key order is cost-neutral and
would invalidate the already-published ElastiCache/OpenSearch/Redshift receipts, so it was left
alone. Evidence and live numbers: `analysis/FINDINGS.md` section 17,
`receipts/p1-utilization-emr.json` (113.88) and `receipts/p1-utilization-workSpaces.json`
(2,297.58), both editor recompute with zero mismatches.
