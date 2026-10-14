import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./ci-tray-workers.test.py", import.meta.url));
let result;
for (const interpreter of ["python3", "python"]) {
  result = spawnSync(interpreter, [script], { stdio: "inherit" });
  if (result.error?.code === "ENOENT") continue;
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
console.log("SKIP Qt worker tests: Python is not installed (PyQt6 is optional).");
