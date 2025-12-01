import { Notice } from 'obsidian';

export function arraysEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;

  a.sort();
  b.sort();

  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export const NOTIFICATION_EMOJI_LUT: Record<ToastMessage['type'], string> = {
  success: '✅',
  info: 'ℹ️',
  warning: '⚠️',
  error: '❌',
} as const;

const TIMEOUTS = {
  short: 5 * 1000,
  long: 10 * 1000,
  'really-long': 20 * 1000,
} as const;

export type ToastMessage = {
  type: 'success' | 'info' | 'warning' | 'error';
  message: string;
};

export const showMessage = ({ type, message }: ToastMessage, timeOut?: keyof typeof TIMEOUTS) => {
  new Notice(NOTIFICATION_EMOJI_LUT[type] + ' ' + message, timeOut && TIMEOUTS[timeOut]);

  if (type === 'error') console.error("Error Notice: " + message);
  else if (type === 'warning') console.warn("Warning Notice: " + message);
  // eslint-disable-next-line no-console
  else console.info("Info Notice: " + message);
};
