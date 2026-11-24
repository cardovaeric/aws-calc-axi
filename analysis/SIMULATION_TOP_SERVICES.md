# Top-service simulation: EKS, VPC, EBS, RDS, EC2

Final calculator link:

https://calculator.aws/#/estimate?id=bb86ab5ce58ba6a55af7f36c320b33e0fbd798a9

- Estimate: `axi-sim EKS VPC EBS RDS EC2 full surface`
- Monthly total: **16,313.62 USD**
- Upfront: **1,538.08 USD**
- Annual: **197,301.52 USD**
- Services stored: 37 across 5 groups

| Group | Monthly | Upfront | Included |
| --- | ---: | ---: | --- |
| EKS | 1,711.16 | 0.00 | Standard and extended support, Argo CD/ACK/KRO capabilities, tiered hybrid nodes |
| VPC | 2,481.08 | 0.00 | All 13 VPC sub-services |
| EBS | 9,131.75 | 0.00 | gp2, gp3, io1, io2, st1, sc1, magnetic, with IOPS/throughput, snapshots, restore and direct APIs |
| RDS | 2,802.17 | 0.00 | MySQL, PostgreSQL, MariaDB, Oracle, Custom Oracle, SQL Server, Db2, Custom SQL Server, Aurora MySQL, Aurora PostgreSQL |
| EC2 | 187.46 | 1,538.08 | On-demand, 1-year Standard RI, 3-year Convertible RI, Spot, 3-year Compute Savings Plan, 3-year EC2 Instance Savings Plan |

## Verification

The saved page and the live editor recomputation agree to the cent. Values are
monthly / upfront.

| Check | Stored page | Editor recompute |
| --- | ---: | ---: |
| Total | 16,313.62 / 1,538.08 | 16,313.62 / 1,538.08 |
| EKS | 1,711.16 / 0.00 | 1,711.16 / 0.00 |
| VPC | 2,481.08 / 0.00 | 2,481.08 / 0.00 |
| EBS | 9,131.75 / 0.00 | 9,131.75 / 0.00 |
| RDS | 2,802.17 / 0.00 | 2,802.17 / 0.00 |
| EC2 | 187.46 / 1,538.08 | 187.46 / 1,538.08 |

Native Oracle and Custom Oracle were also published on their own and passed the editor oracle:

https://calculator.aws/#/estimate?id=056b774a6376f3e7c721255b883589c39f15e505

EBS and RDS MySQL/PostgreSQL/MariaDB were published flat in diagnostics and matched the live editor per row. The final link groups them so the page fits in five rows; expand a group to see every service.

## What is native and what is captured

Native engine services:

- EKS, all 4 cards.
- VPC, all 13 sub-services.
- EBS, 3 variants.
- RDS MySQL, PostgreSQL, MariaDB, Oracle, Custom Oracle.

Live-editor-captured services (the native engine does not implement these paths yet):

- RDS SQL Server, Db2, Custom SQL Server, Aurora MySQL, Aurora PostgreSQL.
- EC2 pricing variants. They reuse the captured advanced-estimate payload for `m5.large`, Linux, shared tenancy, gp3 storage, snapshots, detailed monitoring, data transfer, and additional costs; only the pricing strategy changes.

The captured rows are valid calculator payloads. The final link re-runs them in the live editor and their group totals match the stored costs, so the link is not a static mock. The remaining native gaps are the column-form selector matching for SQL Server/Db2/Aurora and the EC2 pricing-strategy math.

## Code changes needed to reach parity

- Implemented `snapShotMaths` with the live formula: first snapshot stores the full volume, later snapshots store the changed amount at 50% of a month, multiplied by the snapshot count.
- Fixed file-size rate conversion. A 1 TB/month input was converted to 730 TB/hour instead of 1.4 GB/hour; this made Gateway Load Balancer LCU costs about 730x too high and also affected any per-hour/per-month file-size input.
- File-size inputs now reject a frequency the component does not offer. `storageAmount: gb|month` on EBS/RDS was silently saved with an undefined unit and the live editor rendered `500 undefined`; the correct wire unit is `gb|NA`.
- Rendered verification now matches duplicate display names by config summary instead of always picking the first row. Three EBS rows and five EC2 rows share the same display name.
- Added unit tests for snapShotMaths, rate conversion, file-size validation, and duplicate-row matching.

## Evidence

- `receipts/sim-top-services.json`: link, totals, group totals, 37-service inventory, method and verification.
- `receipts/sim-top-services-estimate.json`: the full stored estimate with every service component.
- `analysis/fixtures/estimate-top-services.yaml`: the native portion of the estimate (EKS, VPC, EBS, native RDS).
- Oracle/Custom Oracle receipt: `receipts/rds-native2.json`.
- Diagnostic probes (same components, flat rows): RDS SQL Server/Db2/Aurora
  `https://calculator.aws/#/estimate?id=48239098382953d2049eff2bcfe6275de1053067`;
  EC2 variants `https://calculator.aws/#/estimate?id=f72e1b5b7a0d9667190000e0d0ff5776bc3a5418`.

## Reproduce

```sh
# Native base (EKS, VPC, EBS, native RDS)
node bin/aws-calc-axi.js cost analysis/fixtures/estimate-top-services.yaml --full

# Final link
node bin/aws-calc-axi.js verify "https://calculator.aws/#/estimate?id=bb86ab5ce58ba6a55af7f36c320b33e0fbd798a9"
```

The mixed builder that adds the live-captured RDS/EC2 rows is a one-off analysis script. It is not committed because it embeds live-captured costs from this run; the receipt and the stored estimate are the reproducible evidence.
