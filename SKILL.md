---
name: api-armor
description: 给上线项目的 AI API 加防护甲。三层鉴权（master/BYOK/free）+ Upstash Redis 速率限制 + 后端代理 + cost guard。用在 Vite/Next.js + Gemini/OpenAI/Anthropic 的项目。触发词：API key 泄漏、防白嫖、加密 API、限流、三层鉴权、Vercel AI 项目上线、新项目带 key、保护我的 API、给项目加固。
user-invocable: true
effort: medium
---

# API Armor — 给 AI API 加防护甲

## 何时启动

**自动触发条件（任一命中）：**

1. 用户说：「保护我的 API」、「防 API 泄漏」、「加密 API」、「防白嫖」、「限流」、「三层鉴权」、「给项目加固」、「API 被人弄走」
2. 用户开始新项目，技术栈含：Vite / Next.js + `@google/genai` / `openai` / `@anthropic-ai/sdk` 等 AI SDK
3. 用户准备把带 API 的项目部署到 Vercel / Netlify / Cloudflare Pages
4. 审计已上线项目时发现：纯前端 build（Vite + no api/ folder）+ AI SDK 直接 import → 高危

**手动审计：** Jane 说「审计 X 项目的 API 安全」、「这个项目有没有 key 泄漏」。

## 核心模式（多层防护）

来自实战验证（`xiaoer-tools-wall` / `AI-MVP` / `Camera-Museum` / `headshot`）的 working 模式：

| 层 | 触发 | Key 来源 | 限制 |
|----|------|---------|------|
| **master** | header `x-master-key === MASTER_PASSWORD` | 服务器 GEMINI_API_KEY | 无限 |
| **byok** | header `x-user-api-key` 以 `AIza` / `AQ.` / `sk-` 开头 | 调用方自己的 key | 无限（自己付钱） |
| **free** | 都没填 | 服务器 GEMINI_API_KEY | IP+cookie 限流 + Turnstile 人机验证 + 全局日额熔断 |

**核心约束：** 真 API key **永远只在 Vercel env**，前端永远 fetch `/api/generate`，不直连 AI SDK。

**Free 模式三道墙（按顺序）：**
1. **Cloudflare Turnstile**（防自动脚本/IP 池）—— 前端 invisible 拿 token，后端 `siteverify` 校验
2. **全局日额熔断**（防账单飞）—— Upstash 全站日计数器，超 `FREE_GLOBAL_DAILY_LIMIT` 全部 503
3. **每 IP+cookie 限流**（防单人狂刷）—— 默认每日 3 次

## 审计 checklist（在动手前先跑）

针对一个项目目录，跑这个清单：

1. **前端是否直连 AI SDK？**
   - 搜 `grep -rn "new GoogleGenAI\|new OpenAI\|new Anthropic" --include="*.ts*" src/ services/ components/`
   - 如果命中前端文件 → 🔴 高危
2. **vite.config.ts 是否 `define` 进 process.env？**
   - 搜 `grep -n "define\|process.env" vite.config.ts`
   - 命中 `JSON.stringify(env.GEMINI_API_KEY)` 类的 → 🔴 灾难，key 直接 bake 进 bundle
3. **是否有 api/ 目录或 pages/api/ ？**
   - 没有 → 🔴 没后端代理，所有 AI 调用必然走前端
4. **是否有限流？**
   - 搜 `grep -rn "ratelimit\|rateLimit\|FREE_DAILY_LIMIT\|Upstash" --include="*.ts" .`
   - 没命中 → 🟡 没有限流，会被白嫖
5. **production bundle 是否含真 key？**
   - 跑 `npm run build && grep -r "AIza\|sk-proj\|sk-ant" dist/`
   - 命中真 key 字符串 → 🔴 已暴露

发现 🔴 → 走「迁移流程」。发现 🟡 → 走「加限流」。

## 迁移流程（前端裸 SDK → 后端代理 + 三层鉴权）

适用：Vite + React（纯前端）项目。Next.js 项目走「Next.js 变体」（见 references）。

### Step 1 — 复制模板到目标项目

```bash
TARGET=~/projects/你的项目
cp ~/.shared-skills/api-armor/templates/lib/ratelimit.ts $TARGET/lib/ratelimit.ts
cp ~/.shared-skills/api-armor/templates/lib/settings.ts $TARGET/lib/settings.ts
cp ~/.shared-skills/api-armor/templates/api/generate.ts $TARGET/api/generate.ts
cp ~/.shared-skills/api-armor/templates/components/SettingsModal.tsx $TARGET/components/SettingsModal.tsx
```

### Step 2 — 改 `lib/settings.ts` 的 LS 命名空间

把 `__PROJECT__.masterKey` 改成 `项目名.masterKey`，避免不同站点的 localStorage 串味。

### Step 3 — 改 `api/generate.ts` 的默认模型

`DEFAULT_MODEL` 改成你这个项目实际用的模型。`ALLOWED_MODELS` 白名单加上你需要的模型。

### Step 4 — 重写 `services/*.ts`（最关键）

把所有 `new GoogleGenAI(...)` / `new OpenAI(...)` 直连调用，替换为 `fetch('/api/generate', { headers, body })`。保留所有 prompt 构建逻辑不变。参考模板：`templates/services/serviceCall.ts`。

### Step 5 — 改 `vite.config.ts`

**关键** —— 删掉所有 `define: { 'process.env.XXX_API_KEY': ... }` 行。如果只有这一项 define，直接删 `define` 块。

加 dev proxy：

```ts
server: {
  proxy: {
    '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:3000', changeOrigin: true },
  },
},
```

### Step 6 — `package.json` 加 dep

```json
"devDependencies": {
  "@vercel/node": "^5.8.0"
}
```

### Step 7 — Vercel env 设置

在 Vercel dashboard 该项目 Settings → Environment Variables，加：

| Key | 值 | 必需 |
|-----|----|----|
| `GEMINI_API_KEY` | 你的真 key | ✅ |
| `MASTER_PASSWORD` | 自定义密码（≥ 12 位随机字符串！别用 4 位数） | ✅ |
| `KV_REST_API_URL` | Upstash Redis URL | 推荐 |
| `KV_REST_API_TOKEN` | Upstash Redis Token | 推荐 |
| `FREE_DAILY_LIMIT` | 单 IP 每日次数，默认 3 | 可选 |
| `FREE_GLOBAL_DAILY_LIMIT` | 全站每日次数，0 = 禁用熔断，推荐 30 | 推荐 |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret | 推荐 |
| `VITE_TURNSTILE_SITEKEY` | Cloudflare Turnstile sitekey（前端用，公开） | 推荐 |

没配 Upstash 时自动 fallback 内存限流（单 serverless 实例内准，跨实例不准但安全）。
没配 Turnstile 时自动跳过人机验证（开发环境友好，但生产建议配）。
`FREE_GLOBAL_DAILY_LIMIT=0` 时禁用全局熔断。

### Step 7.1 — Cloudflare Turnstile widget 创建（90 秒）

走 [dash.cloudflare.com](https://dash.cloudflare.com) → Turnstile → Add Widget。或直接 API 一行搞定（同登录态浏览器 console 跑）：

```js
await fetch('/api/v4/accounts/<ACCOUNT_ID>/challenges/widgets', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'api-armor',
    mode: 'invisible',
    domains: ['your-site-1.vercel.app', 'your-site-2.vercel.app']
  })
}).then(r => r.json())
```

返回的 `result.sitekey` → `VITE_TURNSTILE_SITEKEY`；`result.secret` → `TURNSTILE_SECRET_KEY`。

### Step 8 — 本地 build 验证

```bash
npm install
npm run build
grep -r "AIza\|sk-proj\|sk-ant" dist/ | grep -v "AIza\.\.\."  # 排除 placeholder
```

**不应该**有真 key 字符串。如果有 → vite.config.ts 的 define 没删干净。

### Step 9 — 紧急轮换

如果项目已上线过且裸奔过 key：**立刻去 AI Studio / OpenAI dashboard 把当前 key 作废 + 生成新 key**，再更新 Vercel env。

## Next.js 变体

Next.js（App Router）的 API route 写法不一样：`app/api/generate/route.ts`，导出 `POST` async 函数。模板见 `templates/nextjs/route.ts`，鉴权 + 限流逻辑相同。

middleware 可设置 `xfp` cookie 做更准的 fingerprint（参考 `xiaoer-tools-wall` 的实现）。

## 已 audit 过的 Jane 项目（state of art）

| 项目 | 状态 | 备注 |
|------|------|------|
| `xiaoer-tools-wall` | 🟢 三层完备 | 这套模式的源头，Upstash 接好 |
| `AI-MVP` | 🟢 三层完备 | 端口此模式，多模型白名单 |
| `Camera-Museum` | 🟢 全套防护 (2026-05-13) | Turnstile + 全局熔断（30/天）+ 3 层 |
| `headshot` | 🟢 全套防护 (2026-05-13) | 同上 |

## 一句话提示词（开新项目时甩给自己）

> 这个项目要用 Gemini/OpenAI API 部署到 Vercel，先走 api-armor skill：建 api/generate.ts 做后端代理，加 master/BYOK/free 三层鉴权，limit Upstash，前端 fetch 走 /api/generate。前端任何文件都不许 `import { GoogleGenAI }`。
