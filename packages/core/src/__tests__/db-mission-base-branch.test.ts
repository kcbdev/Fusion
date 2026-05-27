import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MissionStore } from "../mission-store.js";
import { Database } from "../db.js";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "kb-db-mission-base-branch-"));
}

describe("mission baseBranch persistence", () => {
  let tmpDir: string;
  let fusionDir: string;
  let db: Database;
  let store: MissionStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fusionDir = join(tmpDir, ".fusion");
    db = new Database(fusionDir, { inMemory: true });
    db.init();
    store = new MissionStore(fusionDir, db);
  });

  afterEach(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates, reads, and updates mission baseBranch", () => {
    const created = store.createMission({
      title: "Mission",
      baseBranch: "develop",
    });

    expect(created.baseBranch).toBe("develop");

    const fetched = store.getMission(created.id);
    expect(fetched?.baseBranch).toBe("develop");

    const updated = store.updateMission(created.id, { baseBranch: "release/1.0" });
    expect(updated.baseBranch).toBe("release/1.0");

    const refetched = store.getMission(created.id);
    expect(refetched?.baseBranch).toBe("release/1.0");
  });
});
