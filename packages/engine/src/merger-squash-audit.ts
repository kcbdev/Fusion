import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LOOKBACK = 30;
const GIT_OUTPUT_MAX_BUFFER = 10 * 1024 * 1024;

export interface SquashAuditRecentMainCommit {
  sha: string;
  subject: string;
}

export interface SquashAuditDuplicateSubjectFinding {
  type: "duplicate-subject";
  subject: string;
}

export interface SquashAuditTouchedFileOverlapFinding {
  type: "touched-file-overlap";
  file: string;
  recentMainCommits: SquashAuditRecentMainCommit[];
}

export type SquashAuditFinding = SquashAuditDuplicateSubjectFinding | SquashAuditTouchedFileOverlapFinding;

export interface SquashAuditFindings {
  squashSha: string;
  parentSha: string;
  squashSubject: string;
  lookback: number;
  branchSubjects: string[];
  recentMainSubjects: string[];
  duplicateSubjects: SquashAuditDuplicateSubjectFinding[];
  touchedFiles: string[];
  touchedFileOverlaps: SquashAuditTouchedFileOverlapFinding[];
  findings: SquashAuditFinding[];
  issueCount: number;
  clean: boolean;
}

export async function auditSquashMerge({
  rootDir,
  squashSha,
  lookback = DEFAULT_LOOKBACK,
}: {
  rootDir: string;
  squashSha: string;
  lookback?: number;
}): Promise<SquashAuditFindings> {
  const normalizedLookback = normalizeLookback(lookback);
  const parentSha = await git(rootDir, ["rev-parse", `${squashSha}^`]);
  const squashSubject = await git(rootDir, ["log", "-1", "--format=%s", squashSha]);
  const branchSubjects = normalizeLines(await git(rootDir, ["log", "-1", "--format=%b", squashSha]))
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean);

  const recentMainCommits = await listRecentMainCommits(rootDir, parentSha, normalizedLookback);
  const recentMainSubjects = recentMainCommits.map((entry) => entry.subject);

  const duplicateSubjects = branchSubjects
    .filter((subject) => recentMainSubjects.includes(subject))
    .map((subject) => ({ type: "duplicate-subject", subject }) satisfies SquashAuditDuplicateSubjectFinding);

  const touchedFiles = normalizeLines(await git(rootDir, ["diff", "--name-only", parentSha, squashSha]));
  const touchedFileOverlaps: SquashAuditTouchedFileOverlapFinding[] = [];

  for (const file of touchedFiles) {
    const overlappingCommits: SquashAuditRecentMainCommit[] = [];
    for (const commit of recentMainCommits) {
      const touchedInCommit = await git(rootDir, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit.sha, "--", file]);
      if (normalizeLines(touchedInCommit).includes(file)) {
        overlappingCommits.push({ sha: commit.shortSha, subject: commit.subject });
      }
    }

    if (overlappingCommits.length > 0) {
      touchedFileOverlaps.push({
        type: "touched-file-overlap",
        file,
        recentMainCommits: overlappingCommits,
      });
    }
  }

  const findings: SquashAuditFinding[] = [...duplicateSubjects, ...touchedFileOverlaps];

  return {
    squashSha,
    parentSha,
    squashSubject,
    lookback: normalizedLookback,
    branchSubjects,
    recentMainSubjects,
    duplicateSubjects,
    touchedFiles,
    touchedFileOverlaps,
    findings,
    issueCount: findings.length,
    clean: findings.length === 0,
  };
}

export function formatSquashAuditReport(findings: SquashAuditFindings): string {
  const lines: string[] = [
    `Auditing squash: ${findings.squashSha} — ${findings.squashSubject}`,
    `Parent (main before squash): ${findings.parentSha}`,
    `Lookback window on main: ${findings.lookback} commits`,
    "",
    "=== Duplicate-cherry-pick risk ===",
  ];

  if (findings.duplicateSubjects.length === 0) {
    lines.push("(none — no branch commit subjects match recent main commits)", "");
  } else {
    lines.push(
      "WARN: branch contains commits whose subjects match recent main commits.",
      "Auto-resolve may have picked the older side, dropping refinements.",
      "Action: diff each main commit below against HEAD and confirm its",
      "net contribution survived. Restore anything dropped as a follow-up.",
      "",
      ...findings.duplicateSubjects.map((entry) => `  - ${entry.subject}`),
      "",
    );
  }

  lines.push(`=== Touched-file overlap (${findings.touchedFiles.length} files in squash) ===`);
  if (findings.touchedFileOverlaps.length === 0) {
    lines.push("(none — squash touches files no recent main commit touched)", "");
  } else {
    lines.push(
      "Files the squash touched that also have recent main activity.",
      "Action: for each commit below, verify its changes still appear",
      "in HEAD. Reapply any silently dropped changes on the same branch.",
      "",
    );
    for (const overlap of findings.touchedFileOverlaps) {
      lines.push(`  ${overlap.file}`);
      for (const commit of overlap.recentMainCommits) {
        lines.push(`    - ${commit.sha}  ${commit.subject}`);
      }
    }
    lines.push("");
  }

  lines.push(`Audit complete. ${findings.issueCount} item(s) for the calling agent to review.`);
  return lines.join("\n");
}

async function git(rootDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: rootDir,
    encoding: "utf-8",
    maxBuffer: GIT_OUTPUT_MAX_BUFFER,
  });
  return stdout.trim();
}

function normalizeLines(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  return trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function listRecentMainCommits(rootDir: string, parentSha: string, lookback: number): Promise<Array<{ sha: string; shortSha: string; subject: string }>> {
  const entries = normalizeLines(await git(rootDir, ["log", `--format=%H~%h~%s`, `-n`, String(lookback), parentSha]));
  return entries
    .map((entry) => {
      const [sha, shortSha, ...subjectParts] = entry.split("~");
      const subject = subjectParts.join("~").trim();
      if (!sha?.trim() || !shortSha?.trim() || !subject) {
        return null;
      }
      return {
        sha: sha.trim(),
        shortSha: shortSha.trim(),
        subject,
      };
    })
    .filter((entry): entry is { sha: string; shortSha: string; subject: string } => entry !== null);
}

function normalizeLookback(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) {
    return DEFAULT_LOOKBACK;
  }
  return Math.trunc(value);
}
