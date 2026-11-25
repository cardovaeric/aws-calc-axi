# Coverage ledger

One row per service, template, region, and fixture. `pass` means the public page was opened and
the rendered DOM matched the native result. The `Oracle` column records the live
recomputation: a recompute probe (source not the calculator) or, for rows the read-only probe
drops, the editor recomputation behind `Update estimate` (`oracle: editor`).

| Service | Template | Region | Fixture | Path | Native | Rendered | Oracle | Status | Link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EKS + EBS conformance batch | awsEks + amazonElasticBlockStore | us-east-2 | 3 EKS fixtures and all 7 EBS volume types with snapshots | native | 31024.26 | 31,024.26 USD | pass | pass | https://calculator.aws/#/estimate?id=da681d431df3701ad0507ffd5fbc6a060a26ea16 |
| VPC conformance batch 1 | vpn, network analyzer, reachability, traffic mirroring, public IPv4, IPAM, data transfer | us-east-2 | 7 VPC sub-services with nonzero values | native | 416.26 | 416.26 USD | pass | pass | https://calculator.aws/#/estimate?id=243609a2f92756ab64839b25ad47a455157f7113 |
| VPC conformance batch 2 | route server, NAT, transit gateway, PrivateLink, gateway LB, Cloud WAN | us-east-2 | 6 VPC sub-services with nonzero values | native | 2064.82 | 2,064.82 USD | pass | pass | https://calculator.aws/#/estimate?id=0eacc258d28623ebf52606058e9944db30d46028 |
| amazonS3Standard (via amazonSimpleStorageServiceGroup) | s3Standard | us-east-2 | 100 GB/month Standard storage | native | 2.30 | 2.30 USD | pass | pass | https://calculator.aws/#/estimate?id=3202908b0ea42ffe803a3cb5cfc093e72721e1e2 |
| aWSLambda | lambdaWithFreeTier | us-east-2 | 10M requests, 200 ms, 512 MB, free tier | native | 11.80 | 11.80 USD | pass | pass | https://calculator.aws/#/estimate?id=3336459db750e935468fe72e4d860bbd5d66264c |
| amazonCloudWatch | CloudWatch | us-east-2 | 10 metrics, 1M API requests, 5 GB logs, 3 dashboards, 10 alarms | native | 16.52 | 16.52 USD | pass | pass | https://calculator.aws/#/estimate?id=bb5773335aa17b384ef7805a9c9a09c2ca8ade39 |
| amazonSimpleNotificationService (via standardTopics) | sns_t1 | us-east-2 | 1M requests, 1M HTTP notifications | native | 0.54 | 0.54 USD | pass | pass | https://calculator.aws/#/estimate?id=b6a3ae880542e885780eeaaebaa0eb3e39bbf302 |
| amazonSimpleQueueService | simpleQueueService | us-east-2 | 1M standard requests, no data transfer | native | 0.40 | 0.40 USD | pass | pass | https://calculator.aws/#/estimate?id=387fceb09cc417abb281cac930295a55b1377a3e |
| awsXRay | template_0 | us-east-2 | 10M requests per month, default sampling, no Insights | native | 50.00 | 50.00 USD | pass | pass | https://calculator.aws/#/estimate?id=c0c9753c81e715c286d4cb487d6853830c861818 |
| awsCloudFormation | CloudFormation | us-east-2 | 100 extensions, 1000 operations per day, 30 seconds each | native | 2736.60 | 2,736.60 USD | pass | pass | https://calculator.aws/#/estimate?id=6ad370fe8cbb355e02dfd241e6bdd85f1af6a48f |
| amazonEventBridge | template_0 | us-east-2 | 10M custom events per month, 1 KB payload, same-account events | native | 10.00 | 10.00 USD | pass | pass | https://calculator.aws/#/estimate?id=170ba0aa4c1ce7f6c1329ab52dfca32faa615902 |
| amazonAthena | Athena | us-east-2 | 100 queries per day, 1 GB scanned, 4 DPUs | native | 14.85 | 14.85 USD | pass | pass | https://calculator.aws/#/estimate?id=8adc3640728e1d0d4e375e78464521b57b9a8889 |
| awsS3DataTransfer | awsS3DataTransfer | us-east-2 | 1 TB/month outbound to the internet | native | 92.16 | 92.16 USD | pass | pass | https://calculator.aws/#/estimate?id=2ba8815d844b0c98d3c23d3df0e103b2b38ab662 |
| amazonDynamoDbDaxClusters | dynamoDBDaxNodes | us-east-2 | 3 r5.large DAX nodes, hourly pricing | native | 558.45 | 558.45 USD | pass | pass | https://calculator.aws/#/estimate?id=ee83789565dcdcd9b0c169dcac29e8cf3848575c |
| CodeBuild x2 + ElastiCache + MSK | awsCodeBuild x2 + amazonElastiCache + amazonManagedStreamingForApacheKafkaMsk | us-east-2 | two CodeBuild services (10 and 5 builds), ElastiCache 2 x cache.m5.xlarge, MSK 3 x m5.large | native | 957.46 | 957.46 USD | pass | pass | https://calculator.aws/#/estimate?id=0a75b381ce55078a95880d40349e5ab6f2a44fed |
| ElastiCache + OpenSearch + Redshift reserved | amazonElastiCache + amazonElasticsearchService + amazonRedshift | us-east-2 | ElastiCache 2 x cache.m5.xlarge Reserved 1yr All Upfront, OpenSearch 2 x r5.2xlarge.search Reserved 1yr No Upfront, Redshift 2 x ra3.4xlarge Reserved 1yr No Upfront | native | 4080.70 | 4,080.70 USD | pass | pass | https://calculator.aws/#/estimate?id=b03c7fc75c828c53cb388b87aa8dae6f421e2153 |
| awsPcs | AWS PCS | us-east-2 | length of time cluster is running at 0%, 50%, and 100% | native | 654.48 | 654.48 USD | pass | pass | https://calculator.aws/#/estimate?id=b7b98f1a0722374e75e09dadba67c8f6f997aec4 |
| awsElementalMediaConnect | elementalMediaConnect | us-east-2 | 10 NDI flows at 0, 365, and 730 hours per month | native | 16425.00 | 16,425.00 USD | pass | pass | https://calculator.aws/#/estimate?id=9569932f90a240ff002a4a0c24f008f3fd1f74da |
| awsDeadlineCloud | template | us-east-2 | 1 c5.large Linux worker at 0%, 50%, and 100% utilization | native | 409.08 | 409.08 USD | pass | pass | https://calculator.aws/#/estimate?id=36f308705d6341c80d9e55d1b1075b0c35a5da79 |
| awsDirectConnect | template | us-east-1 | 1 Dedicated 10G port at Equinix LD4 - LD6 used 0, 365, and 730 hours | native | 2463.75 | 2,463.75 USD | pass | pass | https://calculator.aws/#/estimate?id=0dc55dd9b0a6dd6b306b70f1086bb430eb7bbb36 |
| amazonFSxForLustre | persistent | us-east-2 | 1200 GB SSD, 125 MBps/TiB, 50% compression savings, no backup | native | 174.32 | 174.32 USD | pass | pass | https://calculator.aws/#/estimate?id=2c468a43ab3f709f06ab11b4c5fac7c9b27723a1 |
| amazonKeyspaces | keyspacesOnDemandCapacityNew | us-east-2 | 1M writes, 1M reads, 100 GB, LOCAL_ONE reads at the 100% default | native | 25.69 | 25.69 USD | pass | pass | https://calculator.aws/#/estimate?id=17757fae2a38867cb590bbfb27ca4b3e89eff427 |
| group: Data -> Data Compute (S3 + Lambda) | simpleStorageServiceClassesGroup + lambdaWithFreeTier | us-east-2 | nested groups with Business Support+ | native | 14.10 | 43.10 USD | none | pass | https://calculator.aws/#/estimate?id=41bc364a547ab7429de00d8d39cb29f70210d12a |

## Evidence

- Receipts: `receipts/` (native result, stored JSON comparison, rendered DOM, probe).
- Screenshots: `receipts/screenshots/<row id>.png` captured from each public link.

## Notes

- p0-eks-ebs-conformance-use2: per-row editor recompute; 10 fixtures in one estimate
- p0-vpc-conformance-1-use2: per-row editor recompute
- p0-vpc-conformance-2-use2: per-row editor recompute
- s3-standard-100gb-use2: P0 vertical slice; selector parent emits subServices[]
- lambda-free-tier-10m-use2: replace + pricingComboV2, frequency and duration inputs, free tier subtraction
- cloudwatch-usage-use2: region-less pricing meters merged from the pricing file's Any bucket
- sns-standard-topics-use2: selector parent with a required sub-service template
- sqs-standard-requests-use2: hashed metered unit labels; untouched dataTransferV2 rows render DT Inbound/Outbound lines
- xray-requests-use2: P3 fixture promoted to a render receipt; single flat per-request rate
- cloudformation-extensions-use2: P3 fixture promoted to a render receipt; frequency and duration conversion
- eventbridge-custom-events-use2: P3 fixture promoted to a render receipt; payload size drives the metered unit
- athena-queries-use2: P3 fixture promoted to a render receipt; per-query day-to-month conversion
- s3-outbound-transfer-1tb-use2: non-empty dataTransferV2; the read-only probe drops these rows, so the editor recompute is the oracle
- dax-nodes-use2: first columnFormIPM row; PLC_2.0 metadata, aggregations, and index price path
- column-form-rows-use2: one row per column form; the live 'second row' is a second service (receipts/column-form-rows-probe.json)
- dependent-selectors-use2: dependent Term/Purchase selectors resolved from the price records; 3,482.00 upfront (analysis/FINDINGS.md section 14)
- utilization-pcs-use2: utilization subtype with percentagePerMonth hours conversion; 3 rows cover min, middle, and max
- utilization-mediaconnect-use2: utilization subtype with hoursPerMonth; the editor recompute is the oracle because the service also carries dataTransferV2 rows
- deadline-cloud-utilization-use2: utilization subtype plus spaced PLC_2.0 price-set labels (c5 large Linux ...); the labels resolve through the dependent-selector work
- direct-connect-utilization-use2: a price map with no regionAttributes.Location is not region-scoped, and the index path takes the region name for Location and From Location (analysis/FINDINGS.md section 16)
- fsx-lustre-use2: replace is a global substring substitution and a displayIf ordering comparison coerces an uncomputed component to 0, so the 1200 GB branch rounds up (174.32 = 1200 x 0.000199 x 730)
- keyspaces-percent-input-use2: percentInput saves the entered percent, so the rehydrated summary keeps LOCAL_ONE reads (1); this is the 25.69 vs 25.63 oracle from D-026
- groups-support-business-use2: support is recomputed by the share page; groups render as rows plus a tree

Regenerate with `npm run ledger`. Receipts are in `receipts/`; each one stores the native result,
the stored result, the rendered DOM snapshot, the recompute probe, and the verdict.
