# api-armor

> 给上线项目的 AI API 加防护甲。三层鉴权（master / BYOK / free）+ Upstash Redis 限流 + 后端代理。一个 Claude Code skill。

---

## 这是什么

你在 Vite / Next.js 项目里直接 `import { GoogleGenAI }` → 部署到 Vercel → 任何访客打开 DevTools 都能从 bundle 里扒到你的 `AIza...` key。然后 5 分钟之内你的 Google AI Studio 账单就开始飞。

`api-armor` 是解决这件事的 skill：

- **后端代理** —— 真 API key 永远只在服务端，前端永远 `fetch('/api/generate')`
- **三层鉴权** —— `master`（你自己，无限）/ `byok`（用户自带 key，无限）/ `free`（你的 key，每天 N 次）
- **Upstash Redis 限流** —— IP + cookie fingerprint，跨 serverless instance 准确
- **可选 cost guard** —— 全局日额阈值熔断（防恶意刷穹爆账单）

> 这套模式的源头是 [xiaoer-tools-wall](https://github.com/Jane-xiaoer/xiaoers-arsenal) 的 `/api/chat`，跑了几个月扛住公开访客 + 白嫖客 + 善意用户三类。

---

## 谁应该用

- 你做了一个 Vite / Next.js 项目，里面调 Gemini / OpenAI / Anthropic API
- 你想部署到 Vercel / Netlify / Cloudflare 给人看
- 你不想自己的 API 账单一夜烧爆

不该用的场景：

- 纯本地工具（不联网）
- 已经有完整 SaaS 鉴权 + 计费的项目（你不需要这个，你需要的是用户系统）

---

## 用法

### 方式 A：装成 Claude Code skill（推荐）

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jane-xiaoer/claude-skill-api-armor/main/install.sh)
```

装完后，开 Claude Code，对 Claude 说：

> 「这个项目要部署到 Vercel，里面用了 Gemini API，帮我加固」

Claude 会自动调用 `api-armor` skill，按 9 步 checklist 审计 + 套模板 + 给你 deploy 指引。

### 方式 B：手动用模板

```bash
git clone https://github.com/Jane-xiaoer/claude-skill-api-armor.git
cp claude-skill-api-armor/templates/lib/* 你的项目/lib/
cp claude-skill-api-armor/templates/api/* 你的项目/api/
cp claude-skill-api-armor/templates/components/SettingsModal.tsx 你的项目/components/
```

然后跟 SKILL.md 的 9 步走。

---

## 文件结构

```
claude-skill-api-armor/
├── SKILL.md                          # 主指令（Claude 会读这个）
├── README.md                         # 你正在看的
├── install.sh                        # 一键装到 ~/.shared-skills/
├── LICENSE                           # MIT
├── templates/
│   ├── api/generate.ts               # Vercel serverless function（后端代理）
│   ├── lib/
│   │   ├── ratelimit.ts              # Upstash Redis + 内存 fallback
│   │   └── settings.ts               # 客户端 localStorage（master + BYOK）
│   ├── components/SettingsModal.tsx  # 设置弹窗（master / BYOK 输入框）
│   └── services/serviceCall.ts       # 前端 fetch 替换示例
└── references/
    ├── audit-checklist.md            # 9 步审计 checklist
    └── nextjs-variant.md             # Next.js App Router 写法
```

---

## 三层鉴权速查

| 模式 | 触发条件 | Key 来源 | 限制 |
|------|---------|---------|------|
| `master` | header `x-master-key === MASTER_PASSWORD` | 服务端 `GEMINI_API_KEY` | 无限 |
| `byok` | header `x-user-api-key` 以 `AIza` / `AQ.` / `sk-` 开头 | 调用方自己的 | 无限（自己付） |
| `free` | 都没填 | 服务端 key | IP + cookie 限流（默认 3 次/天） |

---

## 必需的 Vercel env

| Key | 必需 | 说明 |
|-----|------|------|
| `GEMINI_API_KEY` | ✅ | 你的真 key |
| `MASTER_PASSWORD` | ✅ | 你的管理密码 |
| `KV_REST_API_URL` | 推荐 | Upstash Redis URL（没配会 fallback 内存） |
| `KV_REST_API_TOKEN` | 推荐 | Upstash Redis Token |
| `FREE_DAILY_LIMIT` | 可选 | 数字，默认 3 |

没配 Upstash 时自动用内存限流，单 serverless instance 内准，跨 instance 不准 —— 个人项目够用。

---

## License

MIT © Jane Xiaoer

模板代码可自由复用到任何项目（商业 / 个人 / 闭源 / 开源）。

---

## 相关

- 实战源头：[xiaoer-tools-wall](https://xiaoer-tools-wall.vercel.app) · [repo](https://github.com/Jane-xiaoer/xiaoers-arsenal)
- 作者：[Jane (小耳) on X](https://x.com/janexiaoer)
- 同系列 skill：
  - [claude-skill-meeting-secretary](https://github.com/Jane-xiaoer/claude-skill-meeting-secretary)
  - [claude-skill-video-transcribe](https://github.com/Jane-xiaoer/claude-skill-video-transcribe)
  - [claude-skill-tearable-cloth](https://github.com/Jane-xiaoer/claude-skill-tearable-cloth)
