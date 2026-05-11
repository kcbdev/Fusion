import { AgentStore, ChatStore, type MessageStore, type TaskStore } from "@fusion/core";
import type { PluginRunner, ProjectEngineManager } from "@fusion/engine";
import { ChatManager } from "./chat.js";
import { getOrCreateProjectStore } from "./project-store-resolver.js";

const scopedChatStoreCache = new Map<string, ChatStore>();

function cacheKeyForStore(store: TaskStore): string {
  return store.getFusionDir();
}

export function getOrCreateScopedChatStore(store: TaskStore, fallbackChatStore?: ChatStore): ChatStore {
  const key = cacheKeyForStore(store);
  const cached = scopedChatStoreCache.get(key);
  if (cached) return cached;

  const chatStore = fallbackChatStore ?? new ChatStore(store.getFusionDir(), store.getDatabase());
  scopedChatStoreCache.set(key, chatStore);
  return chatStore;
}

export async function resolveProjectChatContext(options: {
  projectId?: string | null;
  defaultStore: TaskStore;
  defaultChatStore?: ChatStore;
  engineManager?: ProjectEngineManager;
}): Promise<{ store: TaskStore; chatStore: ChatStore }> {
  const { projectId, defaultStore, defaultChatStore, engineManager } = options;
  if (!projectId) {
    return {
      store: defaultStore,
      chatStore: getOrCreateScopedChatStore(defaultStore, defaultChatStore),
    };
  }

  const engine = engineManager?.getEngine(projectId);
  const scopedStore = engine?.getTaskStore() ?? await getOrCreateProjectStore(projectId);
  return {
    store: scopedStore,
    chatStore: getOrCreateScopedChatStore(scopedStore),
  };
}

export async function createProjectScopedChatManager(options: {
  store: TaskStore;
  chatStore: ChatStore;
  pluginRunner?: PluginRunner;
  messageStore?: MessageStore;
}): Promise<ChatManager> {
  const agentStore = new AgentStore({ rootDir: options.store.getFusionDir() });
  return new ChatManager(
    options.chatStore,
    options.store.getRootDir(),
    agentStore,
    options.pluginRunner,
    () => options.store.getSettings(),
    options.messageStore,
  );
}

export function __resetScopedChatStoreCache(): void {
  scopedChatStoreCache.clear();
}
