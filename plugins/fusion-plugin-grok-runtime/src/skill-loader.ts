/*
FNXC:GrokAcp 2026-07-11-14:00:
Stage Fusion + session skills so Grok ACP discovers them the same way pi does.
Grok loads skills from trusted `--plugin-dir` / `_meta.pluginDirs` plugins
(skills/ SKILL.md tree). We materialize a session-scoped plugin directory with:
  - the bundled Fusion skill (fn_* tool catalog + workflows)
  - skills from engine additionalSkillPaths / skill roots
Requested skill names are also listed in runtime context rules so the agent
still sees the selection when a skill file cannot be resolved on disk.
*/

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FUSION_SKILL_NAME = "fusion";

export interface GrokSkillStagingResult {
  pluginDir: string;
  skillNames: string[];
  dispose: () => void;
}

function isSkillDir(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md"));
}

export function getFusionSkillSourceCandidates(moduleUrl = import.meta.url): string[] {
  const here = fileURLToPath(moduleUrl);
  const moduleDir = dirname(here);
  return [
    // Monorepo source checkout: packages/cli/skill/fusion
    resolve(moduleDir, "..", "..", "..", "packages", "cli", "skill", FUSION_SKILL_NAME),
    // Bundled CLI layout: dist/skill/fusion or sibling skill/
    resolve(moduleDir, "..", "..", "skill", FUSION_SKILL_NAME),
    resolve(moduleDir, "..", "skill", FUSION_SKILL_NAME),
    resolve(moduleDir, "..", "..", "..", "skill", FUSION_SKILL_NAME),
  ];
}

export function resolveBundledFusionSkillSource(): string | null {
  for (const candidate of getFusionSkillSourceCandidates()) {
    if (isSkillDir(candidate)) return candidate;
  }
  return null;
}

function installSkillDir(sourceDir: string, targetDir: string): boolean {
  if (!isSkillDir(sourceDir)) return false;
  mkdirSync(dirname(targetDir), { recursive: true });
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  try {
    symlinkSync(sourceDir, targetDir, "dir");
    return true;
  } catch {
    try {
      cpSync(sourceDir, targetDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

function collectSkillsFromRoot(root: string, out: Map<string, string>): void {
  if (!existsSync(root)) return;
  // Root may itself be a skill (…/skills/foo with SKILL.md) or a skills container.
  if (isSkillDir(root)) {
    out.set(basename(root), root);
    return;
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = join(root, entry);
    if (isSkillDir(child)) {
      out.set(entry, child);
    }
  }
}

export interface StageGrokSkillsOptions {
  /** Engine-requested skill names (skillSelection / skills). */
  requestedSkillNames?: string[];
  /** Extra skill roots (plugin skill dirs, CE install roots, etc.). */
  additionalSkillPaths?: string[];
  /** Always include the bundled Fusion skill (default true). */
  includeFusionSkill?: boolean;
}

/**
 * Build a session-scoped Grok plugin directory with Fusion + requested skills.
 */
export function stageGrokSessionSkills(options: StageGrokSkillsOptions = {}): GrokSkillStagingResult {
  const pluginDir = mkdtempSync(join(tmpdir(), "fusion-grok-plugin-"));
  const skillsDir = join(pluginDir, "skills");
  mkdirSync(skillsDir, { recursive: true });

  const installed = new Map<string, string>();
  const includeFusion = options.includeFusionSkill !== false;

  if (includeFusion) {
    const fusionSource = resolveBundledFusionSkillSource();
    if (fusionSource && installSkillDir(fusionSource, join(skillsDir, FUSION_SKILL_NAME))) {
      installed.set(FUSION_SKILL_NAME, fusionSource);
    }
  }

  for (const root of options.additionalSkillPaths ?? []) {
    if (typeof root !== "string" || !root.trim()) continue;
    collectSkillsFromRoot(root.trim(), installed);
  }

  // Re-install collected skills (may overwrite with higher-priority roots).
  for (const [name, source] of installed) {
    if (name === FUSION_SKILL_NAME && includeFusion) continue; // already installed
    installSkillDir(source, join(skillsDir, name));
  }

  // Second pass: additionalSkillPaths may have added fusion under a different name path.
  for (const [name, source] of installed) {
    if (!existsSync(join(skillsDir, name))) {
      installSkillDir(source, join(skillsDir, name));
    }
  }

  writeFileSync(
    join(pluginDir, "plugin.json"),
    JSON.stringify(
      {
        name: "fusion-session-skills",
        version: "0.1.0",
        description: "Session-scoped Fusion skills for Grok ACP",
      },
      null,
      2,
    ),
  );

  const skillNames = Array.from(
    new Set([
      ...installed.keys(),
      ...(options.requestedSkillNames ?? []).filter((n) => typeof n === "string" && n.trim().length > 0),
    ]),
  );

  return {
    pluginDir,
    skillNames,
    dispose: () => {
      try {
        rmSync(pluginDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

/**
 * Build a short rules block listing requested skills and reminding Grok to use
 * Fusion tools/MCP when available.
 */
export function buildGrokSkillRules(options: {
  skillNames: string[];
  toolMode?: string;
  fusionToolCount?: number;
  operatorMcpCount?: number;
}): string {
  const lines = [
    "Fusion runtime context for this session:",
    `- Tool mode: ${options.toolMode ?? "coding"}`,
  ];
  if (options.skillNames.length > 0) {
    lines.push(`- Loaded / requested skills: ${options.skillNames.join(", ")}`);
  }
  if (typeof options.fusionToolCount === "number") {
    lines.push(`- Fusion custom tools (fn_*) available via MCP server "fusion-custom-tools": ${options.fusionToolCount}`);
  }
  if (typeof options.operatorMcpCount === "number" && options.operatorMcpCount > 0) {
    lines.push(`- Operator MCP servers forwarded into this session: ${options.operatorMcpCount}`);
  }
  lines.push(
    "- Prefer Fusion fn_* MCP tools for task board / coordination actions (e.g. fn_task_done, fn_task_list) when they are available.",
    "- Use the Fusion skill workflows when planning or managing tasks.",
  );
  return lines.join("\n");
}

export function extractRequestedSkillNames(options: {
  skills?: unknown;
  skillSelection?: unknown;
}): string[] {
  const fromSkills = Array.isArray(options.skills)
    ? options.skills.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const selection = options.skillSelection as { requestedSkillNames?: unknown } | undefined;
  const fromSelection = Array.isArray(selection?.requestedSkillNames)
    ? selection.requestedSkillNames.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  return Array.from(new Set(fromSkills.length > 0 ? fromSkills : fromSelection));
}
