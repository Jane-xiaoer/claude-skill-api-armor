/**
 * Cloudflare Turnstile helper (frontend).
 * Lazily loads the Turnstile script and fetches a one-shot token.
 *
 * If sitekey is empty (env var not set) — caller should skip entirely.
 */

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

let scriptPromise: Promise<void> | null = null;

function ensureScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Turnstile script load failed'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

async function waitForTurnstile(maxMs = 5000): Promise<any> {
  const start = Date.now();
  while (!(window as any).turnstile) {
    if (Date.now() - start > maxMs) throw new Error('Turnstile not ready');
    await new Promise((r) => setTimeout(r, 50));
  }
  return (window as any).turnstile;
}

export async function getTurnstileToken(sitekey: string, timeoutMs = 20000): Promise<string> {
  if (!sitekey) return '';
  await ensureScript();
  const ts = await waitForTurnstile();

  return new Promise<string>((resolve, reject) => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
    document.body.appendChild(container);

    let widgetId: string | undefined;
    const cleanup = () => {
      try { if (widgetId !== undefined) ts.remove(widgetId); } catch {}
      try { container.remove(); } catch {}
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Turnstile timeout')); }, timeoutMs);

    try {
      widgetId = ts.render(container, {
        sitekey,
        callback: (token: string) => { clearTimeout(timer); cleanup(); resolve(token); },
        'error-callback': () => { clearTimeout(timer); cleanup(); reject(new Error('Turnstile error')); },
        'expired-callback': () => { clearTimeout(timer); cleanup(); reject(new Error('Turnstile expired')); },
        appearance: 'interaction-only',
        retry: 'auto',
      });
    } catch (e) {
      clearTimeout(timer);
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
