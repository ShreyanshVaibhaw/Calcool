import { evaluateSheet } from "./engine/sheet";

// Minimal node typings so `tsc` passes without @types/node (the app never imports this).
interface CliStdin extends AsyncIterable<Uint8Array> {
  isTTY: boolean | undefined;
}
declare const process: {
  argv: string[];
  stdin: CliStdin;
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};

// Minimal CLI: `npm run cli -- "June 20 + 3 weeks"` prints the answer.
// Reuses the app engine build; currency uses the offline table (no cache, no fetch).

// Pure answer extraction, one formatted answer per line that has a value.
export function cliAnswers(text: string): string[] {
  return evaluateSheet(text)
    .lines.filter((l) => l.value)
    .map((l) => l.formatted);
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const c of process.stdin) chunks.push(c);
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(all);
}

async function runCli(): Promise<void> {
  let text = process.argv.slice(2).join(" ").trim();
  if (!text && !process.stdin.isTTY) text = (await readStdin()).trim();
  if (!text) {
    console.error('usage: npm run cli -- "<expression>"');
    process.exit(2);
  }
  const answers = cliAnswers(text);
  if (!answers.length) {
    console.error("no answer");
    process.exit(1);
  }
  for (const a of answers) console.log(a);
}

// the test runner imports cliAnswers; only run when actually executed
if (!process.env.VITEST) void runCli();
