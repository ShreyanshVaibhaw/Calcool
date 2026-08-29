import { isTauri } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";
import { useCallback, useRef, useState } from "react";

export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "installing" | "current" | "error";

export interface UpdateState {
  phase: UpdatePhase;
  message: string;
  version?: string;
  progress?: number;
}

const INITIAL_STATE: UpdateState = {
  phase: "idle",
  message: "Check GitHub for a newer signed release.",
};

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useAppUpdater() {
  const [state, setState] = useState<UpdateState>(INITIAL_STATE);
  const pendingUpdate = useRef<Update | null>(null);

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) {
      setState({ phase: "error", message: "Update checks are available in the installed app." });
      return;
    }

    setState({ phase: "checking", message: "Checking GitHub releases..." });
    try {
      if (pendingUpdate.current) await pendingUpdate.current.close();
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check({ timeout: 15_000 });
      pendingUpdate.current = update;

      if (!update) {
        setState({ phase: "current", message: "Calcool is up to date." });
        return;
      }

      setState({
        phase: "available",
        version: update.version,
        message: update.body?.trim() || `Calcool ${update.version} is ready to install.`,
      });
    } catch (error) {
      setState({ phase: "error", message: `Could not check for updates. ${readableError(error)}` });
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;

    let downloaded = 0;
    let total: number | undefined;
    setState({ phase: "downloading", version: update.version, message: `Downloading Calcool ${update.version}...`, progress: 0 });

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = total ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined;
          setState({ phase: "downloading", version: update.version, message: `Downloading Calcool ${update.version}...`, progress });
        } else {
          setState({ phase: "installing", version: update.version, message: "Installing update and restarting...", progress: 100 });
        }
      });

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      setState({ phase: "error", version: update.version, message: `Update failed. ${readableError(error)}` });
    }
  }, []);

  const busy = state.phase === "checking" || state.phase === "downloading" || state.phase === "installing";
  return { state, busy, checkForUpdates, installUpdate };
}
