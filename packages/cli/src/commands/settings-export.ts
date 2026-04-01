import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { TaskStore, exportSettings, generateExportFilename } from "@fusion/core";

/**
 * Run settings export command.
 * Usage: kb settings export [--output <path>] [--scope global|project|both]
 *
 * @param options.output - Custom output file path (optional, auto-generates if not provided)
 * @param options.scope - Which settings to export: 'global', 'project', or 'both' (default: 'both')
 */
export async function runSettingsExport(options: {
  output?: string;
  scope?: "global" | "project" | "both";
} = {}): Promise<void> {
  const store = new TaskStore(process.cwd());
  await store.init();

  const scope = options.scope ?? "both";
  const outputPath = options.output;

  try {
    // Export settings
    const exportData = await exportSettings(store, { scope });

    // Determine output file path
    let targetPath: string;
    if (outputPath) {
      targetPath = resolve(outputPath);
    } else {
      // Generate timestamped filename in current directory
      const filename = generateExportFilename();
      targetPath = join(process.cwd(), filename);
    }

    // Write to file with pretty-printed JSON
    const jsonContent = JSON.stringify(exportData, null, 2);
    await writeFile(targetPath, jsonContent);

    // Output success message
    console.log();
    console.log(`  ✓ Settings exported to ${targetPath}`);
    
    // Show what was exported
    const parts: string[] = [];
    if (exportData.global) {
      const globalKeys = Object.keys(exportData.global).filter(
        (k) => exportData.global?.[k as keyof typeof exportData.global] !== undefined
      );
      if (globalKeys.length > 0) {
        parts.push(`${globalKeys.length} global setting(s)`);
      }
    }
    if (exportData.project) {
      const projectKeys = Object.keys(exportData.project).filter(
        (k) => exportData.project?.[k as keyof typeof exportData.project] !== undefined
      );
      if (projectKeys.length > 0) {
        parts.push(`${projectKeys.length} project setting(s)`);
      }
    }
    
    if (parts.length > 0) {
      console.log(`    Exported: ${parts.join(", ")}`);
    }
    console.log();
    
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
