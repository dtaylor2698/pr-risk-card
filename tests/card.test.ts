import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import {
  assessDiff,
  renderMarkdownCard,
  riskAtLeast,
} from "../src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("markdown card + CLI", () => {
  it("builds a high/critical card for the risky fixture with required sections", () => {
    const text = fs.readFileSync(path.join(root, "fixtures/risky.diff"), "utf8");
    const card = assessDiff(text, undefined, "2026-01-01T00:00:00.000Z");
    expect(["high", "critical"]).toContain(card.riskLevel);
    expect(card.summary.findingCount).toBeGreaterThan(0);

    const md = renderMarkdownCard(card);
    expect(md).toContain("# PR Risk Card");
    expect(md).toMatch(/\*\*overall risk:\*\* \*\*(high|critical)\*\*/);
    expect(md).toContain("## Findings");
    expect(md).toContain("## Changed files");
    expect(md).toContain("`secret-like`");
    expect(md).toContain(".github/workflows/deploy.yml");
  });

  it("builds a low-risk card for the safe fixture", () => {
    const text = fs.readFileSync(path.join(root, "fixtures/safe.diff"), "utf8");
    const card = assessDiff(text, undefined, "2026-01-01T00:00:00.000Z");
    expect(card.riskLevel).toBe("low");
    expect(card.summary.filesChanged).toBe(1);
    const md = renderMarkdownCard(card);
    expect(md).toContain("**overall risk:** **low**");
  });

  it("CLI --help works and --diff writes a card; --fail-on critical exits 1 on risky", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const io = {
      log: (m: string) => logs.push(m),
      error: (m: string) => errors.push(m),
    };

    expect(runCli(["--help"], io)).toBe(0);
    expect(logs.join("\n")).toContain("pr-risk-card");
    expect(logs.join("\n")).toContain("--diff");

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-risk-card-"));
    const outFile = path.join(outDir, "card.md");
    logs.length = 0;
    const code = runCli(
      [
        "--diff",
        path.join(root, "fixtures/risky.diff"),
        "--output",
        outFile,
        "--fail-on",
        "critical",
        "--quiet",
      ],
      io,
    );
    expect(fs.existsSync(outFile)).toBe(true);
    const written = fs.readFileSync(outFile, "utf8");
    expect(written).toContain("# PR Risk Card");
    expect(code).toBe(1);
    expect(riskAtLeast("critical", "high")).toBe(true);
    expect(riskAtLeast("medium", "high")).toBe(false);
  });
});
