import type { DiffFile, DiffHunk, ParsedDiff } from "./types.js";

/** Normalize separators so path rules are Windows + Linux safe. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function stripPrefix(pathWithPrefix: string): string {
  // git diff paths look like a/foo or b/foo; also tolerate bare paths
  const stripped = pathWithPrefix.replace(/^[ab]\//, "");
  return normalizePath(stripped);
}

function emptyHunk(header = ""): DiffHunk {
  return {
    header,
    addedLines: [],
    removedLines: [],
    addedCount: 0,
    removedCount: 0,
  };
}

/**
 * Parse a unified / git file-mode diff into structured file entries.
 * Accepts `git diff`, `git show`, and `diff -u` style text.
 */
export function parseUnifiedDiff(text: string): ParsedDiff {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;

  const flushHunk = () => {
    if (current && hunk) {
      current.hunks.push(hunk);
      current.addedLines += hunk.addedCount;
      current.removedLines += hunk.removedCount;
    }
    hunk = null;
  };

  const flushFile = () => {
    flushHunk();
    if (current) {
      files.push(current);
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    if (line.startsWith("diff --git ")) {
      flushFile();
      // diff --git a/path b/path  (paths may contain spaces when quoted — keep simple)
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      const oldPath = match ? stripPrefix(`a/${match[1]}`) : "unknown";
      const newPath = match ? stripPrefix(`b/${match[2]}`) : oldPath;
      current = {
        path: newPath,
        oldPath: oldPath !== newPath ? oldPath : undefined,
        status: "modified",
        isBinary: false,
        hunks: [],
        addedLines: 0,
        removedLines: 0,
      };
      continue;
    }

    if (!current) {
      // Support diffs that start with --- / +++ without diff --git
      if (line.startsWith("--- ")) {
        flushFile();
        const oldRaw = line.slice(4).trim();
        const oldPath =
          oldRaw === "/dev/null" ? undefined : stripPrefix(oldRaw);
        const next = lines[i + 1] ?? "";
        let newPath = oldPath ?? "unknown";
        if (next.startsWith("+++ ")) {
          const newRaw = next.slice(4).trim();
          newPath =
            newRaw === "/dev/null"
              ? oldPath ?? "unknown"
              : stripPrefix(newRaw);
          i += 1;
        }
        current = {
          path: newPath === "unknown" && oldPath ? oldPath : newPath,
          oldPath,
          status: "modified",
          isBinary: false,
          hunks: [],
          addedLines: 0,
          removedLines: 0,
        };
        if (oldPath === undefined) current.status = "added";
        if (newPath === "unknown" || (lines[i] ?? "").includes("/dev/null")) {
          // handled below via +++ /dev/null when present
        }
      }
      continue;
    }

    if (line.startsWith("new file mode")) {
      current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = normalizePath(line.slice("rename from ".length));
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = normalizePath(line.slice("rename to ".length));
      continue;
    }
    if (line.startsWith("Binary files ") || line.includes("GIT binary patch")) {
      current.isBinary = true;
      continue;
    }

    if (line.startsWith("--- ")) {
      const oldRaw = line.slice(4).trim();
      if (oldRaw === "/dev/null") {
        current.status = current.status === "renamed" ? "renamed" : "added";
        current.oldPath = undefined;
      } else {
        current.oldPath = stripPrefix(oldRaw);
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const newRaw = line.slice(4).trim();
      if (newRaw === "/dev/null") {
        current.status = "deleted";
      } else {
        current.path = stripPrefix(newRaw);
      }
      continue;
    }

    if (line.startsWith("@@")) {
      flushHunk();
      hunk = emptyHunk(line);
      continue;
    }

    if (!hunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      hunk.addedLines.push(line.slice(1));
      hunk.addedCount += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      hunk.removedLines.push(line.slice(1));
      hunk.removedCount += 1;
      continue;
    }
    // context line or "\ No newline at end of file"
  }

  flushFile();

  let totalAdded = 0;
  let totalRemoved = 0;
  for (const f of files) {
    totalAdded += f.addedLines;
    totalRemoved += f.removedLines;
  }

  return { files, totalAdded, totalRemoved };
}
