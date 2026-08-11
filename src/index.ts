import { renderMarkdownCard, renderOneLineSummary } from "./card.js";
import { parseUnifiedDiff, normalizePath } from "./parse-diff.js";
import {
  analyzeDiff,
  globToRegExp,
  pathMatches,
  SENSITIVE_PATH_RULES,
  SECRET_PATTERNS,
} from "./rules.js";
import { buildRiskCard, riskAtLeast, scoreFindings } from "./score.js";
import type {
  DiffFile,
  Finding,
  ParsedDiff,
  RiskCard,
  RiskLevel,
  RiskThresholds,
  Severity,
} from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

/** Analyze a unified-diff string and return a risk card. */
export function assessDiff(
  diffText: string,
  thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
  generatedAt?: string,
): RiskCard {
  const parsed = parseUnifiedDiff(diffText);
  const findings = analyzeDiff(parsed, thresholds);
  return buildRiskCard(parsed, findings, generatedAt);
}

export {
  analyzeDiff,
  buildRiskCard,
  DEFAULT_THRESHOLDS,
  globToRegExp,
  normalizePath,
  parseUnifiedDiff,
  pathMatches,
  renderMarkdownCard,
  renderOneLineSummary,
  riskAtLeast,
  scoreFindings,
  SECRET_PATTERNS,
  SENSITIVE_PATH_RULES,
};

export type {
  DiffFile,
  Finding,
  ParsedDiff,
  RiskCard,
  RiskLevel,
  RiskThresholds,
  Severity,
};
