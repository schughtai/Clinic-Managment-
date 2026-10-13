import { reactive } from 'vue';
import { ApiError } from './api';
import { t } from './i18n';

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

export const toasts = reactive<Toast[]>([]);
let next = 1;

function push(kind: Toast['kind'], text: string, ms: number): void {
  const id = next++;
  toasts.push({ id, kind, text });
  setTimeout(() => {
    const index = toasts.findIndex((entry) => entry.id === id);
    if (index >= 0) toasts.splice(index, 1);
  }, ms);
}

export const notify = (text: string): void => push('ok', text, 3_500);

/** Shows what went wrong in words a clinic worker understands. */
export function notifyError(error: unknown): void {
  if (error instanceof ApiError) push('error', t(error.message), 7_000);
  else push('error', t('Something went wrong. Please try again.'), 7_000);
}
