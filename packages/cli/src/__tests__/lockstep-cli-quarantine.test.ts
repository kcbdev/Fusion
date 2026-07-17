import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type QuarantineEntry = {
  file: string;
  reason: string;
  quarantinedAt: string;
};

const repoRoot = resolve(import.meta.dirname!, "../../../..");
const configPath = resolve(repoRoot, "packages/cli/vitest.config.ts");
const ledgerPath = resolve(repoRoot, "scripts/lib/test-quarantine.json");
const fn8210BoundaryPath = "src/__tests__/package-config.test.ts";
const expiredFn8219Paths = new Set([
  "src/__tests__/extension-fn-secret-get.test.ts",
  "src/__tests__/skill-sync.test.ts",
  "src/__tests__/version.test.ts",
  "src/commands/__tests__/dashboard.test.ts",
  "src/plugins/__tests__/bundled-plugin-freshness.test.ts",
]);

function parseQuarantinedCliTests(configSource: string): string[] {
  const declaration = configSource.match(/const quarantinedCliTests: string\[\] = \[([\s\S]*?)\n\];/);
  expect(declaration, "quarantinedCliTests declaration must remain statically parseable").not.toBeNull();

  return [...declaration![1].matchAll(/"([^"\n]+)"/g)].map((match) => match[1]);
}

function countByPath(paths: string[]): Map<string, number> {
  return paths.reduce((counts, path) => counts.set(path, (counts.get(path) ?? 0) + 1), new Map<string, number>());
}

describe("CLI quarantine ledger lockstep", () => {
  /*
  FNXC:CliTests 2026-07-17-10:00:
  FN-8219 deletes five expired 2026-06-25 quarantines instead of rescuing or
  re-recording them. This source-level guard prevents those five paths from
  returning as config-only or ledger-only entries. FN-8210 must remove the
  package-config boundary and widen this to full CLI coverage if it ever adds
  or resolves that separate quarantine.
  */
  it("keeps the expired FN-8219 scope in bidirectional config-to-ledger lockstep", () => {
    const configPaths = parseQuarantinedCliTests(readFileSync(configPath, "utf8"))
      .filter((path) => expiredFn8219Paths.has(path));
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as { entries: QuarantineEntry[] };
    const ledgerEntries = ledger.entries.filter((entry) =>
      expiredFn8219Paths.has(entry.file.replace(/^packages\/cli\//, "")),
    );
    const ledgerPaths = ledgerEntries.map((entry) => entry.file.replace(/^packages\/cli\//, ""));

    expect(configPaths).not.toContain(fn8210BoundaryPath);
    expect(countByPath(configPaths)).toEqual(countByPath(ledgerPaths));

    for (const entry of ledgerEntries) {
      expect(entry.reason.trim()).not.toBe("");
      expect(entry.quarantinedAt).toMatch(/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/);
      expect(Number.isNaN(Date.parse(entry.quarantinedAt))).toBe(false);
    }

    expect(configPaths).toEqual([]);
    expect(ledgerPaths).toEqual([]);
  });
});
