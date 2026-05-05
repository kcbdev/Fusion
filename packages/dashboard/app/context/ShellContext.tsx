import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { FusionShellApi, ShellConnectionState } from "../types/native-shell";

interface ShellContextValue {
  shellApi: FusionShellApi | null;
  state: ShellConnectionState;
  ready: boolean;
}

const DEFAULT_STATE: ShellConnectionState = {
  host: "web",
  activeProfileId: null,
  profiles: [],
};

const ShellContext = createContext<ShellContextValue>({
  shellApi: null,
  state: DEFAULT_STATE,
  ready: true,
});

export function ShellProvider({ children }: PropsWithChildren) {
  const shellApi = useMemo(() => (typeof window !== "undefined" ? window.fusionShell ?? null : null), []);
  const [state, setState] = useState<ShellConnectionState>(DEFAULT_STATE);
  const [ready, setReady] = useState(!shellApi);

  useEffect(() => {
    if (!shellApi) {
      return;
    }

    let cancelled = false;
    void shellApi.getState().then((value) => {
      if (!cancelled) {
        setState(value);
        setReady(true);
      }
    });

    const unsubscribe = shellApi.subscribe((nextState) => {
      setState(nextState);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [shellApi]);

  return <ShellContext.Provider value={{ shellApi, state, ready }}>{children}</ShellContext.Provider>;
}

export function useShellContext(): ShellContextValue {
  return useContext(ShellContext);
}
