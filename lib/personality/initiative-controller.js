/* @deprecated Dialogue Agency v1 compatibility shim.
 * Conversational initiative is owned exclusively by lib/cognition/behavior-policy.js.
 * This module intentionally contains no semantic routing so stale imports cannot
 * create a second initiative path.
 */
export function chooseInitiative() {
  return {
    mode: 'none',
    reason: 'deprecated compatibility shim; behavior-policy owns initiative',
    instruction: 'Не использовать этот слой для выбора инициативы.'
  };
}
