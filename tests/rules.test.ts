import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/parse-diff.js";
import {
  analyzeDiff,
  pathMatches,
  SECRET_PATTERNS,
} from "../src/rules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("path rules, size, secret-like regex", () => {
  it("matches sensitive and lockfile path globs", () => {
    expect(pathMatches(".github/workflows/ci.yml", ".github/workflows/**")).toBe(
      true,
    );
    expect(pathMatches("apps/api/.env", "**/.env")).toBe(true);
    expect(pathMatches("apps/api/.env.local", "**/.env.*")).toBe(true);
    expect(pathMatches("package-lock.json", "**/package-lock.json")).toBe(true);
    expect(pathMatches("src/index.ts", ".github/workflows/**")).toBe(false);
  });

  it("flags AWS / GitHub / api_key secret-like added lines", () => {
    const aws = SECRET_PATTERNS.find((p) => p.name === "aws-access-key-id");
    const gh = SECRET_PATTERNS.find((p) => p.name === "github-token");
    const api = SECRET_PATTERNS.find(
      (p) => p.name === "generic-api-key-assignment",
    );
    expect(aws?.regex.test("AWS_ACCESS_KEY_ID: AKIAIOSFODNN7EXAMPLE")).toBe(
      true,
    );
    expect(
      gh?.regex.test("GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789"),
    ).toBe(true);
    expect(
      api?.regex.test('API_KEY="sk_test_fixture_not_real_12345"'),
    ).toBe(true);
    expect(aws?.regex.test("const x = 1")).toBe(false);
  });

  it("emits path-sensitive, secret-like, and size findings on the risky fixture", () => {
    const text = fs.readFileSync(path.join(root, "fixtures/risky.diff"), "utf8");
    const parsed = parseUnifiedDiff(text);
    // Fixture is ~235 added lines: large-file (220) fires at default 200;
    // large-pr needs a lower threshold to assert in this fixture.
    const findings = analyzeDiff(parsed, {
      largeFileLines: 200,
      largePrLines: 200,
    });

    const ids = new Set(findings.map((f) => f.id));
    expect(ids.has("path-sensitive")).toBe(true);
    expect(ids.has("secret-like")).toBe(true);
    expect(ids.has("size-large-file")).toBe(true);
    expect(ids.has("size-large-pr")).toBe(true);

    expect(
      findings.some(
        (f) => f.id === "path-sensitive" && f.path === ".github/workflows/deploy.yml",
      ),
    ).toBe(true);
    expect(
      findings.some((f) => f.id === "path-sensitive" && f.path === ".env"),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.id === "secret-like" && f.evidence === "aws-access-key-id",
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.id === "size-large-file" && f.path === "src/bulk_generated.ts",
      ),
    ).toBe(true);
  });

  it("does not invent secret findings on the safe fixture", () => {
    const text = fs.readFileSync(path.join(root, "fixtures/safe.diff"), "utf8");
    const findings = analyzeDiff(parseUnifiedDiff(text));
    expect(findings.filter((f) => f.id === "secret-like")).toHaveLength(0);
    expect(findings.filter((f) => f.id === "path-sensitive")).toHaveLength(0);
  });
});
