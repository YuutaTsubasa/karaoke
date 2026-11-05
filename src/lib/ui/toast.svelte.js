// Tiny toast queue shared by a page's components.
export const toasts = $state([]);
let seq = 0;

/** @param {{ title: string, body?: string, tone?: 'info' | 'success' | 'warn', timeout?: number }} t */
export function toast({ title, body = '', tone = 'info', timeout = 4000 }) {
  const id = ++seq;
  toasts.push({ id, title, body, tone });
  if (timeout > 0) setTimeout(() => dismiss(id), timeout);
  return id;
}

export function dismiss(id) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
