import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { TaskStore, importSettings, readExportFile, validateImportData } from "@fusion/core";

/**
 * Run settings import command.
 * Usage: kb settings import <file> [--scope global|project|both] [--merge] [--yes]
 *
 * @param filePath - Path to the JSON file to import
 * @param options.scope - Which settings to import: 'global', 'project', or 'both' (default: 'both')
 * @param options.merge - Whether to merge (true, default) or replace (false) existing settings
 * @param options.yes - Skip confirmation prompt
 */
export async function runSettingsImport(
  filePath: string,
  options: {
    scope?: "global" | "project" | "both";
    merge?: boolean;
    yes?: boolean;
  } = {}
): Promise<void> {
  const store = new TaskStore(process.cwd());
  await store.init();

  const scope = options.scope ?? "both";
  const merge = options.merge ?? true;
  const skipConfirm = options.yes ?? false;

  try {
    // Resolve and verify file exists
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    // Read and parse the file
    let importData;
    try {
      importData = await readExportFile(resolvedPath);
    } catch (err) {
      console.error(`Error: Failed to read import file: ${(err as Error).message}`);
      process.exit(1);
    }

    // Validate the import data
    const validationErrors = validateImportData(importData);
    if (validationErrors.length > 0) {
      console.error("Error: Invalid import file:");
      for (const error of validationErrors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    // Show summary of what will be imported
    const summary: string[] = [];
    
    if ((scope === "global" || scope === "both") && importData.global) {
      const globalKeys = Object.keys(importData.global).filter(
        (k) => importData.global?.[k as keyof typeof importData.global] !== undefined
      );
      if (globalKeys.length > 0) {
        summary.push(`  Global: ${globalKeys.length} setting(s)`);
      }
    }
    
    if ((scope === "project" || scope === "both") && importData.project) {
      const projectKeys = Object.keys(importData.project).filter(
        (k) => importData.project?.[k as keyof typeof importData.project] !== undefined
      );
      if (projectKeys.length > 0) {
        summary.push(`  Project: ${projectKeys.length} setting(s)`);
      }
    }

    if (summary.length === 0) {
      console.error("Error: No settings to import in the specified scope");
      process.exit(1);
    }

    // Show preview
    console.log();
    console.log("  Import Summary:");
    console.log(`  Source: ${resolvedPath}`);
    console.log(`  Scope: ${scope}`);
    console.log(`  Mode: ${merge ? "merge" : "replace"}`);
    console.log();
    for (const line of summary) {
      console.log(line);
    }
    console.log();

    // Ask for confirmation unless --yes flag
    if (!skipConfirm) {
      // In a real CLI, we'd use readline or prompts here
      // For now, we'll proceed since we don't have an interactive prompt library
      // and the --yes flag provides an escape hatch
      console.log("  Use --yes to confirm this import operation");
      console.log();
      process.exit(1);
    }

    // Perform the import
    const result = await importSettings(store, importData, { scope, merge });

    if (!result.success) {
      console.error(`Error: Import failed: ${result.error}`);
      process.exit(1);
    }

    // Show success message
    console.log(`  ✓ Settings imported successfully`);
    if (result.globalCount > 0) {
      console.log(`    Imported ${result.globalCount} global setting(s)`);
    }
    if (result.projectCount > 0) {
      console.log(`    Imported ${result.projectCount} project setting(s)`);
    }
    console.log();
    
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
