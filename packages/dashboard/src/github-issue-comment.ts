import type { TaskStore } from "@fusion/core";
import { GitHubClient } from "./github.js";
import { getCliPackageVersion } from "./cli-package-version.js";
import {
  FUSION_SELF_REPO,
  computeNextMinorVersion,
  formatReleaseVersionLines,
  isFusionSelfRepo,
} from "./fusion-release-version.js";

interface TaskMovedEvent {
  task: {
    id: string;
    title?: string;
    sourceIssue?: {
      provider: string;
      repository: string;
      issueNumber: number;
    };
  };
  to: string;
}

const DEFAULT_COMMENT_TEMPLATE = "✅ Task {taskId} ({taskTitle}) has been completed and resolved.";

/*
 * FNXC:GitHubIssueComment 2026-07-15-09:40:
 * The self-repo detection and next-minor computation moved to `fusion-release-version.ts` so the
 * GitHubTrackingCommentService done comment — the surface that actually posts on linked issues —
 * shares one implementation. See that module for the full requirement and the FN-7575 miss.
 * NOTE: this service is gated on `settings.githubCommentOnDone`, which defaults to false and has
 * no Settings UI, so it rarely fires; do not treat it as the primary done-comment surface.
 */

export class GitHubIssueCommentService {
  private readonly store: TaskStore;
  private readonly getGitHubToken: () => string | undefined;
  private readonly getCurrentVersion: () => string;
  private readonly onTaskMoved = (event: TaskMovedEvent): void => {
    void this.handleTaskMoved(event);
  };
  private started = false;

  constructor(
    store: TaskStore,
    getGitHubToken?: () => string | undefined,
    getCurrentVersion?: () => string,
  ) {
    this.store = store;
    this.getGitHubToken = getGitHubToken ?? (() => process.env.GITHUB_TOKEN);
    this.getCurrentVersion = getCurrentVersion ?? (() => getCliPackageVersion(import.meta.url));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.store.on("task:moved", this.onTaskMoved);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.store.off("task:moved", this.onTaskMoved);
  }

  private async handleTaskMoved(event: TaskMovedEvent): Promise<void> {
    if (event.to !== "done") {
      return;
    }

    const task = event.task;
    const settings = await this.store.getSettings();
    if (!settings.githubCommentOnDone) {
      return;
    }

    const sourceIssue = task.sourceIssue;
    if (!sourceIssue || sourceIssue.provider !== "github") {
      return;
    }

    const [owner, repo] = sourceIssue.repository.split("/");
    if (!owner || !repo) {
      await this.store.logEntry(
        task.id,
        "Failed to post GitHub issue comment",
        `Invalid GitHub repository format: ${sourceIssue.repository}`,
      );
      return;
    }

    const template = settings.githubCommentTemplate || DEFAULT_COMMENT_TEMPLATE;
    let commentBody = template
      .replaceAll("{taskId}", task.id)
      .replaceAll("{taskTitle}", task.title ?? "");

    const versionLines = formatReleaseVersionLines(sourceIssue.repository, () => this.getCurrentVersion());
    if (versionLines.length > 0) {
      commentBody += `\n\n${versionLines.join("\n")}`;
    }

    try {
      const client = new GitHubClient(this.getGitHubToken());
      await client.commentOnIssue(owner, repo, sourceIssue.issueNumber, commentBody);
      await this.store.logEntry(
        task.id,
        "Posted GitHub issue completion comment",
        `${sourceIssue.repository}#${sourceIssue.issueNumber}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.logEntry(
        task.id,
        "Failed to post GitHub issue comment",
        message,
      );
    }
  }
}

export { DEFAULT_COMMENT_TEMPLATE };
// Re-exported from ./fusion-release-version.js for back-compat with existing importers/tests.
export { FUSION_SELF_REPO, isFusionSelfRepo, computeNextMinorVersion };
