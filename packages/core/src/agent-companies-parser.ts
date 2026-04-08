/**
 * Parser for Agent Companies markdown manifests.
 *
 * Supports YAML frontmatter extraction, per-manifest parsing,
 * directory/package parsing, archive parsing, and conversion into
 * Fusion `AgentCreateInput` payloads.
 *
 * @module agent-companies-parser
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";

import type {
  AgentCompaniesImportResult,
  AgentCompaniesPackage,
  AgentManifest,
  CompanyManifest,
  ProjectManifest,
  SkillManifest,
  TaskManifest,
  TeamManifest,
} from "./agent-companies-types.js";
import { mapRoleToCapability } from "./companies-sh-parser.js";
import type { AgentCapability, AgentCreateInput } from "./types.js";

export { mapRoleToCapability } from "./companies-sh-parser.js";

// ── Parsing Errors ───────────────────────────────────────────────────────

export class AgentCompaniesParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentCompaniesParseError";
  }
}

// ── Frontmatter Parsing ──────────────────────────────────────────────────

/**
 * Extract YAML frontmatter and markdown body from a manifest file.
 *
 * @throws {AgentCompaniesParseError} On missing or malformed frontmatter.
 */
export function parseYamlFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (typeof content !== "string" || content.length === 0) {
    throw new AgentCompaniesParseError("Manifest content is empty or not a string");
  }

  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    throw new AgentCompaniesParseError("Missing YAML frontmatter delimiters (---)");
  }

  const yamlContent = match[1];
  const body = match[2] ?? "";

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (err) {
    throw new AgentCompaniesParseError(
      `Malformed YAML frontmatter: ${(err as Error).message}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentCompaniesParseError("YAML frontmatter must parse to an object");
  }

  return {
    frontmatter: parsed as Record<string, unknown>,
    body,
  };
}

function validateRequiredFields(
  frontmatter: Record<string, unknown>,
  kind: string,
  requiredFields: string[],
): void {
  for (const field of requiredFields) {
    const value = frontmatter[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new AgentCompaniesParseError(
        `${kind} manifest is missing required field: ${field}`,
      );
    }
  }
}

/**
 * Parse and validate a manifest frontmatter shape.
 */
function parseManifest<T>(content: string, kind: string, requiredFields: string[]): T {
  const { frontmatter } = parseYamlFrontmatter(content);
  validateRequiredFields(frontmatter, kind, requiredFields);
  return frontmatter as T;
}

// ── Individual Manifest Parsers ─────────────────────────────────────────

export function parseCompanyManifest(content: string): CompanyManifest {
  return parseManifest<CompanyManifest>(content, "company", ["name"]);
}

export function parseTeamManifest(content: string): TeamManifest {
  return parseManifest<TeamManifest>(content, "team", ["name"]);
}

export function parseAgentManifest(content: string): AgentManifest {
  const manifest = parseManifest<AgentManifest>(content, "agent", ["name"]);
  const { body } = parseYamlFrontmatter(content);
  return {
    ...manifest,
    instructionBody: body,
  };
}

export function parseProjectManifest(content: string): ProjectManifest {
  return parseManifest<ProjectManifest>(content, "project", ["name"]);
}

export function parseTaskManifest(content: string): TaskManifest {
  return parseManifest<TaskManifest>(content, "task", ["name"]);
}

export function parseSkillManifest(content: string): SkillManifest {
  return parseManifest<SkillManifest>(content, "skill", ["name"]);
}

// ── Directory + Archive Parsing ─────────────────────────────────────────

function parseManifestFile<T>(
  filePath: string,
  parser: (content: string) => T,
): T {
  try {
    const content = readFileSync(filePath, "utf-8");
    return parser(content);
  } catch (err) {
    if (err instanceof AgentCompaniesParseError) {
      throw new AgentCompaniesParseError(`${filePath}: ${err.message}`);
    }
    throw err;
  }
}

function parseManifestSubdirectories<T>(
  rootDir: string,
  sectionDir: string,
  filename: string,
  parser: (content: string) => T,
): T[] {
  const sectionPath = join(rootDir, sectionDir);
  if (!existsSync(sectionPath)) {
    return [];
  }

  const entries = readdirSync(sectionPath, { withFileTypes: true });
  const parsed: T[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = join(sectionPath, entry.name, filename);
    if (!existsSync(manifestPath)) {
      continue;
    }

    parsed.push(parseManifestFile(manifestPath, parser));
  }

  return parsed;
}

export function parseCompanyDirectory(dirPath: string): AgentCompaniesPackage {
  const resolvedDir = resolve(dirPath);

  if (!existsSync(resolvedDir)) {
    throw new AgentCompaniesParseError(`Company directory does not exist: ${resolvedDir}`);
  }
  if (!statSync(resolvedDir).isDirectory()) {
    throw new AgentCompaniesParseError(`Company path is not a directory: ${resolvedDir}`);
  }

  const companyPath = join(resolvedDir, "COMPANY.md");

  return {
    company: existsSync(companyPath)
      ? parseManifestFile(companyPath, parseCompanyManifest)
      : undefined,
    agents: parseManifestSubdirectories(resolvedDir, "agents", "AGENTS.md", parseAgentManifest),
    teams: parseManifestSubdirectories(resolvedDir, "teams", "TEAM.md", parseTeamManifest),
    projects: parseManifestSubdirectories(resolvedDir, "projects", "PROJECT.md", parseProjectManifest),
    tasks: parseManifestSubdirectories(resolvedDir, "tasks", "TASK.md", parseTaskManifest),
    skills: parseManifestSubdirectories(resolvedDir, "skills", "SKILL.md", parseSkillManifest),
  };
}

function resolveArchiveRoot(tempDir: string): string {
  if (existsSync(join(tempDir, "COMPANY.md"))) {
    return tempDir;
  }

  const entries = readdirSync(tempDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childPath = join(tempDir, entry.name);
    if (existsSync(join(childPath, "COMPANY.md"))) {
      return childPath;
    }
  }

  if (entries.length === 1 && entries[0].isDirectory()) {
    return join(tempDir, entries[0].name);
  }

  return tempDir;
}

export async function parseCompanyArchive(archivePath: string): Promise<AgentCompaniesPackage> {
  const resolvedArchivePath = resolve(archivePath);

  if (resolvedArchivePath.endsWith(".zip")) {
    throw new AgentCompaniesParseError(
      "Zip archives are not yet supported for Agent Companies imports. Please use .tar.gz or .tgz.",
    );
  }

  if (!resolvedArchivePath.endsWith(".tar.gz") && !resolvedArchivePath.endsWith(".tgz")) {
    throw new AgentCompaniesParseError(
      "Unsupported archive format. Expected .tar.gz or .tgz.",
    );
  }

  const tempDir = mkdtempSync(join(tmpdir(), "agent-companies-"));

  try {
    execSync(
      `tar xzf ${JSON.stringify(resolvedArchivePath)} -C ${JSON.stringify(tempDir)}`,
      { stdio: "pipe" },
    );

    const extractionRoot = resolveArchiveRoot(tempDir);
    return parseCompanyDirectory(extractionRoot);
  } catch (err) {
    if (err instanceof AgentCompaniesParseError) {
      throw err;
    }

    throw new AgentCompaniesParseError(
      `Failed to parse Agent Companies archive: ${(err as Error).message}`,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── Conversion to Fusion Agent Inputs ───────────────────────────────────

const ROLE_HINT_ALIASES: Record<string, AgentCapability> = {
  triage: "triage",
  planner: "triage",
  planning: "triage",
  executor: "executor",
  execute: "executor",
  reviewer: "reviewer",
  review: "reviewer",
  merger: "merger",
  merge: "merger",
  scheduler: "scheduler",
  schedule: "scheduler",
  engineer: "engineer",
  engineering: "engineer",
  custom: "custom",
};

function extractRoleFromHint(hint: string): AgentCapability {
  const normalized = hint.toLowerCase();
  const tokens = normalized.split(/[^a-z]+/g).filter(Boolean);

  for (const token of tokens) {
    const mapped = ROLE_HINT_ALIASES[token];
    if (mapped) {
      return mapRoleToCapability(mapped);
    }
  }

  return mapRoleToCapability("custom");
}

function inferRole(agent: AgentManifest): AgentCapability {
  if (agent.skills && agent.skills.length > 0) {
    for (const skill of agent.skills) {
      const role = extractRoleFromHint(skill);
      if (role !== "custom") {
        return role;
      }
    }
  }

  if (typeof agent.reportsTo === "string" && agent.reportsTo.trim() !== "") {
    const role = extractRoleFromHint(agent.reportsTo);
    if (role !== "custom") {
      return role;
    }
  }

  return mapRoleToCapability("custom");
}

export function agentManifestToAgentCreateInput(agent: AgentManifest): AgentCreateInput {
  const metadata: Record<string, unknown> = {};

  if (agent.skills && agent.skills.length > 0) {
    metadata.skills = agent.skills;
  }

  const input: AgentCreateInput = {
    name: agent.name,
    role: inferRole(agent),
  };

  if (agent.title) {
    input.title = agent.title;
  }

  if (agent.instructionBody !== undefined) {
    input.instructionsText = agent.instructionBody;
  }

  if (agent.reportsTo !== null && agent.reportsTo !== undefined) {
    input.reportsTo = agent.reportsTo;
  }

  if (Object.keys(metadata).length > 0) {
    input.metadata = metadata;
  }

  return input;
}

export function convertAgentCompanies(
  pkg: AgentCompaniesPackage,
  options?: { skipExisting?: string[] },
): { inputs: AgentCreateInput[]; result: AgentCompaniesImportResult } {
  const existingNames = new Set(options?.skipExisting ?? []);
  const inputs: AgentCreateInput[] = [];
  const result: AgentCompaniesImportResult = {
    created: [],
    skipped: [],
    errors: [],
  };

  for (const agent of pkg.agents) {
    if (existingNames.has(agent.name)) {
      result.skipped.push(agent.name);
      continue;
    }

    try {
      const input = agentManifestToAgentCreateInput(agent);
      inputs.push(input);
      result.created.push(agent.name);
    } catch (err) {
      result.errors.push({
        name: agent.name,
        error: (err as Error).message,
      });
    }
  }

  return { inputs, result };
}
