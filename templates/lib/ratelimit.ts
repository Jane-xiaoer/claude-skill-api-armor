/**
 * IP + Cookie fingerprint rate limiter
 * - Upstash Redis if KV_REST_API_URL / KV_REST_API_TOKEN env vars present
 * - Otherwise in-memory fallback (per serverless instance — inaccurate but safe)
 */
import type { VercelRequest } from '@vercel/node';

const UPSTASH_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_REDIS = !!UPSTASH_URL && !!UPSTASH_TOKEN;

const memoryCounts = new Map<string, { count: number; reset: number }>();

export function getFingerprint(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const xri = req.headers['x-real-ip'];
  const ip =
    (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()) ||
    (Array.isArray(xri) ? xri[0] : xri) ||
    req.socket?.remoteAddress ||
    'unknown';

  const cookie = req.headers.cookie || '';
  const cookieId = /(?:^|;\s*)xfp=([^;]+)/.exec(cookie)?.[1] || '';

  return `${ip}|${cookieId || ip}`;
}

export type CheckResult = {
  allowed: boolean;
  remaining: number;
  used: number;
  reset: number;
};

function todayKey(fp: string): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // CST
  return `rl:${d.toISOString().slice(0, 10)}:${fp}`;
}

function endOfTodayMs(): number {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime() - 8 * 3600 * 1000;
}

async function redisIncr(key: string): Promise<number> {
  const r = await fetch(`${UPSTASH_URL}/incr/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = (await r.json()) as { result?: number | string };
  const count = Number(data.result || 0);
  if (count === 1) {
    await fetch(`${UPSTASH_URL}/expire/${encodeURIComponent(key)}/90000`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
  }
  return count;
}

async function redisGet(key: string): Promise<number> {
  const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = (await r.json()) as { result?: number | string };
  return Number(data.result || 0);
}

export async function checkRateLimit(
  fingerprint: string,
  limit: number,
): Promise<CheckResult> {
  const key = todayKey(fingerprint);
  const reset = endOfTodayMs();

  if (HAS_REDIS) {
    try {
      const current = await redisGet(key);
      if (current >= limit) {
        return { allowed: false, remaining: 0, used: current, reset };
      }
      const after = await redisIncr(key);
      return {
        allowed: true,
        remaining: Math.max(0, limit - after),
        used: after,
        reset,
      };
    } catch (e) {
      console.warn('Redis fail, fallback to memory:', e);
    }
  }

  const now = Date.now();
  const rec = memoryCounts.get(key);
  if (rec && rec.reset > now) {
    if (rec.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        used: rec.count,
        reset: rec.reset,
      };
    }
    rec.count++;
    return {
      allowed: true,
      remaining: limit - rec.count,
      used: rec.count,
      reset: rec.reset,
    };
  }
  memoryCounts.set(key, { count: 1, reset });
  if (memoryCounts.size > 5000) {
    for (const [k, v] of memoryCounts) {
      if (v.reset < now) memoryCounts.delete(k);
    }
  }
  return { allowed: true, remaining: limit - 1, used: 1, reset };
}
