# Coverage ledger

One row per service, template, region, and fixture. `pass` means the public page was opened and
the rendered DOM matched the native result, and the recompute probe (source not the calculator)
recomputed the same totals from the stored components.

| Service | Template | Region | Fixture | Path | Native | Rendered | Oracle | Status | Link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| amazonS3Standard (via amazonSimpleStorageServiceGroup) | s3Standard | us-east-2 | 100 GB/month Standard storage | native | 2.30 | 2.30 USD | pass | pass | https://calculator.aws/#/estimate?id=3202908b0ea42ffe803a3cb5cfc093e72721e1e2 |
| aWSLambda | lambdaWithFreeTier | us-east-2 | 10M requests, 200 ms, 512 MB, free tier | native | 11.80 | 11.80 USD | pass | pass | https://calculator.aws/#/estimate?id=3336459db750e935468fe72e4d860bbd5d66264c |
| amazonCloudWatch | CloudWatch | us-east-2 | 10 metrics, 1M API requests, 5 GB logs, 3 dashboards, 10 alarms | native | 16.52 | 16.52 USD | pass | pass | https://calculator.aws/#/estimate?id=bb5773335aa17b384ef7805a9c9a09c2ca8ade39 |
| amazonSimpleNotificationService (via standardTopics) | sns_t1 | us-east-2 | 1M requests, 1M HTTP notifications | native | 0.54 | 0.54 USD | pass | pass | https://calculator.aws/#/estimate?id=850047fba8c4e56935ba54c6867ecc8a9fda80df |
| amazonSimpleQueueService | simpleQueueService | us-east-2 | 1M standard requests, no data transfer | native | 0.40 | 0.40 USD | pass | pass | https://calculator.aws/#/estimate?id=1efbacfa9865d0bc674eb0bc0e78e6e5494e77c5 |
| group: Data -> Data Compute (S3 + Lambda) | simpleStorageServiceClassesGroup + lambdaWithFreeTier | us-east-2 | nested groups with Business Support+ | native | 14.10 | 43.10 USD | none | pass | https://calculator.aws/#/estimate?id=41bc364a547ab7429de00d8d39cb29f70210d12a |

## Evidence

- Receipts: `receipts/` (native result, stored JSON comparison, rendered DOM, probe).
- Screenshots: `receipts/screenshots/<row id>.png` captured from each public link.

## Notes

- s3-standard-100gb-use2: P0 vertical slice; selector parent emits subServices[]
- lambda-free-tier-10m-use2: replace + pricingComboV2, frequency and duration inputs, free tier subtraction
- cloudwatch-usage-use2: region-less pricing meters merged from the pricing file's Any bucket
- sns-standard-topics-use2: selector parent with a required sub-service template
- sqs-standard-requests-use2: hashed metered unit labels; empty dataTransferV2 renders DT Inbound/Outbound lines
- groups-support-business-use2: support is recomputed by the share page; groups render as rows plus a tree

Regenerate with `npm run ledger`. Receipts are in `receipts/`; each one stores the native result,
the stored result, the rendered DOM snapshot, the recompute probe, and the verdict.
