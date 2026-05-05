import { useShellContext } from "../context/ShellContext";

export function useShellConnection() {
  return useShellContext();
}
