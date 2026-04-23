# OpenClaw Runtime Plugin

> **Status:** Experimental placeholder - runtime execution deferred

Provides an OpenClaw runtime plugin for Fusion. This package enables runtime registration and discovery so agents can be configured with `runtimeConfig.runtimeHint: "openclaw"`.

## Overview

This plugin mirrors the Hermes runtime plugin pattern: runtime registration succeeds and can be discovered by Fusion's runtime resolver, while execution behavior is intentionally deferred.

## Installation

### Option 1: Copy to plugins directory

```bash
cp -r fusion-plugin-openclaw-runtime ~/.fusion/plugins/
```

### Option 2: Install via CLI

```bash
fn plugin add ./plugins/fusion-plugin-openclaw-runtime
```

## Current Status

| Component | Status |
|-----------|--------|
| Plugin Scaffold | ✅ Complete |
| Runtime Registration | ✅ Complete |
| Runtime Discovery | ✅ Complete |
| Runtime Execution | ⏳ Deferred placeholder |

## Runtime Metadata

- **Plugin ID:** `fusion-plugin-openclaw-runtime`
- **Package name:** `@fusion-plugin-examples/openclaw-runtime`
- **Runtime ID:** `openclaw`
- **Runtime name:** `OpenClaw Runtime`
- **Version:** `0.1.0`
- **Description:** Experimental OpenClaw runtime integration for Fusion tasks (execution deferred)

## Agent Configuration

Configure an agent to target OpenClaw via `runtimeConfig.runtimeHint`:

```json
{
  "name": "OpenClaw Executor",
  "role": "executor",
  "runtimeConfig": {
    "runtimeHint": "openclaw"
  }
}
```

## Placeholder Runtime Behavior

The runtime factory currently returns a deferred placeholder object:

- Runtime registration and lookup are supported
- Runtime factory invocation succeeds
- `execute()` intentionally throws a descriptive not-implemented/deferred error

This prevents silent misbehavior while making runtime configuration and compatibility tests possible.

## Local Development

```bash
# Run plugin tests
pnpm --filter @fusion-plugin-examples/openclaw-runtime test

# Build plugin output to dist/
pnpm --filter @fusion-plugin-examples/openclaw-runtime build
```
