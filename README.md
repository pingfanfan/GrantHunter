# UK Academic Funding Hub (GitHub Pages)

一个可部署到 GitHub Pages 的 UK academic funding 聚合页，支持：

- 每日自动抓取多个 UK funding source
- 每条机会 AI 摘要（适合谁 / 风险点）
- 用户画像驱动的匹配度评分（0-100）
- 每日更新简报（Markdown）
- 邮箱订阅（Buttondown）

## 目录结构

- `config/sources.json`: 资金来源配置（可持续扩展）
- `scripts/update-funding.mjs`: 每日抓取 + 去重 + AI 摘要 + 数据生成
- `scripts/send-digest.mjs`: 发送每日邮件简报（Buttondown API）
- `docs/`: GitHub Pages 静态站
- `.github/workflows/daily-refresh.yml`: 每日定时任务
- `.github/workflows/deploy-pages.yml`: Pages 部署任务

## 本地运行

```bash
npm run update:data
npm run send:digest
```

运行后将生成：

- `docs/data/funding.latest.json`
- `docs/data/funding.index.json`
- `docs/data/digest.latest.md`
- `docs/data/site-config.json`

你可用任意静态服务器预览 `docs/index.html`。

## GitHub Pages 部署

1. 推送到 GitHub 仓库 `main` 分支。
2. 在 GitHub 仓库设置中启用 `Pages`（Source 选择 `GitHub Actions`）。
3. `Deploy GitHub Pages` workflow 会自动部署 `docs/`。

## 每日更新与邮件订阅配置

### Secrets

- `OPENROUTER_API_KEY`：用于生成 AI 摘要（可选，不填则使用规则摘要）
- `BUTTONDOWN_API_KEY`：用于发送 daily brief（可选）

### Variables

- `OPENROUTER_MODEL`：默认 `meta-llama/llama-3.3-70b-instruct:free`
- `OPENROUTER_MODELS`：可选，逗号分隔的免费模型回退列表（优先于 `OPENROUTER_MODEL`）
- `OPENROUTER_SITE_URL`：可选，OpenRouter `HTTP-Referer` header
- `OPENROUTER_SITE_NAME`：可选，OpenRouter `X-Title` header
- `BUTTONDOWN_USERNAME`：你的 Buttondown 用户名（用于前端订阅表单 action）
- `BUTTONDOWN_NEWSLETTER_ID`：如使用多 newsletter 可填（可选）
- `BUTTONDOWN_DRY_RUN`：`true` 时仅创建草稿不发送
- `MAX_ITEMS_PER_SOURCE`：每个 source 抓取的详情数（默认 18）
- `MAX_TOTAL_ITEMS`：全局保留条目上限（默认 320）

## 订阅说明

由于 GitHub Pages 是纯静态托管，订阅采用 Buttondown：

- 用户在页面填写邮箱
- 直接提交到 Buttondown 公开订阅接口（带 double opt-in）
- 每日 workflow 自动把当天 digest 发给订阅者

## 增加/调整 funding resources

编辑 `config/sources.json`，添加新来源：

```json
{
  "id": "source-id",
  "name": "Source Name",
  "category": "research_grants",
  "homepage": "https://example.com/funding",
  "seedUrls": ["https://example.com/funding"],
  "includeHosts": ["example.com"]
}
```

## 重要提醒

- 自动抓取受网站结构变化、反爬策略影响。
- AI 摘要仅用于快速筛选，不构成申请建议。
- 申请资格、截止时间、材料要求请始终以官方页面为准。
