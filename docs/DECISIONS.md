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
