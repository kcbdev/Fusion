import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CentralCore,
  MasterKeyManager,
  RESERVED_SYNC_PASSPHRASE_KEY,
  SecretsStore,
  TaskStore,
  getSyncPassphrase,
} from "@fusion/core";
import { createServer } from "../server.js";
import { request } from "../test-request.js";

type AppFixture = {
  root: string;
  app: ReturnType<typeof createServer>;
  globalDir: string;
  secretsStore: SecretsStore;
};

async function createFixture(prefix: string): Promise<AppFixture> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const globalDir = join(root, ".fusion-global-settings");
  const store = new TaskStore(root, globalDir, { inMemoryDb: true });
  await store.init();
  const central = new CentralCore(store.getFusionDir());
  await central.init();
  const centralDb = (central as unknown as { db: any | null }).db;
  if (!centralDb) throw new Error("central db unavailable");
  const mk = new MasterKeyManager({ globalDir });
  const secretsStore = new SecretsStore(store.getDatabase(), centralDb, () => mk.getOrCreateKey());
  (store as unknown as { getSecretsStore: () => Promise<SecretsStore> }).getSecretsStore = async () => secretsStore;
  return { root, app: createServer(store as any), globalDir, secretsStore };
}

describe("routes secrets sync passphrase", () => {
  let fixture: AppFixture;
  const logSink: string[] = [];

  beforeEach(async () => {
    fixture = await createFixture("fn-secrets-passphrase-");
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logSink.push(args.map((value) => String(value)).join(" "));
    });
  });

  afterEach(() => {
    rmSync(fixture.root, { recursive: true, force: true });
    vi.restoreAllMocks();
    logSink.length = 0;
  });

  it("GET /api/secrets/sync-passphrase reflects configured status", async () => {
    const first = await request(fixture.app, "GET", "/api/secrets/sync-passphrase");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ configured: false });

    const setResponse = await request(
      fixture.app,
      "PUT",
      "/api/secrets/sync-passphrase",
      JSON.stringify({ passphrase: "shared-passphrase" }),
      { "content-type": "application/json" },
    );
    expect(setResponse.status).toBe(200);

    const second = await request(fixture.app, "GET", "/api/secrets/sync-passphrase");
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ configured: true });
  });

  it("PUT /api/secrets/sync-passphrase validates payload", async () => {
    for (const body of [{}, { passphrase: "   " }, { passphrase: 123 }]) {
      const response = await request(
        fixture.app,
        "PUT",
        "/api/secrets/sync-passphrase",
        JSON.stringify(body),
        { "content-type": "application/json" },
      );
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid-passphrase" });
    }
  });

  it("PUT persists reserved key and does not leak passphrase via response or logs", async () => {
    const passphrase = "forbidden-passphrase";
    const response = await request(
      fixture.app,
      "PUT",
      "/api/secrets/sync-passphrase",
      JSON.stringify({ passphrase }),
      { "content-type": "application/json" },
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(JSON.stringify(response.body)).not.toContain(passphrase);

    const reserved = fixture.secretsStore
      .listSecrets("global")
      .find((secret) => secret.key === RESERVED_SYNC_PASSPHRASE_KEY && secret.scope === "global");
    expect(reserved).toBeTruthy();
    expect(logSink.join("\n")).not.toContain(passphrase);
  });

  it("DELETE clears reserved key and GET returns not configured", async () => {
    await request(
      fixture.app,
      "PUT",
      "/api/secrets/sync-passphrase",
      JSON.stringify({ passphrase: "to-clear" }),
      { "content-type": "application/json" },
    );

    const deleteResponse = await request(fixture.app, "DELETE", "/api/secrets/sync-passphrase");
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ success: true });

    const configuredResponse = await request(fixture.app, "GET", "/api/secrets/sync-passphrase");
    expect(configuredResponse.status).toBe(200);
    expect(configuredResponse.body).toEqual({ configured: false });

    const reserved = fixture.secretsStore
      .listSecrets("global")
      .find((secret) => secret.key === RESERVED_SYNC_PASSPHRASE_KEY && secret.scope === "global");
    expect(reserved).toBeUndefined();
  });

  it("GET /api/secrets excludes reserved sync passphrase key", async () => {
    await request(
      fixture.app,
      "PUT",
      "/api/secrets/sync-passphrase",
      JSON.stringify({ passphrase: "hidden" }),
      { "content-type": "application/json" },
    );
    await fixture.secretsStore.createSecret({ scope: "global", key: "VISIBLE", plaintextValue: "value" });

    const response = await request(fixture.app, "GET", "/api/secrets");
    expect(response.status).toBe(200);
    const keys = ((response.body as { secrets: Array<{ key: string }> }).secrets).map((secret) => secret.key);
    expect(keys).toContain("VISIBLE");
    expect(keys).not.toContain(RESERVED_SYNC_PASSPHRASE_KEY);
  });

  it("repeated PUT rotates passphrase", async () => {
    await request(
      fixture.app,
      "PUT",
      "/api/secrets/sync-passphrase",
      JSON.stringify({ passphrase: "first-pass" }),
      { "content-type": "application/json" },
    );
    await request(
      fixture.app,
      "PUT",
      "/api/secrets/sync-passphrase",
      JSON.stringify({ passphrase: "second-pass" }),
      { "content-type": "application/json" },
    );

    const passphrase = await getSyncPassphrase(fixture.secretsStore);
    expect(passphrase).toBe("second-pass");
  });
});
