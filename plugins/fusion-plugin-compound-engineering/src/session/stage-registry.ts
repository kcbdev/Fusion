/**
 * Minimal internal stage registry (U5 slice).
 *
 * The full registry + presentation metadata is U6. Here we keep ONLY the data
 * the orchestrator needs to launch a stage by id: which bundled `ce-*` skill it
 * loads, and where its `complete` artifact is written (R10). Adding a stage is a
 * data entry in this map — no new route or store code (proved by the
 * "second stage through the same orchestrator" test).
 */

export interface CeStageDefinition {
  /** Stage id (stable, kebab-case). */
  stageId: string;
  /** Bundled skill the orchestrator loads for this stage. */
  skillId: string;
  /**
   * Conventional artifact location for this stage's `complete` output,
   * project-root-relative. When the path ends in `/` the orchestrator writes a
   * timestamped file inside that directory; otherwise it writes that exact file.
   */
  artifactLocation: string;
}

/**
 * The first registration slice. Locations mirror where the real ce-* skills
 * write today (STRATEGY.md, docs/ideation/, docs/brainstorms/, docs/plans/).
 */
const STAGE_DEFINITIONS: CeStageDefinition[] = [
  { stageId: "strategy", skillId: "ce-strategy", artifactLocation: "STRATEGY.md" },
  { stageId: "ideate", skillId: "ce-ideate", artifactLocation: "docs/ideation/" },
  { stageId: "brainstorm", skillId: "ce-brainstorm", artifactLocation: "docs/brainstorms/" },
  { stageId: "plan", skillId: "ce-plan", artifactLocation: "docs/plans/" },
];

const REGISTRY = new Map<string, CeStageDefinition>(STAGE_DEFINITIONS.map((s) => [s.stageId, s]));

export function getStage(stageId: string): CeStageDefinition | undefined {
  return REGISTRY.get(stageId);
}

export function listStages(): CeStageDefinition[] {
  return [...REGISTRY.values()];
}

/**
 * Register an additional stage at runtime (used by tests to prove "adding a
 * stage requires only data"). Production stages live in STAGE_DEFINITIONS.
 */
export function registerStage(def: CeStageDefinition): void {
  REGISTRY.set(def.stageId, def);
}
