import { buildDisableScript, buildEnableScript } from "./rules.mjs";

/** Diagnostic-only validator. The privileged helper accepts structured options, never scripts. */
export function validateNftScript(content) {
  for (const useDestroy of [true, false]) {
    if (content === buildDisableScript({ useDestroy })) return { ok: true };
    for (const allowLan of [true, false]) {
      if (content === buildEnableScript({ useDestroy, allowLan })) return { ok: true };
    }
  }
  return { ok: false, reason: "not an exact canonical kill-switch script" };
}
