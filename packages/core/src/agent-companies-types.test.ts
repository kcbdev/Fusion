import { describe, it, expect } from "vitest";
import type {
  AgentCompaniesFrontmatter,
  AgentCompaniesImportResult,
  AgentCompaniesKind,
  AgentCompaniesPackage,
  AgentCompaniesSchema,
  AgentManifest,
  CompanyManifest,
  ProjectManifest,
  SkillManifest,
  SourceReference,
  TaskManifest,
  TeamManifest,
} from "./agent-companies-types.js";

describe("agent-companies-types", () => {
  it("accepts AgentCompaniesSchema literal", () => {
    const schema: AgentCompaniesSchema = "agentcompanies/v1";
    expect(schema).toBe("agentcompanies/v1");
  });

  it("accepts all AgentCompaniesKind variants", () => {
    const kinds: AgentCompaniesKind[] = [
      "company",
      "team",
      "agent",
      "project",
      "task",
      "skill",
    ];
    expect(kinds).toHaveLength(6);
  });

  it("accepts AgentCompaniesFrontmatter base fields", () => {
    const frontmatter: AgentCompaniesFrontmatter = {
      name: "Lean Dev Shop",
      description: "Small engineering-focused AI company",
      slug: "lean-dev-shop",
      schema: "agentcompanies/v1",
      kind: "company",
      version: "1.0.0",
      license: "MIT",
      authors: ["Team"],
      tags: ["engineering", "ai"],
      metadata: {
        sources: [{ kind: "git", repo: "acme/repo" }],
        customField: true,
      },
    };

    expect(frontmatter.name).toBe("Lean Dev Shop");
    expect(frontmatter.metadata?.sources).toHaveLength(1);
  });

  it("accepts minimal AgentManifest", () => {
    const manifest: AgentManifest = {
      name: "CEO",
    };

    expect(manifest.name).toBe("CEO");
    expect(manifest.skills).toBeUndefined();
  });

  it("accepts fully populated AgentManifest", () => {
    const manifest: AgentManifest = {
      name: "CEO",
      description: "Runs strategy",
      slug: "ceo",
      kind: "agent",
      title: "Chief Executive Officer",
      reportsTo: null,
      skills: ["plan-ceo-review", "review"],
      instructionBody: "You are the CEO.",
    };

    expect(manifest.title).toBe("Chief Executive Officer");
    expect(manifest.reportsTo).toBeNull();
    expect(manifest.skills).toHaveLength(2);
  });

  it("accepts CompanyManifest with schema and slug", () => {
    const manifest: CompanyManifest = {
      name: "Lean Dev Shop",
      description: "Small engineering-focused AI company",
      slug: "lean-dev-shop",
      schema: "agentcompanies/v1",
    };

    expect(manifest.schema).toBe("agentcompanies/v1");
    expect(manifest.slug).toBe("lean-dev-shop");
  });

  it("accepts TeamManifest with manager and includes", () => {
    const manifest: TeamManifest = {
      name: "Engineering",
      manager: "../cto/AGENTS.md",
      includes: ["../platform-lead/AGENTS.md", "../../skills/review/SKILL.md"],
    };

    expect(manifest.manager).toContain("AGENTS.md");
    expect(manifest.includes).toHaveLength(2);
  });

  it("accepts ProjectManifest", () => {
    const manifest: ProjectManifest = {
      name: "Q2 Launch",
      description: "Launch execution project",
      slug: "q2-launch",
    };

    expect(manifest.name).toBe("Q2 Launch");
  });

  it("accepts TaskManifest with assignee, project, and schedule", () => {
    const manifest: TaskManifest = {
      name: "Monday Review",
      slug: "monday-review",
      description: "Weekly code review",
      assignee: "./agents/ceo/AGENTS.md",
      project: "./projects/q2-launch/PROJECT.md",
      schedule: {
        timezone: "America/New_York",
        startsAt: "2025-01-06T09:00:00",
      },
    };

    expect(manifest.assignee).toContain("AGENTS.md");
    expect(manifest.schedule?.timezone).toBe("America/New_York");
  });

  it("accepts SkillManifest with provides and requirements", () => {
    const manifest: SkillManifest = {
      name: "Code Review",
      provides: ["code-review", "security-review"],
      requirements: ["typescript"],
    };

    expect(manifest.provides).toHaveLength(2);
    expect(manifest.requirements).toEqual(["typescript"]);
  });

  it("accepts SourceReference with optional fields", () => {
    const source: SourceReference = {
      kind: "git",
      repo: "acme/repo",
      path: "skills/review",
      commit: "abc123",
      hash: "sha256:xyz",
      url: "https://example.com/spec",
      trackingRef: "v1",
    };

    expect(source.repo).toBe("acme/repo");
    expect(source.trackingRef).toBe("v1");
  });

  it("accepts AgentCompaniesPackage with nested manifests", () => {
    const pkg: AgentCompaniesPackage = {
      company: {
        name: "Lean Dev Shop",
        schema: "agentcompanies/v1",
      },
      agents: [{ name: "CEO" }],
      teams: [{ name: "Engineering" }],
      projects: [{ name: "Q2 Launch" }],
      tasks: [{ name: "Monday Review" }],
      skills: [{ name: "Code Review" }],
    };

    expect(pkg.company?.name).toBe("Lean Dev Shop");
    expect(pkg.agents).toHaveLength(1);
    expect(pkg.teams).toHaveLength(1);
    expect(pkg.projects).toHaveLength(1);
    expect(pkg.tasks).toHaveLength(1);
    expect(pkg.skills).toHaveLength(1);
  });

  it("accepts AgentCompaniesImportResult", () => {
    const result: AgentCompaniesImportResult = {
      created: ["CEO", "CTO"],
      skipped: ["Reviewer"],
      errors: [{ name: "Broken", error: "missing name" }],
    };

    expect(result.created).toHaveLength(2);
    expect(result.skipped).toEqual(["Reviewer"]);
    expect(result.errors[0].name).toBe("Broken");
  });
});
