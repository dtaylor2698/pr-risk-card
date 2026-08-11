import { normalizePath } from "./parse-diff.js";
import type {
  DiffFile,
  Finding,
  ParsedDiff,
  RiskThresholds,
  Severity,
} from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

export interface PathRule {
  id: "path-sensitive" | "path-lockfile";
  severity: Severity;
  /** Glob-ish matcher: * = one segment, ** = any depth, suffix/prefix literals. */
  pattern: string;
  message: string;
}

/** Sensitive path patterns (forward-slash normalized). */
export const SENSITIVE_PATH_RULES: PathRule[] = [
  {
    id: "path-sensitive",
    severity: "high",
    pattern: ".github/workflows/**",
    message: "Changes GitHub Actions workflow (CI privilege surface)",
  },
  {
    id: "path-sensitive",
    severity: "high",
    pattern: ".github/actions/**",
    message: "Changes a composite/JS action definition",
  },
  {
    id: "path-sensitive",
    severity: "critical",
    pattern: "**/.env",
    message: "Touches a .env file (credential leak risk)",
  },
  {
    id: "path-sensitive",
    severity: "critical",
    pattern: "**/.env.*",
    message: "Touches an env file (credential leak risk)",
  },
  {
    id: "path-sensitive",
    severity: "critical",
    pattern: "**/secrets/**",
    message: "Touches a secrets/ directory",
  },
  {
    id: "path-sensitive",
    severity: "critical",
    pattern: "**/id_rsa*",
    message: "Touches an SSH private key path",
  },
  {
    id: "path-sensitive",
    severity: "high",
    pattern: "**/credentials*",
    message: "Touches a credentials-named path",
  },
  {
    id: "path-sensitive",
    severity: "high",
    pattern: "**/kubeconfig*",
    message: "Touches a kubeconfig path",
  },
  {
    id: "path-sensitive",
    severity: "medium",
    pattern: "**/Dockerfile*",
    message: "Touches a Dockerfile (supply-chain / build surface)",
  },
  {
    id: "path-lockfile",
    severity: "info",
    pattern: "**/package-lock.json",
    message: "Lockfile change — verify intentional dependency updates",
  },
  {
    id: "path-lockfile",
    severity: "info",
    pattern: "**/yarn.lock",
    message: "Lockfile change — verify intentional dependency updates",
  },
  {
    id: "path-lockfile",
    severity: "info",
    pattern: "**/pnpm-lock.yaml",
    message: "Lockfile change — verify intentional dependency updates",
  },
];

export interface SecretPattern {
  name: string;
  severity: Severity;
  /** Applied to added lines only. */
  regex: RegExp;
}

/**
 * Secret-like heuristics for added lines. Deterministic regex only — not a
 * full secrets engine (see v0.2 limitations).
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "aws-access-key-id",
    severity: "critical",
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: "pem-private-key",
    severity: "critical",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "github-token",
    severity: "critical",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  },
  {
    name: "slack-token",
    severity: "high",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    name: "generic-api-key-assignment",
    severity: "high",
    regex:
      /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[=:]\s*['"][^'"]{12,}['"]/i,
  },
  {
    name: "jwt-like",
    severity: "medium",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
];

/** Convert a simple glob (** / * / literal) to a RegExp anchored on full path. */
export function globToRegExp(pattern: string): RegExp {
  const norm = normalizePath(pattern);
  let re = "^";
  let i = 0;
  while (i < norm.length) {
    const ch = norm[i]!;
    if (ch === "*" && norm[i + 1] === "*") {
      if (norm[i + 2] === "/") {
        // **/ → optional multi-segment prefix (matches root or nested)
        re += "(?:.*/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
      continue;
    }
    if (ch === "*") {
      re += "[^/]*";
      i += 1;
      continue;
    }
    if ("\\.()+?[]{}$^|".includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
    i += 1;
  }
  re += "$";
  return new RegExp(re, "i");
}

export function pathMatches(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(normalizePath(path));
}

function findPathFindings(file: DiffFile, rules: PathRule[]): Finding[] {
  const findings: Finding[] = [];
  const paths = [file.path, file.oldPath].filter(Boolean) as string[];
  for (const p of paths) {
    for (const rule of rules) {
      if (pathMatches(p, rule.pattern)) {
        findings.push({
          id: rule.id,
          severity: rule.severity,
          path: normalizePath(p),
          message: rule.message,
          evidence: `matched ${rule.pattern}`,
        });
      }
    }
  }
  return findings;
}

function findSecretFindings(file: DiffFile): Finding[] {
  if (file.isBinary || file.status === "deleted") {
    return [];
  }
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const hunk of file.hunks) {
    for (const line of hunk.addedLines) {
      for (const pat of SECRET_PATTERNS) {
        if (!pat.regex.test(line)) continue;
        const key = `${file.path}|${pat.name}|${line.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const redacted =
          line.length > 96 ? `${line.slice(0, 93)}...` : line;
        findings.push({
          id: "secret-like",
          severity: pat.severity,
          path: file.path,
          lineHint: redacted.trim(),
          message: `Added line looks like a secret (${pat.name})`,
          evidence: pat.name,
        });
      }
    }
  }
  return findings;
}

function findSizeFindings(
  parsed: ParsedDiff,
  thresholds: RiskThresholds,
): Finding[] {
  const findings: Finding[] = [];
  for (const file of parsed.files) {
    if (file.isBinary) continue;
    if (file.addedLines >= thresholds.largeFileLines) {
      findings.push({
        id: "size-large-file",
        severity: "medium",
        path: file.path,
        message: `File adds ${file.addedLines} lines (≥ ${thresholds.largeFileLines})`,
        evidence: `added=${file.addedLines}`,
      });
    }
  }
  if (parsed.totalAdded >= thresholds.largePrLines) {
    findings.push({
      id: "size-large-pr",
      severity: "medium",
      message: `PR adds ${parsed.totalAdded} lines total (≥ ${thresholds.largePrLines})`,
      evidence: `totalAdded=${parsed.totalAdded}`,
    });
  }
  return findings;
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = [f.id, f.severity, f.path ?? "", f.message, f.evidence ?? ""].join(
      "|",
    );
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export function analyzeDiff(
  parsed: ParsedDiff,
  thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
  pathRules: PathRule[] = SENSITIVE_PATH_RULES,
): Finding[] {
  const findings: Finding[] = [];
  for (const file of parsed.files) {
    findings.push(...findPathFindings(file, pathRules));
    findings.push(...findSecretFindings(file));
  }
  findings.push(...findSizeFindings(parsed, thresholds));
  return dedupeFindings(findings);
}
