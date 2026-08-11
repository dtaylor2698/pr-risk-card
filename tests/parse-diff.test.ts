import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/parse-diff.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("parseUnifiedDiff (file-mode input)", () => {
  it("parses the risky fixture into named files with statuses and counts", () => {
    const text = fs.readFileSync(path.join(root, "fixtures/risky.diff"), "utf8");
    const parsed = parseUnifiedDiff(text);

    expect(parsed.files.map((f) => f.path).sort()).toEqual([
      ".env",
      ".github/workflows/deploy.yml",
      "src/bulk_generated.ts",
    ]);
    expect(parsed.files.every((f) => f.status === "added")).toBe(true);
    expect(parsed.totalAdded).toBeGreaterThan(200);

    const bulk = parsed.files.find((f) => f.path === "src/bulk_generated.ts");
    expect(bulk?.addedLines).toBe(220);
    expect(bulk?.hunks.length).toBe(1);
    expect(bulk?.hunks[0]?.addedLines[0]).toBe("export const ROW_001 = 1;");
  });

  it("parses a simple modified file and respects Windows path separators via normalize", () => {
    const text = [
      "diff --git a/docs/guide.md b/docs/guide.md",
      "index 111..222 100644",
      "--- a/docs/guide.md",
      "+++ b/docs/guide.md",
      "@@ -1,2 +1,3 @@",
      " hello",
      "+world",
      " end",
      "",
    ].join("\n");
    const parsed = parseUnifiedDiff(text);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]?.path).toBe("docs/guide.md");
    expect(parsed.files[0]?.status).toBe("modified");
    expect(parsed.totalAdded).toBe(1);
    expect(parsed.totalRemoved).toBe(0);
  });

  it("detects deleted files and binary markers", () => {
    const text = [
      "diff --git a/old.bin b/old.bin",
      "deleted file mode 100644",
      "index 111..000",
      "--- a/old.bin",
      "+++ /dev/null",
      "Binary files a/old.bin and /dev/null differ",
      "",
    ].join("\n");
    const parsed = parseUnifiedDiff(text);
    expect(parsed.files[0]?.status).toBe("deleted");
    expect(parsed.files[0]?.isBinary).toBe(true);
  });
});
