/**
 * For the card panel's `onEscapeKeyDown`: Escape in a task's title field cancels that edit, it does
 * not close the panel.
 */
export function keepEscapeInTaskTitle(e: KeyboardEvent): void {
  if ((e.target as HTMLElement | null)?.closest?.("[data-task-title-input]")) e.preventDefault();
}
