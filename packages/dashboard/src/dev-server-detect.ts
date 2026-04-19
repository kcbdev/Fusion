import { glob, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface DetectedCandidate {
  name: string;
  command: string;
  scriptName: string;
  cwd: string;
  label: string;
}

export const PREFERRED_SCRIPT_NAMES: readonly string[] = [
  "dev",
  "start",
  "serve",
  "web",
  "frontend",
  "storybook",
  "preview",
];

export const EXCLUDED_SCRIPT_NAMES: ReadonlySet<string> = new Set([
  "lint",
  "test",
  "build",
  "typecheck",
  "check",
  "clean",
  "format",
  "validate",
  "compile",
  "bundle",
]);

const cache: Map<string, { candidates: DetectedCandidate[]; mtime: number }> = new Map();

interface PackageJsonShape {
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

function parseScripts(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const scripts = (value as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object") {
    return {};
  }

  const entries = Object.entries(scripts as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
  );

  return Object.fromEntries(entries);
}

function shouldIncludeScript(scriptName: string): boolean {
  if (PREFERRED_SCRIPT_NAMES.includes(scriptName)) {
    return true;
  }
  return !EXCLUDED_SCRIPT_NAMES.has(scriptName);
}

function preferredIndex(scriptName: string): number {
  const index = PREFERRED_SCRIPT_NAMES.indexOf(scriptName);
  return index >= 0 ? index : Number.POSITIVE_INFINITY;
}

function buildCandidatesForScripts(
  scripts: Record<string, string>,
  cwd: string,
  labelPrefix: string,
): DetectedCandidate[] {
  return Object.entries(scripts)
    .filter(([scriptName]) => shouldIncludeScript(scriptName))
    .map(([scriptName, command]) => {
      const label = `${labelPrefix} > ${scriptName}`;
      const isRoot = labelPrefix === "Root";
      return {
        name: isRoot ? scriptName : label,
        command,
        scriptName,
        cwd,
        label,
      } satisfies DetectedCandidate;
    });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function collectWorkspacePatterns(rootPackage: PackageJsonShape | null, pnpmWorkspaceRaw: string | null, lernaPackage: unknown): string[] {
  const patterns = new Set<string>();

  if (pnpmWorkspaceRaw) {
    const matches = pnpmWorkspaceRaw.matchAll(/^\s*-\s*['"]?(.+?)['"]?\s*$/gm);
    for (const match of matches) {
      const pattern = match[1]?.trim();
      if (pattern) {
        patterns.add(pattern);
      }
    }
  }

  if (rootPackage?.workspaces) {
    if (Array.isArray(rootPackage.workspaces)) {
      for (const pattern of rootPackage.workspaces) {
        if (typeof pattern === "string" && pattern.trim().length > 0) {
          patterns.add(pattern.trim());
        }
      }
    } else if (Array.isArray(rootPackage.workspaces.packages)) {
      for (const pattern of rootPackage.workspaces.packages) {
        if (typeof pattern === "string" && pattern.trim().length > 0) {
          patterns.add(pattern.trim());
        }
      }
    }
  }

  if (Array.isArray((lernaPackage as { packages?: unknown })?.packages)) {
    for (const pattern of (lernaPackage as { packages: unknown[] }).packages) {
      if (typeof pattern === "string" && pattern.trim().length > 0) {
        patterns.add(pattern.trim());
      }
    }
  }

  return [...patterns];
}

function toPackageJsonPattern(pattern: string): string {
  const normalized = pattern.replace(/\\/g, "/").replace(/\/+$|^\/+/, "");
  if (!normalized) {
    return "package.json";
  }
  if (normalized.endsWith("package.json")) {
    return normalized;
  }
  return `${normalized}/package.json`;
}

async function expandWorkspacePackageJsons(projectRoot: string, patterns: string[]): Promise<string[]> {
  const packageJsonPaths: string[] = [];

  for (const pattern of patterns) {
    const packageJsonPattern = toPackageJsonPattern(pattern);
    try {
      for await (const matchedPath of glob(packageJsonPattern, { cwd: projectRoot })) {
        if (typeof matchedPath !== "string") {
          continue;
        }
        packageJsonPaths.push(path.resolve(projectRoot, matchedPath));
      }
    } catch {
      // Ignore invalid glob patterns and continue.
    }
  }

  return [...new Set(packageJsonPaths)];
}

async function detect(projectRoot: string): Promise<DetectedCandidate[]> {
  const candidates: DetectedCandidate[] = [];

  const rootPackagePath = path.join(projectRoot, "package.json");
  const rootPackageJson = await readJsonFile<PackageJsonShape>(rootPackagePath);
  const rootScripts = parseScripts(rootPackageJson);
  candidates.push(...buildCandidatesForScripts(rootScripts, projectRoot, "Root"));

  const [pnpmWorkspaceRaw, lernaJson] = await Promise.all([
    readFile(path.join(projectRoot, "pnpm-workspace.yaml"), "utf-8").catch(() => null),
    readJsonFile<Record<string, unknown>>(path.join(projectRoot, "lerna.json")),
  ]);

  const workspacePatterns = collectWorkspacePatterns(rootPackageJson, pnpmWorkspaceRaw, lernaJson);
  const workspacePackageJsons = await expandWorkspacePackageJsons(projectRoot, workspacePatterns);

  for (const packageJsonPath of workspacePackageJsons) {
    const workspacePackage = await readJsonFile<PackageJsonShape>(packageJsonPath);
    if (!workspacePackage) {
      continue;
    }

    const scripts = parseScripts(workspacePackage);
    const workspaceDir = path.dirname(packageJsonPath);
    const relativePath = path.relative(projectRoot, workspaceDir).replace(/\\/g, "/") || ".";
    candidates.push(...buildCandidatesForScripts(scripts, workspaceDir, relativePath));
  }

  return candidates.sort((a, b) => {
    const aIndex = preferredIndex(a.scriptName);
    const bIndex = preferredIndex(b.scriptName);

    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }

    if (a.label !== b.label) {
      return a.label.localeCompare(b.label);
    }

    return a.command.localeCompare(b.command);
  });
}

async function getRootPackageMtime(projectRoot: string): Promise<number> {
  try {
    const stats = await stat(path.join(projectRoot, "package.json"));
    return stats.mtimeMs;
  } catch {
    return 0;
  }
}

export async function detectDevServerCandidates(projectRoot: string): Promise<DetectedCandidate[]> {
  const resolvedRoot = path.resolve(projectRoot);

  try {
    const mtime = await getRootPackageMtime(resolvedRoot);
    const cached = cache.get(resolvedRoot);
    if (cached && cached.mtime === mtime) {
      return cached.candidates.map((candidate) => ({ ...candidate }));
    }

    const candidates = await detect(resolvedRoot);
    cache.set(resolvedRoot, {
      candidates: candidates.map((candidate) => ({ ...candidate })),
      mtime,
    });

    return candidates;
  } catch {
    return [];
  }
}

export function invalidateDetectionCache(projectRoot?: string): void {
  if (!projectRoot) {
    cache.clear();
    return;
  }

  cache.delete(path.resolve(projectRoot));
}
