/**
 * /api/generate — Vercel serverless function
 *
 * Three-tier access:
 *   1. master  : header x-master-key === MASTER_PASSWORD → use server GEMINI_API_KEY, unlimited
 *   2. byok    : header x-user-api-key looks like a Gemini key → use caller's key, unlimited
 *   3. free    : neither → use server key, IP+cookie rate-limited (default 3/day)
 *
 * Env vars (set in Vercel dashboard):
 *   GEMINI_API_KEY    — your Gemini key (required for master & free modes)
 *   MASTER_PASSWORD   — your admin password
 *   KV_REST_API_URL   — optional: Upstash Redis URL for cross-instance rate limit
 *   KV_REST_API_TOKEN — optional: Upstash Redis token
 *   FREE_DAILY_LIMIT  — optional: defaults to 3
 */
import { GoogleGenAI, Modality } from '@google/genai';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit, getFingerprint } from '../lib/ratelimit.js';

const MASTER_PASSWORD = process.env.MASTER_PASSWORD || '';
const SERVER_GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT || 3);

const ALLOWED_MODELS = new Set<string>([
  'gemini-2.5-flash-image-preview',
  'gemini-3-pro-image-preview',
]);
const DEFAULT_MODEL = 'gemini-3-pro-image-preview';

type SimplePart = { text: string };
type ImagePart = { image: { base64: string; mimeType: string } };
type AnyPart = SimplePart | ImagePart;

type GeneratePayload = {
  prompt?: string;
  image?: { base64: string; mimeType: string };
  parts?: AnyPart[];
  model?: string;
  masterKey?: string;
  userApiKey?: string;
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

  let geminiParts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (Array.isArray(body.parts) && body.parts.length) {
    for (const p of body.parts) {
      if ('text' in p && typeof p.text === 'string') {
        geminiParts.push({ text: p.text });
      } else if ('image' in p && p.image?.base64 && p.image?.mimeType) {
        geminiParts.push({ inlineData: { data: p.image.base64, mimeType: p.image.mimeType } });
      }
    }
  } else if (body.prompt && body.image?.base64 && body.image?.mimeType) {
    geminiParts = [
      { inlineData: { data: body.image.base64, mimeType: body.image.mimeType } },
      { text: body.prompt },
    ];
  }
  if (!geminiParts.length) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }

  const masterKey = (req.headers['x-master-key'] as string) || body.masterKey || '';
  const userApiKey = (req.headers['x-user-api-key'] as string) || body.userApiKey || '';

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
      return res.status(503).json({
        ok: false,
        error: 'server_misconfigured',
        message: '免费体验未开放,请填主密码或自己的 Gemini API Key',
      });
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

  const model = body.model && ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const response = await ai.models.generateContent({
      model,
      contents: { parts: geminiParts },
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData && part.inlineData.data) {
        return res.status(200).json({
          ok: true,
          mode,
          image: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        });
      }
    }

    return res.status(502).json({ ok: false, error: 'no_image', mode, message: 'Gemini 未返回图像' });
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
