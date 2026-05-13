# API Armor — 项目审计 checklist

按顺序跑一遍。命中任何 🔴 必须修；🟡 强烈建议修。

## 1. vite.config.ts 是否把 key bake 进 bundle

```bash
grep -n "JSON.stringify.*API_KEY\|JSON.stringify.*GEMINI\|JSON.stringify.*OPENAI" vite.config.ts
```

命中 → 🔴 **灾难** — key 已在前端 JS 里，任何访客可扒。

## 2. 前端是否直连 AI SDK

```bash
grep -rn "new GoogleGenAI\|new OpenAI\|new Anthropic\b" --include="*.ts" --include="*.tsx" \
  src/ services/ components/ app/ 2>/dev/null | grep -v "/api/"
```

命中 → 🔴 前端代码直连 AI。即使没 bake 进 bundle，开发时 `.env.local` 也会 vite 注入。

## 3. 是否有后端代理

```bash
ls api/ pages/api/ app/api/ 2>/dev/null
```

任一存在且含 generate/proxy 路由 → ✅。都不存在 → 🔴 没后端，必须建。

## 4. 是否有限流

```bash
grep -rn "checkRateLimit\|FREE_DAILY_LIMIT\|UPSTASH\|Upstash" --include="*.ts" . 2>/dev/null
```

没命中 → 🟡 没限流。serverless function 一旦被刷会烧钱。

## 5. Production bundle 是否含真 key

```bash
npm run build 2>&1 | tail -5
grep -rE "AIza[A-Za-z0-9_-]{30,}|sk-(proj|ant)-[A-Za-z0-9_-]{20,}" dist/ build/ .next/ 2>/dev/null \
  | grep -v "AIza\.\.\."  # 排除 placeholder
```

任何命中 → 🔴 已暴露，必须立刻轮换 key。

## 6. .env / .env.local 是否进了 git

```bash
git ls-files | grep -E "^\.env(\.|$)"
cat .gitignore | grep -E "^\.env"
```

`.env*` 出现在 `git ls-files` → 🔴 git history 里有 key，要 BFG/git-filter-repo 清理 + 轮换。

## 7. Vercel env vars 是否齐全

部署到 Vercel 的项目需要：

- ✅ `GEMINI_API_KEY` / `OPENAI_API_KEY` 等
- ✅ `MASTER_PASSWORD`
- ✅ `KV_REST_API_URL` + `KV_REST_API_TOKEN`（推荐 Upstash）
- 可选 `FREE_DAILY_LIMIT`

少任何 ✅ → 🟡。Redis 没配会 fallback 内存限流（仍然 work，但跨实例不准）。

## 8. CORS / Origin 限制

如果有人脚本调你的 `/api/generate`，他能直接拿你限流额度。在 `api/generate.ts` 头部加：

```ts
const ALLOWED_ORIGINS = ['https://your-site.vercel.app', 'http://localhost:3000'];
const origin = req.headers.origin || '';
if (!ALLOWED_ORIGINS.includes(origin)) {
  return res.status(403).json({ ok: false, error: 'origin_forbidden' });
}
```

没加 → 🟡。

## 9. Cost guard（账单熔断）

Upstash 限流是「单 IP 每日 N 次」。但 N 个 IP × N 次 = 仍然可能烧爆账单。建议加全局阈值：

- 在 redis 里加一个 `cost:YYYY-MM-DD` counter
- 每次 success 后 INCR
- 超过 `GLOBAL_DAILY_COST_CAP` 后 free 模式全部 503

没加 → 🟡（非紧急，但上量后必须加）。
