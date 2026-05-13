/**
 * Client-side settings: master password + BYOK API key.
 * Stored in localStorage; never sent except via /api/generate headers.
 *
 * Replace __PROJECT__ with your project's short name to avoid LS collision
 * with other apps deployed to the same domain.
 */

const LS_MASTER = '__PROJECT__.masterKey';
const LS_BYOK = '__PROJECT__.userApiKey';

export type AccessMode = 'master' | 'byok' | 'free';

export function readMasterKey(): string {
  try { return localStorage.getItem(LS_MASTER) || ''; } catch { return ''; }
}

export function readUserApiKey(): string {
  try { return localStorage.getItem(LS_BYOK) || ''; } catch { return ''; }
}

export function saveSettings(masterKey: string, userApiKey: string): void {
  try {
    if (masterKey) localStorage.setItem(LS_MASTER, masterKey);
    else localStorage.removeItem(LS_MASTER);
    if (userApiKey) localStorage.setItem(LS_BYOK, userApiKey);
    else localStorage.removeItem(LS_BYOK);
  } catch { /* ignore */ }
}

export function currentMode(): AccessMode {
  if (readMasterKey()) return 'master';
  if (readUserApiKey().startsWith('AIza')) return 'byok';
  return 'free';
}
