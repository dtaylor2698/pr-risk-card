import type { Finding, RiskCard, RiskLevel, Severity, ParsedDiff } from "./types.js";

const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 1,
  medium: 5,
  high: 15,
  critical: 40,
};

const ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

export function scoreFindings(findings: Finding[]): {
  score: number;
  riskLevel: RiskLevel;
} {
  let score = 0;
  let maxSeverity: Severity = "info";
  for (const f of findings) {
    score += SEVERITY_WEIGHT[f.severity];
    if (SEVERITY_WEIGHT[f.severity] > SEVERITY_WEIGHT[maxSeverity]) {
      maxSeverity = f.severity;
    }
  }

  let riskLevel: RiskLevel = "low";
  if (score === 0) {
    riskLevel = "low";
  } else if (maxSeverity === "critical" || score >= 40) {
    riskLevel = "critical";
  } else if (maxSeverity === "high" || score >= 15) {
    riskLevel = "high";
  } else if (maxSeverity === "medium" || score >= 5) {
    riskLevel = "medium";
  } else {
    riskLevel = "low";
  }

  return { score, riskLevel };
}

export function riskAtLeast(actual: RiskLevel, threshold: RiskLevel): boolean {
  return ORDER.indexOf(actual) >= ORDER.indexOf(threshold);
}

export function buildRiskCard(
  parsed: ParsedDiff,
  findings: Finding[],
  generatedAt: string = new Date().toISOString(),
): RiskCard {
  const { score, riskLevel } = scoreFindings(findings);
  return {
    generatedAt,
    riskLevel,
    score,
    summary: {
      filesChanged: parsed.files.length,
      totalAdded: parsed.totalAdded,
      totalRemoved: parsed.totalRemoved,
      findingCount: findings.length,
    },
    findings,
    files: parsed.files.map((f) => ({
      path: f.path,
      status: f.status,
      added: f.addedLines,
      removed: f.removedLines,
      isBinary: f.isBinary,
    })),
  };
}
