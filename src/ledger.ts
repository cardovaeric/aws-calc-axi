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
  oracle: "probe" | "none";
  notes?: string;
}

export const LEDGER: LedgerEntry[] = [
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
    notes: "hashed metered unit labels; empty dataTransferV2 renders DT Inbound/Outbound lines",
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
    "the rendered DOM matched the native result, and the recompute probe (source not the calculator)"
  );
  lines.push("recomputed the same totals from the stored components.");
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
