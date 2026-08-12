# CF 优选 IP 工具

根据访客当前 IP 自动识别所在国家，返回该国家/地区的 Cloudflare 优选 IP 与优选域名，并支持生成订阅。零服务器成本，全部运行在 GitHub Actions + Cloudflare 免费额度内。

## 功能

- **自动识别国家**：Cloudflare Worker 用 `request.cf.country` 免费识别访客所在地，中国等无本地节点的国家自动回退到港台日韩新周边。
- **按国家优选**：GitHub Actions 定时用 `-cfcolo` 按数据中心分桶测速（延迟/丢包/下载速度），结果写入 KV。
- **双输出**：既给「纯 IP 列表」，也生成「vless / trojan 订阅链接」。
- **浏览器连通性探测**：前端可对候选 IP 快速探测可达性与响应时长（粗略参考）。

## 架构

```
访客浏览器 → Cloudflare Pages（分控面板）
                    │ fetch /api/*
                    ▼
           Cloudflare Worker（request.cf.country 识别国家 + 读 KV + 生成订阅）
                    │ 读
                    ▼
            CF KV（bestip:{国家码}）  ◄── 写 ── GitHub Actions（定时跑 CloudflareSpeedTest 按 colo 测速）
```

## 目录结构

```
cf-best-ip/
├── .github/workflows/speedtest.yml   # 定时测速（cron + matrix 并行）
├── scripts/
│   ├── speedtest.sh                  # 下载 CloudflareST + 按 colo 测速
│   ├── parse.js                      # 解析 CSV → bestip_{国家}.json
│   └── upload.mjs                    # 上传 KV
├── data/
│   ├── colo-map.json                 # colo 三字码 → 国家映射
│   └── targets.json                  # 目标测速地区
├── worker/                           # Cloudflare Worker API
│   ├── wrangler.toml
│   └── src/{index,geolocate,subscribe}.js
├── pages/                            # 前端
│   ├── index.html
│   ├── app.js
│   └── style.css
└── README.md
```

## 部署步骤

### 1. 建 Cloudflare 资源
1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. **Workers & Pages → KV** 创建 Namespace，记下 `KV Namespace ID`。
3. （可选）创建 R2 Bucket 用于归档原始测速结果。

### 2. 部署 Worker
```bash
cd worker
npx wrangler login
# 编辑 wrangler.toml：填入 KV ID 和 PAGES_URL
npx wrangler deploy
```
记下 Worker 域名，如 `https://cf-best-ip.你的子域.workers.dev`。

### 3. 部署前端 Pages
```bash
cd pages
npx wrangler pages deploy . --project-name=cf-best-ip
```
部署完成后，把站点 URL 填回 `worker/wrangler.toml` 的 `PAGES_URL` 并重新 `wrangler deploy`。

> 跨域访问：若 Worker 与 Pages 不同域，把 `pages/app.js` 顶部的 `API` 常量改成 Worker 域名。

### 4. 配置 GitHub Secrets
在仓库 **Settings → Secrets and variables → Actions** 添加：
- `CF_ACCOUNT_ID`：Cloudflare 账户 ID（控制台首页右侧）
- `CF_API_TOKEN`：API Token，最小权限 `Workers KV Storage: Edit` + `Account: Read`
- `KV_NAMESPACE_ID`：第 1 步的 KV ID

### 5. 首次跑测速
**Actions → speedtest → Run workflow** 手动触发一次，等待 matrix 各 colo 测速完成并写入 KV。

### 6. 验证
打开 Pages 站点：顶部显示你的国家 → 自动高亮 → 点击国家看优选 IP → 勾选 + 填模板生成订阅。

## API 一览

| 路径 | 说明 |
|---|---|
| `GET /api/me` | 访客 country/city/colo/asn |
| `GET /api/best?country=auto` | 自动识别国家返回最优 IP；`country=HK` 显式指定 |
| `GET /api/best?country=auto&format=text` | 纯文本 IP 列表 |
| `GET /api/countries` | 可用国家列表 |
| `GET /api/sub?countries=HK,JP&type=vless&uuid=...` | 生成订阅 |

## 自定义

- **测速地区**：改 `data/targets.json` 的 `targets` 数组（colo 三字码）。
- **colo 映射**：改 `data/colo-map.json`。
- **就近回退**：改 `worker/src/geolocate.js` 的 `FALLBACK` 表。
- **测速参数**：改 `scripts/speedtest.sh`（`-n` 并发、`-tl` 延迟上限、`-sl` 速度下限等）。

## 注意事项

- 优选 IP 是 anycast，裸 IP 无法正确回源，实际使用需配合「优选域名」或自己域名的 DNS A 记录。
- GitHub runner 出口在美国，测出的是相对排名，浏览器连通性探测仅作粗略参考。
- Cloudflare 明文禁止将 CDN 用于代理中转，个人自用请自行评估风险。
