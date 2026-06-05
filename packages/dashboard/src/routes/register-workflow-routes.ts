import type { WorkflowDefinition, WorkflowDefinitionKind, WorkflowIr, WorkflowIrNode } from "@fusion/core";
import { ColumnTraitValidationError, OccupiedColumnsError, InvalidRehomeTargetError, WorkflowCompileError, WorkflowIrError, SCHEMA_VERSION, assertColumnTraitsValid, compileWorkflowToSteps, listTraits, listStepParsers, parseWorkflowIr } from "@fusion/core";
import { validateCodeNodeSources } from "@fusion/engine";
import { ApiError, badRequest, conflict, notFound } from "../api-error.js";
import { emitWorkflowSseEvent } from "../sse.js";
import type { ApiRoutesContext } from "./types.js";

/**
 * Routes for named workflow definitions, IR compilation preview, per-task
 * workflow selection, and the project default workflow. All state changes flow
 * through @fusion/core's TaskStore; none touch the engine's scheduler/executor.
 */
export function registerWorkflowRoutes(ctx: ApiRoutesContext): void {
  const { router, getProjectContext, rethrowAsApiError } = ctx;

  function requireIr(body: unknown): WorkflowIr {
    const ir = (body as { ir?: unknown })?.ir;
    if (!ir || typeof ir !== "object") {
      throw badRequest("ir is required and must be a workflow graph object");
    }
    return ir as WorkflowIr;
  }

  /**
   * Save-time `code` node compile validation (KTD-15 handoff). Runs the engine's
   * esbuild transform over every `code` node's source (including nodes nested in
   * foreach templates) and throws a 400 listing the failing nodes BEFORE the IR is
   * persisted, so a workflow with an uncompilable code node can never be saved and
   * deferred to an execution-time failure. A null/non-object IR is left to the
   * store's own validator (this only inspects node arrays it can read).
   */
  async function assertCodeNodesCompile(ir: unknown): Promise<void> {
    const nodes = (ir as { nodes?: unknown })?.nodes;
    if (!Array.isArray(nodes)) return;
    const failures = await validateCodeNodeSources({ nodes: nodes as WorkflowIrNode[] });
    if (failures.length > 0) {
      throw badRequest(
        `Workflow has ${failures.length} code node(s) that failed to compile`,
        { codeNodeErrors: failures },
      );
    }
  }

  // GET /api/traits — trait catalog for the node editor's trait picker (U10).
  // Returns the registry's listTraits() (built-ins + any registered plugin
  // traits): id, name, description, flags, hook descriptors, and config schema.
  // Session-scoped via getProjectContext exactly like the other workflow routes;
  // no new auth surface. The catalog is registry-backed and read-only, so it
  // does not depend on the project store beyond confirming the session.
  router.get("/traits", async (req, res) => {
    try {
      await getProjectContext(req);
      res.json({
        traits: listTraits().map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          builtin: t.builtin === true,
          flags: t.flags,
          hooks: t.hooks,
          configSchema: t.configSchema,
        })),
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // GET /api/step-parsers — step-parser catalog for the parse-steps node
  // inspector (KTD-12). Returns the registry's listStepParsers() ids (built-ins
  // plus any registered plugin parsers), mirroring GET /api/traits: registry-
  // backed, read-only, and session-scoped via getProjectContext. The editor
  // falls back to the built-in pair if this fetch fails, so it adds no hard
  // dependency on the project store beyond confirming the session.
  router.get("/step-parsers", async (req, res) => {
    try {
      await getProjectContext(req);
      res.json({
        parsers: listStepParsers().map((p) => ({ id: p.id })),
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // GET /api/workflows — list all workflow definitions for the project.
  router.get("/workflows", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      res.json(await store.listWorkflowDefinitions());
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // POST /api/workflows — create a workflow. Body: { name, description?, ir, layout? }
  router.post("/workflows", async (req, res) => {
    try {
      const { store, projectId } = await getProjectContext(req);
      const { name, description, layout } = req.body ?? {};
      if (!name || typeof name !== "string" || !name.trim()) {
        throw badRequest("name is required");
      }
      const ir = requireIr(req.body);
      await assertCodeNodesCompile(ir);
      const created = await store.createWorkflowDefinition({ name, description, ir, layout });
      emitWorkflowSseEvent("workflow:created", created, projectId);
      res.status(201).json(created);
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      if (err instanceof WorkflowIrError) throw badRequest(err.message);
      // Residual A: server-side trait composition conflict → 400 with the
      // structured violations (consistent with the IR-error 4xx mapping).
      if (err instanceof ColumnTraitValidationError) {
        throw badRequest(err.message, { violations: err.violations });
      }
      rethrowAsApiError(err);
    }
  });

  // GET /api/workflows/:id
  router.get("/workflows/:id", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      const def = await store.getWorkflowDefinition(req.params.id);
      if (!def) throw notFound(`Workflow '${req.params.id}' not found`);
      res.json(def);
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // PATCH /api/workflows/:id — partial update. Body: { name?, description?, ir?, layout? }
  router.patch("/workflows/:id", async (req, res) => {
    try {
      const { store, projectId } = await getProjectContext(req);
      const { name, description, ir, layout, rehomeTo } = req.body ?? {};
      if (name !== undefined && (typeof name !== "string" || !name.trim())) {
        throw badRequest("name must be a non-empty string");
      }
      if (ir !== undefined && (typeof ir !== "object" || ir === null)) {
        throw badRequest("ir must be a workflow graph object");
      }
      if (rehomeTo !== undefined && typeof rehomeTo !== "string") {
        throw badRequest("rehomeTo must be a string column id");
      }
      if (ir !== undefined) {
        await assertCodeNodesCompile(ir);
      }
      const updated = await store.updateWorkflowDefinition(req.params.id, {
        name,
        description,
        ir,
        layout,
        ...(rehomeTo !== undefined ? { rehomeTo } : {}),
      });
      emitWorkflowSseEvent("workflow:updated", updated, projectId);
      res.json(updated);
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      // U5 (R20): a flag-ON edit removing an occupied column blocks with a typed
      // error. Surface it as a structured 409 carrying the per-column occupant
      // counts so the client can prompt for a `rehomeTo` target and retry.
      if (err instanceof OccupiedColumnsError) {
        throw conflict(err.message, { workflowId: err.workflowId, occupancies: err.occupancies });
      }
      // A supplied rehomeTo naming a non-existent column is a bad request (400),
      // not a 409 conflict.
      if (err instanceof InvalidRehomeTargetError) {
        throw badRequest(err.message, { workflowId: err.workflowId, rehomeTo: err.rehomeTo });
      }
      if (err instanceof WorkflowIrError) throw badRequest(err.message);
      if (err instanceof ColumnTraitValidationError) {
        throw badRequest(err.message, { violations: err.violations });
      }
      if (err instanceof Error && /not found/i.test(err.message)) throw notFound(err.message);
      rethrowAsApiError(err);
    }
  });

  // DELETE /api/workflows/:id
  router.delete("/workflows/:id", async (req, res) => {
    try {
      const { store, projectId } = await getProjectContext(req);
      await store.deleteWorkflowDefinition(req.params.id);
      emitWorkflowSseEvent("workflow:deleted", { id: req.params.id }, projectId);
      res.status(204).send();
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      if (err instanceof Error && /not found/i.test(err.message)) throw notFound(err.message);
      rethrowAsApiError(err);
    }
  });

  // POST /api/workflows/:id/compile — preview the compiled WorkflowSteps.
  // 200 with the step set, or 422 when the graph requires the deferred interpreter.
  router.post("/workflows/:id/compile", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      const def = await store.getWorkflowDefinition(req.params.id);
      if (!def) throw notFound(`Workflow '${req.params.id}' not found`);
      try {
        res.json({ steps: compileWorkflowToSteps(def.ir) });
      } catch (compileErr: unknown) {
        if (compileErr instanceof WorkflowCompileError || compileErr instanceof WorkflowIrError) {
          throw new ApiError(422, compileErr.message);
        }
        throw compileErr;
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // GET /api/tasks/:taskId/workflow — current selection for a task.
  router.get("/tasks/:taskId/workflow", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      const selection = store.getTaskWorkflowSelection(req.params.taskId);
      res.json({ workflowId: selection?.workflowId ?? null });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // PUT /api/tasks/:taskId/workflow — select (or clear) a workflow for a task.
  // Body: { workflowId: string | null }
  router.put("/tasks/:taskId/workflow", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      const workflowId = (req.body ?? {}).workflowId;
      // Only an explicit null clears the selection. An omitted field
      // (e.g. a malformed `{}` body) must fail validation rather than
      // silently wiping the task's workflow.
      if (workflowId === undefined) {
        throw badRequest("workflowId is required (string to select, null to clear)");
      }
      if (workflowId === null) {
        await store.clearTaskWorkflowSelection(req.params.taskId);
        res.json({ workflowId: null, enabledWorkflowSteps: [] });
        return;
      }
      if (typeof workflowId !== "string") {
        throw badRequest("workflowId must be a string or null");
      }
      let enabledWorkflowSteps: string[] = [];
      // U5 (R20) switch reconciliation: when the workflowColumns flag is ON, the
      // store re-homes the card to the new workflow's entry column (aborting
      // in-flight work first) unless the new workflow defines its current column.
      // The re-home outcome rides on the response so the UI can reflect the move.
      let reconciliation: { preserved: boolean; fromColumn: string; toColumn: string } | undefined;
      try {
        const result = await store.selectTaskWorkflowAndReconcile(req.params.taskId, workflowId);
        enabledWorkflowSteps = result.enabledWorkflowSteps;
        reconciliation = result.reconciliation;
      } catch (selectErr: unknown) {
        if (selectErr instanceof WorkflowCompileError || selectErr instanceof WorkflowIrError) {
          throw new ApiError(422, selectErr.message);
        }
        if (selectErr instanceof Error && /not found/i.test(selectErr.message)) {
          throw notFound(selectErr.message);
        }
        throw selectErr;
      }
      res.json({ workflowId, enabledWorkflowSteps, ...(reconciliation ? { reconciliation } : {}) });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // POST /api/tasks/:taskId/workflow/approve-cli — approve the raw CLI command
  // the task is currently paused on (trust-on-first-use) and resume the run.
  router.post("/tasks/:taskId/workflow/approve-cli", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      const task = await store.getTask(req.params.taskId);
      const reason = task.pausedReason ?? "";
      const match = /^workflow-cli-approval:[^:]+:\s*(.*)$/s.exec(reason);
      // Derive the approved command exclusively from the task's pausedReason.
      // A caller-supplied body.command must never be trusted — accepting it
      // would let any client approve an arbitrary command the task is not
      // actually paused on, bypassing trust-on-first-use entirely.
      const command = match ? match[1].trim() : "";
      // Require an active CLI-approval pause: a non-empty command parsed from
      // pausedReason AND the task actually paused. This rejects approvals
      // against a stale reason string on an already-resumed task.
      if (!task.paused || !command) {
        throw badRequest("No pending CLI command to approve for this task");
      }
      await store.approveWorkflowCliCommand(command);
      await store.updateTask(req.params.taskId, { status: null, paused: false, pausedReason: null });
      res.json({ approved: command });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // POST /api/tasks/:taskId/workflow/input — submit the user's answer to an
  // await-input node (records a steering comment and resumes the task).
  router.post("/tasks/:taskId/workflow/input", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      const text = (req.body?.text as string | undefined)?.trim();
      if (!text) throw badRequest("Input text is required");
      await store.addSteeringComment(req.params.taskId, text);
      // Do NOT clear pausedReason here: runAwaitInputNode checks
      // (live.pausedReason ?? "").startsWith(marker) to confirm this specific
      // node previously paused the task. Clearing it would make every re-run
      // re-pause without ever consuming the answer. The node clears the marker
      // itself once it consumes the input.
      await store.updateTask(req.params.taskId, { status: null, paused: false });
      res.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // GET /api/project/default-workflow
  router.get("/project/default-workflow", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      res.json({ workflowId: (await store.getDefaultWorkflowId()) ?? null });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // PUT /api/project/default-workflow — Body: { workflowId: string | null }
  router.put("/project/default-workflow", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      const workflowId = (req.body ?? {}).workflowId;
      if (workflowId !== null && typeof workflowId !== "string") {
        throw badRequest("workflowId must be a string or null");
      }
      try {
        await store.setDefaultWorkflowId(workflowId);
      } catch (setErr: unknown) {
        if (setErr instanceof Error && /not found/i.test(setErr.message)) {
          throw notFound(setErr.message);
        }
        throw setErr;
      }
      res.json({ workflowId: workflowId ?? null });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // POST /api/workflows/migrate-legacy-steps — Lazy idempotent migration of
  // legacy user-authored workflow steps into fragments + a combined "Migrated
  // steps" workflow (U2/R5/KTD-3). Fired once per project on first editor open;
  // safe to call repeatedly (idempotent via per-row markers). Returns the counts.
  router.post("/workflows/migrate-legacy-steps", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      const result = await store.migrateLegacyWorkflowSteps();
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // GET /api/workflows/:id/export — emit a portable, versioned JSON envelope for
  // a single workflow or fragment (U5/R9/KTD-5). Built-ins are exportable too —
  // the lookup mirrors GET /workflows/:id (built-ins resolved by
  // getWorkflowDefinition). The envelope carries the server's SCHEMA_VERSION so
  // import can version-gate it; the client triggers a file download.
  router.get("/workflows/:id/export", async (req, res) => {
    try {
      const { store } = await getProjectContext(req);
      const def = await store.getWorkflowDefinition(req.params.id);
      if (!def) throw notFound(`Workflow '${req.params.id}' not found`);
      res.json({
        fusionWorkflowExport: 1,
        schemaVersion: SCHEMA_VERSION,
        kind: def.kind,
        name: def.name,
        description: def.description,
        ir: def.ir,
        layout: def.layout,
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });

  // POST /api/workflows/import — validate a workflow export envelope at the write
  // boundary and create a fresh definition (U5/R10/KTD-5). Validation order is
  // strict: ANY failure short-circuits with a 4xx and ZERO writes.
  //   1. envelope marker            → 400
  //   2. schemaVersion > server's   → 409 (forward-incompatible)
  //   3. parseWorkflowIr            → 422 (parser message)
  //   4. trait availability         → 422 (names the missing trait)
  //   5. strip cliSkipApproval/autoApprove from every node config (incl. foreach
  //      template nodes) — trust boundary; flagged in the response.
  //   6. scriptName existence       → non-blocking WARNINGS
  //   7. fresh id + name collision suffix → store.createWorkflowDefinition
  router.post("/workflows/import", async (req, res) => {
    try {
      const { store, projectId } = await getProjectContext(req);
      const envelope = (req.body ?? {}) as Record<string, unknown>;

      // 1. Envelope marker.
      if (envelope.fusionWorkflowExport !== 1) {
        throw badRequest(
          "Not a Fusion workflow export file (missing or invalid fusionWorkflowExport marker)",
        );
      }

      // 2. Schema version gate: equal/older accepted, newer rejected.
      const schemaVersion = envelope.schemaVersion;
      if (typeof schemaVersion === "number" && schemaVersion > SCHEMA_VERSION) {
        throw conflict(
          `This file was exported from a newer Fusion (schema version ${schemaVersion}); this server supports up to ${SCHEMA_VERSION}. Update Fusion to import it.`,
        );
      }

      // 3. Parse/validate the IR (parser message surfaced as 422).
      let ir: WorkflowIr;
      try {
        ir = parseWorkflowIr(envelope.ir as WorkflowIr);
      } catch (parseErr: unknown) {
        if (parseErr instanceof WorkflowIrError) {
          throw new ApiError(422, parseErr.message);
        }
        throw new ApiError(
          422,
          parseErr instanceof Error ? parseErr.message : "Invalid workflow IR",
        );
      }

      // 4. Trait availability (v2 columns) — names the missing/unknown trait.
      try {
        assertImportTraitsValid(ir);
      } catch (traitErr: unknown) {
        if (traitErr instanceof ColumnTraitValidationError) {
          throw new ApiError(422, traitErr.message);
        }
        throw traitErr;
      }

      // 5. Strip trust-escalating flags from every node config (incl. foreach
      // templates). Operates on the parsed IR so the stored definition can never
      // carry an approval bypass smuggled through an untrusted file.
      const strippedApprovalFlags = stripApprovalFlags(ir);

      // 6. scriptName warnings (non-blocking): a script node referencing a name
      // absent from the project's configured scripts is importable, but flagged.
      const settings = await store.getSettingsFast();
      const knownScripts = new Set(Object.keys(settings.scripts ?? {}));
      const warnings = collectScriptNameWarnings(ir, knownScripts);

      // 7. Fresh id is server-minted by createWorkflowDefinition; resolve a
      // collision-free name (case-sensitive exact match across the merged set,
      // built-ins included).
      const existingNames = new Set(
        (await store.listWorkflowDefinitions()).map((w) => w.name),
      );
      const rawName =
        typeof envelope.name === "string" && envelope.name.trim()
          ? envelope.name.trim()
          : "Imported workflow";
      const name = resolveImportName(rawName, existingNames);

      const kind: WorkflowDefinitionKind =
        envelope.kind === "fragment" ? "fragment" : "workflow";
      const layout =
        envelope.layout && typeof envelope.layout === "object"
          ? (envelope.layout as WorkflowDefinition["layout"])
          : {};

      let workflow: WorkflowDefinition;
      try {
        workflow = await store.createWorkflowDefinition({
          name,
          description:
            typeof envelope.description === "string" ? envelope.description : "",
          kind,
          ir,
          layout,
        });
      } catch (createErr: unknown) {
        // The store re-validates IR/traits; surface those as 422 (the envelope is
        // the untrusted input) rather than a 500.
        if (createErr instanceof WorkflowIrError) throw new ApiError(422, createErr.message);
        if (createErr instanceof ColumnTraitValidationError) {
          throw new ApiError(422, createErr.message);
        }
        throw createErr;
      }

      emitWorkflowSseEvent("workflow:created", workflow, projectId);
      res.status(201).json({ workflow, strippedApprovalFlags, warnings });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      rethrowAsApiError(err);
    }
  });
}

/** Validate trait availability for an imported IR exactly as the store does on
 *  create (v1 IRs with no columns are a no-op). Kept local to the import route so
 *  the 422 fires BEFORE any write — the store would also reject, but importing
 *  must short-circuit on the untrusted envelope, not after a partial write. */
function assertImportTraitsValid(ir: WorkflowIr): void {
  const columns = (ir as { columns?: Parameters<typeof assertColumnTraitsValid>[0] }).columns;
  if (Array.isArray(columns) && columns.length > 0) {
    // Throws ColumnTraitValidationError naming the unknown trait.
    assertColumnTraitsValid(columns);
  }
}

/** Strip `cliSkipApproval`/`autoApprove` from every node config in the IR,
 *  including configs nested inside foreach `template.nodes`. Returns true when
 *  anything was removed so the response can flag it (R10 trust boundary). */
function stripApprovalFlags(ir: WorkflowIr): boolean {
  const nodes = (ir as { nodes?: WorkflowIrNode[] }).nodes;
  if (!Array.isArray(nodes)) return false;
  let stripped = false;
  const stripNode = (node: WorkflowIrNode): void => {
    const cfg = node.config as Record<string, unknown> | undefined;
    if (cfg && typeof cfg === "object") {
      if ("cliSkipApproval" in cfg) {
        delete cfg.cliSkipApproval;
        stripped = true;
      }
      if ("autoApprove" in cfg) {
        delete cfg.autoApprove;
        stripped = true;
      }
      const template = (cfg as { template?: { nodes?: unknown } }).template;
      if (template && Array.isArray(template.nodes)) {
        for (const inner of template.nodes as WorkflowIrNode[]) stripNode(inner);
      }
    }
  };
  for (const node of nodes) stripNode(node);
  return stripped;
}

/** Collect non-blocking warnings for script nodes (and any config carrying a
 *  `scriptName`) whose script is absent from the project's configured scripts.
 *  Recurses into foreach templates so nested script nodes are covered too. */
function collectScriptNameWarnings(ir: WorkflowIr, knownScripts: Set<string>): string[] {
  const nodes = (ir as { nodes?: WorkflowIrNode[] }).nodes;
  if (!Array.isArray(nodes)) return [];
  const warnings: string[] = [];
  const visit = (node: WorkflowIrNode): void => {
    const cfg = node.config as Record<string, unknown> | undefined;
    if (cfg && typeof cfg === "object") {
      const scriptName = cfg.scriptName;
      if (typeof scriptName === "string" && scriptName.trim() && !knownScripts.has(scriptName)) {
        warnings.push(
          `Node '${node.id}' references script '${scriptName}', which is not configured in this project. Add it under Settings → Scripts before running this workflow.`,
        );
      }
      const template = (cfg as { template?: { nodes?: unknown } }).template;
      if (template && Array.isArray(template.nodes)) {
        for (const inner of template.nodes as WorkflowIrNode[]) visit(inner);
      }
    }
  };
  for (const node of nodes) visit(node);
  return warnings;
}

/** Case-sensitive exact-match collision policy (R10/KTD-5): append " (imported)"
 *  then " (imported 2)", " (imported 3)" … until the name is unique. */
function resolveImportName(baseName: string, existing: Set<string>): string {
  if (!existing.has(baseName)) return baseName;
  let candidate = `${baseName} (imported)`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${baseName} (imported ${n})`;
    n += 1;
  }
  return candidate;
}
