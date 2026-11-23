# Coverage ledger

One row per service, template, region, and fixture. `pass` means the public page was opened and
the rendered DOM matched the native result. `native` means the generic engine computed it without
a bespoke module. `unsupported` means the engine failed closed with an adapter task.

| Service | Template | Region | Fixture | Path | Status | Receipt |
| --- | --- | --- | --- | --- | --- | --- |
| amazonS3Standard | s3Standard | us-east-2 | 100 GB/month Standard | native | pass | receipts/p0-s3-standard.json |
| awsS3DataTransfer | awsS3DataTransfer | us-east-2 | empty transfer rows | native | pass | receipts/p0-s3-standard.json |
