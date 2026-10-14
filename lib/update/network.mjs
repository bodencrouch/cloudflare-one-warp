/** Bounded metadata parsing; the fetch signal also covers reading its body. */
export async function readUpdateJson(response, { maxBytes = 2 * 1024 * 1024 } = {}) {
  if (!response.body) return response.json(); // Minimal test/embedded fetch adapters.
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Update metadata exceeds the size limit.");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
