/**
 * CSP-safe replacement for page.waitForFunction.
 *
 * The Web UI ships `script-src 'self' qrc:` with no `unsafe-eval`, and
 * waitForFunction installs its polling loop by evaluating a string inside the
 * page, which that policy blocks. Polling from Node keeps each check on the
 * page.evaluate path, which runs outside the page's script-src.
 */
export async function waitForPredicate(page, predicate, { timeout = 15000, interval = 100, message } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      const value = await page.evaluate(predicate);
      if (value) return value;
    } catch (err) {
      // A reload or navigation mid-poll tears down the execution context; retry
      // until the deadline rather than failing the whole smoke run.
      if (Date.now() >= deadline) throw err;
    }
    if (Date.now() >= deadline) {
      throw new Error(message || `Timed out after ${timeout}ms waiting for: ${predicate.toString().replace(/\s+/g, " ").slice(0, 160)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
