---
title: "S02: merge request projection onto work items"
type: refactor
status: draft-stack-handoff
date: 2026-06-09
slice: S02
milestone: "Foundation"
origin: docs/plans/2026-06-09-003-refactor-workflow-owned-merge-full-migration-slices-plan.md
stack_base: feature/workflow-owned-merge-retry-scheduling-plan
---

# S02: merge request projection onto work items

## Stack Role

This draft PR reserves the S02 review slot in the workflow-owned merge,
retry, scheduling, and recovery migration stack. It is intentionally a handoff
artifact, not the completed implementation for this slice.

## Milestone

Foundation

## Depends On

S1 workflow work-item schema and store API.

## Goal

Project existing merge request records into workflow work-item state so dashboards and schedulers can dual-read before cutover.

## Expected File Scope

packages/core/src/store.ts; packages/core/src/task-merge.ts; packages/core/src/types.ts; merge-request and dual-observe tests.

## Expected Tests

Projection tests for queued/running/retrying/manual-required/succeeded/exhausted states, hard cancel cancellation, and restart idempotency.

## Exit Gate

Every merge request state has a lossless workflow work-item equivalent.

## Full Plan

See `docs/plans/2026-06-09-003-refactor-workflow-owned-merge-full-migration-slices-plan.md`.
