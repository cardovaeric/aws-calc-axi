/**
 * Version leaf module. Imports nothing so the `--version` fast path in
 * `bin/aws-calc-axi.js` never pulls in the CLI graph. Keep the version string
 * in sync with package.json (enforced by tests/version.test.ts).
 */
export const VERSION = "0.1.0";
