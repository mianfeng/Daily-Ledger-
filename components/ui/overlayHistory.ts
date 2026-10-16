// One sentinel entry owns the entire overlay stack. Nested dialogs share it so
// batched closes cannot leave dead entries or navigate away from the app.
type Entry = { id: symbol; close: () => void };
const entries: Entry[] = [];
const key = "dailyLedgerOverlay";
const token = `overlay-${Date.now()}`;
let cleaning = false;
let listening = false;
let cleanupTimer: number | undefined;
let previousScrollRestoration: ScrollRestoration = "auto";
const state = () => ({
  ...(typeof history.state === "object" && history.state !== null
    ? history.state
    : {}),
  [key]: token,
});
const pop = () => {
  if (cleaning) {
    cleaning = false;
    if (entries.length) history.pushState(state(), "");
    else finish();
    return;
  }
  const top = entries.at(-1);
  if (!top) {
    finish();
    return;
  }
  // Restore the sentinel before asking about dirty input; cancellation is safe.
  history.pushState(state(), "");
  top.close();
};
const finish = () => {
  window.removeEventListener("popstate", pop);
  listening = false;
  history.scrollRestoration = previousScrollRestoration;
};
export const registerOverlayHistory = (close: () => void) => {
  window.clearTimeout(cleanupTimer);
  const entry = { id: Symbol(), close };
  if (!entries.length && !cleaning && !listening) {
    listening = true;
    previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    window.addEventListener("popstate", pop);
    // A reload may leave a sentinel state from a previous JS session.
    const base = { ...(history.state ?? {}) };
    delete base[key];
    history.replaceState(base, "");
    history.pushState(state(), "");
  }
  entries.push(entry);
  return () => {
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) entries.splice(index, 1);
    cleanupTimer = window.setTimeout(() => {
      if (entries.length || cleaning) return;
      if (history.state?.[key] === token) {
        cleaning = true;
        history.back();
      } else finish();
    }, 0);
  };
};
