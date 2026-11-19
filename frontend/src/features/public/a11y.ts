/** Ids and focus helpers shared by the public form's fields and error summary. */

export function hintId(id: string) {
  return `${id}-hint`;
}

export function errorId(id: string) {
  return `${id}-error`;
}

/** Focus a field by id (or its first item for a list, or by name), scrolling it into view. */
export function focusField(id: string): void {
  const el = document.getElementById(id) ?? document.getElementById(`${id}-0`) ?? document.querySelector<HTMLElement>(`[name="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
}
