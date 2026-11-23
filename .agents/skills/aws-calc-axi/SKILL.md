---
name: aws-calc-axi
description: Build, price, publish, and render-verify AWS Pricing Calculator estimates from the shell. Use when asked to estimate AWS cost, price a service configuration, create or inspect a calculator.aws estimate link, or compare AWS Pricing Calculator numbers with a native calculation.
---

# aws-calc-axi

A native CLI for the AWS Pricing Calculator. It computes estimates offline from the live
definition and price data, can publish a normal `https://calculator.aws/#/estimate?id=...` link,
and only counts a publish as successful after opening the public page and matching the rendered
DOM to the cent.

Read the repo's `README.md` for the full surface, `PLAN.md` for the accuracy gates, and
`STATUS.md` for what is verified today (not every AWS service is supported yet; unsupported
components fail closed).

## Output contract

- stdout is TOON; errors also go to stdout with `error:`, `code:`, and `help:`.
- Progress and diagnostics go to stderr.
- Exit codes: 0 success/no-op, 1 error, 2 usage error (unknown flag, missing argument).
- No interactive prompts. Every command completes with flags alone.
- Node 24+ required.

## Get the CLI

The skill ships with the CLI in one repository, but installing the skill does not install the
binary. Clone the repository once and link it:

```sh
git clone https://github.com/cardovaeric/aws-calc-axi.git
cd aws-calc-axi
npm install
npm link
aws-calc-axi --version
```

Node 24+ is required, and the CLI must run from that checkout: it executes the TypeScript
sources directly, which Node does not allow for files under `node_modules`. If the link is
undesirable, call `node <checkout>/bin/aws-calc-axi.js` instead.

## Discover

```sh
aws-calc-axi                                             # data state, publish budget, next steps
aws-calc-axi services --region us-east-2 --query s3      # find services
aws-calc-axi schema amazonDynamoDbDaxClusters --region us-east-2 --full
aws-calc-axi pricing amazonS3Standard --region us-east-2 --unit "Standard Storage"
aws-calc-axi doctor                                      # data plane and browser health
aws-calc-axi update --check                              # data drift, read only
```

## Estimate file

YAML (JSON accepted). Names, currency, locale, optional support plan, services, and nested
groups:

```yaml
name: Web tier
currency: USD
locale: en_US
support: business
services:
  - code: aWSLambda
    region: us-east-2
    template: lambdaWithFreeTier
    set:
      numberOfRequests: { value: 10000000, unit: perMonth }
      durationOfEachRequest: 200
      sizeOfMemoryAllocated: { value: 512, unit: mb|NA }
groups:
  - name: Data
    services:
      - code: amazonSimpleStorageServiceGroup
        region: us-east-2
        subServices:
          - code: amazonS3Standard
            set:
              s3StandardStorageSize: { value: 100, unit: gb|month }
```

Repeatable table inputs use their live saved shape:

```yaml
services:
  - code: awsS3DataTransfer
    region: us-east-2
    set:
      dataTransfer:
        value:
          - entryType: OUTBOUND
            value: 1
            unit: tb_month
            toRegion: External        # External, other, or a region code
  - code: amazonDynamoDbDaxClusters
    region: us-east-2
    set:
      columnFormIPM:
        - Number of nodes: 3
          Instance Type: r5.large
```

## Compute

```sh
aws-calc-axi estimate init "Web tier" --out estimate.yaml
aws-calc-axi cost estimate.yaml            # totals
aws-calc-axi cost estimate.yaml --full     # per-service rows, summaries, subtotals
```

`cost` never touches the network at render time and never publishes. Use it for quotes and for
checking a spec before publishing.

## Publish and verify

```sh
aws-calc-axi publish estimate.yaml --oracle --receipt receipts/my-estimate.json
aws-calc-axi publish estimate.yaml --oracle-editor --receipt receipts/dt.json
aws-calc-axi verify "https://calculator.aws/#/estimate?id=<key>" --expect estimate.yaml
```

- A link alone is not a receipt. `publish` opens the page with `agent-browser`, reads
  `[data-monthly-cost]`, the service/group rows, the group tree, and the support row, and diffs
  them against the native estimate.
- `--oracle` publishes a second, foreign-source copy that the share page recomputes from
  `calculationComponents`; that recomputation is the math oracle.
- `--oracle-editor` instead opens the published link, clicks "Update estimate", and diffs the
  editor page. Use it for `dataTransferV2` rows, which the read-only page drops. It creates no
  extra link.
- Publishing is a public, explicit mutation. Links are capped at 25 per UTC day
  (`AWSCALC_MAX_PUBLISHES_PER_DAY`) and public, so put no secrets in an estimate.
- `--receipt <path>` reuses the stored link when the spec hash matches. Add `--force-publish`
  only when the fixture or the saved contract genuinely changed.
- Estimate names used for tests must start with `axi-e2e`.

## Failure semantics

The engine never publishes a guessed zero. Unknown component subtypes, unresolved meters,
missing region prices, unselected data transfer destinations, and unsupported column-form
features raise a structured error with the service, template, and component id. Fix the spec or
pick a supported service; do not bypass the error.

## Good agent loop

1. `aws-calc-axi services ...` and `aws-calc-axi schema ...` to confirm support and input ids.
2. Write or edit the YAML spec.
3. `aws-calc-axi cost ... --full` until the numbers and summaries are what you expect.
4. `aws-calc-axi publish ... --oracle --receipt receipts/<name>.json` (or `--oracle-editor`).
5. Report the public URL plus the rendered monthly/annual totals. If `render: fail`, fix the
   native estimate; the page is the truth.
