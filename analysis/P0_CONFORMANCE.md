# P0 conformance proof

This is the verification standard for "done means the output matches the AWS Pricing Calculator".
It records what is actually proven today for EKS, VPC, EBS, RDS, and EC2, and what is still
missing before any P0 service can be called done.

## Short answer

None of the P0 services meet the full definition of done yet.

EKS, VPC, and EBS have a real per-service differential proof for a defined fixture batch. RDS
and EC2 do not: their native engines still fail closed on core templates, and the simulation
link uses captured live payloads for those rows.

| Service | Surface | Conformance fixtures | Differential | Payload parity | Negative tests | Region matrix | Ledger | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EKS | 44/44 components | 3 fixtures | pass, 10 rows total with EBS | no | partial | us-east-2 only | conformance receipt | not done |
| VPC | 151/151 across 13 sub-services | all 13 sub-services | pass, 13 rows | no | partial | us-east-2 only | conformance receipts | not done |
| EBS | 68/68 components | 7 volume types with snapshots | pass, 7 rows | no | partial | us-east-2 only | conformance receipt | not done |
| RDS | 1020/1020 component types, but column-form gaps | not run natively | captured rows only | no | partial | us-east-2 only | simulation only | not done |
| EC2 | 85.1% ec2Enhancement, 79.2% eC2Next, 29.2% Windows | not run natively | captured rows only | no | partial | us-east-2 only | simulation only | not done |

## What "1:1" actually means

The public page with `source: calculator-platform` is not proof of math. It renders the stored
`serviceCost` from the saved estimate. A matching public page only proves publication and
rendering.

The live oracle is the calculator editor. Opening the published link, clicking **Update
estimate**, and reading the recomputed DOM makes the calculator rehydrate every saved
`calculationComponents` value and run its own engine. That is the number we must match.

Current verifier behavior:

- `publish` writes a stored estimate and opens the public page.
- `--oracle` publishes a second probe link whose read-only page recomputes from components.
- `--oracle-editor` opens the published link, clicks **Update estimate**, and diffs the live
  editor recomputation.
- `e2e/matrix.test.ts` re-reads the receipt and re-runs the oracle for probe and editor rows.

The editor recompute is the only acceptable differential oracle for 1:1 math. Probe links are
acceptable only where the read-only recompute preserves every component; data transfer is the
known exception and uses the editor oracle.

## P0 conformance run

Three per-row batches were published on 2026-11-24. Each receipt contains the stored page, the
editor recomputation, and zero mismatches.

| Batch | Fixtures | Stored monthly | Editor monthly | Rows | Result | Link |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 1 | EKS default, EKS full cards, EKS high tier, EBS gp2, gp3, io1, io2, st1, sc1, magnetic | 31,024.26 | 31,024.26 | 10 | pass | https://calculator.aws/#/estimate?id=da681d431df3701ad0507ffd5fbc6a060a26ea16 |
| 2 | VPC VPN, Network Access Analyzer, Reachability Analyzer, Traffic Mirroring, public IPv4, IPAM, data transfer | 416.26 | 416.26 | 7 | pass | https://calculator.aws/#/estimate?id=243609a2f92756ab64839b25ad47a455157f7113 |
| 3 | VPC Route Server, NAT Gateway, Transit Gateway, PrivateLink, Gateway Load Balancer, Cloud WAN | 2,064.82 | 2,064.82 | 6 | pass | https://calculator.aws/#/estimate?id=0eacc258d28623ebf52606058e9944db30d46028 |

The VPC batches sum to 2,481.08, which matches the VPC group in the larger simulation. The
EKS and EBS rows also match individually, not just as a total.

Receipts and fixtures:

- `receipts/conformance-p0-1.json`
- `receipts/conformance-p0-2.json`
- `receipts/conformance-p0-3.json`
- `analysis/fixtures/conformance-p0-1.yaml`
- `analysis/fixtures/conformance-p0-2.yaml`
- `analysis/fixtures/conformance-p0-3.yaml`

## Definition of done

A service is done only when every gate below is green for a checked-in fixture matrix.

### D1 - Native surface

Every template, card, input, pricing, and math subtype has a handler. No fixture can reach
`UNSUPPORTED_INPUT` or `UNSUPPORTED_COMPONENT`.

### D2 - Fixture matrix

The matrix covers, at minimum:

- every template and every card, including cards that are hidden by `displayIf`;
- every dropdown option for small lists;
- representative equivalence classes plus boundary samples for large lists such as instance
  types;
- min, max, zero, and decimal boundaries;
- repeatable rows with two or more entries;
- every pricing strategy, term, and payment option (on-demand, RI, Savings Plans, Spot);
- every storage, engine, and deployment variant used by the service;
- every region in the certification set.

For a service with a 7-option dropdown, that means 7 fixtures, not one. For a 183-option
instance list, define the equivalence classes, test every class boundary, and add a generated
random sweep.

### D3 - Differential

For every fixture, the native engine and the live editor recompute must match to the cent:

- per-service monthly and upfront;
- group monthly and upfront;
- estimate total monthly and upfront;
- annual total;
- support cost, when present.

Config summaries are compared on the stored page. The editor can lag the string table, so the
editor oracle treats costs as the signal and keeps summaries out of the strict diff.

### D4 - Payload parity

The saved `calculationComponents` and config summary must match what a user creating the same
fixture in the live UI would save. This is different from D3: D3 recomputes our payload, while
D4 proves our payload is the same shape the UI would produce. It needs a browser capture of a
live-created estimate for at least one fixture per template.

### D5 - Negative and fail-closed tests

Missing meters, invalid dropdown values, out-of-range values, unknown destinations, unsupported
components, and malformed definitions must fail with a path-addressed error. They must never
publish a zero or a guessed value.

### D6 - Region and currency matrix

At minimum us-east-1 and us-east-2 for every service, plus one EU and one AP region for price
path coverage. Currency conversion and locale strings are separate checks.

### D7 - Regression proof

The service has a ledger receipt, a nightly re-render, a pinned definition and price hash, and a
drift report. A data-plane change must fail CI or open a task before the service can still be
called done.

## Why the current proof is not enough

### EKS

Proven: default, all four cards, and a high hybrid-node tier boundary.
Missing: every hybrid-node tier boundary (576000, 1152000, 5760000, 11520000 vCPU-hours), zero
and empty optional cards, a second region, negative values, payload parity, and a ledger row.

### VPC

Proven: every one of the 13 sub-services with nonzero values, per row and as a total.
Missing: option-level variants for each child (zonal vs regional NAT, site-to-site vs client
VPN, TGW multicast on/off, PrivateLink tier boundaries, Gateway Load Balancer connection
classes, Cloud WAN attachments and peering), a second region, negative tests, payload parity,
and ledger rows for children.

### EBS

Proven: all seven volume types, snapshots at daily/weekly/monthly, per row.
Missing: all nine snapshot frequency options, snapshot zero/min/max, gp3 IOPS and throughput
boundaries, io2 IOPS tier boundaries, Fast Snapshot Restore, EBS direct APIs, a second region,
negative tests, payload parity, and a ledger row.

### RDS

Not proven natively. The native engine prices on-demand single-row MySQL, PostgreSQL, MariaDB,
Oracle, and Custom Oracle. The simulation uses captured payloads for SQL Server, Db2, Custom SQL
Server, Aurora MySQL, and Aurora PostgreSQL. The column-form engine still needs repeatable rows,
dependent selectors, additional pricing data, RI payment units, and upfront totals before RDS can
enter conformance. No RDS service can be called done yet.

### EC2

Not proven natively. Both EC2 templates fail at `ec2PriceFetcher`. The simulation uses a
captured advanced-estimate payload for on-demand, RI, Spot, and Savings Plan variants. That
proves the captured payload renders and recomputes, not that our engine is 1:1. EC2 cannot enter
conformance until the instance catalog, pricing strategies, workloads, monitoring, EBS, and data
transfer paths are native.

## How to make it bulletproof

1. **Make the editor recompute the mandatory oracle.** Do not accept a stored-page match as
   evidence. Every receipt must carry `oracle.kind` and a zero-mismatch recomputation.
2. **Generate fixtures from definitions.** Walk every template, card, input, and option list.
   Store the generated matrix and its hash.
3. **Batch by ten.** Publish at most ten fixture rows per link, compare per-row, and reuse the
   link. This keeps the 25/day budget usable and avoids pagination.
4. **Add property-based sweeps.** Random valid values within min/max, repeated across a seed
   set, catch rounding and branch errors that hand-picked fixtures miss.
5. **Capture the live payload once per template.** Create the same fixture in the UI, save it,
   and diff `calculationComponents` and config summary against the native payload.
6. **Run negative tests.** Assert the exact error code and component path for every unsupported
   path.
7. **Pin the data plane.** Hash manifest, definitions, prices, and support tiers. Re-run
   conformance when any hash changes.
8. **Promote conformance to the ledger.** A conformance batch is evidence, not a permanent
   ledger row. Add the fixtures to `LEDGER` and keep the receipt.
9. **Expand groups or paginate before large proofs.** The current DOM reader sees the first ten
   table rows and group rows collapse their children. For large matrices, either batch by ten or
   teach the reader to expand groups and paginate.

## Immediate next actions

1. Add the three P0 conformance batches to the ledger so `npm run e2e` re-runs them.
2. Add the missing EBS snapshot frequency and boundary fixtures, then Fast Snapshot Restore and
   direct API fixtures.
3. Add EKS tier boundaries and a second region.
4. Add VPC child option variants and a second region.
5. Add negative tests for each P0 fail-closed path.
6. Implement column-form v2 before attempting RDS conformance.
7. Implement the EC2 module before attempting EC2 conformance.
8. Add a live payload capture step for D4.

## Tracking

`analysis/COVERAGE_TABLE.md` records what has a conformance receipt. EKS, VPC, and EBS now sit
in "Conformance passed - add ledger" because all three batches are in `LEDGER` and re-run in
`npm run e2e`. The phase name means the batch is proven but still needs wider fixture coverage
before the service itself is done. RDS and EC2 remain in their build phases and have no
conformance receipt.

The tracker column is `conformance_receipt`. It is set per service from the receipts in
`receipts/conformance-*.json`.

## Reproduce

```sh
# Native build check
node bin/aws-calc-axi.js cost analysis/fixtures/conformance-p0-1.yaml --full
node bin/aws-calc-axi.js cost analysis/fixtures/conformance-p0-2.yaml --full
node bin/aws-calc-axi.js cost analysis/fixtures/conformance-p0-3.yaml --full

# Publish and prove against the live editor
node bin/aws-calc-axi.js publish analysis/fixtures/conformance-p0-1.yaml --oracle-editor
node bin/aws-calc-axi.js publish analysis/fixtures/conformance-p0-2.yaml --oracle-editor
node bin/aws-calc-axi.js publish analysis/fixtures/conformance-p0-3.yaml --oracle-editor

# Re-read the published receipts
node bin/aws-calc-axi.js verify "https://calculator.aws/#/estimate?id=da681d431df3701ad0507ffd5fbc6a060a26ea16"
node bin/aws-calc-axi.js verify "https://calculator.aws/#/estimate?id=243609a2f92756ab64839b25ad47a455157f7113"
node bin/aws-calc-axi.js verify "https://calculator.aws/#/estimate?id=0eacc258d28623ebf52606058e9944db30d46028"
```

A publish is only successful after the editor recompute passes. The saved key alone is not a
receipt.
