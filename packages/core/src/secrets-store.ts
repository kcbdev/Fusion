import { randomUUID } from "node:crypto";
import type { Database as ProjectDatabase } from "./db.js";
import type { CentralDatabase } from "./central-db.js";
import { createSecretCipher, SecretCryptoError, type MasterKeyProvider } from "./secrets-crypto.js";

export type SecretScope = "project" | "global";
export type SecretAccessPolicy = "auto" | "prompt" | "deny";

export interface SecretRecord {
  id: string;
  key: string;
  scope: SecretScope;
  description: string | null;
  accessPolicy: SecretAccessPolicy;
  envExportable: boolean;
  envExportKey: string | null;
  createdAt: string;
  updatedAt: string;
  lastReadAt: string | null;
  lastReadBy: string | null;
}

interface SecretRow {
  id: string;
  key: string;
  description: string | null;
  access_policy: SecretAccessPolicy;
  env_exportable: number;
  env_export_key: string | null;
  created_at: string;
  updated_at: string;
  last_read_at: string | null;
  last_read_by: string | null;
}

interface SecretCipherRow extends SecretRow {
  value_ciphertext: Buffer;
  nonce: Buffer;
}

type SecretsDb = Pick<ProjectDatabase, "prepare" | "bumpLastModified"> | Pick<CentralDatabase, "prepare" | "bumpLastModified">;

export class SecretsStoreError extends Error {
  readonly code: "duplicate-key" | "not-found" | "invalid-policy" | "invalid-key" | "decrypt-failed";

  constructor(params: {
    code: "duplicate-key" | "not-found" | "invalid-policy" | "invalid-key" | "decrypt-failed";
    message: string;
  }) {
    super(params.message);
    this.name = "SecretsStoreError";
    this.code = params.code;
  }
}

function tableForScope(scope: SecretScope): "secrets" | "secrets_global" {
  return scope === "project" ? "secrets" : "secrets_global";
}

function isSqliteUniqueError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/u.test(error.message);
}

function isAccessPolicy(value: string): value is SecretAccessPolicy {
  return value === "auto" || value === "prompt" || value === "deny";
}

export class SecretsStore {
  private readonly cipher: ReturnType<typeof createSecretCipher>;

  constructor(
    private readonly projectDb: Pick<ProjectDatabase, "prepare" | "bumpLastModified">,
    private readonly centralDb: Pick<CentralDatabase, "prepare" | "bumpLastModified">,
    masterKeyProvider: MasterKeyProvider,
  ) {
    this.cipher = createSecretCipher(masterKeyProvider);
  }

  private dbForScope(scope: SecretScope): SecretsDb {
    return scope === "project" ? this.projectDb : this.centralDb;
  }

  private rowToRecord(row: SecretRow, scope: SecretScope): SecretRecord {
    return {
      id: row.id,
      key: row.key,
      scope,
      description: row.description,
      accessPolicy: row.access_policy,
      envExportable: row.env_exportable === 1,
      envExportKey: row.env_export_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastReadAt: row.last_read_at,
      lastReadBy: row.last_read_by,
    };
  }

  listSecrets(scope?: SecretScope): SecretRecord[] {
    if (scope) {
      const db = this.dbForScope(scope);
      const table = tableForScope(scope);
      const rows = db.prepare(`SELECT id, key, description, access_policy, env_exportable, env_export_key, created_at, updated_at, last_read_at, last_read_by FROM ${table} ORDER BY key COLLATE NOCASE ASC`).all() as SecretRow[];
      return rows.map((row) => this.rowToRecord(row, scope));
    }

    return [...this.listSecrets("project"), ...this.listSecrets("global")];
  }

  getSecretMetadata(id: string, scope: SecretScope): SecretRecord | null {
    const db = this.dbForScope(scope);
    const table = tableForScope(scope);
    const row = db.prepare(`SELECT id, key, description, access_policy, env_exportable, env_export_key, created_at, updated_at, last_read_at, last_read_by FROM ${table} WHERE id = ?`).get(id) as SecretRow | undefined;
    return row ? this.rowToRecord(row, scope) : null;
  }

  async createSecret(input: {
    scope: SecretScope;
    key: string;
    plaintextValue: string;
    description?: string | null;
    accessPolicy?: SecretAccessPolicy;
    envExportable?: boolean;
    envExportKey?: string | null;
  }): Promise<SecretRecord> {
    const key = input.key.trim();
    if (!key) {
      throw new SecretsStoreError({ code: "invalid-key", message: "Secret key is required" });
    }
    if (input.accessPolicy && !isAccessPolicy(input.accessPolicy)) {
      throw new SecretsStoreError({ code: "invalid-policy", message: "Invalid access policy" });
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const encrypted = await this.cipher.encrypt(input.plaintextValue);
    const scope = input.scope;
    const db = this.dbForScope(scope);
    const table = tableForScope(scope);

    try {
      db.prepare(`INSERT INTO ${table} (id, key, value_ciphertext, nonce, description, access_policy, env_exportable, env_export_key, created_at, updated_at, last_read_at, last_read_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
        .run(
          id,
          key,
          encrypted.ciphertext,
          encrypted.nonce,
          input.description ?? null,
          input.accessPolicy ?? "auto",
          input.envExportable ? 1 : 0,
          input.envExportKey ?? null,
          now,
          now,
        );
      db.bumpLastModified();
    } catch (error) {
      if (isSqliteUniqueError(error)) {
        throw new SecretsStoreError({ code: "duplicate-key", message: "Secret key already exists" });
      }
      throw error;
    }

    return this.getSecretMetadata(id, scope)!;
  }

  async updateSecret(id: string, scope: SecretScope, patch: {
    key?: string;
    plaintextValue?: string;
    description?: string | null;
    accessPolicy?: SecretAccessPolicy;
    envExportable?: boolean;
    envExportKey?: string | null;
  }): Promise<SecretRecord> {
    const existing = this.getSecretMetadata(id, scope);
    if (!existing) {
      throw new SecretsStoreError({ code: "not-found", message: "Secret not found" });
    }

    const updates: string[] = ["updated_at = ?"];
    const params: Array<string | number | Buffer | null> = [new Date().toISOString()];

    if (patch.key !== undefined) {
      const key = patch.key.trim();
      if (!key) {
        throw new SecretsStoreError({ code: "invalid-key", message: "Secret key is required" });
      }
      updates.push("key = ?");
      params.push(key);
    }

    if (patch.description !== undefined) {
      updates.push("description = ?");
      params.push(patch.description ?? null);
    }

    if (patch.accessPolicy !== undefined) {
      if (!isAccessPolicy(patch.accessPolicy)) {
        throw new SecretsStoreError({ code: "invalid-policy", message: "Invalid access policy" });
      }
      updates.push("access_policy = ?");
      params.push(patch.accessPolicy);
    }

    if (patch.envExportable !== undefined) {
      updates.push("env_exportable = ?");
      params.push(patch.envExportable ? 1 : 0);
    }

    if (patch.envExportKey !== undefined) {
      updates.push("env_export_key = ?");
      params.push(patch.envExportKey ?? null);
    }

    if (patch.plaintextValue !== undefined) {
      const encrypted = await this.cipher.encrypt(patch.plaintextValue);
      updates.push("value_ciphertext = ?", "nonce = ?");
      params.push(encrypted.ciphertext, encrypted.nonce);
    }

    const db = this.dbForScope(scope);
    const table = tableForScope(scope);

    try {
      params.push(id);
      db.prepare(`UPDATE ${table} SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      db.bumpLastModified();
    } catch (error) {
      if (isSqliteUniqueError(error)) {
        throw new SecretsStoreError({ code: "duplicate-key", message: "Secret key already exists" });
      }
      throw error;
    }

    return this.getSecretMetadata(id, scope)!;
  }

  deleteSecret(id: string, scope: SecretScope): void {
    const db = this.dbForScope(scope);
    const table = tableForScope(scope);
    const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id) as { changes?: number };
    if ((result.changes ?? 0) === 0) {
      throw new SecretsStoreError({ code: "not-found", message: "Secret not found" });
    }
    db.bumpLastModified();
  }

  async revealSecret(
    id: string,
    scope: SecretScope,
    reader: { agentId?: string | null; userId?: string | null },
  ): Promise<{ key: string; plaintextValue: string }> {
    const db = this.dbForScope(scope);
    const table = tableForScope(scope);
    const row = db.prepare(`SELECT id, key, value_ciphertext, nonce, description, access_policy, env_exportable, env_export_key, created_at, updated_at, last_read_at, last_read_by FROM ${table} WHERE id = ?`).get(id) as SecretCipherRow | undefined;

    if (!row) {
      throw new SecretsStoreError({ code: "not-found", message: "Secret not found" });
    }

    let plaintextValue: string;
    try {
      plaintextValue = await this.cipher.decrypt({ ciphertext: row.value_ciphertext, nonce: row.nonce });
    } catch (error) {
      if (error instanceof SecretCryptoError && error.code === "decryption-failed") {
        throw new SecretsStoreError({ code: "decrypt-failed", message: "Secret decryption failed" });
      }
      throw new SecretsStoreError({ code: "decrypt-failed", message: "Secret decryption failed" });
    }

    const now = new Date().toISOString();
    const lastReadBy = reader.userId ?? reader.agentId ?? null;
    db.prepare(`UPDATE ${table} SET last_read_at = ?, last_read_by = ?, updated_at = ? WHERE id = ?`).run(now, lastReadBy, now, id);
    db.bumpLastModified();

    return { key: row.key, plaintextValue };
  }
}
