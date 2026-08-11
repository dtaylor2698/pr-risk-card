# pr-risk-card

Maintainers who need a **fast, deterministic PR risk summary** from a unified diff — path hotspots, large churn, and secret-like added lines — without waiting on an LLM review bot. Unlike **CodeRabbit / Copilot PR summary** (model-generated narrative) or **gitleaks** (dedicated secrets scanning with entropy and allowlists), this tool only emits a **markdown risk card** from fixed path/size/regex rules so CI stays offline and reproducible.

## 60-second quickstart

### bash

```bash
# from the repository root
npm install
npm test
npx tsx src/cli.ts --help
npx tsx src/cli.ts --diff fixtures/safe.diff
npx tsx src/cli.ts --diff fixtures/risky.diff -o /tmp/pr-risk-card.md --fail-on high ; echo "exit=$?"
```

### PowerShell

```powershell
# from the repository root
npm install
npm test
npx tsx src/cli.ts --help
npx tsx src/cli.ts --diff fixtures/safe.diff
npx tsx src/cli.ts --diff fixtures/risky.diff -o $env:TEMP\pr-risk-card.md --fail-on high; Write-Host "exit=$LASTEXITCODE"
```

`fixtures/safe.diff` → **low**. `fixtures/risky.diff` → **high/critical** (workflow + `.env` paths, fake `AKIA…` / `ghp_…` lines, 220-line file).

## What it checks (v0.1)

| Rule | Default severity | Meaning |
|------|------------------|---------|
| `path-sensitive` | medium–critical | Touches workflows, `.env*`, `secrets/`, keys, credentials, kubeconfig, Dockerfiles |
| `path-lockfile` | info | Lockfile churn (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) |
| `size-large-file` | medium | Single file adds ≥ `--large-file-lines` (default 200) |
| `size-large-pr` | medium | Diff adds ≥ `--large-pr-lines` (default 500) |
| `secret-like` | medium–critical | Added-line regex: AWS `AKIA…`, PEM headers, `gh*_` tokens, Slack `xox…`, `api_key=` / JWT-like |

Input is **file-mode**: pass a saved `git diff` / `diff -u` patch with `--diff`, or pipe with `--stdin`.

## CLI

```text
pr-risk-card --diff <file.patch> [options]
pr-risk-card --stdin [options]

  -d, --diff <file>           Unified diff path (file-mode)
      --stdin                 Read diff from stdin
  -o, --output <file>         Write markdown card
      --fail-on <level>       none|low|medium|high|critical
      --large-file-lines <n>  Per-file size threshold
      --large-pr-lines <n>    Whole-PR size threshold
      --github-output         Write Action outputs
  -q, --quiet
  -h, --help
  -V, --version
```

Exit codes: `0` ok, `1` risk ≥ `--fail-on`, `2` usage/runtime error.

## GitHub Action

```yaml
- uses: ./
  with:
    diff-file: ""                    # empty → git diff base-ref...HEAD
    base-ref: origin/main
    output: pr-risk-card.md
    fail-on: high
    large-file-lines: "200"
    large-pr-lines: "500"
```

Action inputs are documented in `action.yml`. Outputs: `risk-level`, `card-path`, `finding-count`.

## Fixtures

- `fixtures/safe.diff` — tiny README edit → low risk
- `fixtures/risky.diff` — workflow + `.env` + fake secrets + large generated file → high/critical

## Install / build

```bash
npm install
npm run build
node dist/cli.js --diff fixtures/risky.diff --help
```

## Honest v0.2 limitations

- No entropy / allowlist / commit-history scanning (not a gitleaks replacement).
- No language-aware AST review, ownership routing, or suggested reviewers.
- Path globs are simple `*` / `**` only; no ignore-file integration yet.
- Binary diffs are flagged as binary but not byte-scanned for secrets.
- Risk score weights are fixed heuristics; teams may want configurable policies.

## License

MIT
