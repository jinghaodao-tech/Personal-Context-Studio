import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const evaluator = join(root, "tools", "evaluate-gliner-context-span.ts");
const dictionary = process.env.PCS_NAME_DICTIONARY ?? join(root, "data", "name-dictionary", "names.json");
function run(label: string, env: Record<string, string | undefined>) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", evaluator], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`gliner_eval_failed:${label}\n${result.stderr}`);
  const line = result.stdout.trim().split(/\r?\n/).at(-1);
  return { label, metrics: JSON.parse(line ?? "{}") };
}
console.log(JSON.stringify({ before: run("without_dictionary", { PCS_NAME_DICTIONARY: join(root, "data", "name-dictionary", "__missing__.json") }), after: run("with_dictionary", { PCS_NAME_DICTIONARY: dictionary }) }, null, 2));
