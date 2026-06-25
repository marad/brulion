import type { IconNode } from "lucide"

/**
 * The action model (FEAT-0057/0058): a first-class, named capability the user can
 * invoke from the command palette and pin to the header action bar. This module owns
 * the type and the pure list helpers over pinned-action-id lists, so neither the
 * palette nor the settings modal has to depend on the other for them.
 */
export interface Action {
  /** Stable identity (used by the pinned-action list); unique within the registry. */
  id: string
  /** Human label shown in the palette row and the bar button's tooltip/aria-label. */
  label: string
  /** Optional Lucide icon node rendered in the palette row and the bar button. */
  icon?: IconNode
  /** Invoke the action. The palette/bar runs this on selection/click. */
  run: () => void
}

/**
 * Resolve an ordered list of pinned action `ids` to their {@link Action}s against
 * the registry, preserving id order and **dropping** ids that match no action
 * (FEAT-0058). Pure & total — a stale/unknown id yields no entry, never a throw.
 */
export function resolvePinned(ids: readonly string[], actions: readonly Action[]): Action[] {
  return ids
    .map((id) => actions.find((a) => a.id === id))
    .filter((a): a is Action => a !== undefined)
}

/**
 * Toggle `id` in a pinned-id `list` (FEAT-0058): append it if absent, remove it if
 * present. Pure — returns a new list, input unchanged.
 */
export function togglePinned(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

/**
 * Reorder a pinned-id `list` by moving `draggedId` to the slot of `targetId`,
 * inserting it **before** `targetId` (the drag-and-drop drop semantics, FEAT-0058).
 * A drop onto itself, or an id not in the list, returns an equivalent list. Pure —
 * returns a new list, input unchanged.
 */
export function reorderPinned(
  list: readonly string[],
  draggedId: string,
  targetId: string,
): string[] {
  if (draggedId === targetId || !list.includes(draggedId) || !list.includes(targetId)) {
    return [...list]
  }
  const without = list.filter((x) => x !== draggedId)
  const at = without.indexOf(targetId)
  return [...without.slice(0, at), draggedId, ...without.slice(at)]
}
