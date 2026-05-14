import { afterEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  classifyForeignCommits,
  type BranchCrossContaminationCommit,
} from "../branch-conflicts.js";

const execAsync = promisify(exec);

async function run(command: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(command, { cwd, encoding: "utf-8" });
  return stdout.trim();
}

describe("branch contamination recovery classification", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setupRepo() {
    const repoDir = await mkdtemp(path.join(tmpdir(), "fn-4428-"));
    dirs.push(repoDir);

    await run("git init -b main", repoDir);
    await run("git config user.email test@example.com", repoDir);
    await run("git config user.name 'Test User'", repoDir);

    await writeFile(path.join(repoDir, "note.txt"), "base\n", "utf-8");
    await run("git add note.txt && git commit -m 'chore: base'", repoDir);
    const baseSha = await run("git rev-parse HEAD", repoDir);

    await run("git checkout -b feature", repoDir);

    return { repoDir, baseSha };
  }

  async function makeCommit(repoDir: string, body: string, subject: string, foreignTaskId: string): Promise<BranchCrossContaminationCommit> {
    await appendFile(path.join(repoDir, "note.txt"), `${body}\n`, "utf-8");
    await run("git add note.txt", repoDir);
    await run(`git commit -m ${JSON.stringify(subject)} -m ${JSON.stringify(`Fusion-Task-Id: ${foreignTaskId}`)}`, repoDir);
    const sha = await run("git rev-parse HEAD", repoDir);
    return { sha, subject, foreignTaskId };
  }

  it("classifies all foreign commits as already-upstream when patches exist on main", async () => {
    const { repoDir, baseSha } = await setupRepo();

    const commit = await makeCommit(repoDir, "foreign-a", "feat(FN-4412): foreign change", "FN-4412");
    await run("git checkout main", repoDir);
    await run(`git cherry-pick ${commit.sha}`, repoDir);
    await run("git checkout feature", repoDir);

    const result = await classifyForeignCommits({
      repoDir,
      branchName: "feature",
      baseSha,
      foreignCommits: [commit],
      mainRef: "main",
    });

    expect(result.alreadyUpstream.map((entry) => entry.sha)).toEqual([commit.sha]);
    expect(result.unique).toEqual([]);
  });

  it("classifies all foreign commits as unique when patches are absent on main", async () => {
    const { repoDir, baseSha } = await setupRepo();
    const commit = await makeCommit(repoDir, "foreign-b", "feat(FN-4412): unique", "FN-4412");

    const result = await classifyForeignCommits({
      repoDir,
      branchName: "feature",
      baseSha,
      foreignCommits: [commit],
      mainRef: "main",
    });

    expect(result.alreadyUpstream).toEqual([]);
    expect(result.unique.map((entry) => entry.sha)).toEqual([commit.sha]);
  });

  it("classifies mixed foreign commits into already-upstream and unique buckets", async () => {
    const { repoDir, baseSha } = await setupRepo();
    const upstreamCommit = await makeCommit(repoDir, "foreign-c", "feat(FN-4412): upstream", "FN-4412");
    const uniqueCommit = await makeCommit(repoDir, "foreign-d", "fix(FN-4410): still unique", "FN-4410");

    await run("git checkout main", repoDir);
    await run(`git cherry-pick ${upstreamCommit.sha}`, repoDir);
    await run("git checkout feature", repoDir);

    const result = await classifyForeignCommits({
      repoDir,
      branchName: "feature",
      baseSha,
      foreignCommits: [upstreamCommit, uniqueCommit],
      mainRef: "main",
    });

    expect(result.alreadyUpstream.map((entry) => entry.sha)).toEqual([upstreamCommit.sha]);
    expect(result.unique.map((entry) => entry.sha)).toEqual([uniqueCommit.sha]);
  });
});
