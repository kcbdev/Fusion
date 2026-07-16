import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitLabIssueCommentService } from "../gitlab-issue-comment.js";

function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function store(settings: any = {}) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    getSettings: vi.fn().mockResolvedValue({ gitlabAuthToken: "token", gitlabInstanceUrl: "https://gitlab.example.com", gitlabCommentOnDone: true, ...settings }),
    getGlobalSettingsStore: () => ({ getSettings: vi.fn().mockResolvedValue({}) }),
    logEntry: vi.fn(),
  });
}
const task: any = { id: "FN-1", title: "Fix", sourceIssue: { provider: "gitlab", repository: "g/p", issueNumber: 2, url: "https://gitlab.example.com/g/p/-/issues/2" }, gitlabTracking: { item: { kind: "project_issue", instanceUrl: "https://gitlab.example.com", host: "gitlab.example.com", url: "https://gitlab.example.com/g/p/-/issues/2", projectPath: "g/p", iid: 2, title: "Fix", state: "opened", linkedAt: "now" } } };

describe("GitLabIssueCommentService", () => {
  beforeEach(() => vi.unstubAllGlobals());
  it("posts source completion comments to GitLab project issues", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
    vi.stubGlobal("fetch", fetchImpl);
    const s = store();
    new GitLabIssueCommentService(s as any).start();
    s.emit("task:moved", { task, to: "done" });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(fetchImpl.mock.calls[0][0]).toBe("https://gitlab.example.com/api/v4/projects/g%2Fp/issues/2/notes");
    expect(s.logEntry).toHaveBeenCalledWith("FN-1", "Posted GitLab issue completion comment", "g/p#2");
  });
  /*
   * FNXC:GitLabIssueComment 2026-07-15-10:05:
   * Parity coverage for the issue #1916 release lines. Version is injected so assertions do not
   * drift with each real release.
   */
  it("appends release version lines for a Fusion self-repo source issue", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
    vi.stubGlobal("fetch", fetchImpl);
    const s = store();
    new GitLabIssueCommentService(s as any, () => "0.60.0").start();
    const selfRepoTask = { ...task, gitlabTracking: { item: { ...task.gitlabTracking.item, projectPath: "runfusion/fusion" } } };
    s.emit("task:moved", { task: selfRepoTask, to: "done" });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as any).body)).body as string;
    expect(body).toContain("Current version: v0.60.0");
    expect(body).toContain("Target release: v0.61.0");
  });

  it("leaves completion comments for every other project unchanged", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
    vi.stubGlobal("fetch", fetchImpl);
    const s = store();
    new GitLabIssueCommentService(s as any, () => "0.60.0").start();
    s.emit("task:moved", { task, to: "done" });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as any).body)).body as string;
    expect(body).toBe("✅ Task FN-1 (Fix) has been completed and resolved.");
  });

  it("skips non-GitLab and incomplete source metadata", async () => {
    const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
    const s = store(); new GitLabIssueCommentService(s as any).start();
    s.emit("task:moved", { task: { ...task, sourceIssue: { provider: "github" } }, to: "done" });
    s.emit("task:moved", { task: { id: "FN-2", sourceIssue: { provider: "gitlab" }, gitlabTracking: { item: { kind: "group_issue", iid: 3 } } }, to: "done" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(s.logEntry).toHaveBeenCalledWith("FN-2", "Skipped GitLab source comment", "Linked GitLab source metadata is incomplete");
  });
});
