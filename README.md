# aws-calc-axi

An agent-facing CLI for the AWS Pricing Calculator: discover services, build estimates with
groups and support, compute the same numbers as the web app, publish a normal
`https://calculator.aws/#/estimate?id=...` link, and prove it by rendering the public page.

- Native, deterministic engine. The browser is never in the calculation path.
- TOON on stdout, progress on stderr, no prompts, unknown flags exit 2.
- A publish is only complete when the public page is opened and the visible DOM matches the
  native estimate to the cent.

See `PLAN.md` for the locked plan, `analysis/FINDINGS.md` for the live-site evidence,
`COVERAGE.md` for the ledger, and `STATUS.md` for the current state.

## Requirements

- Node 24+ (runs TypeScript directly through type stripping)
- `agent-browser` for render verification (`npm i -g agent-browser && agent-browser install`)

## Install the CLI

```sh
git clone https://github.com/cardovaeric/aws-calc-axi.git
cd aws-calc-axi
npm install
npm link                 # puts `aws-calc-axi` on your PATH
aws-calc-axi             # home view
```

Node 24+ is required. The CLI runs the TypeScript sources directly through Node's type
stripping, so it must be run from a cloned checkout (Node refuses type stripping for packages
installed under `node_modules`).

## Install as an agent skill

```sh
npx skills add cardovaeric/aws-calc-axi --skill aws-calc-axi
```

This installs `.agents/skills/aws-calc-axi/SKILL.md`, the agent-facing guide with the output
contract, estimate format, publish and oracle rules, and the fail-closed behavior. It does not
install the CLI; use the clone and `npm link` step above so the skill's commands resolve. The
skill is also readable without installing:
`npx skills use cardovaeric/aws-calc-axi@aws-calc-axi`.

## Check the repo

```sh
npm run typecheck
npm run lint
npm test
npm run e2e          # live DOM checks; needs network and agent-browser
npm run coverage     # exhaustive static table in analysis/COVERAGE_TABLE.md
npm run coverage -- --evaluate --offline  # add us-east-1/us-east-2 runtime status
```

## Usage

```sh
aws-calc-axi                                        # home: data state and next steps
aws-calc-axi services --region us-east-2 --query s3
aws-calc-axi schema amazonS3Standard --region us-east-2
aws-calc-axi pricing amazonS3Standard --region us-east-2 --unit "Standard Storage"
aws-calc-axi estimate init "Web tier" --out estimate.yaml
aws-calc-axi cost estimate.yaml --full
aws-calc-axi publish estimate.yaml --receipt receipts/web.json
aws-calc-axi publish estimate.yaml --oracle-editor --receipt receipts/dt.json
aws-calc-axi verify "https://calculator.aws/#/estimate?id=<key>" --expect estimate.yaml
aws-calc-axi doctor
aws-calc-axi update --check
```

An estimate file is YAML (JSON accepted):

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

Repeatable table inputs (`dataTransferV2`, `columnFormIPM`) take their live saved shape:

```yaml
services:
  - code: awsS3DataTransfer                 # non-empty transfer rows
    region: us-east-2
    set:
      dataTransfer:
        value:
          - entryType: OUTBOUND             # INBOUND, OUTBOUND, INTRA_REGION
            value: 1
            unit: tb_month                  # tb_month or gb_month
            toRegion: External              # External, other, or a region code
  - code: amazonDynamoDbDaxClusters         # PLC_2.0 column form
    region: us-east-2
    set:
      columnFormIPM:
        - Number of nodes: 3
          Instance Type: r5.large
```

Unselected transfer rows and unsupported column-form features fail closed with the component id.

## How verification works

1. `publish` posts the built estimate to the public save endpoint and returns a link.
2. It opens that link in a named `agent-browser` session and reads `[data-monthly-cost]`,
   `[data-upfront-cost]`, `[data-annual-cost]`, the service/group rows, the group tree, the
   support row, and the read-only banner.
3. `--oracle` also publishes a recompute probe (same components, non-native `metaData.source`).
   The share page recomputes those from `calculationComponents`, so the probe is a live UI oracle
   for the engine. Both URLs land in the receipt.
4. `--oracle-editor` opens the published link, clicks "Update estimate", and diffs the editor
   page instead. Use it for components the read-only probe drops, such as non-empty
   `dataTransferV2` rows; it creates no extra link.

Links are public and the save endpoint is open, so publishing is explicit, capped at 25 links per
day (`AWSCALC_MAX_PUBLISHES_PER_DAY`), and reused when a receipt matches the spec hash.

## Development

- `src/engine/` is the interpreter: inputs, `displayIf`, pricing, maths, summaries.
- `src/data/` holds cache-backed clients for the manifest, definitions, prices, and support tiers.
- `scripts/scan.ts` inventories component subtypes across the catalog and reports what the engine
  can evaluate today (the coverage roadmap).
- `npm run ledger` regenerates `COVERAGE.md` from the receipts.
- `analysis/FINDINGS.md` records the live data shapes and the observed recomputations for data
  transfer (section 9) and `columnFormIPM` (section 10).
