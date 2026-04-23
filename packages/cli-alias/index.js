#!/usr/bin/env node
// runfusion.ai — tiny alias for @runfusion/fusion.
//
// Exposes four bins: runfusion.ai, runfusion, fn, fusion. Installing this
// package globally (`npm i -g runfusion.ai`) therefore also puts `fn` and
// `fusion` on PATH, even though `@runfusion/fusion` is only a dependency
// (npm does not link dep bins globally).
//
// When invoked as `runfusion.ai` / `runfusion` with no args, defaults to
// launching the dashboard. When invoked as `fn` / `fusion`, forwards args
// verbatim so behavior matches the main CLI exactly (e.g. bare `fn` prints
// help, not `fn dashboard`).

import { basename } from "node:path";

const args = globalThis.process.argv.slice(2);
const invokedAs = basename(globalThis.process.argv[1] || "").replace(/\.(js|cjs|mjs|exe)$/i, "");
const isAliasInvocation = invokedAs === "runfusion.ai" || invokedAs === "runfusion";

if (isAliasInvocation && args.length === 0) {
  // No subcommand → default to dashboard.
  globalThis.process.argv = [globalThis.process.argv[0], globalThis.process.argv[1], "dashboard"];
}

await import("@runfusion/fusion/dist/bin.js");
