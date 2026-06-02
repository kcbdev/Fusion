---
name: Fusion Pro
last_updated: 2026-06-02
---

# Fusion Pro Strategy

> **Private / closed-source.** This document lives only in `Runfusion/fusion-pro` and must never be referenced from or copied into the open-source `Runfusion/Fusion` repo. The open-source `STRATEGY.md` is the public anchor and stays free of any commercial or closed-edition language.

## Target problem

AI agent work is fragmented across many products, and each one locks you into its own models, workflows, and surfaces. Teams that have outgrown a single solo operator hit a second wall: the open orchestration layer they trust has no first-class path for multi-user access, control, and deployment without forking it or bolting on a silo.

## Our approach

Fusion Pro is the closed-source commercial edition built *on top of* the open-source core's pluggable extension points — never a fork. We keep the open core genuinely open and capable, and add the access, collaboration, and deployment capabilities that teams will pay for as private plugins, so the OSS product stays whole and Pro never holds it hostage.

## Who it's for

**Primary:** The small team that adopted open-source Fusion through a solo developer and now needs shared access, roles, and a deployment they can govern — hiring Fusion Pro to scale from one operator to a team without leaving the orchestration layer they already trust.

## Key metrics

- **Pro-converted teams** — OSS installs that adopt a Pro plugin/license; the core funnel signal.
- **Seats active per team** — weekly active users inside multi-user deployments; proves collaboration is used, not just licensed.
- **OSS→Pro extension coverage** — share of Pro capability delivered purely through public extension points (target: 100%); guards the no-fork commitment.
- **Net revenue retention** — expansion minus churn across Pro accounts; the lagging signal the model works.
- **Time-to-team** — median time from OSS adoption to a working multi-user deployment; lower means the Pro path is frictionless.

## Tracks

### Multi-user & access control

Roles, permissions, and shared workspaces delivered as Pro plugins on the OSS extension points.

_Why it serves the approach:_ This is the core paid value — and building it only against public seams is what keeps the "never a fork" promise honest.

### Governed deployment

Self-host and managed deployment options teams can administer, secure, and audit.

_Why it serves the approach:_ Teams pay for control; deployment is where multi-user value becomes operationally real.

### Open-core stewardship

Active investment in the OSS extension points Pro depends on, contributed upstream first.

_Why it serves the approach:_ If the open core's seams atrophy, Pro is forced to fork. Keeping them rich protects both editions.

### Commercial foundation

Licensing, billing, entitlement enforcement, and the boundary that keeps closed code out of the public repo.

_Why it serves the approach:_ A clean commercial and code boundary is what lets the open core stay fully open without leaking the paid edition.

## Not working on

- Closing or crippling the OSS core to drive conversion — the open product stays whole and useful on its own.
- Forking the OSS codebase — all Pro value ships through public extension points.
