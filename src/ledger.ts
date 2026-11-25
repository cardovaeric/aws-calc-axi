/**
 * Coverage ledger. One row per service, template, region, and fixture.
 *
 * `expectedMonthlyCents` is the frozen native result. A row is only `pass` when
 * the public page renders that value and the recompute probe agrees.
 */
export interface LedgerEntry {
  id: string;
  service: string;
  template: string;
  region: string;
  fixture: string;
  specPath: string;
  receiptPath: string;
  expectedMonthlyCents: number;
  /** Support cost the page recomputes at render, when a plan is attached. */
  expectedSupportMonthlyCents?: number;
  /** Total the banner should show: services + support. */
  expectedRenderedMonthlyCents?: number;
  path: "native" | "bridge" | "unsupported";
  /**
   * `probe` is a second public link recomputed by the share page;
   * `editor` is the published link recomputed by the calculator editor.
   */
  oracle: "probe" | "editor" | "none";
  notes?: string;
}

export const LEDGER: LedgerEntry[] = [
  {
    id: "p0-eks-ebs-conformance-use2",
    service: "EKS + EBS conformance batch",
    template: "awsEks + amazonElasticBlockStore",
    region: "us-east-2",
    fixture: "3 EKS fixtures and all 7 EBS volume types with snapshots",
    specPath: "analysis/fixtures/conformance-p0-1.yaml",
    receiptPath: "receipts/conformance-p0-1.json",
    expectedMonthlyCents: 3102426,
    path: "native",
    oracle: "editor",
    notes: "per-row editor recompute; 10 fixtures in one estimate",
  },
  {
    id: "p0-vpc-conformance-1-use2",
    service: "VPC conformance batch 1",
    template: "vpn, network analyzer, reachability, traffic mirroring, public IPv4, IPAM, data transfer",
    region: "us-east-2",
    fixture: "7 VPC sub-services with nonzero values",
    specPath: "analysis/fixtures/conformance-p0-2.yaml",
    receiptPath: "receipts/conformance-p0-2.json",
    expectedMonthlyCents: 41626,
    path: "native",
    oracle: "editor",
    notes: "per-row editor recompute",
  },
  {
    id: "p0-vpc-conformance-2-use2",
    service: "VPC conformance batch 2",
    template: "route server, NAT, transit gateway, PrivateLink, gateway LB, Cloud WAN",
    region: "us-east-2",
    fixture: "6 VPC sub-services with nonzero values",
    specPath: "analysis/fixtures/conformance-p0-3.yaml",
    receiptPath: "receipts/conformance-p0-3.json",
    expectedMonthlyCents: 206482,
    path: "native",
    oracle: "editor",
    notes: "per-row editor recompute",
  },
  {
    id: "s3-standard-100gb-use2",
    service: "amazonS3Standard (via amazonSimpleStorageServiceGroup)",
    template: "s3Standard",
    region: "us-east-2",
    fixture: "100 GB/month Standard storage",
    specPath: "examples/s3-standard.yaml",
    receiptPath: "receipts/p1-s3-standard.json",
    expectedMonthlyCents: 230,
    path: "native",
    oracle: "probe",
    notes: "P0 vertical slice; selector parent emits subServices[]",
  },
  {
    id: "lambda-free-tier-10m-use2",
    service: "aWSLambda",
    template: "lambdaWithFreeTier",
    region: "us-east-2",
    fixture: "10M requests, 200 ms, 512 MB, free tier",
    specPath: "examples/lambda.yaml",
    receiptPath: "receipts/p1-lambda.json",
    expectedMonthlyCents: 1180,
    path: "native",
    oracle: "probe",
    notes: "replace + pricingComboV2, frequency and duration inputs, free tier subtraction",
  },
  {
    id: "cloudwatch-usage-use2",
    service: "amazonCloudWatch",
    template: "CloudWatch",
    region: "us-east-2",
    fixture: "10 metrics, 1M API requests, 5 GB logs, 3 dashboards, 10 alarms",
    specPath: "examples/cloudwatch.yaml",
    receiptPath: "receipts/p1-cloudwatch.json",
    expectedMonthlyCents: 1652,
    path: "native",
    oracle: "probe",
    notes: "region-less pricing meters merged from the pricing file's Any bucket",
  },
  {
    id: "sns-standard-topics-use2",
    service: "amazonSimpleNotificationService (via standardTopics)",
    template: "sns_t1",
    region: "us-east-2",
    fixture: "1M requests, 1M HTTP notifications",
    specPath: "examples/sns.yaml",
    receiptPath: "receipts/p1-sns.json",
    expectedMonthlyCents: 54,
    path: "native",
    oracle: "probe",
    notes: "selector parent with a required sub-service template",
  },
  {
    id: "sqs-standard-requests-use2",
    service: "amazonSimpleQueueService",
    template: "simpleQueueService",
    region: "us-east-2",
    fixture: "1M standard requests, no data transfer",
    specPath: "examples/sqs.yaml",
    receiptPath: "receipts/p1-sqs.json",
    expectedMonthlyCents: 40,
    path: "native",
    oracle: "probe",
    notes:
      "hashed metered unit labels; untouched dataTransferV2 rows render DT Inbound/Outbound lines",
  },
  {
    id: "xray-requests-use2",
    service: "awsXRay",
    template: "template_0",
    region: "us-east-2",
    fixture: "10M requests per month, default sampling, no Insights",
    specPath: "examples/xray.yaml",
    receiptPath: "receipts/p3-xray.json",
    expectedMonthlyCents: 5000,
    path: "native",
    oracle: "probe",
    notes: "P3 fixture promoted to a render receipt; single flat per-request rate",
  },
  {
    id: "cloudformation-extensions-use2",
    service: "awsCloudFormation",
    template: "CloudFormation",
    region: "us-east-2",
    fixture: "100 extensions, 1000 operations per day, 30 seconds each",
    specPath: "examples/cloudformation.yaml",
    receiptPath: "receipts/p3-cloudformation.json",
    expectedMonthlyCents: 273660,
    path: "native",
    oracle: "probe",
    notes: "P3 fixture promoted to a render receipt; frequency and duration conversion",
  },
  {
    id: "eventbridge-custom-events-use2",
    service: "amazonEventBridge",
    template: "template_0",
    region: "us-east-2",
    fixture: "10M custom events per month, 1 KB payload, same-account events",
    specPath: "examples/eventbridge.yaml",
    receiptPath: "receipts/p3-eventbridge.json",
    expectedMonthlyCents: 1000,
    path: "native",
    oracle: "probe",
    notes: "P3 fixture promoted to a render receipt; payload size drives the metered unit",
  },
  {
    id: "athena-queries-use2",
    service: "amazonAthena",
    template: "Athena",
    region: "us-east-2",
    fixture: "100 queries per day, 1 GB scanned, 4 DPUs",
    specPath: "examples/athena.yaml",
    receiptPath: "receipts/p3-athena.json",
    expectedMonthlyCents: 1485,
    path: "native",
    oracle: "probe",
    notes: "P3 fixture promoted to a render receipt; per-query day-to-month conversion",
  },
  {
    id: "s3-outbound-transfer-1tb-use2",
    service: "awsS3DataTransfer",
    template: "awsS3DataTransfer",
    region: "us-east-2",
    fixture: "1 TB/month outbound to the internet",
    specPath: "examples/s3-data-transfer.yaml",
    receiptPath: "receipts/p3-s3-data-transfer.json",
    expectedMonthlyCents: 9216,
    path: "native",
    oracle: "editor",
    notes:
      "non-empty dataTransferV2; the read-only probe drops these rows, so the editor recompute is the oracle",
  },
  {
    id: "dax-nodes-use2",
    service: "amazonDynamoDbDaxClusters",
    template: "dynamoDBDaxNodes",
    region: "us-east-2",
    fixture: "3 r5.large DAX nodes, hourly pricing",
    specPath: "examples/dax.yaml",
    receiptPath: "receipts/p3-dax.json",
    expectedMonthlyCents: 55845,
    path: "native",
    oracle: "probe",
    notes: "first columnFormIPM row; PLC_2.0 metadata, aggregations, and index price path",
  },
  {
    id: "column-form-rows-use2",
    service: "CodeBuild x2 + ElastiCache + MSK",
    template: "awsCodeBuild x2 + amazonElastiCache + amazonManagedStreamingForApacheKafkaMsk",
    region: "us-east-2",
    fixture:
      "two CodeBuild services (10 and 5 builds), ElastiCache 2 x cache.m5.xlarge, MSK 3 x m5.large",
    specPath: "examples/column-form-rows.yaml",
    receiptPath: "receipts/p2-column-form-rows.json",
    expectedMonthlyCents: 95746,
    path: "native",
    oracle: "editor",
    notes:
      "one row per column form; the live 'second row' is a second service (receipts/column-form-rows-probe.json)",
  },
  {
    id: "dependent-selectors-use2",
    service: "ElastiCache + OpenSearch + Redshift reserved",
    template: "amazonElastiCache + amazonElasticsearchService + amazonRedshift",
    region: "us-east-2",
    fixture:
      "ElastiCache 2 x cache.m5.xlarge Reserved 1yr All Upfront, OpenSearch 2 x r5.2xlarge.search Reserved 1yr No Upfront, Redshift 2 x ra3.4xlarge Reserved 1yr No Upfront",
    specPath: "examples/dependent-selectors.yaml",
    receiptPath: "receipts/p1-dependent-selectors.json",
    expectedMonthlyCents: 408070,
    path: "native",
    oracle: "editor",
    notes:
      "dependent Term/Purchase selectors resolved from the price records; 3,482.00 upfront (analysis/FINDINGS.md section 14)",
  },
  {
    id: "utilization-pcs-use2",
    service: "awsPcs",
    template: "AWS PCS",
    region: "us-east-2",
    fixture: "length of time cluster is running at 0%, 50%, and 100%",
    specPath: "examples/utilization-pcs.yaml",
    receiptPath: "receipts/p1-utilization-pcs.json",
    expectedMonthlyCents: 65448,
    path: "native",
    oracle: "editor",
    notes:
      "utilization subtype with percentagePerMonth hours conversion; 3 rows cover min, middle, and max",
  },
  {
    id: "utilization-mediaconnect-use2",
    service: "awsElementalMediaConnect",
    template: "elementalMediaConnect",
    region: "us-east-2",
    fixture: "10 NDI flows at 0, 365, and 730 hours per month",
    specPath: "examples/utilization-mediaconnect.yaml",
    receiptPath: "receipts/p1-utilization-mediaconnect.json",
    expectedMonthlyCents: 1642500,
    path: "native",
    oracle: "editor",
    notes:
      "utilization subtype with hoursPerMonth; the editor recompute is the oracle because the service also carries dataTransferV2 rows",
  },
  {
    id: "deadline-cloud-utilization-use2",
    service: "awsDeadlineCloud",
    template: "template",
    region: "us-east-2",
    fixture: "1 c5.large Linux worker at 0%, 50%, and 100% utilization",
    specPath: "examples/utilization-deadline-cloud.yaml",
    receiptPath: "receipts/p2-deadline-cloud-utilization.json",
    expectedMonthlyCents: 40908,
    path: "native",
    oracle: "editor",
    notes:
      "utilization subtype plus spaced PLC_2.0 price-set labels (c5 large Linux ...); the labels resolve through the dependent-selector work",
  },
  {
    id: "direct-connect-utilization-use2",
    service: "awsDirectConnect",
    template: "template",
    region: "us-east-1",
    fixture: "1 Dedicated 10G port at Equinix LD4 - LD6 used 0, 365, and 730 hours",
    specPath: "examples/utilization-direct-connect.yaml",
    receiptPath: "receipts/p2-direct-connect-utilization.json",
    expectedMonthlyCents: 246375,
    path: "native",
    oracle: "editor",
    notes:
      "a price map with no regionAttributes.Location is not region-scoped, and the index path takes the region name for Location and From Location (analysis/FINDINGS.md section 16)",
  },
  {
    id: "fsx-lustre-use2",
    service: "amazonFSxForLustre",
    template: "persistent",
    region: "us-east-2",
    fixture: "1200 GB SSD, 125 MBps/TiB, 50% compression savings, no backup",
    specPath: "examples/fsx-lustre.yaml",
    receiptPath: "receipts/p2-fsx-lustre.json",
    expectedMonthlyCents: 17432,
    path: "native",
    oracle: "editor",
    notes:
      "replace is a global substring substitution and a displayIf ordering comparison coerces an uncomputed component to 0, so the 1200 GB branch rounds up (174.32 = 1200 x 0.000199 x 730)",
  },
  {
    id: "keyspaces-percent-input-use2",
    service: "amazonKeyspaces",
    template: "keyspacesOnDemandCapacityNew",
    region: "us-east-2",
    fixture: "1M writes, 1M reads, 100 GB, LOCAL_ONE reads at the 100% default",
    specPath: "examples/keyspaces-column-form.yaml",
    receiptPath: "receipts/p1-keyspaces.json",
    expectedMonthlyCents: 2569,
    path: "native",
    oracle: "editor",
    notes:
      "percentInput saves the entered percent, so the rehydrated summary keeps LOCAL_ONE reads (1); this is the 25.69 vs 25.63 oracle from D-026",
  },
  {
    id: "groups-support-business-use2",
    service: "group: Data -> Data Compute (S3 + Lambda)",
    template: "simpleStorageServiceClassesGroup + lambdaWithFreeTier",
    region: "us-east-2",
    fixture: "nested groups with Business Support+",
    specPath: "examples/groups-support.yaml",
    receiptPath: "receipts/p2-groups-support.json",
    expectedMonthlyCents: 1410,
    expectedSupportMonthlyCents: 2900,
    expectedRenderedMonthlyCents: 4310,
    path: "native",
    oracle: "none",
    notes: "support is recomputed by the share page; groups render as rows plus a tree",
  },
];

export interface LedgerReceiptView {
  verdict?: string;
  url?: string;
  oracle?: { verdict?: string; url?: string };
  native?: { monthly?: number };
  rendered?: { monthly?: string; annual?: string };
  expires?: string;
}

export function formatCoverage(
  entries: LedgerEntry[],
  receipts: Map<string, LedgerReceiptView | undefined>
): string {
  const lines: string[] = [];
  lines.push("# Coverage ledger");
  lines.push("");
  lines.push(
    "One row per service, template, region, and fixture. `pass` means the public page was opened and"
  );
  lines.push(
    "the rendered DOM matched the native result. The `Oracle` column records the live"
  );
  lines.push(
    "recomputation: a recompute probe (source not the calculator) or, for rows the read-only probe"
  );
  lines.push("drops, the editor recomputation behind `Update estimate` (`oracle: editor`).");
  lines.push("");
  lines.push("| Service | Template | Region | Fixture | Path | Native | Rendered | Oracle | Status | Link |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of entries) {
    const receipt = receipts.get(entry.id);
    const native = (entry.expectedMonthlyCents / 100).toFixed(2);
    const rendered = receipt?.rendered?.monthly ?? "-";
    const oracle = receipt?.oracle?.verdict ?? "none";
    const status =
      receipt?.verdict === "pass" && (entry.oracle === "none" || receipt?.oracle?.verdict === "pass")
        ? "pass"
        : receipt
          ? "fail"
          : "pending";
    const link = receipt?.url ?? "-";
    lines.push(
      `| ${entry.service} | ${entry.template} | ${entry.region} | ${entry.fixture} | ${entry.path} | ${native} | ${rendered} | ${oracle} | ${status} | ${link} |`
    );
  }
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  lines.push("- Receipts: `receipts/` (native result, stored JSON comparison, rendered DOM, probe).");
  lines.push("- Screenshots: `receipts/screenshots/<row id>.png` captured from each public link.");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const entry of entries) {
    if (entry.notes) lines.push(`- ${entry.id}: ${entry.notes}`);
  }
  lines.push("");
  lines.push(
    "Regenerate with `npm run ledger`. Receipts are in `receipts/`; each one stores the native result,"
  );
  lines.push("the stored result, the rendered DOM snapshot, the recompute probe, and the verdict.");
  lines.push("");
  return lines.join("\n");
}
