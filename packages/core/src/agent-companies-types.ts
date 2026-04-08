/**
 * TypeScript type definitions for the Agent Companies markdown manifest format.
 *
 * Agent Companies packages are directory-based and use YAML frontmatter inside
 * markdown files (COMPANY.md, TEAM.md, AGENTS.md, PROJECT.md, TASK.md, SKILL.md).
 *
 * @module agent-companies-types
 */

// ── Schema + Kinds ──────────────────────────────────────────────────────

/** Current Agent Companies schema literal. */
export type AgentCompaniesSchema = "agentcompanies/v1";

/** Supported manifest kinds in Agent Companies packages. */
export type AgentCompaniesKind =
  | "company"
  | "team"
  | "agent"
  | "project"
  | "task"
  | "skill";

// ── Provenance Metadata ─────────────────────────────────────────────────

/**
 * Source/provenance reference for imported or pinned external artifacts.
 * Stored under `metadata.sources` when present.
 */
export interface SourceReference {
  kind: string;
  repo?: string;
  path?: string;
  commit?: string;
  hash?: string;
  url?: string;
  trackingRef?: string;
}

// ── Common Frontmatter ──────────────────────────────────────────────────

/**
 * Shared frontmatter fields across Agent Companies manifest files.
 */
export interface AgentCompaniesFrontmatter {
  /** Human-readable name (required). */
  name: string;
  /** Optional short discovery description. */
  description?: string;
  /** Stable portable identifier. */
  slug?: string;
  /** Schema identifier (typically set at package roots). */
  schema?: AgentCompaniesSchema;
  /** Explicit kind override (often implied by filename). */
  kind?: AgentCompaniesKind;
  /** Optional semantic version for package/manifests. */
  version?: string;
  /** License identifier. */
  license?: string;
  /** Attribution metadata. */
  authors?: string[];
  /** Search and classification tags. */
  tags?: string[];
  /** Tool-specific extension metadata. */
  metadata?: {
    /** Optional source/provenance references. */
    sources?: SourceReference[];
    [key: string]: unknown;
  };
}

// ── Manifest Types ──────────────────────────────────────────────────────

/** Root COMPANY.md manifest. */
export interface CompanyManifest extends AgentCompaniesFrontmatter {
  // Company currently uses common frontmatter fields only.
}

/** TEAM.md manifest. */
export interface TeamManifest extends AgentCompaniesFrontmatter {
  manager?: string;
  includes?: string[];
}

/** AGENTS.md manifest. */
export interface AgentManifest extends AgentCompaniesFrontmatter {
  title?: string;
  reportsTo?: string | null;
  skills?: string[];
  /** Markdown content after YAML frontmatter. */
  instructionBody?: string;
}

/** PROJECT.md manifest. */
export interface ProjectManifest extends AgentCompaniesFrontmatter {
  // Project currently uses common frontmatter fields only.
}

/** SKILL.md manifest. */
export interface SkillManifest extends AgentCompaniesFrontmatter {
  provides?: string[];
  requirements?: string[];
}

/** TASK.md manifest. */
export interface TaskManifest extends AgentCompaniesFrontmatter {
  assignee?: string;
  project?: string;
  schedule?: {
    timezone?: string;
    startsAt?: string;
  };
}

// ── Package + Import Result ─────────────────────────────────────────────

/** Parsed Agent Companies package from a directory or archive. */
export interface AgentCompaniesPackage {
  company?: CompanyManifest;
  agents: AgentManifest[];
  teams: TeamManifest[];
  projects: ProjectManifest[];
  tasks: TaskManifest[];
  skills: SkillManifest[];
}

/** Result of converting/importing Agent Companies agents into Fusion agent inputs. */
export interface AgentCompaniesImportResult {
  created: string[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
}
