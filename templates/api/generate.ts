/**
 * /api/generate — Vercel serverless function
 *
 * Three-tier access:
 *   1. master  : caller sends correct master password → uses our GEMINI_API_KEY, unlimited
 *   2. byok    : caller sends a valid-looking Gemini API key → uses theirs, unlimited
 *   3. free    : neither → uses our key, IP+cookie rate-limited (default 3/day)
 *
 * Env vars (set in Vercel dashboard):
 *   GEMINI_API_KEY    — your Gemini key (required for master & free modes)
 *   MASTER_PASSWORD   — your admin password (required for master mode; set to "8005" or anything)
 *   KV_REST_API_URL   — optional: Upstash Redis URL for cross-instance rate limit
 *   KV_REST_API_TOKEN — optional: Upstash Redis token
 *
 * If Upstash isn't configured, falls back to in-memory counting (per serverless
 * instance) — inaccurate at scale but safe and zero-config.
 */
import { GoogleGenAI, Modality } from '@google/genai';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  checkRateLimit,
  getFingerprint,
  getGlobalCount,
  incrementGlobalCount,
} from '../lib/ratelimit.js';

const MASTER_PASSWORD = process.env.MASTER_PASSWORD || '';
const SERVER_GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT || 3);
const FREE_GLOBAL_DAILY_LIMIT = Number(process.env.FREE_GLOBAL_DAILY_LIMIT || 0); // 0 = disabled
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

async function verifyTurnstile(token: string, remoteip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token, remoteip }),
    });
    const data = (await r.json()) as { success?: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}

// Whitelist of allowed Gemini image models. Same /api/generate can serve
// multiple frontends — headshot uses flash-image-preview, camera museum uses
// 3-pro-image-preview.
const ALLOWED_MODELS = new Set<string>([
  'gemini-2.5-flash-image-preview',
  'gemini-3-pro-image-preview',
]);
const DEFAULT_MODEL = 'gemini-3-pro-image-preview';

type GeneratePayload = {
  prompt: string;
  image: { base64: string; mimeType: string };
  model?: string;
  masterKey?: string;
  userApiKey?: string;
  turnstileToken?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let body: GeneratePayload;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }

  if (!body?.prompt || !body?.image?.base64 || !body?.image?.mimeType) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }

  // ───── three-tier auth ─────
  const masterKey =
    (req.headers['x-master-key'] as string) || body.masterKey || '';
  const userApiKey =
    (req.headers['x-user-api-key'] as string) || body.userApiKey || '';

  let geminiKey = '';
  let mode: 'master' | 'byok' | 'free' = 'free';

  if (MASTER_PASSWORD && masterKey === MASTER_PASSWORD) {
    if (!SERVER_GEMINI_KEY) {
      return res
        .status(500)
        .json({ ok: false, error: 'server_misconfigured', message: 'GEMINI_API_KEY 未配置' });
    }
    geminiKey = SERVER_GEMINI_KEY;
    mode = 'master';
  } else if ((userApiKey.startsWith('AIza') || userApiKey.startsWith('AQ.')) && userApiKey.length > 30) {
    geminiKey = userApiKey;
    mode = 'byok';
  } else {
    if (!SERVER_GEMINI_KEY) {
      return res
        .status(503)
        .json({
          ok: false,
          error: 'server_misconfigured',
          message: '免费体验未开放,请填主密码或自己的 Gemini API Key',
        });
    }

    // Turnstile (only if configured; otherwise gracefully skipped)
    if (TURNSTILE_SECRET_KEY) {
      const xff = req.headers['x-forwarded-for'];
      const ip =
        (Array.isArray(xff) ? xff[0] : (xff as string | undefined)?.split(',')[0]?.trim()) ||
        (req.headers['x-real-ip'] as string | undefined) ||
        '';
      const ok = await verifyTurnstile(body.turnstileToken || '', ip);
      if (!ok) {
        return res.status(403).json({
          ok: false,
          error: 'turnstile_failed',
          message: '人机验证未通过，请刷新页面再试。',
        });
      }
    }

    // Global daily cap (站点级熔断 — 防 IP 池刷穹爆账单)
    if (FREE_GLOBAL_DAILY_LIMIT > 0) {
      const used = await getGlobalCount();
      if (used >= FREE_GLOBAL_DAILY_LIMIT) {
        return res.status(503).json({
          ok: false,
          error: 'global_cap_hit',
          message: `今天全站免费额度已用完(每日 ${FREE_GLOBAL_DAILY_LIMIT} 次)。请填写主密码或自己的 Gemini API Key。`,
        });
      }
    }

    const fp = getFingerprint(req);
    const { allowed, remaining, reset } = await checkRateLimit(fp, FREE_DAILY_LIMIT);
    if (!allowed) {
      return res.status(429).json({
        ok: false,
        error: 'rate_limit',
        message: `今天免费体验次数用完了(每日 ${FREE_DAILY_LIMIT} 次)。请填写主密码,或填你自己的 Gemini API Key。`,
        remaining,
        reset,
      });
    }
    geminiKey = SERVER_GEMINI_KEY;
    mode = 'free';
  }

  // ───── call Gemini ─────
  const model = body.model && ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              data: body.image.base64,
              mimeType: body.image.mimeType,
            },
          },
          { text: body.prompt },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData && part.inlineData.data) {
        if (mode !== 'byok') {
          // BYOK doesn't count toward our cost; master + free both consume our key.
          incrementGlobalCount().catch(() => {});
        }
        return res.status(200).json({
          ok: true,
          mode,
          image: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        });
      }
    }

    return res
      .status(502)
      .json({ ok: false, error: 'no_image', mode, message: 'Gemini 未返回图像' });
  } catch (e: any) {
    console.error('Gemini error:', e);
    return res.status(500).json({
      ok: false,
      error: 'generation_failed',
      mode,
      message: String(e?.message || e),
    });
  }
}
