/** Severity of a single finding. */
export type Severity = "info" | "medium" | "high" | "critical";

/** Overall PR risk band derived from findings. */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Rule identifiers emitted by the analyzer. */
export type RuleId =
  | "path-sensitive"
  | "path-lockfile"
  | "size-large-file"
  | "size-large-pr"
  | "secret-like";

export interface DiffHunk {
  header: string;
  addedLines: string[];
  removedLines: string[];
  addedCount: number;
  removedCount: number;
}

export interface DiffFile {
  /** Path after change (b/ side), forward slashes. */
  path: string;
  /** Path before change when renamed/deleted. */
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  isBinary: boolean;
  hunks: DiffHunk[];
  addedLines: number;
  removedLines: number;
}

export interface ParsedDiff {
  files: DiffFile[];
  totalAdded: number;
  totalRemoved: number;
}

export interface Finding {
  id: RuleId;
  severity: Severity;
  path?: string;
  lineHint?: string;
  message: string;
  evidence?: string;
}

export interface RiskThresholds {
  largeFileLines: number;
  largePrLines: number;
}

export interface RiskCard {
  generatedAt: string;
  riskLevel: RiskLevel;
  score: number;
  summary: {
    filesChanged: number;
    totalAdded: number;
    totalRemoved: number;
    findingCount: number;
  };
  findings: Finding[];
  files: Array<{
    path: string;
    status: DiffFile["status"];
    added: number;
    removed: number;
    isBinary: boolean;
  }>;
}

export const DEFAULT_THRESHOLDS: RiskThresholds = {
  largeFileLines: 200,
  largePrLines: 500,
};
