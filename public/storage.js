/** UI preferences must not prevent operation when browser storage is blocked. */
const memory = new Map();
export const preferences = {
  getItem(key) {
    if (memory.has(key)) return memory.get(key);
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    memory.set(key, String(value));
    try { window.localStorage.setItem(key, String(value)); } catch { /* Keep preference for this page. */ }
  },
  removeItem(key) {
    memory.set(key, null);
    try { window.localStorage.removeItem(key); } catch { /* Memory value takes precedence. */ }
  }
};
