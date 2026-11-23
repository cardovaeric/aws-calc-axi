import { spawnSync } from "node:child_process";

export interface ServiceRow {
  name: string | null;
  upfront: string | null;
  monthly: string | null;
  description: string | null;
  region: string | null;
  configSummary: string | null;
}

export interface RenderedGroup {
  name: string;
  root: boolean;
  parent: boolean;
}

export interface RenderedEstimate {
  url: string;
  title: string | null;
  monthly: string | null;
  upfront: string | null;
  annual: string | null;
  monthlyValue: number | null;
  upfrontValue: number | null;
  annualValue: number | null;
  estimateDate: string | null;
  banner: string | null;
  readOnlyNotice: boolean;
  services: ServiceRow[];
  groups: RenderedGroup[];
  supportRow: ServiceRow | null;
  capturedAt: string;
}

export interface VerifyOptions {
  session?: string;
  timeoutMs?: number;
  /** Text that must appear before extraction (usually the estimate name). */
  waitText?: string;
}

export class BrowserError extends Error {
  readonly command: string;
  readonly stderr: string;

  constructor(command: string, stderr: string) {
    super(`agent-browser failed: ${command}: ${stderr.trim().slice(0, 800)}`);
    this.name = "BrowserError";
    this.command = command;
    this.stderr = stderr;
  }
}

const DEFAULT_SESSION = "aws-cal-axi-e2e";

function sessionName(options: VerifyOptions): string {
  return options.session ?? process.env["AGENT_BROWSER_SESSION"] ?? DEFAULT_SESSION;
}

function runBrowser(
  args: string[],
  options: VerifyOptions,
  input?: string
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("agent-browser", ["--session", sessionName(options), ...args], {
    encoding: "utf8",
    input,
    timeout: options.timeoutMs ?? 120_000,
    env: { ...process.env, AGENT_BROWSER_SESSION: sessionName(options) },
  });
  if (result.error) throw new BrowserError(`agent-browser ${args.join(" ")}`, String(result.error));
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

const EXTRACTION = String.raw`
(() => {
  const text = (el) => (el ? (el.textContent || "").trim() : null);
  const money = (el) => {
    if (!el) return null;
    const match = /(-?[0-9][0-9,]*\.[0-9]{2})/.exec(el.textContent || "");
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  };
  const bannerEl = (() => {
    const candidates = Array.from(document.querySelectorAll("div,p,span")).filter((el) =>
      /was last updated on/.test(el.textContent || "")
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
    return candidates[0];
  })();
  const bodyText = document.body ? document.body.innerText : "";
  const updatedMatch = /last updated on ([A-Za-z]+ [0-9]{1,2}, [0-9]{4})/.exec(bodyText);
  const services = Array.from(document.querySelectorAll("table tbody tr")).map((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => (cell.textContent || "").trim());
    return {
      name: cells[1] ?? null,
      upfront: cells[2] ?? null,
      monthly: cells[3] ?? null,
      description: cells[4] ?? null,
      region: cells[5] ?? null,
      configSummary: cells[6] ?? null,
    };
  });
  const groups = Array.from(document.querySelectorAll("[data-root-group],[data-parent-group]")).map((el) => ({
    name: (el.textContent || "").trim(),
    root: el.hasAttribute("data-root-group"),
    parent: el.hasAttribute("data-parent-group"),
  }));
  const supportRow = services.find((row) => /Support/i.test(row.name || "")) || null;
  return JSON.stringify({
    title: text(document.querySelector("#current-group-label h1")) || text(document.querySelector("h1")),
    monthly: text(document.querySelector("[data-monthly-cost]")),
    upfront: text(document.querySelector("[data-upfront-cost]")),
    annual: text(document.querySelector("[data-annual-cost]")),
    monthlyValue: money(document.querySelector("[data-monthly-cost]")),
    upfrontValue: money(document.querySelector("[data-upfront-cost]")),
    annualValue: money(document.querySelector("[data-annual-cost]")),
    estimateDate: text(document.querySelector("#estimate-date")),
    banner: updatedMatch ? updatedMatch[0] : text(bannerEl),
    readOnlyNotice: /This is a read only document/.test(bodyText),
    services,
    groups,
    supportRow,
    capturedAt: new Date().toISOString(),
  });
})()
`;

/** Open a public estimate URL, wait for it to render, and read the visible DOM. */
export function readRenderedEstimate(url: string, options: VerifyOptions = {}): RenderedEstimate {
  const open = runBrowser(["open", url], options);
  if (open.status !== 0) throw new BrowserError(`open ${url}`, open.stderr || open.stdout);

  if (options.waitText) {
    runBrowser(["wait", "--text", options.waitText], options);
  }
  const wait = runBrowser(["wait", "[data-monthly-cost]"], options);
  if (wait.status !== 0) {
    throw new BrowserError(`wait [data-monthly-cost] ${url}`, wait.stderr || wait.stdout);
  }

  const evaluated = runBrowser(["eval", "--json", "--stdin"], options, EXTRACTION);
  if (evaluated.status !== 0) {
    throw new BrowserError(`eval on ${url}`, evaluated.stderr || evaluated.stdout);
  }

  const envelope = JSON.parse(evaluated.stdout) as {
    success?: boolean;
    data?: { result?: string };
    error?: string | null;
  };
  if (!envelope.success || !envelope.data?.result) {
    throw new BrowserError(`eval on ${url}`, envelope.error ?? evaluated.stdout);
  }
  const parsed = JSON.parse(envelope.data.result) as Omit<RenderedEstimate, "url">;
  return { url, ...parsed };
}

export interface RenderedExpectation {
  monthly?: number;
  upfront?: number;
  annual?: number;
  services?: Array<{
    name: string;
    monthly?: number;
    upfront?: number;
    region?: string;
    configSummary?: string;
  }>;
  support?: { nameContains?: string; monthly?: number };
  groups?: string[];
  title?: string;
}

export interface Mismatch {
  field: string;
  expected: string;
  actual: string;
}

function moneyText(value: number): string {
  return value.toFixed(2);
}

function compareMoney(field: string, expected: number, actual: number | null): Mismatch[] {
  if (actual === null) return [{ field, expected: moneyText(expected), actual: "missing" }];
  if (Math.abs(actual - expected) > 0.005) {
    return [{ field, expected: moneyText(expected), actual: moneyText(actual) }];
  }
  return [];
}

/** Diff a rendered estimate against expectations. An empty list means PASS. */
export function diffRendered(
  rendered: RenderedEstimate,
  expectation: RenderedExpectation
): Mismatch[] {
  const mismatches: Mismatch[] = [];

  if (expectation.title !== undefined) {
    if ((rendered.title ?? "").trim() !== expectation.title.trim()) {
      mismatches.push({ field: "title", expected: expectation.title, actual: rendered.title ?? "missing" });
    }
  }
  if (expectation.monthly !== undefined) {
    mismatches.push(...compareMoney("monthly", expectation.monthly, rendered.monthlyValue));
  }
  if (expectation.upfront !== undefined) {
    mismatches.push(...compareMoney("upfront", expectation.upfront, rendered.upfrontValue));
  }
  if (expectation.annual !== undefined) {
    mismatches.push(...compareMoney("annual", expectation.annual, rendered.annualValue));
  }

  for (const expected of expectation.services ?? []) {
    const row = rendered.services.find((candidate) => (candidate.name ?? "").trim() === expected.name);
    if (!row) {
      mismatches.push({ field: `service:${expected.name}`, expected: "present", actual: "missing" });
      continue;
    }
    if (expected.monthly !== undefined) {
      mismatches.push(
        ...compareMoney(`service:${expected.name}:monthly`, expected.monthly, moneyValue(row.monthly))
      );
    }
    if (expected.upfront !== undefined) {
      mismatches.push(
        ...compareMoney(`service:${expected.name}:upfront`, expected.upfront, moneyValue(row.upfront))
      );
    }
    if (expected.region !== undefined && (row.region ?? "").trim() !== expected.region) {
      mismatches.push({
        field: `service:${expected.name}:region`,
        expected: expected.region,
        actual: row.region ?? "missing",
      });
    }
    if (expected.configSummary !== undefined) {
      const actual = (row.configSummary ?? "").replace(/\s+/g, " ").trim();
      const wanted = expected.configSummary.replace(/\s+/g, " ").trim();
      if (actual !== wanted) {
        mismatches.push({ field: `service:${expected.name}:configSummary`, expected: wanted, actual });
      }
    }
  }

  if (expectation.support) {
    const row = rendered.supportRow;
    if (!row) {
      mismatches.push({ field: "support", expected: "present", actual: "missing" });
    } else {
      if (
        expectation.support.nameContains &&
        !(row.name ?? "").toLowerCase().includes(expectation.support.nameContains.toLowerCase())
      ) {
        mismatches.push({
          field: "support:name",
          expected: expectation.support.nameContains,
          actual: row.name ?? "missing",
        });
      }
      if (expectation.support.monthly !== undefined) {
        mismatches.push(
          ...compareMoney("support:monthly", expectation.support.monthly, moneyValue(row.monthly))
        );
      }
    }
  }

  if (expectation.groups) {
    const names = rendered.groups.map((group) => group.name);
    for (const expected of expectation.groups) {
      if (!names.some((name) => name.includes(expected))) {
        mismatches.push({ field: `group:${expected}`, expected: "present", actual: names.join(" | ") });
      }
    }
  }

  return mismatches;
}

function moneyValue(text: string | null): number | null {
  if (!text) return null;
  const match = /(-?[0-9][0-9,]*\.[0-9]{2})/.exec(text);
  const digits = match?.[1];
  if (!digits) return null;
  const value = Number(digits.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** Close the named browser session. Safe to call when nothing is running. */
export function closeBrowser(options: VerifyOptions = {}): void {
  runBrowser(["close"], options);
}
