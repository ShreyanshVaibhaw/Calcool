// `npm run cli`: bundle src/cli.ts to the OS temp dir and run it with args.
// bin/calcool[.cmd] are the real entry points; this keeps the npm script working
// cross-platform without writing build artifacts into node_modules.
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(tmpdir(), "calcool-cli.mjs");
const esbuild = join(root, "node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild");

execFileSync(esbuild, [join(root, "src", "cli.ts"), "--bundle", "--platform=node", "--format=esm", `--outfile=${out}`, "--log-level=error"], {
  stdio: "inherit",
});
const res = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(res.status ?? 1);
