#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessDiff,
  renderMarkdownCard,
  renderOneLineSummary,
  riskAtLeast,
} from "./index.js";
import type { RiskLevel, RiskThresholds } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

export interface CliOptions {
  diffPath?: string;
  output?: string;
  failOn: "none" | RiskLevel;
  largeFileLines: number;
  largePrLines: number;
  quiet: boolean;
  help: boolean;
  version: boolean;
  githubOutput: boolean;
  stdin: boolean;
}

const FAIL_ON_VALUES = new Set(["none", "low", "medium", "high", "critical"]);

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    failOn: "none",
    largeFileLines: DEFAULT_THRESHOLDS.largeFileLines,
    largePrLines: DEFAULT_THRESHOLDS.largePrLines,
    quiet: false,
    help: false,
    version: false,
    githubOutput: false,
    stdin: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--version" || arg === "-V") {
      options.version = true;
      continue;
    }
    if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
      continue;
    }
    if (arg === "--stdin") {
      options.stdin = true;
      continue;
    }
    if (arg === "--github-output") {
      options.githubOutput = true;
      continue;
    }
    if (arg === "--diff" || arg === "-d") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a file path`);
      options.diffPath = path.resolve(value);
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a file path`);
      options.output = value;
      continue;
    }
    if (arg === "--fail-on") {
      const value = argv[++i];
      if (!value || !FAIL_ON_VALUES.has(value)) {
        throw new Error(
          `--fail-on requires one of: none|low|medium|high|critical`,
        );
      }
      options.failOn = value as CliOptions["failOn"];
      continue;
    }
    if (arg === "--large-file-lines") {
      const value = argv[++i];
      const n = Number(value);
      if (!value || !Number.isFinite(n) || n < 1) {
        throw new Error(`--large-file-lines requires a positive number`);
      }
      options.largeFileLines = n;
      continue;
    }
    if (arg === "--large-pr-lines") {
      const value = argv[++i];
      const n = Number(value);
      if (!value || !Number.isFinite(n) || n < 1) {
        throw new Error(`--large-pr-lines requires a positive number`);
      }
      options.largePrLines = n;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    options.diffPath = path.resolve(arg);
  }

  return options;
}

export function helpText(): string {
  return `pr-risk-card — deterministic PR risk card from a unified diff (no LLM)

Usage:
  pr-risk-card --diff <file.patch> [options]
  pr-risk-card --stdin [options]
  git diff origin/main...HEAD | pr-risk-card --stdin -o card.md

Reads a file-mode unified diff and emits a markdown risk card based on:
  • path rules (workflows, .env, secrets/, keys, Dockerfiles, lockfiles)
  • size thresholds (per-file and whole-PR added lines)
  • secret-like regex on added lines (AKIA, PEM, gh*_ tokens, etc.)

Options:
  -d, --diff <file>           Path to unified diff (file-mode input)
      --stdin                 Read diff from stdin
  -o, --output <file>         Write markdown card to file (also printed unless --quiet)
      --fail-on <level>       Exit 1 when risk >= level (none|low|medium|high|critical)
      --large-file-lines <n>  Per-file added-line threshold (default: ${DEFAULT_THRESHOLDS.largeFileLines})
      --large-pr-lines <n>    Total added-line threshold (default: ${DEFAULT_THRESHOLDS.largePrLines})
      --github-output         Append risk-level / card-path / finding-count to GITHUB_OUTPUT
  -q, --quiet                 Print only the one-line summary
  -h, --help                  Show help
  -V, --version               Show version

Exit codes:
  0  ok (or risk below --fail-on)
  1  risk at or above --fail-on
  2  usage / runtime error
`;
}

function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(here, "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function readDiff(options: CliOptions): string {
  if (options.stdin) {
    return fs.readFileSync(0, "utf8");
  }
  if (!options.diffPath) {
    throw new Error("Provide --diff <file> or --stdin");
  }
  if (!fs.existsSync(options.diffPath)) {
    throw new Error(`Diff file not found: ${options.diffPath}`);
  }
  return fs.readFileSync(options.diffPath, "utf8");
}

function appendGithubOutput(fields: Record<string, string>): void {
  const dest = process.env.GITHUB_OUTPUT;
  if (!dest) return;
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.appendFileSync(dest, `${body}\n`, "utf8");
}

export function runCli(
  argv: string[],
  io = {
    log: console.log.bind(console),
    error: console.error.bind(console),
  },
): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  if (options.help) {
    io.log(helpText());
    return 0;
  }
  if (options.version) {
    io.log(readVersion());
    return 0;
  }

  let diffText: string;
  try {
    diffText = readDiff(options);
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const thresholds: RiskThresholds = {
    largeFileLines: options.largeFileLines,
    largePrLines: options.largePrLines,
  };

  // Fixed timestamp only when PR_RISK_CARD_FIXED_TIME is set (tests); else real ISO.
  const fixed = process.env.PR_RISK_CARD_FIXED_TIME;
  const card = assessDiff(
    diffText,
    thresholds,
    fixed && fixed.length > 0 ? fixed : undefined,
  );
  const markdown = renderMarkdownCard(card);
  const summary = renderOneLineSummary(card);

  let cardPath = "";
  if (options.output) {
    cardPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(cardPath), { recursive: true });
    fs.writeFileSync(cardPath, markdown, "utf8");
  }

  if (options.quiet) {
    io.log(summary);
  } else {
    io.log(markdown);
    if (!options.output) {
      // still show summary line after card when printing to stdout only
    } else {
      io.log(summary);
    }
  }

  if (options.githubOutput) {
    appendGithubOutput({
      "risk-level": card.riskLevel,
      "card-path": cardPath || "",
      "finding-count": String(card.summary.findingCount),
    });
  }

  if (options.failOn !== "none" && riskAtLeast(card.riskLevel, options.failOn)) {
    return 1;
  }
  return 0;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const code = runCli(process.argv.slice(2));
  process.exit(code);
}
