import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const FUSION_TASK_ID_TRAILER_KEY = "Fusion-Task-Id";
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

export interface BranchConflictCommit {
  sha: string;
  subject: string;
}

export interface BranchCrossContaminationCommit extends BranchConflictCommit {
  foreignTaskId: string;
}

export interface BranchRecoveryCandidate {
  branchName: string;
  tipSha: string;
  worktreePath: string | null;
  strandedCommits: BranchConflictCommit[];
  isCanonical: boolean;
}

export interface BranchConflictDetails {
  branchName: string;
  conflictingWorktreePath: string;
  existingTipSha: string;
  strandedCommits: BranchConflictCommit[];
  startPoint: string;
  recommendedAction: string;
}

export class BranchConflictError extends Error implements BranchConflictDetails {
  readonly name = "BranchConflictError";
  readonly branchName: string;
  readonly conflictingWorktreePath: string;
  readonly existingTipSha: string;
  readonly strandedCommits: BranchConflictCommit[];
  readonly startPoint: string;
  readonly recommendedAction: string;

  constructor(details: BranchConflictDetails) {
    const commitSummary = details.strandedCommits.length > 0
      ? `${details.strandedCommits.length} stranded commit${details.strandedCommits.length === 1 ? "" : "s"}`
      : "no stranded commits";
    super(
      `Branch ${details.branchName} is already checked out at ${details.conflictingWorktreePath} ` +
      `(tip ${details.existingTipSha.slice(0, 12)}, ${commitSummary} since ${details.startPoint}). ` +
      details.recommendedAction,
    );
    this.branchName = details.branchName;
    this.conflictingWorktreePath = details.conflictingWorktreePath;
    this.existingTipSha = details.existingTipSha;
    this.strandedCommits = details.strandedCommits;
    this.startPoint = details.startPoint;
    this.recommendedAction = details.recommendedAction;
  }
}

export function isBranchConflictError(error: unknown): error is BranchConflictError {
  return error instanceof BranchConflictError;
}

export interface BranchCrossContaminationDetails {
  branchName: string;
  baseSha: string;
  taskId: string;
  foreignCommits: BranchCrossContaminationCommit[];
}

export class BranchCrossContaminationError extends Error implements BranchCrossContaminationDetails {
  readonly name = "BranchCrossContaminationError";
  readonly branchName: string;
  readonly baseSha: string;
  readonly taskId: string;
  readonly foreignCommits: BranchCrossContaminationCommit[];

  constructor(details: BranchCrossContaminationDetails) {
    super(
      `Branch ${details.branchName} contains ${details.foreignCommits.length} foreign task-attributed commits ` +
      `since base ${details.baseSha.slice(0, 12)} for ${details.taskId}`,
    );
    this.branchName = details.branchName;
    this.baseSha = details.baseSha;
    this.taskId = details.taskId;
    this.foreignCommits = details.foreignCommits;
  }
}

export interface InspectBranchConflictInput {
  repoDir: string;
  branchName: string;
  conflictingWorktreePath: string;
  requestingTaskId: string;
  startPoint?: string;
}

export type BranchConflictInspectionResult =
  | { kind: "stale" }
  | { kind: "stale-resolved" }
  | { kind: "reclaimable"; livePath: string; tipSha: string; taskAttributedCommitCount: number; strandedCommits: BranchConflictCommit[] }
  | { kind: "live-foreign"; livePath: string; error: BranchConflictError };

export interface ListBranchRecoveryCandidatesInput {
  repoDir: string;
  branchName: string;
  startPoint?: string;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runGit(repoDir: string, command: string): Promise<string> {
  const { stdout } = await execAsync(command, {
    cwd: repoDir,
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return stdout.trim();
}

async function revParse(repoDir: string, ref: string): Promise<string> {
  return runGit(repoDir, `git rev-parse --verify ${quoteShellArg(`${ref}^{commit}`)}`);
}

async function listStrandedCommits(repoDir: string, startPoint: string, branchName: string): Promise<BranchConflictCommit[]> {
  try {
    const output = await runGit(
      repoDir,
      `git log --reverse --format=%H%x09%s ${quoteShellArg(`${startPoint}..${branchName}`)}`,
    );
    if (!output) return [];
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, ...subjectParts] = line.split("\t");
        return { sha, subject: subjectParts.join("\t") };
      });
  } catch {
    return [];
  }
}

async function getWorktreeBranchMap(repoDir: string): Promise<Map<string, string>> {
  const output = await runGit(repoDir, "git worktree list --porcelain");
  const map = new Map<string, string>();
  let currentWorktree: string | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentWorktree = line.slice("worktree ".length).trim();
      continue;
    }
    if (line.startsWith("branch refs/heads/") && currentWorktree) {
      map.set(line.slice("branch refs/heads/".length).trim(), currentWorktree);
    }
    if (!line.trim()) {
      currentWorktree = null;
    }
  }

  return map;
}

function parseBranchNames(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function listBranchRecoveryCandidates(
  input: ListBranchRecoveryCandidatesInput,
): Promise<BranchRecoveryCandidate[]> {
  const { repoDir, branchName } = input;
  const startPoint = input.startPoint ?? "HEAD";
  const [branchListOutput, worktreeBranches] = await Promise.all([
    runGit(
      repoDir,
      `git for-each-ref --format='%(refname:short)' refs/heads/${branchName} refs/heads/${branchName}-*`,
    ),
    getWorktreeBranchMap(repoDir),
  ]);

  const candidates: BranchRecoveryCandidate[] = [];
  for (const candidateName of parseBranchNames(branchListOutput)) {
    const tipSha = await revParse(repoDir, candidateName);
    const strandedCommits = await listStrandedCommits(repoDir, startPoint, candidateName);
    candidates.push({
      branchName: candidateName,
      tipSha,
      worktreePath: worktreeBranches.get(candidateName) ?? null,
      strandedCommits,
      isCanonical: candidateName === branchName,
    });
  }

  candidates.sort((left, right) => {
    if (left.branchName === branchName) return -1;
    if (right.branchName === branchName) return 1;
    return left.branchName.localeCompare(right.branchName);
  });

  return candidates;
}

async function countTaskAttributedCommits(repoDir: string, range: string, taskId: string): Promise<number> {
  const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const subjectPattern = new RegExp(`^(feat|fix|test|chore|docs|refactor|perf|build)\\(${escapedTaskId}\\):`);
  const trailerPattern = new RegExp(`(?:^|\\n)${FUSION_TASK_ID_TRAILER_KEY}: ${escapedTaskId}(?:\\n|$)`);
  let output = "";
  try {
    output = await runGit(repoDir, `git log --format=%H%x00%s%x00%b ${quoteShellArg(range)}`);
  } catch {
    return 0;
  }
  if (!output) return 0;

  const tokens = output.split("\u0000");
  let count = 0;
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const subject = tokens[i + 1] ?? "";
    const body = tokens[i + 2] ?? "";
    if (subjectPattern.test(subject) || trailerPattern.test(body)) {
      count += 1;
    }
  }
  return count;
}

export async function assertCleanBranchAtBase(
  repoDir: string,
  branchName: string,
  baseSha: string,
  taskId: string,
): Promise<void> {
  const output = await runGit(repoDir, `git log --format=%H%x1f%s%x1f%b ${quoteShellArg(`${baseSha}..${branchName}`)}`)
    .catch(() => "");
  if (!output) return;

  const subjectPattern = /^(feat|fix|test|chore|docs|refactor|perf|build)\((FN-\d+)\):/i;
  const trailerPattern = /(?:^|\n)Fusion-Task-Id:\s*(FN-\d+)\s*(?:\n|$)/i;
  const foreignCommits: BranchCrossContaminationCommit[] = [];
  for (const line of output.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
    const [sha, subject, body] = line.split("\u001f");
    const subjectMatch = (subject ?? "").match(subjectPattern);
    const trailerMatch = (body ?? "").match(trailerPattern);
    const attributedTaskId = (trailerMatch?.[1] ?? subjectMatch?.[2] ?? "").toUpperCase();
    if (attributedTaskId && attributedTaskId !== taskId.toUpperCase()) {
      foreignCommits.push({ sha, subject: subject ?? "", foreignTaskId: attributedTaskId });
    }
  }

  if (foreignCommits.length > 0) {
    throw new BranchCrossContaminationError({ branchName, baseSha, taskId, foreignCommits });
  }
}

export interface ClassifyForeignCommitsInput {
  repoDir: string;
  branchName: string;
  baseSha: string;
  foreignCommits: BranchCrossContaminationCommit[];
  mainRef?: string;
}

export interface ClassifyForeignCommitsResult {
  /**
   * Commits whose patch-id already exists on main and are safe to drop.
   */
  alreadyUpstream: BranchCrossContaminationCommit[];
  /**
   * Commits whose patch-id is unique and require human adjudication.
   */
  unique: BranchCrossContaminationCommit[];
}

export async function classifyForeignCommits(
  input: ClassifyForeignCommitsInput,
): Promise<ClassifyForeignCommitsResult> {
  const { repoDir, branchName, baseSha, foreignCommits, mainRef = "main" } = input;
  const targetBySha = new Map(foreignCommits.map((commit) => [commit.sha, commit]));
  if (targetBySha.size === 0) {
    return { alreadyUpstream: [], unique: [] };
  }

  const classifyFromCherryOutput = (output: string): ClassifyForeignCommitsResult => {
    const alreadyUpstreamSha = new Set<string>();
    const uniqueSha = new Set<string>();
    const resolveFullSha = (token: string): string | null => {
      if (targetBySha.has(token)) return token;
      const match = foreignCommits.find((commit) => commit.sha.startsWith(token));
      return match?.sha ?? null;
    };

    for (const rawLine of output.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const [marker, token] = line.split(/\s+/, 2);
      if (!token) continue;
      const sha = resolveFullSha(token);
      if (!sha) continue;
      if (marker === "-") {
        alreadyUpstreamSha.add(sha);
      } else if (marker === "+") {
        uniqueSha.add(sha);
      }
    }

    const alreadyUpstream = foreignCommits.filter((commit) => alreadyUpstreamSha.has(commit.sha) || !uniqueSha.has(commit.sha));
    const unique = foreignCommits.filter((commit) => uniqueSha.has(commit.sha));
    return { alreadyUpstream, unique };
  };

  try {
    const comparisonBase = baseSha || await runGit(repoDir, `git merge-base ${quoteShellArg(mainRef)} ${quoteShellArg(branchName)}`);
    const output = await runGit(repoDir, `git cherry ${quoteShellArg(mainRef)} ${quoteShellArg(branchName)} ${quoteShellArg(comparisonBase)}`);
    return classifyFromCherryOutput(output);
  } catch {
    const upstreamPatchIdsOutput = await runGit(
      repoDir,
      `git rev-list ${quoteShellArg(mainRef)} | while read c; do git show "$c" | git patch-id --stable; done`,
    ).catch(() => "");
    const upstreamPatchIds = new Set(
      upstreamPatchIdsOutput
        .split("\n")
        .map((line) => line.trim().split(" ")[0])
        .filter(Boolean),
    );

    const alreadyUpstream: BranchCrossContaminationCommit[] = [];
    const unique: BranchCrossContaminationCommit[] = [];
    for (const commit of foreignCommits) {
      const patchIdLine = await runGit(repoDir, `git show ${quoteShellArg(commit.sha)} | git patch-id --stable`).catch(() => "");
      const patchId = patchIdLine.trim().split(" ")[0];
      if (patchId && upstreamPatchIds.has(patchId)) {
        alreadyUpstream.push(commit);
      } else {
        unique.push(commit);
      }
    }

    return { alreadyUpstream, unique };
  }
}

export interface AutoRecoverCrossContaminationInput {
  repoDir: string;
  branchName: string;
  baseSha: string;
  taskId: string;
  alreadyUpstreamShas: string[];
  mainRef?: string;
}

export interface AutoRecoverCrossContaminationResult {
  newTipSha: string;
  droppedShas: string[];
}

export async function autoRecoverCrossContamination(
  input: AutoRecoverCrossContaminationInput,
): Promise<AutoRecoverCrossContaminationResult> {
  const { repoDir, branchName, baseSha, taskId, alreadyUpstreamShas } = input;
  const dropSet = new Set(alreadyUpstreamShas);
  if (dropSet.size === 0) {
    throw new Error("autoRecoverCrossContamination requires at least one already-upstream SHA");
  }

  const originalTip = await revParse(repoDir, branchName);
  const commitListOutput = await runGit(repoDir, `git rev-list --reverse ${quoteShellArg(`${baseSha}..${branchName}`)}`)
    .catch(() => "");
  const commits = commitListOutput.split("\n").map((line) => line.trim()).filter(Boolean);

  await runGit(repoDir, `git checkout --detach ${quoteShellArg(baseSha)}`);

  try {
    for (const sha of commits) {
      if (dropSet.has(sha)) continue;
      await execAsync(`git cherry-pick ${quoteShellArg(sha)}`, {
        cwd: repoDir,
        encoding: "utf-8",
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
      });
    }

    const newTip = await revParse(repoDir, "HEAD");
    await runGit(repoDir, `git update-ref ${quoteShellArg(`refs/heads/${branchName}`)} ${quoteShellArg(newTip)} ${quoteShellArg(originalTip)}`);
    await runGit(repoDir, `git checkout ${quoteShellArg(branchName)}`);
  } catch (error) {
    await runGit(repoDir, `git cherry-pick --abort`).catch(() => undefined);
    await runGit(repoDir, `git checkout ${quoteShellArg(branchName)}`).catch(() => undefined);
    throw error;
  }

  await assertCleanBranchAtBase(repoDir, branchName, baseSha, taskId);

  return {
    newTipSha: await revParse(repoDir, branchName),
    droppedShas: Array.from(dropSet),
  };
}

export async function inspectBranchConflict(
  input: InspectBranchConflictInput,
): Promise<BranchConflictInspectionResult> {
  const startPoint = input.startPoint ?? "HEAD";
  if (!existsSync(input.conflictingWorktreePath)) {
    return { kind: "stale" };
  }

  try {
    await runGit(input.repoDir, "git worktree prune");
  } catch {
    // best-effort
  }

  const worktreeMap = await getWorktreeBranchMap(input.repoDir);
  const livePath = worktreeMap.get(input.branchName);

  try {
    await revParse(input.repoDir, `refs/heads/${input.branchName}`);
  } catch {
    return { kind: "stale-resolved" };
  }

  if (!livePath) {
    return { kind: "stale-resolved" };
  }

  const existingTipSha = await revParse(input.repoDir, input.branchName);
  const strandedCommits = await listStrandedCommits(input.repoDir, startPoint, input.branchName);
  const taskAttributedCommitCount = await countTaskAttributedCommits(
    input.repoDir,
    `${startPoint}..${input.branchName}`,
    input.requestingTaskId,
  );

  if (taskAttributedCommitCount > 0) {
    return {
      kind: "reclaimable",
      livePath,
      tipSha: existingTipSha,
      taskAttributedCommitCount,
      strandedCommits,
    };
  }

  return {
    kind: "live-foreign",
    livePath,
    error: new BranchConflictError({
      branchName: input.branchName,
      conflictingWorktreePath: livePath,
      existingTipSha,
      strandedCommits,
      startPoint,
      recommendedAction: "Run branch recovery and explicitly choose whether to reclaim or discard prior work.",
    }),
  };
}
