/**
 * @deprecated Foundation v1 compatibility shim.
 * Runtime callback/open-loop ownership moved to lib/cognition/open-loops.js.
 * Keep these exports temporarily so older imports fail closed instead of
 * reintroducing a second regex-based semantic thread engine.
 */
export function collectConversationThreads() {
  return [];
}

export function chooseThreadCallback() {
  return null;
}
