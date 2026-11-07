/**
 * Entry point for `pnpm rules:verify` (run in CI): every rule in the registry
 * matches RuleSchema, ids are unique, and the registry is not suspiciously small.
 */
import { REGISTRY, registryProblems } from "@/lib/rules/registry";
import { run } from "./lib";

run("verify", async () => {
  const problems = registryProblems();
  if (problems.length > 0) {
    console.error(`[verify] FAILED with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`[verify] OK (${REGISTRY.length} rules)`);
});
