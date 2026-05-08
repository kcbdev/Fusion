import { useCallback } from "react";
import { useShellContext } from "../context/ShellContext";
import {
  createOrUpdateProfile,
  deleteProfile,
  normalizeShellState,
  selectActiveProfile,
} from "../utils/shell-connection-settings";
import type { ShellConnectionProfileInput } from "../types/native-shell";

export function useShellConnection() {
  const context = useShellContext();

  const saveProfile = useCallback((profile: ShellConnectionProfileInput) => createOrUpdateProfile(context.shellApi, profile), [context.shellApi]);
  const removeProfile = useCallback((profileId: string) => deleteProfile(context.shellApi, profileId), [context.shellApi]);
  const setActiveProfile = useCallback((profileId: string | null) => selectActiveProfile(context.shellApi, profileId), [context.shellApi]);

  return {
    ...context,
    state: normalizeShellState(context.state),
    saveProfile,
    removeProfile,
    setActiveProfile,
  };
}
