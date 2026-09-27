import { isTauri } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { s } from "./strings";

export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "installing" | "current" | "error";

export interface UpdateState {
  phase: UpdatePhase;
  message: string;
  version?: string;
  progress?: number;
}

const INITIAL_STATE: UpdateState = {
  phase: "idle",
  message: s.updater.idle,
};

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Classify updater failures so offline and signature problems get distinct,
// actionable copy instead of a raw plugin error. Pure: unit-tested below.
export type UpdateErrorKind = "offline" | "signature" | "other";

export function classifyUpdateError(error: unknown): UpdateErrorKind {
  const msg = readableError(error).toLowerCase();
  if (/signature|invalid signature|minisign|pubkey|verification failed|tamper/.test(msg)) return "signature";
  if (
    error instanceof TypeError || // fetch rejects TypeError when offline
    /network|fetch failed|failed to fetch|enotfound|econn|etimedout|timed out|timeout|offline|dns|unreachable|connection|503|502|504/.test(msg)
  ) {
    return "offline";
  }
  return "other";
}

export function useAppUpdater() {
  const [state, setState] = useState<UpdateState>(INITIAL_STATE);
  const [version, setVersion] = useState("dev");
  const pendingUpdate = useRef<Update | null>(null);

  // the running app version for the settings row (browser dev shows "dev")
  useEffect(() => {
    if (isTauri()) {
      import("@tauri-apps/api/app")
        .then((app) => app.getVersion().then(setVersion))
        .catch(() => {});
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) {
      setState({ phase: "error", message: s.updater.browserOnly });
      return;
    }

    setState({ phase: "checking", message: s.updater.checking });
    try {
      if (pendingUpdate.current) await pendingUpdate.current.close();
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check({ timeout: 15_000 });
      pendingUpdate.current = update;

      if (!update) {
        setState({ phase: "current", message: s.updater.current });
        return;
      }

      setState({
        phase: "available",
        version: update.version,
        message: s.updater.ready(update.version, update.body),
      });
    } catch (error) {
      const kind = classifyUpdateError(error);
      const message =
        kind === "offline"
          ? s.updater.checkOffline
          : kind === "signature"
            ? s.updater.checkSigFailed
            : s.updater.checkFailed(readableError(error));
      setState({ phase: "error", message });
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;

    let downloaded = 0;
    let total: number | undefined;
    setState({ phase: "downloading", version: update.version, message: s.updater.downloading(update.version), progress: 0 });

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = total ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined;
          setState({ phase: "downloading", version: update.version, message: s.updater.downloading(update.version), progress });
        } else {
          setState({ phase: "installing", version: update.version, message: s.updater.installing, progress: 100 });
        }
      });

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      // install is manual-only (never auto-installs); a signature failure here
      // is surfaced once and stays on the error phase.
      const message =
        classifyUpdateError(error) === "signature"
          ? s.updater.installSigFailed
          : s.updater.installFailed(readableError(error));
      setState({ phase: "error", version: update.version, message });
    }
  }, []);

  const busy = state.phase === "checking" || state.phase === "downloading" || state.phase === "installing";
  return { state, busy, version, checkForUpdates, installUpdate };
}
