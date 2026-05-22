// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createServer } from "../server.js";
import { request } from "../test-request.js";

const mocked = vi.hoisted(() => ({
  runGitCommand: vi.fn(),
}));

vi.mock("../routes/resolve-diff-base.js", () => ({
  runGitCommand: mocked.runGitCommand,
}));

class MockStore extends EventEmitter {
  recordRunAuditEvent = vi.fn();
  getRootDir(): string { return "/repo"; }
  getFusionDir(): string { return "/repo/.fusion"; }
  getSettings = vi.fn().mockResolvedValue({});
  getSettingsFast = vi.fn().mockResolvedValue({});
  getDatabase() {
    return {
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }), all: vi.fn().mockReturnValue([]), get: vi.fn() }),
    };
  }
}

type ScriptedResponse = string | Error;

function gitScript(map: Record<string, ScriptedResponse>) {
  const calls: string[] = [];
  mocked.runGitCommand.mockImplementation(async (args: string[]) => {
    const key = args.join(" ");
    calls.push(key);
    const hit = Object.entries(map).find(([prefix]) => key.startsWith(prefix));
    if (!hit) {
      throw new Error(`missing mock for ${key}`);
    }
    if (hit[1] instanceof Error) {
      throw hit[1];
    }
    return hit[1] as string;
  });
  return calls;
}

describe("smart pull routes", () => {
  let store: MockStore;
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MockStore();
    app = createServer(store as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns clean-pull for clean worktree and emits pull audit", async () => {
    gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "rev-parse --git-dir": ".git\n",
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse HEAD": "bbbb\n",
      "status --porcelain=v1 --untracked-files=all": "",
      "pull --ff-only": "Already up to date.\n",
    });

    const res = await request(app, "POST", "/api/git/smart-pull", JSON.stringify({
      worktreePath: "/repo",
      integrationBranch: "main",
      taskId: "FN-5358",
    }), { "content-type": "application/json" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "clean-pull", fromSha: "bbbb", toSha: "bbbb" });
    const events = store.recordRunAuditEvent.mock.calls.map(([event]) => event.mutationType);
    expect(events).toEqual(["pull:fast-forward"]);
    expect(store.recordRunAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      domain: "git",
      mutationType: "pull:fast-forward",
      taskId: "FN-5358",
      target: "/repo",
      metadata: expect.objectContaining({ succeeded: true, integrationBranch: "main" }),
    }));
  });

  it("runs dirty stash/pull/pop path and emits ordered audits", async () => {
    const calls = gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "rev-parse --git-dir": ".git\n",
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse HEAD": "cccc\n",
      "status --porcelain=v1 --untracked-files=all": " M file.ts\n",
      "stash push --include-untracked -m fusion-auto-stash-FN-5358": "Saved working directory and index state\n",
      "rev-parse stash@{0}": "stashsha123\n",
      "pull --ff-only": "Updating cccc..dddd\n",
      "stash pop": "On branch main\nDropped refs/stash@{0}\n",
    });

    const res = await request(app, "POST", "/api/git/smart-pull", JSON.stringify({
      worktreePath: "/repo",
      integrationBranch: "main",
      taskId: "FN-5358",
    }), { "content-type": "application/json" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "stash-pull-pop", stashSha: "stashsha123", stashLabel: "fusion-auto-stash-FN-5358" });
    const events = store.recordRunAuditEvent.mock.calls.map(([event]) => event.mutationType);
    expect(events).toEqual(["stash:push", "pull:fast-forward", "stash:pop"]);
    const stashPush = store.recordRunAuditEvent.mock.calls[0][0];
    const stashPop = store.recordRunAuditEvent.mock.calls[2][0];
    expect(stashPush.metadata.stashSha).toBe("stashsha123");
    expect(stashPop.metadata.stashSha).toBe("stashsha123");
    expect(calls).not.toContain("stash drop");
  });

  it("returns stash-pop-conflict and never drops stash", async () => {
    const calls = gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "rev-parse --git-dir": ".git\n",
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse HEAD": "eeee\n",
      "status --porcelain=v1 --untracked-files=all": " M app.tsx\n",
      "stash push --include-untracked -m fusion-auto-stash-FN-5358": "Saved\n",
      "rev-parse stash@{0}": "stashsha456\n",
      "pull --ff-only": "Updating\n",
      "stash pop": new Error("CONFLICT (content): Merge conflict in app.tsx"),
      "stash list --format=%H|%gd": "stashsha456|stash@{0}\n",
      "diff --name-only --diff-filter=U": "app.tsx\n",
    });

    const res = await request(app, "POST", "/api/git/smart-pull", JSON.stringify({
      worktreePath: "/repo",
      integrationBranch: "main",
      taskId: "FN-5358",
    }), { "content-type": "application/json" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "stash-pop-conflict", conflictedFiles: ["app.tsx"] });
    expect(calls.find((call) => call.startsWith("stash drop"))).toBeUndefined();
    const events = store.recordRunAuditEvent.mock.calls.map(([event]) => event.mutationType);
    expect(events).toEqual(["stash:push", "pull:fast-forward", "stash:pop-conflict"]);
  });

  it("returns 409 on pull rejection, restores stash, emits failed pull audit", async () => {
    const calls = gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "rev-parse --git-dir": ".git\n",
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse HEAD": "ffff\n",
      "status --porcelain=v1 --untracked-files=all": " M a.ts\n",
      "stash push --include-untracked -m fusion-auto-stash-FN-5358": "Saved\n",
      "rev-parse stash@{0}": "stashsha789\n",
      "pull --ff-only": new Error("fatal: Not possible to fast-forward, aborting."),
      "stash pop": "restored\n",
    });

    const res = await request(app, "POST", "/api/git/smart-pull", JSON.stringify({
      worktreePath: "/repo",
      integrationBranch: "main",
      taskId: "FN-5358",
    }), { "content-type": "application/json" });

    expect(res.status).toBe(409);
    expect(calls).toContain("stash pop");
    const events = store.recordRunAuditEvent.mock.calls.map(([event]) => event);
    expect(events.map((event) => event.mutationType)).toEqual(["stash:push", "pull:fast-forward"]);
    expect(events[1].metadata.succeeded).toBe(false);
  });

  it("uses taskId in stash label, and timestamp fallback when taskId omitted", async () => {
    gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "rev-parse --git-dir": ".git\n",
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse HEAD": "1111\n",
      "status --porcelain=v1 --untracked-files=all": " M app.ts\n",
      "stash push --include-untracked -m fusion-auto-stash-": "Saved\n",
      "rev-parse stash@{0}": "stashsha111\n",
      "pull --ff-only": "done\n",
      "stash pop": "done\n",
    });

    await request(app, "POST", "/api/git/smart-pull", JSON.stringify({
      worktreePath: "/repo",
      integrationBranch: "main",
      taskId: "FN-5358",
    }), { "content-type": "application/json" });

    expect(mocked.runGitCommand).toHaveBeenCalledWith(expect.arrayContaining(["-m", "fusion-auto-stash-FN-5358"]), "/repo", 15_000);

    vi.clearAllMocks();
    gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "rev-parse --git-dir": ".git\n",
      "rev-parse --abbrev-ref HEAD": "main\n",
      "rev-parse HEAD": "2222\n",
      "status --porcelain=v1 --untracked-files=all": " M app.ts\n",
      "stash push --include-untracked -m fusion-auto-stash-": "Saved\n",
      "rev-parse stash@{0}": "stashsha222\n",
      "pull --ff-only": "done\n",
      "stash pop": "done\n",
    });

    await request(app, "POST", "/api/git/smart-pull", JSON.stringify({
      worktreePath: "/repo",
      integrationBranch: "main",
    }), { "content-type": "application/json" });

    const stashCall = mocked.runGitCommand.mock.calls.find(([args]: [string[]]) => args[0] === "stash" && args[1] === "push");
    expect(stashCall?.[0][4]).toMatch(/^fusion-auto-stash-\d+$/);
  });

  it("returns branch mismatch 409 without audits", async () => {
    gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "rev-parse --git-dir": ".git\n",
      "rev-parse --abbrev-ref HEAD": "feature\n",
    });

    const res = await request(app, "POST", "/api/git/smart-pull", JSON.stringify({
      worktreePath: "/repo",
      integrationBranch: "main",
    }), { "content-type": "application/json" });

    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ reason: "branch-mismatch", currentBranch: "feature" });
    expect(store.recordRunAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects path traversal worktree path", async () => {
    gitScript({
      "worktree list --porcelain": "worktree /repo\n",
    });

    const res = await request(app, "POST", "/api/git/smart-pull", JSON.stringify({
      worktreePath: "../../etc",
      integrationBranch: "main",
    }), { "content-type": "application/json" });

    expect(res.status).toBe(400);
    expect(store.recordRunAuditEvent).not.toHaveBeenCalled();
  });

  it("stash-resolve uses ours/theirs checkout and rejects invalid choice", async () => {
    const calls = gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "diff --name-only --diff-filter=U": "app/a.ts\n",
      "checkout --ours -- app/a.ts": "",
      "add -- app/a.ts": "",
    });

    const res = await request(app, "POST", "/api/git/stash-resolve", JSON.stringify({
      worktreePath: "/repo",
      stashSha: "stashsha",
      file: "app/a.ts",
      choice: "ours",
    }), { "content-type": "application/json" });

    expect(res.status).toBe(200);
    expect(calls).toContain("checkout --ours -- app/a.ts");
    expect(calls).toContain("add -- app/a.ts");

    const invalid = await request(app, "POST", "/api/git/stash-resolve", JSON.stringify({
      worktreePath: "/repo",
      stashSha: "stashsha",
      file: "app/a.ts",
      choice: "invalid",
    }), { "content-type": "application/json" });
    expect(invalid.status).toBe(400);
  });

  it("stash-drop blocks unresolved conflicts then succeeds and audits manual resolution", async () => {
    gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "diff --name-only --diff-filter=U": "file.ts\n",
    });

    const blocked = await request(app, "POST", "/api/git/stash-drop", JSON.stringify({
      worktreePath: "/repo",
      stashSha: "stashsha",
      taskId: "FN-5358",
    }), { "content-type": "application/json" });
    expect(blocked.status).toBe(409);

    vi.clearAllMocks();
    gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "diff --name-only --diff-filter=U": "",
      "stash list --format=%H|%gd": "stashsha|stash@{1}\n",
      "stash drop stash@{1}": "Dropped stash@{1}\n",
    });

    const dropped = await request(app, "POST", "/api/git/stash-drop", JSON.stringify({
      worktreePath: "/repo",
      stashSha: "stashsha",
      taskId: "FN-5358",
    }), { "content-type": "application/json" });

    expect(dropped.status).toBe(200);
    expect(dropped.body).toMatchObject({ dropped: true });
    expect(store.recordRunAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      domain: "git",
      mutationType: "stash:pop",
      taskId: "FN-5358",
      metadata: expect.objectContaining({ manualResolution: true }),
    }));
  });

  it("stash-restore applies stash and re-emits conflict audit when apply conflicts", async () => {
    gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "stash list --format=%H|%gd": "stashsha|stash@{0}\n",
      "stash apply stash@{0}": "",
    });

    const clean = await request(app, "POST", "/api/git/stash-restore", JSON.stringify({
      worktreePath: "/repo",
      stashSha: "stashsha",
      taskId: "FN-5358",
    }), { "content-type": "application/json" });

    expect(clean.status).toBe(200);
    expect(clean.body).toMatchObject({ applied: true, conflict: false, conflictedFiles: [] });

    vi.clearAllMocks();
    gitScript({
      "worktree list --porcelain": "worktree /repo\n",
      "stash list --format=%H|%gd": "stashsha|stash@{0}\n",
      "stash apply stash@{0}": new Error("CONFLICT (content): Merge conflict in app.tsx"),
      "diff --name-only --diff-filter=U": "app.tsx\n",
    });

    const conflict = await request(app, "POST", "/api/git/stash-restore", JSON.stringify({
      worktreePath: "/repo",
      stashSha: "stashsha",
      taskId: "FN-5358",
    }), { "content-type": "application/json" });

    expect(conflict.status).toBe(200);
    expect(conflict.body).toMatchObject({ applied: true, conflict: true, conflictedFiles: ["app.tsx"] });
    expect(store.recordRunAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      domain: "git",
      mutationType: "stash:pop-conflict",
      taskId: "FN-5358",
      target: "/repo",
    }));
  });
});
