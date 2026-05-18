import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import React from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  tertiaryLabel?: string;
  tertiaryDanger?: boolean;
}

export type ConfirmChoice = "primary" | "tertiary" | "cancel";

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: ConfirmChoice) => void;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmWithChoice: (options: ConfirmOptions) => Promise<ConfirmChoice>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingConfirm[]>([]);
  const queueRef = useRef<PendingConfirm[]>([]);

  const updateQueue = useCallback((updater: (current: PendingConfirm[]) => PendingConfirm[]) => {
    setQueue((current) => {
      const next = updater(current);
      queueRef.current = next;
      return next;
    });
  }, []);

  const confirmWithChoice = useCallback((options: ConfirmOptions) => {
    return new Promise<ConfirmChoice>((resolve) => {
      updateQueue((current) => [...current, { options, resolve }]);
    });
  }, [updateQueue]);

  const confirm = useCallback(async (options: ConfirmOptions) => {
    const choice = await confirmWithChoice(options);
    return choice === "primary";
  }, [confirmWithChoice]);

  const resolveCurrent = useCallback((value: ConfirmChoice) => {
    const current = queueRef.current[0];
    if (!current) {
      return;
    }

    current.resolve(value);
    updateQueue((items) => items.slice(1));
  }, [updateQueue]);

  const active = queue[0] ?? null;

  const contextValue = useMemo<ConfirmContextValue>(() => ({ confirm, confirmWithChoice }), [confirm, confirmWithChoice]);

  return React.createElement(
    ConfirmContext.Provider,
    { value: contextValue },
    children,
    React.createElement(ConfirmDialog, {
      isOpen: active !== null,
      options: active?.options ?? null,
      onConfirm: () => resolveCurrent("primary"),
      onTertiary: () => resolveCurrent("tertiary"),
      onCancel: () => resolveCurrent("cancel"),
    })
  );
}

export function useConfirm(): ConfirmContextValue {
  const context = useContext(ConfirmContext);
  if (context) {
    return context;
  }

  return {
    confirm: async (_options: ConfirmOptions) => false,
    confirmWithChoice: async (_options: ConfirmOptions) => "cancel",
  };
}
