# CF 优选 IP 工具

根据访客当前 IP 自动识别所在国家，并用访客自己的网络实测出对当前网络最优的 Cloudflare 优选 IP，支持生成订阅。零服务器成本，全部运行在 GitHub Actions + Cloudflare 免费额度内。

## 功能

- **自动识别国家**：Cloudflare Worker 用 `request.cf.country` 免费识别访客所在地，中国等无本地节点的国家自动就近回退。
- **浏览器实测优选**：前端加载候选池后，在访客自己的浏览器上逐个实测延迟，按真实网络延迟排序——用户在哪个国家，就自动测出对哪个国家最优的 IP。
- **定时刷新候选池**：GitHub Actions 每 6 小时全量测速，产出 20 个优质 CF IP 候选池写入 KV。
- **订阅生成**：把实测最快的前 10 个 IP 拼成 vless / trojan 订阅，或导出纯 IP 列表。

## 工作原理（为什么这样做）

Cloudflare 的 IP 是 **anycast**：同一个 IP 全球通用，但访问时会被就近路由到当地数据中心。这意味着：

1. 从单一测速点（GitHub runner 在美国）**测不出全球各地节点的延迟**——流量会就近路由回美国节点。
2. 真正"对用户最优"的 IP，只能由**用户自己所在的网络**去测。

所以本工具采用「**全局候选池 + 浏览器实测**」：

- GitHub Actions 测出 20 个优质的 anycast IP 段（路由友好、低延迟），作为候选池。
- 前端浏览器对候选 IP 逐个 `fetch` 实测 RTT，排出对当前网络最优的排序。

## 架构

```
访客浏览器 → Cloudflare Pages（自动实测 + 排序 + 订阅）
                    │ fetch /api/*
                    ▼
           Cloudflare Worker（request.cf.country 识别国家 + 读 KV + 生成订阅）
                    │ 读
                    ▼
            CF KV（bestip:GLOBAL 候选池） ◄── 写 ── GitHub Actions（定时全量测速）
```

## 目录结构

```
cf-best-ip/
├── .github/workflows/speedtest.yml   # 定时全量测速（cron 每 6 小时）
├── scripts/
│   ├── speedtest.sh                  # 下载 cfst + TCPing 延迟测速
│   ├── parse.js                      # 解析 CSV → bestip_GLOBAL.json（取 top20）
│   └── upload.mjs                    # 上传 KV
├── worker/                           # Cloudflare Worker API
│   ├── wrangler.toml
│   └── src/{index,geolocate,subscribe}.js
├── pages/                            # 前端
│   ├── index.html
│   ├── app.js
│   └── style.css
└── README.md
```

## 部署步骤（已有环境可跳过）

### 1. Cloudflare 资源
- 创建 KV Namespace，记下 `KV Namespace ID`。

### 2. 部署 Worker
```bash
cd worker
npx wrangler login
# 编辑 wrangler.toml：填 KV ID 和 PAGES_URL
npx wrangler deploy
```

### 3. 部署前端 Pages
```bash
cd pages
# 把 app.js 顶部的 API 常量改为 Worker 域名
npx wrangler pages deploy . --project-name=cf-best-ip
```
部署后把站点 URL 填回 `worker/wrangler.toml` 的 `PAGES_URL`，重新 `wrangler deploy`。

### 4. 配置 GitHub Secrets
- `CF_ACCOUNT_ID`、`CF_API_TOKEN`、`KV_NAMESPACE_ID`

### 5. 首次测速
Actions → speedtest → Run workflow。

## API 一览

| 路径 | 说明 |
|---|---|
| `GET /api/me` | 访客 country/city/colo/asn |
| `GET /api/best?country=auto` | 返回候选池（auto 自动识别，含就近回退，最终兜底 GLOBAL） |
| `GET /api/countries` | 可用 key 列表 |
| `GET /api/sub?type=vless&ips=1.1.1.1,2.2.2.2&uuid=...&sni=...` | 用指定 IP 生成订阅 |
| `GET /api/sub?countries=GLOBAL&type=trojan&uuid=...` | 从 KV 读候选池生成订阅 |

## 注意事项

- 优选 IP 是 anycast，裸 IP 无法正确回源（SNI 不匹配），实际使用需配合「优选域名」或自己域名的 DNS A 记录。
- 浏览器实测 `fetch https://IP` 测得的是「TCP+TLS 握手到失败」的耗时，作为相对延迟排序参考（no-cors 下无法精确测下载速度）。
- Cloudflare 明文禁止将 CDN 用于代理中转，个人自用请自行评估风险。
