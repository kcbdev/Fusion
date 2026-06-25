import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CentralDatabase, createCentralDatabase, toJson, fromJson } from "../central-db.js";
import { DatabaseSync } from "../sqlite-adapter.js";

describe("CentralDatabase", () => {
  let tempDir: string;
  let db: CentralDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kb-central-test-"));
    db = createCentralDatabase(tempDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("initialization", () => {
    it("should create database at the specified path", () => {
      db.init();
      const dbPath = db.getPath();
      expect(dbPath).toBe(join(tempDir, "fusion-central.db"));
      // Verify file exists
      const stats = statSync(dbPath);
      expect(stats.isFile()).toBe(true);
    });

    it("should create the global directory if it doesn't exist", () => {
      const newTempDir = join(tmpdir(), `kb-central-test-${Date.now()}`);
      const newDb = createCentralDatabase(newTempDir);
      newDb.init();
      expect(statSync(newTempDir).isDirectory()).toBe(true);
      newDb.close();
      rmSync(newTempDir, { recursive: true, force: true });
    });

    it("should initialize schema version", () => {
      db.init();
      expect(db.getSchemaVersion()).toBe(13);
    });

    it("should use DELETE (rollback-journal) mode and busy_timeout, not WAL", () => {
      db.init();

      const journalMode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      const busyTimeout = db.prepare("PRAGMA busy_timeout").get() as Record<string, number>;

      // Regression: the central DB must NOT run in WAL mode. WAL coordinates the
      // many concurrent fusion processes through a memory-mapped `-shm` wal-index,
      // which on macOS/APFS SIGBUSes a reader (walIndexReadHdr / `cluster_pagein
      // past EOF`) when another process resizes it mid-checkpoint — observed 3×
      // in 3 days (Jun 22–24 2026). DELETE mode removes the `-shm` mmap surface.
      expect(journalMode.journal_mode).toBe("delete");
      expect(Object.values(busyTimeout)[0]).toBe(5000);
    });

    it("should never create a `-shm` wal-index file (the SIGBUS surface)", () => {
      db.init();
      // Drive real write traffic; under WAL this materializes `-shm` + `-wal`.
      db.bumpLastModified();
      db.prepare("SELECT * FROM globalConcurrency WHERE id = 1").get();

      const dbPath = db.getPath();
      // The wal-index shared-memory file is the exact thing that was memmap'd
      // and faulted. Its absence proves the crashing surface is gone.
      expect(existsSync(`${dbPath}-shm`)).toBe(false);
      expect(existsSync(`${dbPath}-wal`)).toBe(false);

      const synchronous = db.prepare("PRAGMA synchronous").get() as { synchronous: number };
      expect(synchronous.synchronous).toBe(2); // FULL — durability posture preserved
    });

    it("warns (does not throw) when a WAL holder blocks the DELETE migration", () => {
      // Migration-path regression: during a rolling upgrade an old-version process
      // can still hold the central DB open in WAL mode. WAL→DELETE needs an exclusive
      // lock it cannot get, so SQLite keeps WAL and the PRAGMA *returns* "wal" instead
      // of throwing. The new connection must surface that loudly rather than silently
      // run with the SIGBUS `-shm` surface still present.
      const dbFile = join(tempDir, "fusion-central.db");
      const walHolder = new DatabaseSync(dbFile);
      walHolder.exec("PRAGMA journal_mode = WAL");
      walHolder.exec("CREATE TABLE IF NOT EXISTS lock_probe (id INTEGER PRIMARY KEY)");
      walHolder.exec("INSERT INTO lock_probe (id) VALUES (1)");
      // Hold an open read transaction so the switch cannot checkpoint/truncate the WAL.
      walHolder.exec("BEGIN");
      walHolder.prepare("SELECT * FROM lock_probe").all();

      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };

      let blocked: CentralDatabase | undefined;
      try {
        // busyTimeoutMs:0 → the failed switch returns immediately instead of waiting.
        expect(() => {
          blocked = new CentralDatabase(tempDir, { busyTimeoutMs: 0 });
        }).not.toThrow();

        const mode = blocked!.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
        // The switch failed: this connection is still WAL (documents the known gap)…
        expect(mode.journal_mode).toBe("wal");
        // …and the failure was surfaced, not swallowed.
        expect(
          warnings.some((w) => /journal_mode=DELETE did not take effect/.test(w)),
        ).toBe(true);
      } finally {
        console.warn = originalWarn;
        blocked?.close();
        walHolder.exec("ROLLBACK");
        walHolder.close();
      }
    });

    it("should seed lastModified on init", () => {
      db.init();
      const lastModified = db.getLastModified();
      expect(lastModified).toBeGreaterThan(0);
    });

    it("should seed globalConcurrency default row", () => {
      db.init();
      const row = db.prepare("SELECT * FROM globalConcurrency WHERE id = 1").get() as {
        id: number;
        globalMaxConcurrent: number;
        currentlyActive: number;
        queuedCount: number;
      } | undefined;
      expect(row).toBeDefined();
      expect(row?.globalMaxConcurrent).toBe(4);
      expect(row?.currentlyActive).toBe(0);
      expect(row?.queuedCount).toBe(0);
    });

    it("should apply nodes defaults when optional values are omitted", () => {
      db.init();
      const now = new Date().toISOString();

      db.prepare(
        "INSERT INTO nodes (id, name, type, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      ).run("node_test", "local-test", "local", now, now);

      const row = db.prepare("SELECT status, maxConcurrent FROM nodes WHERE id = ?").get("node_test") as
        | {
            status: string;
            maxConcurrent: number;
          }
        | undefined;

      expect(row).toBeDefined();
      expect(row?.status).toBe("offline");
      expect(row?.maxConcurrent).toBe(2);
    });

    it("should create all required tables", () => {
      db.init();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("projects");
      expect(tableNames).toContain("projectHealth");
      expect(tableNames).toContain("centralActivityLog");
      expect(tableNames).toContain("globalConcurrency");
      expect(tableNames).toContain("nodes");
      expect(tableNames).toContain("peerNodes");
      expect(tableNames).toContain("projectNodePathMappings");
      expect(tableNames).toContain("meshSharedSnapshots");
      expect(tableNames).toContain("meshWriteQueue");
      expect(tableNames).toContain("__meta");
    });

    it("should include nodeId column on projects table", () => {
      db.init();

      const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{
        name: string;
      }>;
      const columnNames = columns.map((column) => column.name);
      expect(columnNames).toContain("nodeId");
    });

    it("should include systemMetrics and knownPeers columns on nodes table", () => {
      db.init();

      const columns = db.prepare("PRAGMA table_info(nodes)").all() as Array<{
        name: string;
      }>;
      const columnNames = columns.map((column) => column.name);
      expect(columnNames).toContain("systemMetrics");
      expect(columnNames).toContain("knownPeers");
    });

    it("should include versionInfo, pluginVersions, and dockerConfig columns on nodes table", () => {
      db.init();

      const columns = db.prepare("PRAGMA table_info(nodes)").all() as Array<{
        name: string;
      }>;
      const columnNames = columns.map((column) => column.name);
      expect(columnNames).toContain("versionInfo");
      expect(columnNames).toContain("pluginVersions");
      expect(columnNames).toContain("dockerConfig");
    });

    it("should create peerNodes table with expected columns", () => {
      db.init();

      const columns = db.prepare("PRAGMA table_info(peerNodes)").all() as Array<{
        name: string;
      }>;
      const columnNames = columns.map((column) => column.name);

      expect(columnNames).toEqual(
        expect.arrayContaining([
          "id",
          "nodeId",
          "peerNodeId",
          "name",
          "url",
          "status",
          "lastSeen",
          "connectedAt",
        ]),
      );
    });

    it("should create required indexes", () => {
      db.init();
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idxProjectsPath");
      expect(indexNames).toContain("idxProjectsStatus");
      expect(indexNames).toContain("idxActivityLogTimestamp");
      expect(indexNames).toContain("idxActivityLogType");
      expect(indexNames).toContain("idxActivityLogProjectId");
      expect(indexNames).toContain("idxNodesStatus");
      expect(indexNames).toContain("idxNodesType");
      expect(indexNames).toContain("idxPeerNodesNodeId");
      expect(indexNames).toContain("idxProjectNodePathMappingsProjectId");
      expect(indexNames).toContain("idxProjectNodePathMappingsNodeId");
    });
  });

  describe("schema migrations", () => {
    it("should migrate from v2 to v3 with mesh node columns and peer table", () => {
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active',
          isolationMode TEXT NOT NULL DEFAULT 'in-process',
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          lastActivityAt TEXT,
          nodeId TEXT,
          settings TEXT
        );

        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK (type IN ('local', 'remote')),
          url TEXT,
          apiKey TEXT,
          status TEXT NOT NULL DEFAULT 'offline',
          capabilities TEXT,
          maxConcurrent INTEGER NOT NULL DEFAULT 2,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS __meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      db.prepare("INSERT INTO __meta (key, value) VALUES ('schemaVersion', '2')").run();
      db.prepare("INSERT INTO __meta (key, value) VALUES ('lastModified', ?)").run(String(Date.now()));
      db.prepare(
        "INSERT INTO nodes (id, name, type, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      ).run("node_legacy", "legacy", "local", now, now);

      db.init();

      expect(db.getSchemaVersion()).toBe(13);

      const nodeColumns = db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>;
      const nodeColumnNames = nodeColumns.map((column) => column.name);
      expect(nodeColumnNames).toContain("systemMetrics");
      expect(nodeColumnNames).toContain("knownPeers");

      const peerTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='peerNodes'")
        .get() as { name: string } | undefined;
      expect(peerTable?.name).toBe("peerNodes");

      const peerIndexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='peerNodes'")
        .all() as Array<{ name: string }>;
      expect(peerIndexes.map((index) => index.name)).toContain("idxPeerNodesNodeId");
    });

    it("should migrate from v3 to v4 with version tracking columns", () => {
      const now = new Date().toISOString();

      // Create v3 schema manually
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active',
          isolationMode TEXT NOT NULL DEFAULT 'in-process',
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          lastActivityAt TEXT,
          nodeId TEXT,
          settings TEXT
        );

        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK (type IN ('local', 'remote')),
          url TEXT,
          apiKey TEXT,
          status TEXT NOT NULL DEFAULT 'offline',
          capabilities TEXT,
          systemMetrics TEXT,
          knownPeers TEXT,
          maxConcurrent INTEGER NOT NULL DEFAULT 2,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS __meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      db.prepare("INSERT INTO __meta (key, value) VALUES ('schemaVersion', '3')").run();
      db.prepare("INSERT INTO __meta (key, value) VALUES ('lastModified', ?)").run(String(Date.now()));
      db.prepare(
        "INSERT INTO nodes (id, name, type, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      ).run("node_v3", "v3-node", "local", now, now);

      db.init();

      expect(db.getSchemaVersion()).toBe(13);

      const nodeColumns = db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>;
      const nodeColumnNames = nodeColumns.map((column) => column.name);
      expect(nodeColumnNames).toContain("versionInfo");
      expect(nodeColumnNames).toContain("pluginVersions");

      // Verify nullable columns - can insert node without them
      const row = db.prepare("SELECT versionInfo, pluginVersions FROM nodes WHERE id = ?").get("node_v3") as {
        versionInfo: string | null;
        pluginVersions: string | null;
      } | undefined;
      expect(row).toBeDefined();
      expect(row?.versionInfo).toBeNull();
      expect(row?.pluginVersions).toBeNull();
    });

    it("should migrate from v5 to v7 with managed Docker node schema and node docker config column", () => {
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active',
          isolationMode TEXT NOT NULL DEFAULT 'in-process',
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          lastActivityAt TEXT,
          nodeId TEXT,
          settings TEXT
        );

        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK (type IN ('local', 'remote')),
          url TEXT,
          apiKey TEXT,
          status TEXT NOT NULL DEFAULT 'offline',
          capabilities TEXT,
          systemMetrics TEXT,
          knownPeers TEXT,
          versionInfo TEXT,
          pluginVersions TEXT,
          maxConcurrent INTEGER NOT NULL DEFAULT 2,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS peerNodes (
          id TEXT PRIMARY KEY,
          nodeId TEXT NOT NULL,
          peerNodeId TEXT NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unknown',
          lastSeen TEXT NOT NULL,
          connectedAt TEXT NOT NULL,
          UNIQUE(nodeId, peerNodeId),
          FOREIGN KEY (nodeId) REFERENCES nodes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settingsSyncState (
          nodeId TEXT NOT NULL,
          remoteNodeId TEXT NOT NULL,
          lastSyncedAt TEXT,
          localChecksum TEXT,
          remoteChecksum TEXT,
          syncCount INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          PRIMARY KEY (nodeId, remoteNodeId),
          FOREIGN KEY (nodeId) REFERENCES nodes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS __meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      db.prepare("INSERT INTO __meta (key, value) VALUES ('schemaVersion', '5')").run();
      db.prepare("INSERT INTO __meta (key, value) VALUES ('lastModified', ?)").run(String(Date.now()));

      db.init();

      expect(db.getSchemaVersion()).toBe(13);

      const nodeColumns = db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>;
      expect(nodeColumns.map((column) => column.name)).toContain("dockerConfig");

      const columns = db.prepare("PRAGMA table_info(managedDockerNodes)").all() as Array<{ name: string }>;
      const columnNames = columns.map((column) => column.name);
      expect(columnNames).toEqual(
        expect.arrayContaining([
          "id",
          "nodeId",
          "name",
          "imageName",
          "imageTag",
          "containerId",
          "status",
          "hostConfig",
          "envVars",
          "volumeMounts",
          "resourceSizing",
          "extraClis",
          "persistentStorage",
          "reachableUrl",
          "apiKey",
          "errorMessage",
          "createdAt",
          "updatedAt",
        ]),
      );

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='managedDockerNodes'")
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map((index) => index.name);
      expect(indexNames).toContain("idxManagedDockerNodesStatus");
      expect(indexNames).toContain("idxManagedDockerNodesNodeId");

      db.prepare(
        "INSERT INTO managedDockerNodes (id, name, imageName, imageTag, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("dn_test_defaults", "docker-defaults", "runfusion/fusion", "latest", now, now);

      const row = db.prepare(
        "SELECT status, hostConfig, envVars, volumeMounts, resourceSizing, extraClis FROM managedDockerNodes WHERE id = ?",
      ).get("dn_test_defaults") as
        | {
            status: string;
            hostConfig: string;
            envVars: string;
            volumeMounts: string;
            resourceSizing: string;
            extraClis: string;
          }
        | undefined;

      expect(row).toBeDefined();
      expect(row?.status).toBe("creating");
      expect(fromJson(row?.hostConfig, {})).toEqual({});
      expect(fromJson(row?.envVars, {})).toEqual({});
      expect(fromJson(row?.volumeMounts, [])).toEqual([]);
      expect(fromJson(row?.resourceSizing, {})).toEqual({});
      expect(fromJson(row?.extraClis, [])).toEqual([]);

      db.prepare(
        "INSERT INTO nodes (id, name, type, dockerConfig, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        "node_docker_config",
        "docker-config-node",
        "remote",
        JSON.stringify({ image: "runfusion/fusion:latest", volumeMounts: [], environment: {}, configVersion: 1 }),
        now,
        now,
      );

      const insertedNode = db.prepare("SELECT dockerConfig FROM nodes WHERE id = ?").get("node_docker_config") as {
        dockerConfig: string | null;
      } | undefined;
      expect(insertedNode?.dockerConfig).toBeTruthy();
    });

    it("should migrate from v7 to v8 and backfill local node path mappings from projects.path", () => {
      const now = new Date().toISOString();

      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active',
          isolationMode TEXT NOT NULL DEFAULT 'in-process',
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          lastActivityAt TEXT,
          nodeId TEXT,
          settings TEXT
        );

        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK (type IN ('local', 'remote')),
          url TEXT,
          apiKey TEXT,
          status TEXT NOT NULL DEFAULT 'offline',
          capabilities TEXT,
          systemMetrics TEXT,
          knownPeers TEXT,
          versionInfo TEXT,
          pluginVersions TEXT,
          dockerConfig TEXT,
          maxConcurrent INTEGER NOT NULL DEFAULT 2,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS __meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      db.prepare("INSERT INTO nodes (id, name, type, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run(
        "node_local",
        "local",
        "local",
        now,
        now,
      );
      db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "proj_1",
        "Project One",
        "/tmp/proj-1",
        "active",
        "in-process",
        now,
        now,
      );
      db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "proj_2",
        "Project Two",
        "/tmp/proj-2",
        "active",
        "in-process",
        now,
        now,
      );
      db.prepare("INSERT INTO __meta (key, value) VALUES ('schemaVersion', '7')").run();
      db.prepare("INSERT INTO __meta (key, value) VALUES ('lastModified', ?)").run(String(Date.now()));

      db.init();

      expect(db.getSchemaVersion()).toBe(13);

      const mappings = db
        .prepare("SELECT projectId, nodeId, path FROM projectNodePathMappings ORDER BY projectId")
        .all() as Array<{ projectId: string; nodeId: string; path: string }>;

      expect(mappings).toEqual([
        { projectId: "proj_1", nodeId: "node_local", path: "/tmp/proj-1" },
        { projectId: "proj_2", nodeId: "node_local", path: "/tmp/proj-2" },
      ]);
    });

    it("should migrate from v9 to v10 with mesh outage tables", () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS __meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS plugin_installs (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, path TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS project_plugin_states (projectPath TEXT NOT NULL, pluginId TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'installed', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, PRIMARY KEY (projectPath, pluginId));
      `);
      db.prepare("INSERT INTO __meta (key, value) VALUES ('schemaVersion', '9')").run();
      db.prepare("INSERT INTO __meta (key, value) VALUES ('lastModified', ?)").run(String(Date.now()));

      db.init();

      expect(db.getSchemaVersion()).toBe(13);

      const snapshotCols = db.prepare("PRAGMA table_info(meshSharedSnapshots)").all() as Array<{ name: string }>;
      expect(snapshotCols.map((c) => c.name)).toEqual(
        expect.arrayContaining(["nodeId", "projectId", "scope", "payload", "snapshotVersion", "capturedAt", "sourceNodeId", "sourceRunId", "staleAfter", "updatedAt"]),
      );

      const queueCols = db.prepare("PRAGMA table_info(meshWriteQueue)").all() as Array<{ name: string }>;
      expect(queueCols.map((c) => c.name)).toEqual(
        expect.arrayContaining(["id", "originNodeId", "targetNodeId", "projectId", "scope", "entityType", "entityId", "operation", "payload", "intentVersion", "status", "attemptCount", "lastAttemptAt", "lastError", "createdAt", "updatedAt", "appliedAt"]),
      );
    });
  });

  describe("transactions", () => {
    beforeEach(() => {
      db.init();
    });

    it("should support basic transactions", () => {
      db.transaction(() => {
        db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
          "proj_1",
          "Test Project",
          "/test/path",
          "active",
          "in-process",
          new Date().toISOString(),
          new Date().toISOString()
        );
      });

      const row = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj_1") as { id: string; name: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.name).toBe("Test Project");
    });

    it("should rollback on error", () => {
      expect(() => {
        db.transaction(() => {
          db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
            "proj_2",
            "Test Project",
            "/test/path",
            "active",
            "in-process",
            new Date().toISOString(),
            new Date().toISOString()
          );
          throw new Error("Intentional error");
        });
      }).toThrow("Intentional error");

      const row = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj_2") as { id: string } | undefined;
      expect(row).toBeUndefined();
    });

    it("should support nested transactions via savepoints", () => {
      db.transaction(() => {
        db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
          "proj_outer",
          "Outer Project",
          "/outer/path",
          "active",
          "in-process",
          new Date().toISOString(),
          new Date().toISOString()
        );

        db.transaction(() => {
          db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
            "proj_inner",
            "Inner Project",
            "/inner/path",
            "active",
            "in-process",
            new Date().toISOString(),
            new Date().toISOString()
          );
        });
      });

      const outerRow = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj_outer") as { id: string } | undefined;
      const innerRow = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj_inner") as { id: string } | undefined;
      expect(outerRow).toBeDefined();
      expect(innerRow).toBeDefined();
    });

    it("should rollback nested transaction without affecting outer", () => {
      db.transaction(() => {
        db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
          "proj_outer_2",
          "Outer Project",
          "/outer/path",
          "active",
          "in-process",
          new Date().toISOString(),
          new Date().toISOString()
        );

        // Inner transaction throws but is caught
        try {
          db.transaction(() => {
            db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
              "proj_inner_2",
              "Inner Project",
              "/inner/path",
              "active",
              "in-process",
              new Date().toISOString(),
              new Date().toISOString()
            );
            throw new Error("Inner error");
          });
        } catch {
          // Ignore inner error
        }
      });

      const outerRow = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj_outer_2") as { id: string } | undefined;
      const innerRow = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj_inner_2") as { id: string } | undefined;
      expect(outerRow).toBeDefined();
      expect(innerRow).toBeUndefined();
    });
  });

  describe("lastModified tracking", () => {
    beforeEach(() => {
      db.init();
    });

    it("should bump lastModified", () => {
      const before = db.getLastModified();
      // Small delay to ensure different timestamp
      const start = Date.now();
      while (Date.now() < start + 2) { /* spin */ }
      
      db.bumpLastModified();
      const after = db.getLastModified();
      expect(after).toBeGreaterThan(before);
    });

    it("should guarantee monotonic increase", () => {
      db.bumpLastModified();
      const first = db.getLastModified();
      db.bumpLastModified();
      const second = db.getLastModified();
      expect(second).toBeGreaterThan(first);
    });
  });

  describe("foreign key constraints", () => {
    beforeEach(() => {
      db.init();
    });

    it("should enforce foreign key constraints", () => {
      // Try to insert health record for non-existent project
      expect(() => {
        db.prepare("INSERT INTO projectHealth (projectId, status, updatedAt) VALUES (?, ?, ?)").run(
          "nonexistent",
          "active",
          new Date().toISOString()
        );
      }).toThrow();
    });

    it("should cascade delete project health on project deletion", () => {
      const now = new Date().toISOString();
      
      db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "proj_cascade",
        "Cascade Test",
        "/cascade/path",
        "active",
        "in-process",
        now,
        now
      );

      db.prepare("INSERT INTO projectHealth (projectId, status, updatedAt) VALUES (?, ?, ?)").run(
        "proj_cascade",
        "active",
        now
      );

      // Verify health record exists
      const healthBefore = db.prepare("SELECT * FROM projectHealth WHERE projectId = ?").get("proj_cascade") as { projectId: string } | undefined;
      expect(healthBefore).toBeDefined();

      // Delete project
      db.prepare("DELETE FROM projects WHERE id = ?").run("proj_cascade");

      // Health record should be gone (cascade delete)
      const healthAfter = db.prepare("SELECT * FROM projectHealth WHERE projectId = ?").get("proj_cascade") as { projectId: string } | undefined;
      expect(healthAfter).toBeUndefined();
    });

    it("should cascade delete activity log entries on project deletion", () => {
      const now = new Date().toISOString();
      
      db.prepare("INSERT INTO projects (id, name, path, status, isolationMode, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "proj_activity",
        "Activity Test",
        "/activity/path",
        "active",
        "in-process",
        now,
        now
      );

      db.prepare("INSERT INTO centralActivityLog (id, timestamp, type, projectId, projectName, details) VALUES (?, ?, ?, ?, ?, ?)").run(
        "log_1",
        now,
        "task:created",
        "proj_activity",
        "Activity Test",
        "Test activity"
      );

      // Verify log entry exists
      const logBefore = db.prepare("SELECT * FROM centralActivityLog WHERE id = ?").get("log_1") as { id: string } | undefined;
      expect(logBefore).toBeDefined();

      // Delete project
      db.prepare("DELETE FROM projects WHERE id = ?").run("proj_activity");

      // Log entry should be gone (cascade delete)
      const logAfter = db.prepare("SELECT * FROM centralActivityLog WHERE id = ?").get("log_1") as { id: string } | undefined;
      expect(logAfter).toBeUndefined();
    });
  });

  describe("JSON helpers", () => {
    it("should stringify arrays for JSON columns", () => {
      const arr = ["a", "b", "c"];
      expect(toJson(arr)).toBe('["a","b","c"]');
    });

    it("should return '[]' for null/undefined", () => {
      expect(toJson(null)).toBe("[]");
      expect(toJson(undefined)).toBe("[]");
    });

    it("should parse JSON columns correctly", () => {
      const json = '{"key": "value", "num": 42}';
      const parsed = fromJson<{ key: string; num: number }>(json);
      expect(parsed).toEqual({ key: "value", num: 42 });
    });

    it("should return undefined for null/empty JSON", () => {
      expect(fromJson(null)).toBeUndefined();
      expect(fromJson(undefined)).toBeUndefined();
      expect(fromJson("")).toBeUndefined();
    });

    it("should return undefined for invalid JSON", () => {
      expect(fromJson("not valid json")).toBeUndefined();
    });
  });
});
