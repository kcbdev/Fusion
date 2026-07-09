export class GrokRuntimeAdapter {
  readonly id = "grok";
  readonly name = "Grok Runtime";

  async createSession(options: { defaultModelId?: string; systemPrompt?: string }) {
    return {
      session: {
        model: options.defaultModelId ?? "grok/default",
        systemPrompt: options.systemPrompt,
        messages: [],
      },
      sessionFile: undefined,
    };
  }

  /*
  FNXC:GrokCli 2026-07-09-00:00:
  FN-7715: this is an INTENTIONAL no-op, not unfinished work. FN-7711 already
  routes `grok-cli/*` model selections through the standard pi/openai-completions
  streaming path against https://api.x.ai/v1 — that is the real, exercised Grok
  streaming path. The `grok` binary (see provider.ts / process-manager.ts) is
  wired for discovery/probe only (`grok models`, `grok --version`); there is no
  documented non-interactive prompt/stream subcommand to invoke here, and
  inventing one would violate the external-integration-evidence policy. This
  adapter's `promptWithFallback` is only reached when an agent's
  `runtimeConfig.runtimeHint === "grok"`, which nothing in the product sets
  today. Mirrors the identical intentional stub in the sibling Cursor plugin
  (`fusion-plugin-cursor-runtime/src/runtime-adapter.ts`, TODO(FN-3396)). If a
  stable non-interactive `grok` CLI streaming contract is confirmed upstream in
  the future, a follow-up task can revisit this.
  */
  async promptWithFallback(): Promise<void> {
    return;
  }

  describeModel(session: { model?: string }) {
    return `grok/${session.model ?? "default"}`;
  }
}
