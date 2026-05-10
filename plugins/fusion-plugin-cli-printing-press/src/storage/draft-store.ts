/* Interim storage — replaced by FN-3766's canonical schema. Do not extend without updating that ticket. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceDraft } from "../wizard/types.js";

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Draft not found: ${id}`);
    this.name = "NotFoundError";
  }
}

function mergeDraft(existing: ServiceDraft, patch: Partial<ServiceDraft>): ServiceDraft {
  const mergedCredential = patch.credential && typeof patch.credential === "object"
    ? { ...existing.credential, ...patch.credential }
    : existing.credential;

  return {
    ...existing,
    ...patch,
    credential: mergedCredential,
    endpoints: patch.endpoints ?? existing.endpoints,
  };
}

export function createDraftStore({ rootDir }: { rootDir: string }) {
  const draftsDir = join(rootDir, ".fusion", "plugins", "cli-printing-press", "drafts");

  async function ensureDir() { await mkdir(draftsDir, { recursive: true }); }

  async function writeAtomic(path: string, draft: ServiceDraft): Promise<void> {
    const tempPath = `${path}.tmp-${randomUUID()}`;
    await writeFile(tempPath, JSON.stringify(draft, null, 2), "utf8");
    await rename(tempPath, path);
  }

  return {
    async create(input: ServiceDraft) {
      await ensureDir();
      const now = new Date().toISOString();
      const draft: ServiceDraft = { ...input, id: input.id || randomUUID(), createdAt: input.createdAt || now, updatedAt: now };
      await writeAtomic(join(draftsDir, `${draft.id}.json`), draft);
      return draft;
    },
    async list() {
      await ensureDir();
      const files = await readdir(draftsDir);
      const entries = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => JSON.parse(await readFile(join(draftsDir, file), "utf8")) as ServiceDraft));
      return entries.map(({ id, name, slug, updatedAt }) => ({ id, name, slug, updatedAt }));
    },
    async get(id: string) {
      try { return JSON.parse(await readFile(join(draftsDir, `${id}.json`), "utf8")) as ServiceDraft; } catch { return null; }
    },
    async update(id: string, patch: Partial<ServiceDraft>) {
      await ensureDir();
      const current = await this.get(id);
      if (!current) throw new NotFoundError(id);
      const updated: ServiceDraft = {
        ...mergeDraft(current, patch),
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await writeAtomic(join(draftsDir, `${id}.json`), updated);
      return updated;
    },
    async delete(id: string) {
      await rm(join(draftsDir, `${id}.json`), { force: true });
    },
  };
}
