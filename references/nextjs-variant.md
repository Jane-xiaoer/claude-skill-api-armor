# Next.js 变体

Next.js App Router 的 API route 长这样（`app/api/generate/route.ts`）：

```ts
import { GoogleGenAI, Modality } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getFingerprintFromNext } from '@/lib/ratelimit';

export const runtime = 'nodejs'; // Edge runtime 不支持 @google/genai

export async function POST(req: NextRequest) {
  const body = await req.json();
  const masterKey = req.headers.get('x-master-key') || '';
  const userApiKey = req.headers.get('x-user-api-key') || '';

  // ... 三层鉴权同 Vercel 版 ...

  return NextResponse.json({ ok: true, image: '...' });
}
```

`lib/ratelimit.ts` 里的 `getFingerprint` 需要适配 NextRequest：

```ts
export function getFingerprintFromNext(req: NextRequest): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  const cookieId = req.cookies.get('xfp')?.value || '';
  return `${ip}|${cookieId || ip}`;
}
```

## 加 xfp cookie 做更准的 fingerprint

`middleware.ts`：

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get('xfp')) {
    const id = crypto.randomUUID();
    res.cookies.set('xfp', id, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

export const config = { matcher: ['/((?!api/health).*)'] };
```

参考实现：`xiaoer-tools-wall` 的 `middleware.ts` + `app/api/chat/route.ts`。
