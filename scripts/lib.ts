import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Value of `--name <value>` on the command line. */
export function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Runs a script's main and exits 1 with its tag if it throws. */
export function run(tag: string, main: () => Promise<void>): void {
  main().catch((err) => {
    console.error(`[${tag}] crashed:`, err);
    process.exit(1);
  });
}
