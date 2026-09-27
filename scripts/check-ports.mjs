// Preflight for `npm run dev`: Tauri needs Vite on exactly port 1420 (strictPort),
// plus 1421 for HMR when TAURI_DEV_HOST is set for on-device testing. If a port
// is taken, name the holder and the fix instead of letting Vite die cryptically.
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";

const ports = [1420];
if (process.env.TAURI_DEV_HOST) ports.push(1421);

function probe(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", (err) => resolve(err));
    srv.listen(port, "0.0.0.0", () => srv.close(() => resolve(null)));
  });
}

function holderHint(port) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const line = out
        .split("\n")
        .find((l) => new RegExp(`[.:]${port}\\s`).test(l) && /LISTENING/i.test(l));
      const pid = line?.trim().split(/\s+/).pop();
      return pid && /^\d+$/.test(pid) ? ` (held by PID ${pid}; run taskkill /PID ${pid} /F to free it)` : "";
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const pid = out.split("\n")[0];
    return pid ? ` (held by PID ${pid}; run kill ${pid} to free it)` : "";
  } catch {
    return "";
  }
}

let failed = false;
for (const port of ports) {
  const err = await probe(port);
  if (err) {
    failed = true;
    console.error(`Port ${port} is already in use${holderHint(port)}.`);
    console.error("Stop the other process (or the stale `tauri dev`), then re-run: npm run dev");
  }
}
if (failed) process.exit(1);
