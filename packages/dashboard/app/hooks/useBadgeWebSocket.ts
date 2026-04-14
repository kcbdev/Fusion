import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { IssueInfo, PrInfo } from "@fusion/core";

interface BadgeUpdatedMessage {
  type: "badge:updated";
  taskId: string;
  prInfo?: PrInfo | null;
  issueInfo?: IssueInfo | null;
  timestamp: string;
}

interface BadgeSnapshot {
  prInfo?: PrInfo | null;
  issueInfo?: IssueInfo | null;
  timestamp: string;
}

interface StoreSnapshot {
  badgeUpdates: Map<string, BadgeSnapshot>;
  isConnected: boolean;
}

/**
 * Scoped key helper for multi-project isolation.
 * Keys are formatted as `${projectId}:${taskId}` to prevent
 * overlapping task IDs across projects from sharing badge state.
 */
function toScopedKey(projectId: string | null, taskId: string): string {
  return `${projectId ?? "default"}:${taskId}`;
}

class BadgeWebSocketStore {
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private badgeUpdates = new Map<string, BadgeSnapshot>();
  private subscriptionsByTask = new Map<string, Set<string>>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 1_000;
  private shouldReconnect = false;
  private isConnected = false;
  private projectId: string | null = null;
  private snapshot: StoreSnapshot = {
    badgeUpdates: new Map(),
    isConnected: false,
  };

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): StoreSnapshot {
    return this.snapshot;
  }

  setProjectId(projectId: string | null): void {
    if (this.projectId === projectId) return;

    const hadSubscriptions = this.subscriptionsByTask.size > 0;
    // Collect all (hookId, taskId) pairs that were subscribed
    const previousSubscriptions: Array<{ hookId: string; taskId: string }> = [];
    for (const [scopedTaskId, subscribers] of this.subscriptionsByTask) {
      // Extract taskId from scoped key (format: "projectId:taskId")
      const taskId = scopedTaskId.split(":").slice(1).join(":");
      for (const hookId of subscribers) {
        previousSubscriptions.push({ hookId, taskId });
      }
    }

    this.projectId = projectId;
    this.reset();

    // Re-subscribe to all previous subscriptions after project change
    // This ensures badge subscriptions survive project switches
    if (hadSubscriptions) {
      for (const { hookId, taskId } of previousSubscriptions) {
        const scopedKey = toScopedKey(this.projectId, taskId);
        this.subscriptionsByTask.set(scopedKey, new Set([hookId]));
      }
      // Set shouldReconnect BEFORE calling connect() to ensure the connection is made
      this.shouldReconnect = this.subscriptionsByTask.size > 0;
      // Note: we restore subscriptions BEFORE calling connect() so that
      // onopen will send the subscribe messages over the new socket
      this.connect();
    }
  }

  subscribeTask(hookId: string, taskId: string): void {
    const scopedKey = toScopedKey(this.projectId, taskId);
    const subscribers = this.subscriptionsByTask.get(scopedKey) ?? new Set<string>();
    const isNewSubscription = !subscribers.has(hookId);
    subscribers.add(hookId);
    this.subscriptionsByTask.set(scopedKey, subscribers);

    this.shouldReconnect = this.subscriptionsByTask.size > 0;
    this.connect();

    // Only send subscribe message if this is a genuinely new subscription
    // (not a re-subscription from project switch or unmount/remount)
    if (isNewSubscription) {
      this.send({ type: "subscribe", taskId });
    }
  }

  unsubscribeTask(hookId: string, taskId: string): void {
    const scopedKey = toScopedKey(this.projectId, taskId);
    const subscribers = this.subscriptionsByTask.get(scopedKey);
    if (!subscribers) return;

    subscribers.delete(hookId);
    if (subscribers.size === 0) {
      this.subscriptionsByTask.delete(scopedKey);
      this.badgeUpdates.delete(scopedKey);
      this.send({ type: "unsubscribe", taskId });
      this.emit();
    }

    this.shouldReconnect = this.subscriptionsByTask.size > 0;
    if (!this.shouldReconnect) {
      this.disconnect();
    }
  }

  cleanupHook(hookId: string): void {
    for (const scopedTaskId of [...this.subscriptionsByTask.keys()]) {
      // Extract taskId from scoped key
      const taskId = scopedTaskId.split(":").slice(1).join(":");
      this.unsubscribeTask(hookId, taskId);
    }
  }

  reset(): void {
    this.disconnect();
    this.badgeUpdates.clear();
    this.subscriptionsByTask.clear();
    this.shouldReconnect = false;
    this.emit();
  }

  private connect(): void {
    if (!this.shouldReconnect || typeof window === "undefined") {
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let url = `${protocol}//${window.location.host}/api/ws`;
    if (this.projectId) {
      url += `?projectId=${encodeURIComponent(this.projectId)}`;
    }
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.isConnected = true;
      this.reconnectDelayMs = 1_000;
      this.emit();

      // Extract raw taskIds from scoped keys (format: "projectId:taskId")
      const uniqueTaskIds = new Set<string>();
      for (const scopedKey of this.subscriptionsByTask.keys()) {
        const taskId = scopedKey.split(":").slice(1).join(":");
        uniqueTaskIds.add(taskId);
      }
      for (const taskId of uniqueTaskIds) {
        this.send({ type: "subscribe", taskId });
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as BadgeUpdatedMessage;
        if (message.type !== "badge:updated") {
          return;
        }

        const scopedKey = toScopedKey(this.projectId, message.taskId);
        const previous = this.badgeUpdates.get(scopedKey);
        this.badgeUpdates.set(scopedKey, {
          prInfo: hasMessageField(message, "prInfo") ? message.prInfo ?? null : previous?.prInfo,
          issueInfo: hasMessageField(message, "issueInfo") ? message.issueInfo ?? null : previous?.issueInfo,
          timestamp: message.timestamp,
        });
        this.emit();
      } catch {
        // Ignore malformed messages.
      }
    };

    ws.onclose = () => {
      this.ws = null;

      if (this.isConnected) {
        this.isConnected = false;
        this.emit();
      }

      if (!this.shouldReconnect) {
        return;
      }

      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // Closed socket is handled by onclose.
    };
  }

  private disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
    }

    if (this.isConnected) {
      this.isConnected = false;
      this.emit();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return;
    }

    const delay = Math.min(this.reconnectDelayMs, 5_000);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.shouldReconnect) {
        return;
      }

      this.connect();
    }, delay);

    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 5_000);
  }

  private send(message: { type: "subscribe" | "unsubscribe"; taskId: string }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  private emit(): void {
    this.snapshot = {
      badgeUpdates: new Map(this.badgeUpdates),
      isConnected: this.isConnected,
    };

    for (const listener of this.listeners) {
      listener();
    }
  }
}

const badgeWebSocketStore = new BadgeWebSocketStore();
let nextHookId = 0;

function hasMessageField(message: BadgeUpdatedMessage, field: "prInfo" | "issueInfo"): boolean {
  return Object.prototype.hasOwnProperty.call(message, field);
}

export function useBadgeWebSocket(projectId?: string): {
  badgeUpdates: Map<string, BadgeSnapshot>;
  isConnected: boolean;
  subscribeToBadge: (taskId: string) => void;
  unsubscribeFromBadge: (taskId: string) => void;
} {
  const hookIdRef = useRef<string | null>(null);
  if (hookIdRef.current === null) {
    hookIdRef.current = `badge-hook-${nextHookId++}`;
  }
  const snapshot = useSyncExternalStore(
    (listener) => badgeWebSocketStore.subscribe(listener),
    () => badgeWebSocketStore.getSnapshot(),
    () => badgeWebSocketStore.getSnapshot(),
  );

  const subscribeToBadge = useCallback((taskId: string) => {
    badgeWebSocketStore.subscribeTask(hookIdRef.current!, taskId);
  }, []);

  const unsubscribeFromBadge = useCallback((taskId: string) => {
    badgeWebSocketStore.unsubscribeTask(hookIdRef.current!, taskId);
  }, []);

  // Update project context when projectId changes
  useEffect(() => {
    badgeWebSocketStore.setProjectId(projectId ?? null);
  }, [projectId]);

  useEffect(() => {
    return () => {
      badgeWebSocketStore.cleanupHook(hookIdRef.current!);
    };
  }, []);

  return {
    badgeUpdates: snapshot.badgeUpdates,
    isConnected: snapshot.isConnected,
    subscribeToBadge,
    unsubscribeFromBadge,
  };
}

export function __resetBadgeWebSocketStoreForTests(): void {
  badgeWebSocketStore.reset();
  nextHookId = 0;
}
