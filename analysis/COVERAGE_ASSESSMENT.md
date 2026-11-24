# AWS service coverage assessment

Assessment date: 2026-11-24. Source: `analysis/defs` (441 definitions), the live catalog
snapshot, and commit `4e28e01` (throughput plus broadened column-form support). This report
includes those changes because they change the answer materially. The previous baseline
(`d9fa653`) was stricter: it blocked 54 column-form services instead of 12.

Machine-readable matrix: `analysis/coverage-matrix.csv` (441 service and selector definitions).
Human-readable exhaustive tracker: `analysis/COVERAGE_TABLE.md`, regenerated with
`npm run coverage`. The catalog's `aWSPricingCalculatorStrings` static string table is
excluded because it has no calculator surface.

Post-assessment update (2026-11-24): `snapShotMaths` is now implemented, so EBS evaluates
natively and its three EBS rows matched the live editor to the cent. File-size rate conversion
and validation were also fixed. The 37-service simulation link is in
`analysis/SIMULATION_TOP_SERVICES.md`. EBS moves from blocked to native; the rest of this
assessment remains the pre-change baseline.

For current implementation tracking use `analysis/COVERAGE_TABLE.md` and
`analysis/coverage-matrix.csv`. The tracker is stricter than the earlier static counts below:
it marks every `columnFormIPM` service partial until repeatable rows and advanced pricing land,
and scores selector groups by their children.

## 1. Verdict

No service is 100% covered under the project's own definition of done (`PLAN.md` gate 5:
rendered public page, every template and region, fixtures for defaults, min/max, every dropdown
option, repeatable rows, and nonzero profiles).

The closest services differ by lens:

| Service | Surface (L1) | Functional (L2) | Rendered receipts (L3) | Verdict |
| --- | --- | --- | --- | --- |
| **Amazon EKS** | 44/44 components, 4/4 cards | All 4 cards price; full-card fixture = 1711.16 USD/month | None | 100% implemented, verification missing |
| **Amazon VPC** | 151/151 components across 13 sub-services | 13/13 usable; 9 price from defaults, 4 need required inputs | None | 100% implemented, verification missing |
| **Amazon RDS family** | 1020/1020 components across 11 definitions | On-demand single-row works for MySQL, MariaDB, PostgreSQL; RI only partially; Savings Plans and multi-row do not | None | Not covered |
| **Amazon EBS** | 68/68 components, 3 cards | Native; 3 variants matched the live editor to the cent | Simulation link | 100% implemented and simulation-verified |
| **Amazon EC2** | 206/278 components across 4 definitions | 0%; both EC2 templates fail at `ec2PriceFetcher` | None | Not covered |

The direct answer to "what is already 100%" is: **EKS and VPC are the only top services whose
entire calculator surface is implemented and functionally evaluable today.** EBS now has its
snapshot math implemented (post-assessment) and matched the live editor. RDS is 100% on
component types but not functional for RI, Savings Plans, multiple rows, or several engines.
EC2 and Windows/SQL need a native module.

Two non-top-5 groups also look complete on static surface and default evaluation: **AWS
Backup** (15/15 sub-services price from defaults) and **Amazon Location Service** (6/6). They
are good first receipt targets, but neither has a rendered receipt yet.

## 2. How coverage is measured

This assessment separates three lenses because the project has historically conflated them:

- **L1 surface**: every component subtype in every template has an engine handler. This is a
  static scan of `analysis/defs`. It does not prove correct math.
- **L2 functional**: the engine evaluates the templates for a representative configuration,
  resolves prices, and respects deep features (RI/SP/spot modes, dependent selectors, multiple
  rows, upfront totals).
- **L3 verified**: the estimate was published, opened, rendered, and compared to the native
  total to the cent, with fixtures that cover the service's options. This is the only PASS in
  `PLAN.md`.

A service is only 100% when all three are green. Today the ledger has 12 verified rows covering
11 services plus one group, and none of those rows exhausts a service's template and option
matrix.

### Static rules used here

- A component subtype is "handled" only if the current engine has a switch case for it.
- A `columnFormIPM` service is never marked clean just because its subtypes are handled.
  The live form is repeatable, so a single-row engine is a functional gap even when pricing
  works for one row.
- Column-form hard blockers in the current tree: `remap.constant`, `subComponentsList`,
  selector-bearing `utilization` rows, and unknown row types.
- Column-form soft gaps: `additionalPricingData` (Database Savings Plans and similar joins),
  `riPricingTypes` selector patterns, dependent selectors, `exportTagsAsValue`, regex remaps,
  multiple price sets, and upfront totals.
- Selector groups (`subServiceSelector`) are scored by their children, not by their empty
  template list.

## 3. Global inventory

### 3.1 Definitions

| Item | Count |
| --- | ---: |
| Catalog rows in `analysis/manifest.json` | 442 |
| Definitions in `analysis/defs` | 441 |
| Selector groups (`subServiceSelector`) | 34 |
| Standalone or sub-service definitions | 407 |
| Definitions missing from the snapshot | 0 |
| Visible in us-east-2 | 160 UI services, 161 definition mappings |
| Visible in us-east-1 | 181 UI services, 182 definition mappings |

The EC2 row appears twice in definitions: active `ec2Enhancement` and inactive `eC2Next`.

### 3.2 Static classification

Standalone definitions:

| Class | Count | Meaning |
| --- | ---: | --- |
| clean | 330 | No missing subtype, no column-form hard feature |
| partial: column-form | 55 | Usable single-row subset; repeatable rows and advanced pricing missing |
| blocked: column-form | 12 | Hard feature not implemented (`remap.constant`, selector utilization, unknown row) |
| blocked: subtype | 10 | At least one component type has no handler |
| no-surface | 1 | Utility strings definition, not a service |

Selector groups by effective child coverage:

| Class | Count |
| --- | ---: |
| clean | 22 |
| partial | 7 |
| blocked | 4 |

Visible us-east-2 (160 services, 161 definition mappings):

| Class | Standalone | Groups | Total |
| --- | ---: | ---: | ---: |
| clean | 92 | 21 | 113 |
| partial | 29 | 7 | 36 |
| blocked | 9 | 2 | 11 |
| missing definition | 0 | 1 | 1 |

That is a useful headline: **113 of 160 visible services have no obvious static blocker**, but
only 86 of the 92 clean standalone services avoid a hard runtime failure in both us-east-1 and
us-east-2. The rest fail on a missing meter, an ambiguous PLC_2.0 match, or a definition bug.

### 3.3 Runtime evaluation

Evaluated every definition with defaults, no overrides, in both regions:

| Result | us-east-1 | us-east-2 |
| --- | ---: | ---: |
| Evaluates with defaults | 215 | 178 |
| Needs required inputs (not a failure) | 170 | 166 |
| Price/data error (missing meter, 403) | 28 | 68 |
| Missing PLC_2.0 price | 15 | 14 |
| Ambiguous PLC_2.0 selection | 5 | 5 |
| Unsupported component | 3 | 3 |
| Unsupported input | 3 | 3 |
| Unknown region | 0 | 2 |
| Bad definition | 1 | 1 |
| Unknown template | 1 | 1 |

The difference between regions is mostly regional price coverage, not engine capability. Use
us-east-1 for a stable L2 baseline; us-east-2 is the receipt region and exposes more data gaps.

### 3.4 Receipts

`COVERAGE.md` has 12 rows: S3 Standard, Lambda, CloudWatch, SNS, SQS, X-Ray, CloudFormation,
EventBridge, Athena, S3 data transfer, DAX, and one group with Support. None of EKS, VPC, RDS,
EBS, or EC2 has a receipt. None of the 12 rows covers every template, option, and region for
its service.

## 4. Top services in detail

### 4.1 EC2

EC2 has four relevant definitions:

| Definition | Cards | Components supported | Status |
| --- | ---: | ---: | --- |
| `ec2Enhancement` (active) | 6 | 79/94 | blocked: subtype |
| `eC2Next` (inactive) | 9 | 83/106 | blocked: subtype |
| `windowsWorkloads` | 11 | 0/78 | blocked: subtype |
| `amazonEc2DedicatedHosts` | 2 | 30/30 | blocked: column form |

Surface: 206/278 components (74.1%). Both EC2 templates fail immediately at
`ec2PriceFetcher` in the first instance card, before the EBS, data transfer, monitoring, or
additional-cost cards can contribute.

| Capability on the calculator page | Surface component | Status |
| --- | --- | --- |
| Instance type catalog and pricing | `ec2PriceFetcher` | Not implemented |
| Instance search and filtering | `ec2InstanceSearch`, `instanceFinder` | Not implemented |
| On-demand pricing | `pricingStrategy`, `priceSelector`, `ec2PriceDisplay` | Not implemented |
| Reserved instances (1/3 year, payment options) | `ec2AdvPricingStrategy`, `ec2AdvPricingStrategyMath` | Not implemented |
| Savings Plans (Compute and EC2 Instance) | same pricing strategy components | Not implemented |
| Spot pricing | same pricing strategy components | Not implemented |
| Workload estimate (web, batch, and so on) | `workload`, `radioTiles` | Not implemented |
| Tenancy (shared, dedicated, host) | `radioTiles`, `workload` | Not implemented |
| Utilization | `utilization` | Not implemented |
| EBS volumes inside EC2 | EBS card components | Implemented but unreachable |
| EBS snapshots inside EC2 | `snapShotMaths` | Not implemented |
| Data transfer | `dataTransferV2` | Implemented but unreachable |
| Detailed monitoring | `ec2AdvPricingMetrics` | Not implemented |
| Additional costs | `numericInput` + `priceDisplay` | Implemented but unreachable |
| Dedicated Hosts | separate definition + column form | Blocked |
| Windows and SQL Server | separate `windowsWorkloads` | Blocked, 25 missing subtypes |

EC2 is **0% usable** today. It needs a native module, not a generic adapter.

### 4.2 RDS and Aurora

RDS family definitions:

| Definition | Cards | Components | Static | Runtime L2 |
| --- | ---: | ---: | --- | --- |
| RDS for MySQL | 9 | 99/99 | blocked: column form | on-demand single row works |
| RDS for PostgreSQL | 9 | 100/100 | blocked: column form | on-demand single row works |
| RDS for MariaDB | 8 | 81/81 | blocked: column form | on-demand single row works |
| RDS for SQL Server | 6 | 114/114 | blocked: column form | selector match fails with plausible values |
| RDS for Oracle | 5 | 59/59 | blocked: column form | selector match fails with plausible values |
| RDS for Db2 | 3 | 41/41 | blocked: column form | selector match fails with plausible values |
| RDS Custom for Oracle | 3 | 42/42 | blocked: column form | concatenate needs `databaseEdition`; ambiguous |
| RDS Custom for SQL Server | 3 | 48/48 | blocked: column form | ambiguous |
| RDS on Outposts | 2 | 7/7 | partial: column form | needs inputs |
| Aurora MySQL-Compatible | 30 | 228/228 | blocked: column form | ambiguous |
| Aurora PostgreSQL-Compatible | 27 | 201/201 | blocked: column form | ambiguous |

Surface: 1020/1020 components (100%). Functional coverage is much lower:

| Capability | Status |
| --- | --- |
| On-demand, single instance row, MySQL/MariaDB/PostgreSQL | Works with explicit deployment and node count |
| On-demand, SQL Server/Oracle/Db2/Custom | Selector values do not resolve to a price row |
| Reserved, 1 year, No Upfront, MySQL | Works as hourly-only; upfront total stays 0 |
| Reserved, All or Partial Upfront | Fails `AMBIGUOUS_SELECTION` between `Quantity` and `Hrs` meters |
| Database Savings Plans | Explicitly fails closed |
| Multiple instance rows | Not supported |
| Dependent selectors (deployment, term, purchase option) | Not filtered or validated |
| Storage (gp2/gp3/io1/io2/magnetic), IOPS, throughput | Components exist; not verified |
| Backup, snapshot export, PI, Database Insights, extended support, proxy, log volume | Components exist; not verified |
| Aurora Serverless v2, I/O-Optimized, Backtrack | Components exist; Aurora pricing does not resolve |

The current tree can price a basic RDS MySQL, MariaDB, or PostgreSQL on-demand estimate. It
cannot claim RDS coverage because the calculator page's core choices (RI/SP, multiple rows,
engine-specific options, Aurora) are not functional.

### 4.3 EBS

`amazonElasticBlockStore` has 3 cards and 68/68 supported components after the post-assessment
`snapShotMaths` implementation. Before that fix the engine failed closed on the whole template,
even for a volumes-only estimate. The three EBS variants in the simulation now match the live
editor to the cent.

| Capability | Status |
| --- | --- |
| gp2, gp3, io1, io2, st1, sc1, standard volumes | Components implemented |
| IOPS and throughput | Components implemented; throughput has unit tests but no fixture or receipt |
| Snapshots | `snapShotMaths` missing |
| Fast Snapshot Restore | Components implemented |
| EBS direct APIs | Components implemented |

EBS is **100% on the definition surface** and its EBS-only values match the live editor. The
`snapShotMaths` implementation also unlocks the snapshot portion of both EC2 definitions, but
EC2 remains blocked by its pricing module.

### 4.4 EKS

`awsEks` has 4 cards and 44/44 components. No column form, no bespoke math.

| Card | Status | Example |
| --- | --- | --- |
| Standard support clusters | Implemented | 2 clusters = 146 USD/month |
| Extended support clusters | Implemented | 1 cluster = 365 USD/month |
| Capabilities (Argo CD, ACK, KRO) | Implemented | 32.16 USD/month |
| Hybrid nodes, tiered vCPU-hours | Implemented | 10 nodes x 8 vCPU = 1168 USD/month |

The full-card fixture totals 1711.16 USD/month. Default evaluation is 73 USD/month (one
cluster). EKS is the cleanest 100% target: no code is needed, only fixtures, a publish, a
rendered verification, and a screenshot.

### 4.5 VPC

`amazonVirtualPrivateCloud` is a selector with 13 sub-services, all statically clean:

| Sub-service | Default runtime | Notes |
| --- | --- | --- |
| VPN Connection | ok | |
| Network Access Analyzer | ok | |
| Reachability Analyzer | ok | |
| Traffic Mirroring | ok | |
| Public IPv4 Address | ok | |
| IPAM | ok | |
| Data Transfer | ok | share-page oracle caveat for foreign-source estimates |
| Route Server | ok | |
| Gateway Load Balancer | ok | |
| NAT Gateway (zonal and regional) | needs inputs | verified with values, 246.06 USD/month |
| Transit Gateway and multicast | needs inputs | verified with values, 115.96 USD/month |
| PrivateLink and tiered data | needs inputs | verified with values, 39.44 USD/month |
| Cloud WAN | needs inputs | verified with values, 527.83 USD/month |

VPC is **100% implemented and functional modulo required inputs**. The remaining work is a
fixture per sub-service, one combined selector estimate, rendered receipts, and the known data
transfer oracle caveat.

## 5. Blockers ranked by leverage

| Blocker | Services affected | Components | Top services | Workstream |
| --- | ---: | ---: | --- | --- |
| `additionalPricingData` (Database Savings Plans and joins) | 16 | 31 | RDS, Aurora, DocumentDB, Neptune, ElastiCache, Keyspaces, Timestream, DMS, Dedicated Hosts | Column form v2 |
| `riPricingTypes` selector patterns (payment units, upfront) | 15 | 30 | RDS, Aurora, Redshift, OpenSearch, MemoryDB, WorkSpaces | Column form v2 |
| Dependent selectors | 31 | - | RDS, ElastiCache, DocumentDB, Neptune, Redshift, DMS, AppStream | Column form v2 |
| Repeatable rows (single-row engine) | 55 | - | Every column-form service | Column form v2 |
| `remap.constant` | 8 | - | Directory Service, Chime, mainframe, PTSN, SIP | Column form v2 |
| `utilization` input | 7 | 18 | Deadline Cloud, Direct Connect, MediaConnect, PCS, EC2, Windows, mainframe | Long tail |
| EC2 pricing and workload subtypes | 3 | 39 distinct | EC2, EC2 Next, Windows/SQL | EC2 module |
| `snapShotMaths` | 3 | 3 | EBS, EC2, EC2 Next | Fixed for EBS; EC2 still blocked by its pricing module |
| Windows/SQL bespoke math and tables | 1 | 25 distinct | Windows Server and SQL Server on EC2 | Windows module |
| Region price gaps and missing meters | 28-68 depending region | - | Bedrock, Polly, QuickSight, FSx, WorkSpaces, media services | Data plane |

Note: counts use commit `4e28e01`. The previous baseline blocked 54 column-form services;
`4e28e01` reduced that to 12 and moved 55 into partial.

## 6. Implementation plan

### Principles

1. Finish services, not subtypes. A handler is not coverage until a rendered estimate proves it.
2. Prefer shared engine work that unlocks multiple services over one-off service patches.
3. Keep fail-closed behavior. Never publish a zero because a meter or selector is missing.
4. Every workstream ends with fixtures and a rendered receipt, not just unit tests.
5. Do not build a second pricing path. Column-form v2 and the EC2 module must emit the same
   estimate contract the publisher and verifier already use.

### Phase 0 - Measurement and a green baseline (2-3 days)

The assessment landed on top of `4e28e01`, which broadened column form and throughput but is
not yet covered by fixtures or receipts.

1. Add fixtures and regression tests for the new selector-pattern, `disableCalculation`,
   utilization, and throughput paths. Verify the saved format and summaries against the live UI
   before calling any of them covered.
2. Replace `scripts/scan.ts`'s hand-maintained `KNOWN` sets with a capability registry exported
   from the engine, including deep column-form flags. Adding `throughput` to the set is not
   enough; the scanner still cannot see dependent selectors, repeatable rows, or savings-plan
   joins.
3. Add `scripts/coverage.ts`:
   - static matrix from `analysis/defs`,
   - optional `--evaluate --region`,
   - CSV and JSON output,
   - selector effective coverage,
   - exit non-zero on a regression against a checked-in baseline.
4. Add a fixture generator: defaults, min/max, every dropdown option, every template, repeatable
   rows, and a nonzero profile.
5. Regenerate `COVERAGE.md` and `STATUS.md` from the matrix instead of editing them by hand.
6. Update `npm test` to run typecheck, lint, unit, and e2e in one command.

Exit criteria: a clean tree, a reproducible matrix, and no hand-maintained support lists.

### Phase 1 - First 100% certificates (1-2 weeks)

No engine invention; finish and prove what is nearly done.

1. **EBS**: `snapShotMaths` is implemented (post-assessment). Add a ledger receipt for the
   volume and snapshot fixtures. The simulation already matches the live editor.
2. **EKS**: fixtures for standard, extended, capabilities, hybrid nodes, tier boundaries, and a
   second region. Publish and verify.
3. **VPC**: one fixture per sub-service plus one combined selector estimate. Publish and verify.
   Use `--oracle-editor` for data transfer if the read-only page drops it.
4. **AWS Backup** and **Amazon Location Service**: quick receipts because their children already
   evaluate from defaults.

Exit criteria: 5 services or groups with L3 receipts, each covering every card and at least two
regions. Update the ledger and screenshots.

### Phase 2 - Column-form v2 (4-6 weeks)

This is the largest unlock: 55 partial and 12 blocked standalone services, including all of RDS.

**A1. Selector tree and dependent selectors**
- Load the PLC metadata selector tree, valid option values, and dependencies.
- Filter dependent dropdowns the way the live form does.
- Implement `exportTagsAsValue`, `prioritizedKey`, hidden selector semantics, and selector
  defaults from the live first-option rule.
- Unlocks RDS Custom, Aurora ambiguity fixes, ElastiCache DSP component, and 31 services with
  dependent selectors.

**A2. Price sets and advanced pricing**
- Implement `additionalPricingData` joins, starting with Database Savings Plans.
- Implement regex remaps, not literal map lookups.
- Honor `riPaymentOptions` and payment units (`Quantity` vs `Hrs`), disambiguating All Upfront
  and Partial Upfront meters.
- Support multiple price sets and the live substring matching rules.
- Unlocks 16 savings-plan services and 15 RI-pattern services.

**A3. Repeatable rows**
- Accept an array of row objects, price each row, and emit the live saved-format array.
- Handle per-row counts, summaries, and aggregate subtotals.
- Required before any column-form service can claim 100%.

**A4. Remaining form features**
- `disableCalculation` semantics beyond raw-price exposure.
- `subComponentsList`, `remap.constant`, selector-bearing utilization rows, and unknown row
  types.
- Unlocks the 12 hard-blocked column-form services.

**A5. Upfront and term totals**
- Carry `upfront` through column-form extras, subtotals, service cost, groups, support, and the
  publisher/verifier.
- Model 1-year and 3-year RI and Savings Plan commitments correctly.
- This is a contract change, not a service patch; it must land before RI/SP can be called done.

**A6. Service-by-service fixtures**
- RDS MySQL first: on-demand, RI No Upfront, RI All/Partial Upfront, DB Savings Plans, multiple
  rows, storage, backup, PI, extended support, proxy.
- Then PostgreSQL, MariaDB, SQL Server, Oracle, Db2, Custom, Outposts, Aurora MySQL, Aurora
  PostgreSQL, Aurora Serverless v2, I/O-Optimized, Backtrack.
- Then DocumentDB, Neptune, ElastiCache, MemoryDB, Keyspaces, Redshift, OpenSearch, DMS,
  Dedicated Hosts, WorkSpaces.

Exit criteria: RDS MySQL, PostgreSQL, and MariaDB at 100% with on-demand, RI, SP, storage, and
multi-row receipts. Then the rest of the RDS family. The column-form engine should no longer
need per-service exceptions.

### Phase 3 - Native EC2 module (4-6 weeks)

EC2 cannot be solved by adding one or two adapters. It needs a module with its own data model.

**B1. Instance catalog and `ec2PriceFetcher`**
- Resolve instance families, types, vCPU, memory, network, architecture, bare metal, and
  region availability from the EC2 pricing sets.
- Emit the live saved component shape, including instance tags.
- Handle the dual `ec2Enhancement` and `eC2Next` definitions from one implementation.

**B2. Instance search and workloads**
- `ec2InstanceSearch`, `instanceFinder`, multi-row workloads, and workload dropdowns.
- `workload`, `radioTiles`, tenancy, and utilization.

**B3. Pricing strategies**
- On-demand first.
- Reserved: Standard and Convertible, 1/3 year, No/Partial/All Upfront, effective hourly.
- Savings Plans: Compute and EC2 Instance, 1/3 year, payment options.
- Spot: spot price, interruption behavior, and the live display.
- Implement `pricingStrategy`, `priceSelector`, `ec2AdvPricingStrategy` and V2,
  `ec2AdvPricingStrategyMath`, `ec2PriceDisplay`, and `ec2Variable`.

**B4. Sub-cards**
- EBS volumes and snapshots (`snapShotMaths` from Phase 1).
- Data transfer (reuse the native engine).
- Detailed monitoring (`ec2AdvPricingMetrics`).
- Additional costs.

**B5. Verification**
- Fixtures for every pricing mode, instance family, tenancy, EBS type, and data transfer path.
- Publish and verify each mode. This is a large receipt matrix; plan for the publish budget.

Exit criteria: EC2 on-demand, RI, Savings Plans, Spot, instance types, EBS, and data transfer
are all 100% with rendered receipts. Windows/SQL remains separate.

### Phase 4 - Windows, SQL Server, and Dedicated Hosts (2-3 weeks)

1. Implement the 25 missing `windowsWorkloads` subtypes: license checkboxes, workload storage,
   instance and storage summaries, SQL license summary, passive node, review and cost tables,
   upload table, and workload instance math.
2. Finish `amazonEc2DedicatedHosts`: column-form v2 plus `additionalPricingData` and host
   pricing.
3. Add Windows and SQL Server receipts, including license-included and BYOL.

Exit criteria: Windows Server and SQL Server on EC2, and EC2 Dedicated Hosts, are 100%.

### Phase 5 - Long tail and data-plane gaps (ongoing)

1. `utilization` input (7 services): decide whether it is a percentage or a cost multiplier,
   implement once, and test against live formulas.
2. `radioTiles`, `conditionalCheckboxes`, `workloadDropdown`, and table/summary components.
3. Fix ambiguous PLC_2.0 matches (Aurora, OpenSearch, Custom) through A1, not per-service hacks.
4. Resolve region price gaps and missing meters. Policies:
   - fail closed when a required meter is absent,
   - hide an optional card only when the live page hides it,
   - record every gap in the coverage matrix.
5. Decide whether `eC2Next` (inactive) is supported before or after it becomes the live EC2 page.

Exit criteria: every visible service is at least L1 and L2, and every remaining gap is an
explicit data-plane gap with a recorded reason.

### Phase 6 - Verification and CI (1 week, then ongoing)

1. Run `scripts/coverage.ts --evaluate` nightly for us-east-1 and us-east-2.
2. Hash the manifest, region map, definitions, prices, and support tiers. Fail on drift.
3. Run the ledger and fail on any rendered mismatch.
4. Publish budget: 25 links/day is not enough for an exhaustive matrix. Options:
   - reuse receipts by spec hash (already supported),
   - sample one receipt per template and pricing mode, not per fixture,
   - request a higher daily cap,
   - split the matrix across days.
   Pick one policy and make it explicit in `docs/DECISIONS.md`.
5. Add a "coverage regression" check to CI so a new definition cannot silently lower coverage.

## 7. Milestones

| Milestone | Scope | Exit |
| --- | --- | --- |
| M0 | Measurement baseline | Clean tree, reproducible matrix, green typecheck/lint/test/e2e |
| M1 | Quick 100% certificates | EKS, VPC, EBS, AWS Backup, Location Service with L3 receipts |
| M2 | RDS on-demand | MySQL, PostgreSQL, MariaDB on-demand, storage, multi-row, L3 |
| M3 | RDS RI and Savings Plans | All RDS engines, Aurora, RI/SP/upfront, L3 |
| M4 | EC2 core | On-demand, instance types, search, tenancy, EBS, data transfer, L3 |
| M5 | EC2 commitments | RI, Savings Plans, Spot, Windows/SQL, Dedicated Hosts, L3 |
| M6 | Long tail | Every visible service L1/L2; explicit data-plane gaps only |
| M7 | Continuous coverage | Nightly scan, drift detection, receipt sampling, no regressions |

## 8. Definition of done

A service is 100% only when all of the following hold:

1. **G1 - Surface**: every template, card, input, pricing, and math subtype has a handler.
2. **G2 - Deep features**: no hard blockers; dependent selectors, repeatable rows, advanced
   pricing, and upfront totals work; every dropdown option resolves to a price or a documented
   absence.
3. **G3 - Fixtures**: defaults, min, max, every option, repeatable rows, and a nonzero profile
   for every template.
4. **G4 - Render**: a public link is opened and the rendered monthly, upfront, annual, group,
   support, and expiry values match the native result to the cent.
5. **G5 - Regression**: the service row is in the ledger; the nightly scan detects definition
   or price drift; a regression fails CI.

## 9. Risks and open decisions

| Risk | Impact | Mitigation |
| --- | --- | --- |
| New column-form paths are committed but not receipt-verified | Green unit tests can still hide live-format gaps | Fixtures, saved-format comparison, and rendered receipts in Phase 1/2 |
| `STATUS.md` prose and `scripts/scan.ts` can drift from the matrix | Agents get the wrong picture | Generate both from the matrix |
| Data plane is unversioned | Definitions and prices drift | Hash and nightly drift detection |
| Region price gaps | False "unsupported" results | Region matrix, explicit data gaps, us-east-1 baseline |
| Publish budget 25/day | Cannot certify every fixture | Receipt reuse, sampling policy, or higher cap |
| EC2 dual definitions | Two surfaces to maintain | One module, both templates, active flag |
| "100%" scope ambiguity | EBS is both a service and an EC2 sub-card | Define scope per calculator page, not per bundle |
| Upfront totals are not in the contract | RI/SP cannot be correct | Treat as a contract change in Phase 2 |

Open decisions to record in `docs/DECISIONS.md`:

1. Is a service "100%" at its own calculator page, or including its bundle relationships?
   Recommendation: own page. EBS is a separate page; EC2's EBS card is EC2 coverage, not EBS
   coverage.
2. Which regions form the certification matrix? Recommendation: us-east-1 and us-east-2 for
   receipts, all regions for price resolution.
3. What is the receipt sampling policy under the 25/day budget? Recommendation: one receipt per
   template and pricing mode, reuse by spec hash, and a full matrix only for top services.
4. Do we support inactive `eC2Next` now? Recommendation: implement the shared module now, but
   gate receipts on the active EC2 definition until the UI switches.

## Appendix A - Full matrix

The tables below list every non-clean standalone definition and every selector group. The CSV
has the same rows plus the clean definitions and the runtime error text.

### Blocked by missing subtype

| Service | Visible us-east-2 | Missing subtypes | Runtime |
| --- | --- | --- | --- |
| `amazonElasticBlockStore` | yes | snapShotMaths:1 | fail:UNSUPPORTED_COMPONENT |
| `awsDeadlineCloud` | yes | utilization:1 | fail:MISSING_INPUT |
| `awsDirectConnect` | yes | utilization:1 | fail:MISSING_INPUT |
| `awsElementalMediaConnect` | yes | utilization:6 | fail:UNSUPPORTED_INPUT |
| `awsPcs` | yes | utilization:4 | fail:UNSUPPORTED_INPUT |
| `eC2Next` | yes | ec2AdvPricingStrategy:1;ec2AdvPricingStrategyMath:1;ec2InstanceSearch:1;ec2PriceDisplay:5;ec2PriceFetcher:2;ec2Variable:1;instanceFinder:1;priceSelector:5;pricingStrategy:1;radioTiles:2;snapShotMaths:1;utilization:1;workload:1 | fail:UNSUPPORTED_COMPONENT |
| `ec2Enhancement` | yes | ec2AdvPricingMetrics:1;ec2AdvPricingStrategyMath:1;ec2AdvPricingStrategyV2:1;ec2InstanceSearch:1;ec2PriceDisplay:5;ec2PriceFetcher:1;ec2Variable:2;radioTiles:1;snapShotMaths:1;workload:1 | fail:UNSUPPORTED_COMPONENT |
| `mainframeBluAge` | no | utilization:2 | fail:MISSING_INPUT |
| `mainframeMicroFocus` | no | utilization:3 | fail:MISSING_INPUT |
| `windowsWorkloads` | yes | conditionalCheckboxes:2;dedicatedHostsCostTable:1;dedicatedHostsMath:1;dedicatedHostsReviewTable:1;inputField:1;instanceCostSummary:1;instanceCostSummaryTable:1;instanceRecommendation:1;pricingStrategy:2;radioTiles:1;sqlLicenseSummary:1;sqlPassiveNode:1;sqlSummary:1;storageCostSummary:1;storageCostSummaryTable:1;uploadTable:1;windowsSummary:1;windowsWorkloadStorage:1;workflowInstruction:1;workloadDropdown:3;workloadInstanceMath:1;workloadPriceSetFetcher:1;workloadStorageMath:1;workloadStoragePricing:1;workloadsConditionalComponent:5;workloadsInstanceSearch:1 | fail:UNSUPPORTED_INPUT |

### Blocked by column-form hard features

| Service | Visible us-east-2 | Hard feature | Runtime |
| --- | --- | --- | --- |
| `aWSDirectoryService` | yes | remap.constant | fail:MISSING_INPUT |
| `amazonEmrCoreNode` | no | utilization-selector | fail:MISSING_INPUT |
| `amazonEmrMasterNode` | no | utilization-selector | fail:MISSING_INPUT |
| `amazonEmrTaskNode` | no | utilization-selector | fail:MISSING_INPUT |
| `amazonWorkspaces` | no | utilization-selector | fail:MISSING_PRICE |
| `chimeBusinessCallingAnalysis` | no | remap.constant | fail:MISSING_INPUT |
| `chimeCostAnalysis` | no | remap.constant | fail:MISSING_INPUT |
| `proxyPhoneSession` | no | remap.constant | fail:MISSING_INPUT |
| `ptsnAudio` | no | remap.constant | fail:MISSING_INPUT |
| `sipTrunking` | no | remap.constant | fail:MISSING_INPUT |
| `workSpacesCore` | no | utilization-selector | fail:MISSING_PRICE |
| `workSpacesInstances` | no | utilization-selector | fail:MISSING_PRICE |

### Partial column-form services

| Service | Visible us-east-2 | Column forms | Gaps | Runtime |
| --- | --- | --- | --- | --- |
| `amazonAppStream` | yes | 2 | dependent;single-row | fail:MISSING_PRICE |
| `amazonAuroraMySQLCompatible` | yes | 4 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:AMBIGUOUS_SELECTION |
| `amazonDocumentDB` | yes | 2 | additionalPricingData;dependent;single-row | fail:MISSING_PRICE |
| `amazonDynamoDbDaxClusters` | no | 1 | single-row | ok |
| `amazonEc2DedicatedHosts` | no | 1 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonElastiCache` | yes | 3 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonElasticGraphics` | yes | 1 | single-row | ok |
| `amazonElasticVMwareService` | yes | 1 | single-row | fail:MISSING_INPUT |
| `amazonElasticsearchService` | yes | 3 | dependent;riPricingTypes[];single-row | fail:AMBIGUOUS_SELECTION |
| `amazonFSxForLustre` | yes | 1 | dependent;single-row | fail:MISSING_PRICE |
| `amazonGameLift` | yes | 1 | dependent;single-row | fail:MISSING_PRICE |
| `amazonGameLiftStreams` | yes | 1 | single-row | fail:MISSING_PRICE |
| `amazonKeyspaces` | yes | 4 | additionalPricingData;dependent;single-row | ok |
| `amazonManagedBlockchain` | no | 2 | dependent;single-row | fail:MISSING_PRICE |
| `amazonManagedStreamingForApacheKafkaMsk` | yes | 1 | single-row | ok |
| `amazonMemoryDbForRedis` | yes | 2 | dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonNeptune` | yes | 5 | additionalPricingData;dependent;single-row | fail:MISSING_INPUT |
| `amazonRDSAuroraPostgreSQLCompatibleDB` | yes | 4 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:AMBIGUOUS_SELECTION |
| `amazonRDSForSQLServer` | yes | 1 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonRDSMariaDB` | yes | 1 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonRDSMySQLDB` | yes | 1 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonRDSPostgreSQLDB` | yes | 1 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonRdsCustomForOracle` | yes | 1 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:AMBIGUOUS_SELECTION |
| `amazonRdsCustomForSqlServer` | yes | 1 | dependent;riPricingTypes[];single-row | fail:AMBIGUOUS_SELECTION |
| `amazonRdsForDb2` | yes | 1 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonRdsForOracle` | yes | 1 | additionalPricingData;dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonRdsForOutposts` | yes | 1 | dependent;single-row | fail:MISSING_INPUT |
| `amazonRedshift` | yes | 1 | dependent;riPricingTypes[];single-row | fail:MISSING_INPUT |
| `amazonTimestream` | yes | 2 | additionalPricingData;dependent;single-row | fail:MISSING_INPUT |
| `awsCodeBuild` | yes | 6 | single-row | fail:MISSING_INPUT |
| `awsDatabaseMigrationService` | yes | 2 | additionalPricingData;dependent;single-row | fail:MISSING_INPUT |
| `lightsailContainers` | no | 1 | single-row | fail:MISSING_INPUT |
| `lightsailManagedDatabases` | no | 1 | single-row | fail:MISSING_INPUT |
| `lightsailObjectStorage` | no | 1 | single-row | fail:MISSING_INPUT |
| `lightsailVirtualServers` | no | 1 | single-row | fail:MISSING_INPUT |
| `mediaLiveAudioAddOns` | no | 4 | dependent;single-row | ok |
| `mediaLiveInput1` | no | 2 | dependent;single-row | ok |
| `mediaLiveOutput1` | no | 6 | dependent;single-row | fail:MISSING_PRICE |
| `omicsReady2RunWorkflows` | no | 1 | single-row | fail:MISSING_INPUT |
| `omicsWorkflows` | no | 1 | single-row | fail:MISSING_INPUT |
| `outputConfiguration1` | no | 1 | dependent;single-row | fail:MISSING_PRICE |
| `outputConfiguration2` | no | 1 | dependent;single-row | fail:MISSING_PRICE |
| `realTimeDocumentTranslation` | no | 1 | single-row | fail:MISSING_PRICE |
| `sageMakerAsynchronousInference` | no | 1 | single-row | fail:MISSING_INPUT |
| `sageMakerBatchTransform` | no | 1 | single-row | fail:MISSING_INPUT |
| `sageMakerCodeEditor` | no | 1 | single-row | fail:MISSING_INPUT |
| `sageMakerDataWrangler` | no | 2 | single-row | fail:MISSING_INPUT |
| `sageMakerOnDemandNotebookInstances` | no | 2 | single-row | fail:MISSING_INPUT |
| `sageMakerProcessing` | no | 1 | single-row | fail:MISSING_INPUT |
| `sageMakerRStudioOnSageMaker` | no | 2 | single-row | fail:MISSING_INPUT |
| `sageMakerRealTimeInference` | no | 3 | single-row | fail:MISSING_INPUT |
| `sageMakerStudioNotebooks` | no | 1 | single-row | fail:MISSING_INPUT |
| `sageMakerTraining` | no | 1 | single-row | fail:MISSING_INPUT |
| `simSpaceWeaver` | yes | 1 | single-row | fail:MISSING_INPUT |
| `workSpacesPools` | no | 1 | dependent;single-row | fail:MISSING_INPUT |

### Selector groups

| Group | Children | Effective static | Non-clean children | Runtime use1 | Runtime use2 |
| --- | --- | --- | --- | --- | --- |
| `aWSTransferForSFTP` | 5 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonBedrock` | 13 | clean | - | fail:ERROR | fail:ERROR |
| `amazonBedrockAgentCore` | 7 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonChime` | 2 | blocked | chimeCostAnalysis;chimeBusinessCallingAnalysis | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonChimeSdk` | 5 | blocked | ptsnAudio;sipTrunking | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonComprehend` | 12 | clean | - | ok | ok |
| `amazonComprehendMedical` | 5 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonDynamoDb` | 8 | partial | amazonDynamoDbDaxClusters | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonEMR` | 5 | blocked | amazonEmrMasterNode;amazonEmrCoreNode;amazonEmrTaskNode | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonLightsail` | 8 | partial | lightsailVirtualServers;lightsailManagedDatabases;lightsailContainers;lightsailObjectStorage | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonMainframeModernization` | 2 | blocked | mainframeBluAge;mainframeMicroFocus | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonOmics` | 4 | partial | omicsWorkflows;omicsReady2RunWorkflows | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonPolly` | 4 | clean | - | ok | fail:ERROR |
| `amazonQuickSight` | 2 | clean | - | ok | fail:ERROR |
| `amazonRekognition` | 5 | clean | - | ok | ok |
| `amazonSageMaker` | 15 | partial | sageMakerStudioNotebooks;sageMakerCodeEditor;sageMakerRStudioOnSageMaker;sageMakerOnDemandNotebookInstances;sageMakerProcessing;sageMakerDataWrangler;sageMakerTraining;sageMakerRealTimeInference;sageMakerAsynchronousInference;sageMakerBatchTransform | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonSimpleNotificationService` | 2 | clean | - | ok | ok |
| `amazonSimpleStorageServiceGroup` | 16 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `amazonTranslate` | 4 | partial | realTimeDocumentTranslation | ok | ok |
| `amazonVirtualPrivateCloud` | 13 | clean | - | ok | ok |
| `awsAppSync` | 5 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `awsBackup` | 15 | clean | - | fail:ERROR | fail:ERROR |
| `awsElasticDisasterRecovery` | 2 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `awsElementalMediaLive` | 4 | partial | mediaLiveInput1;mediaLiveOutput1;mediaLiveAudioAddOns | fail:MISSING_PRICE | fail:MISSING_PRICE |
| `awsGlue` | 9 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `awsIoTCore` | 3 | clean | - | ok | fail:ERROR |
| `awsProfessionalServices` | 5 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `awsSnowball` | 2 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `awsStepFunctions` | 2 | clean | - | fail:MISSING_INPUT | fail:MISSING_INPUT |
| `awsSystemsManager` | 8 | clean | - | ok | ok |
| `elasticLoadBalancing` | 4 | clean | - | ok | ok |
| `elementalMediaConvert` | 2 | partial | outputConfiguration1;outputConfiguration2 | fail:MISSING_PRICE | fail:MISSING_PRICE |
| `locationService` | 6 | clean | - | ok | ok |

Selector rows show the selector's own default evaluation, not the union of its children. A
selector can fail while its children succeed (AWS Backup hit an HTTP 403 during one scan, while
all 15 children priced from defaults). Use the child rows in the CSV for the real picture.

### CSV columns

`analysis/coverage-matrix.csv` contains every catalog row with:

- static class and raw definition class,
- components supported and total,
- column-form count,
- missing subtypes,
- hard blockers and partial gaps,
- selector children and non-clean children,
- runtime status and error in us-east-1 and us-east-2,
- visibility in both regions.

The CSV is the source for the tables in this document. Regenerate it with the Phase 0 scanner.

## Appendix B - Reproduction

Current one-off commands used for this assessment:

```bash
# Typecheck and tests
npm run typecheck
npm run lint
npm test

# Static scan (KNOWN sets only; deep flags are not represented)
node scripts/scan.ts

# Evaluate every definition with defaults (cache warm, offline)
AWSCALC_OFFLINE=1 node --experimental-strip-types scripts/coverage.ts --evaluate --region us-east-1
```

The second command is the planned replacement for the one-off evaluation used here. Until it
lands, the CSV is the checked-in evidence.

## Appendix C - Visible service class summary

| Class | Standalone | Groups | Examples |
| --- | ---: | ---: | --- |
| clean | 92 | 21 | Lambda, CloudWatch, SQS, SNS, EventBridge, EKS, VPC, S3 group, AWS Backup |
| partial | 29 | 7 | RDS, Aurora, ElastiCache, DocumentDB, Neptune, Redshift, DMS, SageMaker |
| blocked | 9 | 2 | EC2, EC2 Next, EBS, Windows/SQL, Deadline Cloud, Direct Connect, MediaConnect, PCS, Directory Service, EMR, Mainframe |
| missing definition | 0 | 1 | WorkSpaces selector |

The 92 clean standalone services are not all verified. Many need required inputs and have no
fixture. The number is a ceiling on what can be finished quickly, not a claim of coverage.
