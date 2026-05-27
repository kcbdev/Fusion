import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../../");

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf-8");
}

describe("desktop release workflow wiring", () => {
  it("adds windows desktop build job to release and test-release workflows", async () => {
    const release = await readRepoFile(".github/workflows/release.yml");
    const testRelease = await readRepoFile(".github/workflows/test-release.yml");

    for (const workflow of [release, testRelease]) {
      expect(workflow).toContain("build-desktop-windows:");
      expect(workflow).toContain("runs-on: windows-latest");
      expect(workflow).toMatch(/pnpm --filter @fusion\/desktop dist:win|electron-builder --win/);
      expect(workflow).toContain("name: fusion-desktop-windows");
    }
  });

  it("wires release aggregation to include desktop exe assets", async () => {
    const release = await readRepoFile(".github/workflows/release.yml");

    expect(release).toContain("needs: [build-binaries, build-desktop-windows]");
    expect(release).toContain('find artifacts -type f \\(');
    expect(release).toContain('-name "*.exe"');
    expect(release).toContain('-name "*.exe.sha256"');
    expect(release).toContain('-name "*.blockmap"');
  });
});
