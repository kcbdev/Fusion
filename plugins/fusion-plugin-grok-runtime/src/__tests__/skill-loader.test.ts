import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGrokSkillRules,
  extractRequestedSkillNames,
  resolveBundledFusionSkillSource,
  stageGrokSessionSkills,
} from "../skill-loader.js";

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

describe("skill-loader", () => {
  it("resolves the bundled Fusion skill from the monorepo", () => {
    const source = resolveBundledFusionSkillSource();
    expect(source).toBeTruthy();
    expect(existsSync(join(source!, "SKILL.md"))).toBe(true);
  });

  it("stages fusion skill plus additional skill roots into a plugin dir", () => {
    const extraRoot = mkdtempSync(join(tmpdir(), "extra-skills-"));
    const skillDir = join(extraRoot, "ce-plan");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: ce-plan\n---\n# plan\n");

    const staged = stageGrokSessionSkills({
      requestedSkillNames: ["fusion", "ce-plan"],
      additionalSkillPaths: [extraRoot],
    });
    disposers.push(staged.dispose);

    expect(existsSync(join(staged.pluginDir, "skills", "fusion", "SKILL.md"))).toBe(true);
    expect(existsSync(join(staged.pluginDir, "skills", "ce-plan", "SKILL.md"))).toBe(true);
    expect(staged.skillNames).toEqual(expect.arrayContaining(["fusion", "ce-plan"]));
  });

  it("extracts requested skill names from skills or skillSelection", () => {
    expect(extractRequestedSkillNames({ skills: ["a", "b"] })).toEqual(["a", "b"]);
    expect(
      extractRequestedSkillNames({ skillSelection: { requestedSkillNames: ["fusion", "ce-plan"] } }),
    ).toEqual(["fusion", "ce-plan"]);
  });

  it("builds rules mentioning skills and tool counts", () => {
    const rules = buildGrokSkillRules({
      skillNames: ["fusion"],
      toolMode: "coding",
      fusionToolCount: 3,
      operatorMcpCount: 1,
    });
    expect(rules).toContain("fusion");
    expect(rules).toContain("fusion-custom-tools");
    expect(rules).toContain("Operator MCP servers");
  });
});
