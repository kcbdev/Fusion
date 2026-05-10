import type { PluginContext, PluginRouteDefinition, PluginRouteResult } from "@fusion/core";
import { createDraftStore, NotFoundError } from "../storage/draft-store.js";
import type { ServiceDraft } from "../wizard/types.js";
import { validateDraft } from "../wizard/validation.js";

interface RouteRequest {
  params: Record<string, string>;
  body?: unknown;
}

function asRequest(req: unknown): RouteRequest { return req as RouteRequest; }

function ok(body: unknown, status = 200): PluginRouteResult { return { status, body }; }

export function createCliPrintingPressRoutes(): PluginRouteDefinition[] {
  return [
    {
      method: "POST",
      path: "/drafts",
      handler: async (req, ctx: PluginContext) => {
        const request = asRequest(req);
        const draft = request.body as ServiceDraft;
        const result = validateDraft(draft);
        if (!result.ok) return { status: 400, body: { error: Object.values(result.errors)[0] ?? "Validation failed", errors: result.errors } };
        const store = createDraftStore({ rootDir: ctx.taskStore.getRootDir() });
        const created = await store.create(draft);
        return ok(created, 201);
      },
    },
    {
      method: "GET",
      path: "/drafts",
      handler: async (_req, ctx: PluginContext) => {
        const store = createDraftStore({ rootDir: ctx.taskStore.getRootDir() });
        return ok(await store.list());
      },
    },
    {
      method: "GET",
      path: "/drafts/:id",
      handler: async (req, ctx: PluginContext) => {
        const request = asRequest(req);
        const store = createDraftStore({ rootDir: ctx.taskStore.getRootDir() });
        const draft = await store.get(request.params.id);
        return draft ? ok(draft) : ok({ error: "Draft not found" }, 404);
      },
    },
    {
      method: "PUT",
      path: "/drafts/:id",
      handler: async (req, ctx: PluginContext) => {
        const request = asRequest(req);
        const draft = request.body as ServiceDraft;
        const result = validateDraft(draft);
        if (!result.ok) return { status: 400, body: { error: Object.values(result.errors)[0] ?? "Validation failed", errors: result.errors } };
        const store = createDraftStore({ rootDir: ctx.taskStore.getRootDir() });
        try {
          const updated = await store.update(request.params.id, draft);
          return ok(updated);
        } catch (error) {
          if (error instanceof NotFoundError) return ok({ error: "Draft not found" }, 404);
          throw error;
        }
      },
    },
    {
      method: "POST",
      path: "/drafts/:id/regenerate",
      handler: async (req, ctx: PluginContext) => {
        const request = asRequest(req);
        const store = createDraftStore({ rootDir: ctx.taskStore.getRootDir() });
        try {
          const draft = await store.update(request.params.id, { regeneratedAt: new Date().toISOString() });
          return ok({ draft, stub: true, message: "Regenerate stub — full generation lands in FN-3765/FN-3767" });
        } catch (error) {
          if (error instanceof NotFoundError) return ok({ error: "Draft not found" }, 404);
          throw error;
        }
      },
    },
    {
      method: "DELETE",
      path: "/drafts/:id",
      handler: async (req, ctx: PluginContext) => {
        const request = asRequest(req);
        const store = createDraftStore({ rootDir: ctx.taskStore.getRootDir() });
        await store.delete(request.params.id);
        return { status: 204 };
      },
    },
  ];
}
