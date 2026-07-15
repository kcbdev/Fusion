// FNXC:WindowsDesktopPackaging 2026-07-14-19:55:
// Diagnostic (throwaway): the GitHub windows-latest runner (image
// windows-2025-vs2026) boots jobs under an elevated admin token, and
// embedded-postgres.start() spawns postgres.exe directly as a child of the
// Node process — so postgres inherits that admin token and refuses with
// "Execution of PostgreSQL by a user with administrative permissions is not
// permitted." initdb succeeds; only the server start fails.
//
// This script reproduces the failure by spawning postgres.exe DIRECTLY
// (mirroring embedded-postgres dist/index.js start()) from two binary paths:
//   A) the pnpm virtual-store path (the failing path) — contains @ + version
//   B) a clean temp path (no @, +, or version characters)
// and captures the exact exit code + full stderr. This disambiguates:
//   - modern postgres flatly refusing any admin token (=> need a non-admin
//     launch context: broker / scheduled task / dedicated user), vs.
//   - postgres's own restricted-token re-exec failing on the pnpm path
//     quoting or an SRP/AppLocker block (=> cheap fix: stage binaries to a
//     clean path before spawn, like the macOS dylib normalization).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readdirSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, platform } from "node:os";

const log = (...a) => console.log("[diag]", ...a);

if (platform() !== "win32") {
  log("Not Windows — this diagnostic is Windows-only. Exiting.");
  process.exit(0);
}

// --- 1. Elevation context ---
log("platform:", process.platform, "arch:", process.arch, "node:", process.version);
log("USERNAME:", process.env.USERNAME, "USERPROFILE:", process.env.USERPROFILE);
const groups = spawnSync("whoami", ["/groups"], { encoding: "utf8" }).stdout || "";
const isAdminGroup = /S-1-5-32-544\b/.test(groups); // Administrators
const isHighIntegrity = /S-1-16-12288\b/.test(groups); // High Mandatory Level
log("Administrators group (S-1-5-32-544) present:", isAdminGroup);
log("High Mandatory Level (S-1-16-12288):", isHighIntegrity);
const netSession = spawnSync("net", ["session"], { encoding: "utf8", shell: true });
log("`net session` exit (0 => elevated admin):", netSession.status);

// --- 2. Locate native postgres binaries in the pnpm store ---
function findNativeBinDir() {
  const store = "node_modules/.pnpm";
  if (!existsSync(store)) return null;
  for (const entry of readdirSync(store)) {
    if (!/embedded-postgres\+windows-x64@/.test(entry)) continue;
    const binDir = join(
      store,
      entry,
      "node_modules",
      "@embedded-postgres",
      "windows-x64",
      "native",
      "bin",
    );
    if (existsSync(join(binDir, "postgres.exe"))) return binDir;
  }
  return null;
}
const pnpmBinDir = findNativeBinDir();
log("pnpm native binDir:", pnpmBinDir);
if (!pnpmBinDir) {
  console.error(
    "FATAL: could not locate @embedded-postgres/windows-x64 native/bin. Run pnpm install first.",
  );
  process.exit(2);
}

// --- helpers ---
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function bootAttempt(label, binDir) {
  log(`\n========== ATTEMPT: ${label} ==========`);
  log("binDir:", binDir);
  const dataDir = join(tmpdir(), `pgdiag-${label}-${process.pid}`);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });

  const initdbExe = join(binDir, "initdb.exe");
  const postgresExe = join(binDir, "postgres.exe");

  const init = spawnSync(initdbExe, [
    "-D",
    dataDir,
    "-A",
    "trust",
    "-U",
    "postgres",
    "--no-instructions",
  ], { encoding: "utf8" });
  log("initdb exit:", init.status, init.error ? `(${init.error.message})` : "");
  if (init.status !== 0) {
    log("initdb stderr:", (init.stderr || "").slice(0, 800));
    return { booted: false, reason: "initdb failed" };
  }

  const port = await freePort();
  log("using port:", port);

  // Mirror embedded-postgres.start(): direct spawn of postgres.exe, inheriting
  // the process token (this is the exact path that fails under an admin token).
  const proc = spawn(postgresExe, ["-D", dataDir, "-p", String(port)], {
    env: { ...process.env },
  });
  let stderr = "";
  let stdout = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  proc.stdout.on("data", (d) => {
    stdout += d.toString();
  });

  let exited = null;
  proc.on("close", (code, signal) => {
    exited = { code, signal };
  });

  const deadline = Date.now() + 10000;
  while (!exited && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
  }

  let booted = false;
  if (exited) {
    log(`postgres EXITED code=${exited.code} signal=${exited.signal}`);
  } else if (/database system is ready to accept connections/.test(stderr)) {
    log("postgres READY (accepting connections)");
    booted = true;
  } else {
    log("postgres still running but no ready message yet");
  }

  if (!exited) {
    spawnSync("taskkill", ["/pid", String(proc.pid), "/f", "/t"], {
      encoding: "utf8",
    });
  }

  log("---- postgres stderr (full) ----");
  console.log(stderr || "(empty)");
  log("---- end stderr ----");

  rmSync(dataDir, { recursive: true, force: true });
  return { booted, exited };
}

// --- 3. Attempt A: from the pnpm virtual-store path (the failing path) ---
const a = await bootAttempt("pnpm-path", pnpmBinDir);

// --- 4. Attempt B: from a clean path (no @, +, version chars) ---
// FNXC:WindowsDesktopPackaging 2026-07-14-20:02:
// Copy the ENTIRE native root (bin + sibling share/lib/resources), not just
// bin, so postgres/initdb relative resource lookups still resolve. Copying
// only native/bin could fail on missing share/lib and produce a false negative
// unrelated to the admin-token behavior under test.
const nativeRoot = dirname(pnpmBinDir); // .../native
const cleanRoot = join(tmpdir(), "pgclean-native");
rmSync(cleanRoot, { recursive: true, force: true });
cpSync(nativeRoot, cleanRoot, { recursive: true });
const cleanBinDir = join(cleanRoot, "bin");
log("\nclean nativeRoot:", cleanRoot);
log("clean native contents:", readdirSync(cleanRoot).join(", "));
const b = await bootAttempt("clean-path", cleanBinDir);

log("\n========== SUMMARY ==========");
log(`pnpm-path:  booted=${a.booted} exited=${JSON.stringify(a.exited)}`);
log(`clean-path: booted=${b.booted} exited=${JSON.stringify(b.exited)}`);
log(`clean-path-fixes-it: ${!a.booted && b.booted}`);
log("DONE");
