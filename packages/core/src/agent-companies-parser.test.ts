import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AgentCompaniesParseError,
  agentManifestToAgentCreateInput,
  convertAgentCompanies,
  parseAgentManifest,
  parseCompanyArchive,
  parseCompanyDirectory,
  parseCompanyManifest,
  parseProjectManifest,
  parseSkillManifest,
  parseTaskManifest,
  parseTeamManifest,
  parseYamlFrontmatter,
} from "./agent-companies-parser.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-companies-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("agent-companies-parser", () => {
  describe("parseYamlFrontmatter", () => {
    it("parses YAML frontmatter with markdown body", () => {
      const content = `---
name: CEO
skills:
  - review
---
You are the CEO agent.`;

      const { frontmatter, body } = parseYamlFrontmatter(content);

      expect(frontmatter.name).toBe("CEO");
      expect(frontmatter.skills).toEqual(["review"]);
      expect(body).toBe("You are the CEO agent.");
    });

    it("parses frontmatter with no body", () => {
      const content = `---
name: Lean Dev Shop
---`;
      const { frontmatter, body } = parseYamlFrontmatter(content);

      expect(frontmatter.name).toBe("Lean Dev Shop");
      expect(body).toBe("");
    });

    it("throws on missing frontmatter delimiters", () => {
      expect(() => parseYamlFrontmatter("name: no delimiters")).toThrow(
        AgentCompaniesParseError,
      );
      expect(() => parseYamlFrontmatter("name: no delimiters")).toThrow(
        "Missing YAML frontmatter delimiters",
      );
    });

    it("throws on malformed YAML", () => {
      const malformed = `---
name: CEO
skills: [review
---
body`;
      expect(() => parseYamlFrontmatter(malformed)).toThrow(AgentCompaniesParseError);
      expect(() => parseYamlFrontmatter(malformed)).toThrow("Malformed YAML frontmatter");
    });

    it("throws when YAML parses to null", () => {
      const content = `---
null
---`;
      expect(() => parseYamlFrontmatter(content)).toThrow("must parse to an object");
    });

    it("throws when YAML parses to an array", () => {
      const content = `---
- one
- two
---`;
      expect(() => parseYamlFrontmatter(content)).toThrow("must parse to an object");
    });

    it("handles multiline frontmatter fields", () => {
      const content = `---
name: CEO
description: |
  Leads strategy
  Reviews direction
---
Body`;
      const { frontmatter } = parseYamlFrontmatter(content);

      expect(String(frontmatter.description)).toContain("Leads strategy");
      expect(String(frontmatter.description)).toContain("Reviews direction");
    });

    it("handles array fields in frontmatter", () => {
      const content = `---
name: Reviewer
skills:
  - review
  - security-review
---
Body`;
      const { frontmatter } = parseYamlFrontmatter(content);

      expect(frontmatter.skills).toEqual(["review", "security-review"]);
    });
  });

  describe("individual manifest parsing", () => {
    it("parses AGENTS.md with full frontmatter and body", () => {
      const content = `---
name: CEO
title: Chief Executive Officer
reportsTo: null
skills:
  - plan-ceo-review
  - review
---
You are the CEO agent. Your job is to lead.`;

      const manifest = parseAgentManifest(content);

      expect(manifest.name).toBe("CEO");
      expect(manifest.title).toBe("Chief Executive Officer");
      expect(manifest.reportsTo).toBeNull();
      expect(manifest.skills).toEqual(["plan-ceo-review", "review"]);
      expect(manifest.instructionBody).toContain("You are the CEO agent");
    });

    it("parses AGENTS.md with minimal fields", () => {
      const manifest = parseAgentManifest(`---
name: Minimal Agent
---`);
      expect(manifest.name).toBe("Minimal Agent");
      expect(manifest.instructionBody).toBe("");
    });

    it("parses COMPANY.md with schema and slug", () => {
      const manifest = parseCompanyManifest(`---
name: Lean Dev Shop
description: Small engineering-focused AI company
slug: lean-dev-shop
schema: agentcompanies/v1
---`);

      expect(manifest.schema).toBe("agentcompanies/v1");
      expect(manifest.slug).toBe("lean-dev-shop");
    });

    it("parses TEAM.md with manager and includes", () => {
      const manifest = parseTeamManifest(`---
name: Engineering
manager: ../cto/AGENTS.md
includes:
  - ../platform-lead/AGENTS.md
  - ../../skills/review/SKILL.md
---`);

      expect(manifest.manager).toBe("../cto/AGENTS.md");
      expect(manifest.includes).toEqual([
        "../platform-lead/AGENTS.md",
        "../../skills/review/SKILL.md",
      ]);
    });

    it("parses PROJECT.md", () => {
      const manifest = parseProjectManifest(`---
name: Q2 Launch
description: Launch execution project
slug: q2-launch
---`);

      expect(manifest.name).toBe("Q2 Launch");
      expect(manifest.slug).toBe("q2-launch");
    });

    it("parses TASK.md with assignee, project, and schedule", () => {
      const manifest = parseTaskManifest(`---
name: Monday Review
slug: monday-review
description: Weekly code review
assignee: ./agents/ceo/AGENTS.md
project: ./projects/q2-launch/PROJECT.md
schedule:
  timezone: America/New_York
  startsAt: "2025-01-06T09:00:00"
---`);

      expect(manifest.assignee).toBe("./agents/ceo/AGENTS.md");
      expect(manifest.project).toBe("./projects/q2-launch/PROJECT.md");
      expect(manifest.schedule).toEqual({
        timezone: "America/New_York",
        startsAt: "2025-01-06T09:00:00",
      });
    });

    it("parses SKILL.md with provides and requirements", () => {
      const manifest = parseSkillManifest(`---
name: Code Review
provides:
  - code-review
requirements:
  - typescript
---`);

      expect(manifest.provides).toEqual(["code-review"]);
      expect(manifest.requirements).toEqual(["typescript"]);
    });

    it("throws on missing required name field", () => {
      const invalid = `---
description: Missing required field
---`;
      expect(() => parseTeamManifest(invalid)).toThrow(AgentCompaniesParseError);
      expect(() => parseTeamManifest(invalid)).toThrow("team manifest is missing required field: name");
    });
  });

  describe("parseCompanyDirectory", () => {
    it("parses a full directory structure", () => {
      const root = createTempDir();

      writeTextFile(
        join(root, "COMPANY.md"),
        `---
name: Lean Dev Shop
description: Small engineering-focused AI company
schema: agentcompanies/v1
---`,
      );
      writeTextFile(
        join(root, "agents", "ceo", "AGENTS.md"),
        `---
name: CEO
title: Chief Executive Officer
skills:
  - review
---
You are the CEO agent.`,
      );
      writeTextFile(
        join(root, "teams", "engineering", "TEAM.md"),
        `---
name: Engineering
manager: ../cto/AGENTS.md
---`,
      );
      writeTextFile(
        join(root, "tasks", "review", "TASK.md"),
        `---
name: Monday Review
assignee: ./agents/ceo/AGENTS.md
---`,
      );
      writeTextFile(
        join(root, "skills", "code-review", "SKILL.md"),
        `---
name: Code Review
provides:
  - code-review
---`,
      );

      const pkg = parseCompanyDirectory(root);

      expect(pkg.company?.name).toBe("Lean Dev Shop");
      expect(pkg.agents).toHaveLength(1);
      expect(pkg.teams).toHaveLength(1);
      expect(pkg.tasks).toHaveLength(1);
      expect(pkg.skills).toHaveLength(1);
      expect(pkg.projects).toHaveLength(0);
    });

    it("handles directory with only agents and no COMPANY.md", () => {
      const root = createTempDir();
      writeTextFile(
        join(root, "agents", "ceo", "AGENTS.md"),
        `---
name: CEO
---`,
      );

      const pkg = parseCompanyDirectory(root);
      expect(pkg.company).toBeUndefined();
      expect(pkg.agents).toHaveLength(1);
    });

    it("handles empty directory", () => {
      const root = createTempDir();
      const pkg = parseCompanyDirectory(root);

      expect(pkg).toEqual({
        company: undefined,
        agents: [],
        teams: [],
        projects: [],
        tasks: [],
        skills: [],
      });
    });

    it("throws on non-existent directory", () => {
      const root = createTempDir();
      const missingPath = join(root, "missing");
      expect(() => parseCompanyDirectory(missingPath)).toThrow("does not exist");
    });

    it("throws when path is not a directory", () => {
      const root = createTempDir();
      const filePath = join(root, "not-a-directory.md");
      writeTextFile(filePath, "hello");

      expect(() => parseCompanyDirectory(filePath)).toThrow("is not a directory");
    });

    it("ignores non-directory entries in section folders", () => {
      const root = createTempDir();
      writeTextFile(join(root, "agents", "README.md"), "not a manifest folder");
      writeTextFile(join(root, "agents", "ceo", "AGENTS.md"), `---
name: CEO
---`);

      const pkg = parseCompanyDirectory(root);
      expect(pkg.agents).toHaveLength(1);
      expect(pkg.agents[0].name).toBe("CEO");
    });

    it("includes file path context in parse errors", () => {
      const root = createTempDir();
      writeTextFile(join(root, "agents", "ceo", "AGENTS.md"), `---
description: missing name
---`);

      expect(() => parseCompanyDirectory(root)).toThrow("AGENTS.md");
      expect(() => parseCompanyDirectory(root)).toThrow("missing required field: name");
    });
  });

  describe("parseCompanyArchive", () => {
    it("throws a clear error for zip archives", async () => {
      const zipPath = join(createTempDir(), "company.zip");
      await expect(parseCompanyArchive(zipPath)).rejects.toThrow(
        "Zip archives are not yet supported",
      );
    });

    it("parses a tar.gz archive", async () => {
      const temp = createTempDir();
      const packageDirName = "company-package";
      const packageDir = join(temp, packageDirName);

      writeTextFile(
        join(packageDir, "COMPANY.md"),
        `---
name: Lean Dev Shop
schema: agentcompanies/v1
---`,
      );
      writeTextFile(
        join(packageDir, "agents", "ceo", "AGENTS.md"),
        `---
name: CEO
skills:
  - review
---
You are the CEO agent.`,
      );

      const archivePath = join(temp, "company.tgz");
      execSync(
        `tar czf ${JSON.stringify(archivePath)} -C ${JSON.stringify(temp)} ${JSON.stringify(packageDirName)}`,
      );

      const pkg = await parseCompanyArchive(archivePath);
      expect(pkg.company?.name).toBe("Lean Dev Shop");
      expect(pkg.agents).toHaveLength(1);
    });

    it("handles archive with a single file entry", async () => {
      const temp = createTempDir();
      writeTextFile(join(temp, "README.md"), "hello");

      const archivePath = join(temp, "single-file.tgz");
      execSync(
        `tar czf ${JSON.stringify(archivePath)} -C ${JSON.stringify(temp)} README.md`,
      );

      const pkg = await parseCompanyArchive(archivePath);
      expect(pkg.company).toBeUndefined();
      expect(pkg.agents).toEqual([]);
      expect(pkg.teams).toEqual([]);
      expect(pkg.projects).toEqual([]);
      expect(pkg.tasks).toEqual([]);
      expect(pkg.skills).toEqual([]);
    });
  });

  describe("conversion", () => {
    it("converts AgentManifest to AgentCreateInput", () => {
      const input = agentManifestToAgentCreateInput({
        name: "CEO",
        title: "Chief Executive Officer",
        instructionBody: "Lead the company",
        skills: ["review"],
        reportsTo: "../founder/AGENTS.md",
      });

      expect(input.name).toBe("CEO");
      expect(input.title).toBe("Chief Executive Officer");
      expect(input.instructionsText).toBe("Lead the company");
      expect(input.metadata).toEqual({ skills: ["review"] });
      expect(input.reportsTo).toBe("../founder/AGENTS.md");
      expect(input.role).toBe("reviewer");
    });

    it("defaults to custom role when no skills are provided", () => {
      const input = agentManifestToAgentCreateInput({
        name: "Unknown",
      });

      expect(input.role).toBe("custom");
    });

    it("infers role from reportsTo when skills are absent", () => {
      const input = agentManifestToAgentCreateInput({
        name: "Planner",
        reportsTo: "../triage-lead/AGENTS.md",
      });

      expect(input.role).toBe("triage");
      expect(input.reportsTo).toBe("../triage-lead/AGENTS.md");
    });

    it("prefers skills over reportsTo for role inference", () => {
      const input = agentManifestToAgentCreateInput({
        name: "Mixed",
        skills: ["review"],
        reportsTo: "../executor-lead/AGENTS.md",
      });

      expect(input.role).toBe("reviewer");
    });

    it("infers role from skills containing role hints", () => {
      const input = agentManifestToAgentCreateInput({
        name: "Triager",
        skills: ["plan-triage-review"],
      });

      expect(input.role).toBe("triage");
    });

    it("maps instructionBody to instructionsText", () => {
      const input = agentManifestToAgentCreateInput({
        name: "Writer",
        instructionBody: "Write docs",
      });

      expect(input.instructionsText).toBe("Write docs");
    });

    it("converts package agents with skipExisting logic", () => {
      const { inputs, result } = convertAgentCompanies(
        {
          company: { name: "Lean Dev Shop" },
          agents: [
            { name: "Existing", skills: ["review"] },
            { name: "New Agent", skills: ["executor"] },
          ],
          teams: [],
          projects: [],
          tasks: [],
          skills: [],
        },
        { skipExisting: ["Existing"] },
      );

      expect(inputs).toHaveLength(1);
      expect(inputs[0].name).toBe("New Agent");
      expect(inputs[0].role).toBe("executor");
      expect(result.created).toEqual(["New Agent"]);
      expect(result.skipped).toEqual(["Existing"]);
      expect(result.errors).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("AgentCompaniesParseError has correct name", () => {
      const err = new AgentCompaniesParseError("boom");
      expect(err.name).toBe("AgentCompaniesParseError");
      expect(err.message).toBe("boom");
    });

    it("error messages include parsing context", () => {
      expect(() => parseCompanyManifest("---\ndescription: missing name\n---")).toThrow(
        "company manifest is missing required field: name",
      );
    });
  });
});
