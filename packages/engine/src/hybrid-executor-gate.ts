import type { CentralCore } from "@fusion/core";

export interface HybridExecutorGateDecision {
  enabled: boolean;
  reason: string;
}

function parseEnvOverride(value: string | undefined): HybridExecutorGateDecision | null {
  if (value === "1") {
    return { enabled: true, reason: "env-override" };
  }

  if (value === "0") {
    return { enabled: false, reason: "env-override" };
  }

  return null;
}

export async function shouldUseHybridExecutor(centralCore: CentralCore): Promise<HybridExecutorGateDecision> {
  const envOverride = parseEnvOverride(process.env.FUSION_HYBRID_EXECUTOR);
  if (envOverride) {
    return envOverride;
  }

  try {
    const nodes = await centralCore.listNodes();
    if (nodes.length > 1) {
      return { enabled: true, reason: "multi-node" };
    }

    const projects = await centralCore.listProjects();
    const liveProjects = projects.filter((project) => project.status === "active" || project.status === "initializing");
    if (liveProjects.length > 1) {
      return { enabled: true, reason: "multi-project" };
    }

    return { enabled: false, reason: "single-project-local-only" };
  } catch {
    return { enabled: false, reason: "central-unavailable" };
  }
}
