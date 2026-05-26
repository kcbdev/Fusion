import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "../..");

async function readDesktopFile(relativePath: string): Promise<string> {
  return readFile(path.join(desktopRoot, relativePath), "utf-8");
}

describe("electron-builder windows config", () => {
  it("keeps required Windows packaging targets and metadata", async () => {
    const builderConfig = await readDesktopFile("electron-builder.yml");

    expect(builderConfig).toContain("win:");
    expect(builderConfig).toMatch(/win:\s*[\s\S]*?target:\s*[\s\S]*?-\s*target:\s*nsis/m);
    expect(builderConfig).toMatch(/win:\s*[\s\S]*?target:\s*[\s\S]*?-\s*target:\s*portable/m);

    const nsisArchMatch = builderConfig.match(
      /-\s*target:\s*nsis\s*arch:\s*([\s\S]*?)(?=\n\s*-\s*target:|\n\w)/m,
    );
    const portableArchMatch = builderConfig.match(
      /-\s*target:\s*portable\s*arch:\s*([\s\S]*?)(?=\n\s*-\s*target:|\n\w)/m,
    );

    expect(nsisArchMatch?.[1]).toBeDefined();
    expect(portableArchMatch?.[1]).toBeDefined();

    const extractArchValues = (archBlock: string) =>
      Array.from(archBlock.matchAll(/-\s*(x64|arm64)/g), (match) => match[1]).sort();

    expect(extractArchValues(nsisArchMatch![1])).toEqual(["arm64", "x64"]);
    expect(extractArchValues(portableArchMatch![1])).toEqual(["arm64", "x64"]);

    expect(builderConfig).toMatch(/nsis:\s*[\s\S]*?oneClick:\s*false/m);
    expect(builderConfig).toMatch(/nsis:\s*[\s\S]*?allowToChangeInstallationDirectory:\s*true/m);

    expect(builderConfig).toMatch(/artifactName:\s*"\$\{productName\}-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}"/m);
    expect(builderConfig).toMatch(/appId:\s*com\.gsxdsm\.fusion\.desktop/m);
    expect(builderConfig).toMatch(/productName:\s*Fusion/m);
  });

  it("locks windows signing policy without baked certificate paths", async () => {
    const builderConfig = await readDesktopFile("electron-builder.yml");

    expect(builderConfig).toMatch(/signtoolOptions:\s*[\s\S]*?signingHashAlgorithms:\s*[\s\S]*?-\s*sha256/m);
    expect(builderConfig).toMatch(/signtoolOptions:\s*[\s\S]*?rfc3161TimeStampServer:\s*http:\/\/timestamp\.digicert\.com/m);
    expect(builderConfig).toMatch(/signtoolOptions:\s*[\s\S]*?publisherName:\s*Fusion/m);
    expect(builderConfig).not.toContain("certificateFile:");
    expect(builderConfig).not.toContain("certificateSubjectName:");
  });

  it("exposes a dedicated dist:win script", async () => {
    const packageJsonRaw = await readDesktopFile("package.json");
    const packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["dist:win"]).toBe("electron-builder --win");
  });
});

describe("desktop windows workflow signing guards", () => {
  it("references signing secrets and verification flow", async () => {
    const workflow = await readFile(
      path.resolve(desktopRoot, "../../.github/workflows/desktop-windows.yml"),
      "utf-8",
    );

    expect(workflow).toContain("secrets.WINDOWS_CERTIFICATE_BASE64");
    expect(workflow).toContain("secrets.WINDOWS_CERTIFICATE_PASSWORD");
    expect(workflow).toContain("CSC_LINK:");
    expect(workflow).toContain("CSC_KEY_PASSWORD:");
    expect(workflow).toContain("WINDOWS_CERTIFICATE_BASE64 != ''");
    expect(workflow).toContain("Get-AuthenticodeSignature");
    expect(workflow).toContain("intentionally deferred");
  });
});
