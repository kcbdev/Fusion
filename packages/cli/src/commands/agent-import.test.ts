import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentStore } from "@fusion/core";
import { runAgentImport } from "./agent-import.js";

function makeAgentManifest(options: {
  name: string;
  title?: string;
  slug?: string;
  reportsTo?: string;
  skills?: string[];
  body?: string;
}): string {
  const lines = ["---", `name: ${options.name}`];
  if (options.title) {
    lines.push(`title: ${options.title}`);
  }
  if (options.slug) {
    lines.push(`slug: ${options.slug}`);
  }
  if (options.reportsTo) {
    lines.push(`reportsTo: ${options.reportsTo}`);
  }
  if (options.skills && options.skills.length > 0) {
    lines.push("skills:");
    for (const skill of options.skills) {
      lines.push(`  - ${skill}`);
    }
  }
  lines.push("---", options.body ?? `${options.name} instructions`);
  return lines.join("\n");
}

function createCompanyDirectory(basePath: string, agentName = "CEO"): string {
  mkdirSync(basePath, { recursive: true });
  writeFileSync(
    join(basePath, "COMPANY.md"),
    "---\nname: Example Company\nslug: example-company\n---\nCompany description",
  );

  const teamDir = join(basePath, "teams", "engineering");
  mkdirSync(teamDir, { recursive: true });
  writeFileSync(
    join(teamDir, "TEAM.md"),
    "---\nname: Engineering\nmanager: ../ceo/AGENTS.md\n---",
  );

  const agentDir = join(basePath, "agents", "ceo");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "AGENTS.md"),
    makeAgentManifest({
      name: agentName,
      title: "Chief Executive",
      skills: ["review"],
      body: "Lead the company",
    }),
  );

  return basePath;
}

function createHierarchyCompanyDirectory(basePath: string): string {
  mkdirSync(basePath, { recursive: true });
  writeFileSync(
    join(basePath, "COMPANY.md"),
    "---\nname: Example Company\nslug: example-company\n---\nCompany description",
  );

  mkdirSync(join(basePath, "agents", "ceo"), { recursive: true });
  writeFileSync(
    join(basePath, "agents", "ceo", "AGENTS.md"),
    makeAgentManifest({
      name: "CEO",
      slug: "ceo",
      title: "Chief Executive",
      body: "Lead the company",
    }),
  );

  mkdirSync(join(basePath, "agents", "vp-eng"), { recursive: true });
  writeFileSync(
    join(basePath, "agents", "vp-eng", "AGENTS.md"),
    makeAgentManifest({
      name: "VP Engineering",
      slug: "vp-eng",
      reportsTo: "ceo",
      body: "Lead engineering",
    }),
  );

  mkdirSync(join(basePath, "agents", "staff-eng"), { recursive: true });
  writeFileSync(
    join(basePath, "agents", "staff-eng", "AGENTS.md"),
    makeAgentManifest({
      name: "Staff Engineer",
      reportsTo: "../vp-eng/AGENTS.md",
      body: "Build systems",
    }),
  );

  return basePath;
}

describe("agent-import", () => {
  const tmpDir = join(tmpdir(), `fn-agent-import-test-${process.pid}`);
  let createAgentMock: ReturnType<typeof vi.fn>;
  let listAgentsMock: ReturnType<typeof vi.fn>;
  let initMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    createAgentMock = vi.fn().mockImplementation(async (input: any) => ({
      id: `agent-${String(input.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      ...input,
    }));
    listAgentsMock = vi.fn().mockResolvedValue([]);
    initMock = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(AgentStore.prototype, "init").mockImplementation(initMock);
    vi.spyOn(AgentStore.prototype, "listAgents").mockImplementation(listAgentsMock);
    vi.spyOn(AgentStore.prototype, "createAgent").mockImplementation(createAgentMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("reports error on invalid source path", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runAgentImport(join(tmpDir, "missing"))).rejects.toThrow("process.exit");

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Path not found"));

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("reports parse error on malformed AGENTS.md", async () => {
    const manifestPath = join(tmpDir, "AGENTS.md");
    writeFileSync(manifestPath, "name: missing frontmatter delimiters");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runAgentImport(manifestPath)).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Parse error"));

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("handles empty directory gracefully", async () => {
    const emptyDir = join(tmpDir, "empty-company");
    mkdirSync(emptyDir, { recursive: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runAgentImport(emptyDir);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No agents found"));
    logSpy.mockRestore();
  });

  it("imports agents from an Agent Companies directory", async () => {
    const companyDir = createCompanyDirectory(join(tmpDir, "company-dir"));

    await runAgentImport(companyDir);

    expect(createAgentMock).toHaveBeenCalledTimes(1);
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CEO", role: "custom", title: "Chief Executive" }),
    );
  });

  it("resolves imported manager hierarchy to created Fusion agent ids", async () => {
    const companyDir = createHierarchyCompanyDirectory(join(tmpDir, "company-hierarchy"));
    createAgentMock
      .mockResolvedValueOnce({ id: "agent-ceo", name: "CEO" })
      .mockResolvedValueOnce({ id: "agent-vp-eng", name: "VP Engineering" })
      .mockResolvedValueOnce({ id: "agent-staff-eng", name: "Staff Engineer" });

    await runAgentImport(companyDir);

    expect(createAgentMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: "CEO",
      role: "custom",
    }));
    expect(createAgentMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: "VP Engineering",
      role: "custom",
      reportsTo: "agent-ceo",
    }));
    expect(createAgentMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      name: "Staff Engineer",
      role: "custom",
      reportsTo: "agent-vp-eng",
    }));
  });

  it("resolves skipped existing managers before importing their reports", async () => {
    const companyDir = createHierarchyCompanyDirectory(join(tmpDir, "company-existing-manager"));
    listAgentsMock.mockResolvedValue([
      {
        id: "agent-ceo-existing",
        name: "CEO",
        role: "custom",
        metadata: { agentCompaniesSlug: "ceo" },
      },
    ]);

    await runAgentImport(companyDir, { skipExisting: true });

    expect(createAgentMock).toHaveBeenCalledTimes(2);
    expect(createAgentMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: "VP Engineering",
      reportsTo: "agent-ceo-existing",
    }));
    expect(createAgentMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: "Staff Engineer",
      reportsTo: "agent-vp-engineering",
    }));
  });

  it("imports agents from a single AGENTS.md file", async () => {
    const manifestPath = join(tmpDir, "AGENTS.md");
    writeFileSync(
      manifestPath,
      makeAgentManifest({
        name: "Solo Agent",
        title: "Single File Agent",
        skills: ["review"],
      }),
    );

    await runAgentImport(manifestPath);

    expect(createAgentMock).toHaveBeenCalledTimes(1);
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Solo Agent", role: "custom" }),
    );
  });

  it("imports agents from a .tar.gz archive", async () => {
    const companyDir = createCompanyDirectory(join(tmpDir, "company-archive-src"), "Archive CEO");
    const archivePath = join(tmpDir, "company.tar.gz");

    execSync(`tar czf ${JSON.stringify(archivePath)} -C ${JSON.stringify(companyDir)} .`);

    await runAgentImport(archivePath);

    expect(createAgentMock).toHaveBeenCalledTimes(1);
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Archive CEO", role: "custom" }),
    );
  });

  it("supports dry-run mode", async () => {
    const companyDir = createCompanyDirectory(join(tmpDir, "company-dry-run"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runAgentImport(companyDir, { dryRun: true });

    expect(createAgentMock).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.flat().join(" ");
    expect(output).toContain("[DRY RUN]");
    expect(output).toContain("Agents: 1");
    expect(output).toContain("Teams: 1");

    logSpy.mockRestore();
  });

  it("supports skip-existing", async () => {
    const companyDir = createCompanyDirectory(join(tmpDir, "company-skip"));
    listAgentsMock.mockResolvedValue([{ id: "agent-1", name: "CEO", role: "custom" }]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runAgentImport(companyDir, { skipExisting: true });

    expect(createAgentMock).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.flat().join(" ");
    expect(output).toContain("Skipped: 1");

    logSpy.mockRestore();
  });

  it("reports unsupported file formats", async () => {
    const unsupportedPath = join(tmpDir, "manifest.json");
    writeFileSync(unsupportedPath, JSON.stringify({ name: "Not a manifest" }));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runAgentImport(unsupportedPath)).rejects.toThrow("process.exit");

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unsupported format"));

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
