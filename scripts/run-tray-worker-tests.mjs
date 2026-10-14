import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scripts = ["./ci-tray-workers.test.py", "./ci-tray-connection.test.py", "./ci-native-page.test.py"].map(path => fileURLToPath(new URL(path, import.meta.url)));
let result;
for (const interpreter of ["python3", "python"]) {
  result = spawnSync(interpreter, [scripts[0]], { stdio: "inherit" });
  if (result.error?.code === "ENOENT") continue;
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  for (const script of scripts.slice(1)) {
    result = spawnSync(interpreter, [script], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}
console.log("SKIP Qt worker tests: Python is not installed (PyQt6 is optional).");
