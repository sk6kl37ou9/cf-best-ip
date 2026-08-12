# CF 优选 IP 工具 — 详细技术设计文档

> 版本：v1.0（草案，供评审）
> 定位：个人自用（轻量），零服务器成本
> 技术栈：GitHub Actions + Cloudflare Worker + Cloudflare Pages + KV/R2
> 目标：根据访客当前 IP 自动识别所在国家，返回该国家/地区的 Cloudflare 优选 IP 与优选域名，并支持生成订阅

---

## 1. 项目目标

1. **自动识别**：访客打开页面，自动识别其所在国家/地区（零配置、零延迟）。
2. **按国家优选**：返回该国家（及其邻近地区）的 Cloudflare 最优 IP，含延迟、丢包率、下载速度。
3. **双输出**：既给「纯 IP / 优选域名列表」，也生成「完整订阅链接（vless/trojan 等）」。
4. **自测兜底**：访客可在浏览器侧对候选 IP/域名二次实测，得到「对自己当前网络最优」的结果。

---

## 2. 总体架构

四层 + 一条数据回流，全部运行在 GitHub 与 Cloudflare 免费额度内：

```
                    ┌─────────────────────┐
                    │   全球访客（浏览器）   │
                    └──────────┬──────────┘
                               │ ① 打开页面 / 请求 API
                               ▼
                    ┌─────────────────────┐
                    │  Cloudflare Pages    │  分控面板 + 浏览器侧在线实测
                    └──────────┬──────────┘
                               │ ② fetch /api/*
                               ▼
                    ┌─────────────────────┐
                    │  Cloudflare Worker   │  request.cf.country 识别国家
                    │                     │  → 读 KV → 返回优选 IP / 订阅
                    └──────────┬──────────┘
                               │ ③ 读
                               ▼
                    ┌─────────────────────┐        ▲
                    │   CF KV + R2 存储    │◄───────┘ ④ 写
                    └─────────────────────┘        │
                                                   │
                    ┌─────────────────────┐        │
                    │  GitHub Actions     │────────┘  定时跑 CloudflareSpeedTest
                    └─────────────────────┘          按 colo 分桶测速 → 解析 → 入库
```

**核心机制（一句话）**：Worker 免费拿到 `request.cf.country` 识别访客国家；GitHub Actions 定时用 `-cfcolo` 按数据中心分桶测出各国家最优 IP 写入 KV；前端展示并支持浏览器侧复测与订阅生成。

---

## 3. 技术选型

| 层 | 技术 | 理由 |
|---|---|---|
| 测速引擎 | [XIU2/CloudflareSpeedTest](https://github.com/XIU2/CloudflareSpeedTest)（Go） | 成熟、支持 `-cfcolo` 按数据中心测速、支持 IPv4/IPv6、TCPing/HTTPing、下载测速 |
| IP 段来源 | Cloudflare 官方 `https://www.cloudflare.com/ips-v4` / `ips-v6` | 权威、持续更新 |
| 定时任务 | GitHub Actions（cron + matrix 并行） | 免费、无需自建服务器 |
| API | Cloudflare Worker（免费版） | `request.cf.*` 免费用、全球边缘、零运维 |
| 前端 | Cloudflare Pages（静态） | 免费托管、全球 CDN |
| 存储 | CF KV（热数据）+ R2（历史/大文件） | KV 读极快、R2 零出口费 |

---

## 4. 目录结构（monorepo）

```
cf-best-ip/
├── .github/workflows/
│   └── speedtest.yml          # 定时测速工作流（cron + matrix）
├── scripts/
│   ├── speedtest.sh           # 下载 CloudflareST + 按 colo 测速
│   ├── parse.js               # 解析 result.csv → 国家/colo 分组 JSON
│   └── upload.mjs             # 通过 wrangler 上传到 KV / R2
├── data/
│   ├── colo-map.json          # colo 三字码 → 国家/地区 映射表
│   └── targets.json           # 目标测速地区（colo 列表 + 优先级）
├── worker/
│   ├── wrangler.toml
│   └── src/
│       ├── index.js           # 路由入口
│       ├── geolocate.js       # request.cf 解析 + 就近回退
│       └── subscribe.js       # 订阅链接生成器
├── pages/
│   ├── index.html
│   ├── app.js                 # 面板逻辑 + 浏览器侧实测
│   └── style.css
└── README.md
```

---

## 5. 数据模型

### 5.1 KV Key 设计

```
bestip:{ISO3166-1 两位国家码}   → 该国家最优 IP JSON（覆盖核心）
bestip:meta:{country}          → 元数据（更新时间、可用性）
colo:{colocode}                → 单个数据中心的原始测速结果（细粒度）
sub:cache:{hash}               → 已生成订阅的缓存
```

### 5.2 优选 IP JSON 结构

```json
{
  "country": "HK",
  "countryName": "中国香港",
  "colo": "HKG",
  "updatedAt": "2026-08-13T05:00:00Z",
  "ips": [
    { "ip": "104.16.132.229", "delay": 38.2, "loss": 0.0, "speed": 28.6, "colo": "HKG" },
    { "ip": "172.67.164.3",   "delay": 41.7, "loss": 0.0, "speed": 25.1, "colo": "HKG" }
  ],
  "domains": [
    { "host": "youxuan.cf.090227.xyz", "note": "三网优选（泛域名）" },
    { "host": "www.visa.cn",            "note": "官方优选" }
  ]
}
```

字段说明：
- `delay`：平均延迟（ms）；`loss`：丢包率（0~1）；`speed`：下载速度（MB/s）。
- `ips` 按「下载速度 × 延迟」综合排序，取前 10~20 条。
- `domains`：可选维护的优选域名清单（来源参考 cf.090227.xyz 的公开列表，手动/脚本更新）。

### 5.3 colo → 国家映射表（`data/colo-map.json`）

CF 数据中心用 IATA 机场三字码标识，需映射到国家/地区。示例：

```json
{
  "HKG": { "country": "HK", "name": "中国香港" },
  "NRT": { "country": "JP", "name": "日本·东京" },
  "KIX": { "country": "JP", "name": "日本·大阪" },
  "SIN": { "country": "SG", "name": "新加坡" },
  "LAX": { "country": "US", "name": "美国·洛杉矶" },
  "SJC": { "country": "US", "name": "美国·圣何塞" },
  "SEA": { "country": "US", "name": "美国·西雅图" },
  "FRA": { "country": "DE", "name": "德国·法兰克福" },
  "LHR": { "country": "GB", "name": "英国·伦敦" },
  "SYD": { "country": "AU", "name": "澳大利亚·悉尼" }
}
```

> 完整映射可参考 Cloudflare 官方公开的 colo 列表（`https://www.cloudflare.com/network/` 或社区整理的 colo.json）。同一国家有多个数据中心时，取延迟最优者作为该国代表。

---

## 6. 测速采集层（GitHub Actions）

### 6.1 工作流设计（`.github/workflows/speedtest.yml`）

- **触发**：`schedule`（cron，建议每 4~6 小时一次）+ `workflow_dispatch`（手动）。
- **策略**：用 **matrix 并行**，每个 colo 一个 job，互不阻塞，控制总时长。
- **关键环境变量**（GitHub Secrets）：
  - `CF_ACCOUNT_ID`、`CF_API_TOKEN`（用于 wrangler 上传 KV/R2）
  - `KV_NAMESPACE_ID`、`R2_BUCKET`（目标存储）

```yaml
name: speedtest
on:
  schedule:
    - cron: "0 */6 * * *"          # 每 6 小时
  workflow_dispatch:

jobs:
  speedtest:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        colo: [HKG, NRT, KIX, SIN, LAX, SJC, SEA, FRA, LHR, SYD]
    steps:
      - uses: actions/checkout@v4
      - name: Run CloudflareST
        run: bash scripts/speedtest.sh ${{ matrix.colo }}
      - name: Parse & upload
        run: node scripts/parse.js ${{ matrix.colo }} && node scripts/upload.mjs ${{ matrix.colo }}
        env:
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

### 6.2 CloudflareSpeedTest 测速参数（`scripts/speedtest.sh`）

```bash
#!/usr/bin/env bash
set -euo pipefail
COLO="$1"

# 1. 下载最新 release（linux_amd64）
VER=$(curl -s https://api.github.com/repos/XIU2/CloudflareSpeedTest/releases/latest | grep -oP '"tag_name": "\K[^"]+')
curl -sL -o cfst.tar.gz "https://github.com/XIU2/CloudflareSpeedTest/releases/download/${VER}/CloudflareST_linux_amd64.tar.gz"
tar -xzf cfst.tar.gz

# 2. 拉取 CF 官方 IPv4 段作为测速池
curl -s https://www.cloudflare.com/ips-v4 -o ip.txt

# 3. 按指定 colo 测速（HTTPing 模式才支持 -cfcolo）
./CloudflareST \
  -f ip.txt \
  -cfcolo "$COLO" \
  -httping \
  -url "https://speed.cloudflare.com/__down?bytes=200000000" \
  -n 200 -t 4 -dn 10 -dt 10 \
  -tl 200 -tll 40 -sl 1 \
  -p 0 -o "result_${COLO}.csv"
```

参数要点：
- `-httping` + `-cfcolo $COLO`：只保留命中该数据中心的 IP（通过响应头 CF-Ray 解析 colo）。
- `-url`：用 CF 官方测速地址（`speed.cloudflare.com`），稳定且文件够大。
- `-tl 200 -tll 40 -sl 1`：过滤掉高延迟、假墙 IP（延迟 < 40ms 的 TCP 劫持）和低速 IP。
- `-p 0 -o ...`：不打印、只落盘 CSV。

### 6.3 解析与入库（`scripts/parse.js` / `upload.mjs`）

1. `parse.js`：读 `result_${COLO}.csv`，按 `colo-map.json` 映射到国家码，组装成第 5.2 节 JSON。
2. `upload.mjs`：用 `wrangler kv key put` 或直接调用 Cloudflare API 写 KV；同时把原始 CSV 归档到 R2（保留历史便于分析）。

> 注意：GitHub 托管 runner 出口在美国，测出的是「美国→各 colo」的**相对**质量排名，不能直接代表中国/欧洲访客的绝对值。因此本工具将其作为「各国家候选 IP 池 + 相对排名」，最终精度由浏览器侧自测兜底（见 §8.2）。

---

## 7. API 层（Cloudflare Worker）

### 7.1 接口列表

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/me` | 返回访客 `request.cf` 信息（country/city/colo/asn），用于前端高亮「你所在国家」 |
| GET | `/api/best?country=auto` | 返回最优 IP。`auto` = 自动用访客国家；也可显式 `?country=HK` |
| GET | `/api/best?country=auto&format=text` | 纯文本 IP 列表（每行一个） |
| GET | `/api/countries` | 返回可用国家列表（供面板渲染全球节点阵列） |
| GET | `/api/sub?countries=HK,JP,SG&type=vless&tpl=xxx` | 生成订阅链接（见 §7.3） |
| GET | `/` | 重定向到 Pages 前端 |

### 7.2 核心逻辑（`worker/src/index.js`）

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/me") {
      return json({
        country: request.cf?.country,
        city: request.cf?.city,
        colo: request.cf?.colo,
        asn: request.cf?.asn,
        timezone: request.cf?.timezone,
      });
    }

    if (path === "/api/best") {
      const req = url.searchParams.get("country") || "auto";
      const country = req === "auto" ? (request.cf?.country || "US") : req;
      const fmt = url.searchParams.get("format");
      const data = await env.KV.get(`bestip:${country}`, "json");
      if (!data) return json({ error: "no data" }, 404);
      if (fmt === "text") return text(data.ips.map(i => i.ip).join("\n"));
      return json(data);
    }

    if (path === "/api/countries") {
      const list = await env.KV.list({ prefix: "bestip:" });
      return json(list.keys.map(k => k.name.replace("bestip:", "")));
    }

    if (path === "/api/sub") {
      return makeSubscription(url.searchParams, request.cf, env);
    }

    return Response.redirect(env.PAGES_URL, 302);
  },
};
```

### 7.3 订阅生成（`worker/src/subscribe.js`）

CF 优选 IP 用于代理/中转时，需要「节点模板 + 优选 IP」拼接成链接：

- **节点模板（tpl）**由用户在前端填写：协议（vless/trojan/vmess）、UUID/密码、端口、传输方式（ws/grpc）、TLS 域名、路径等。
- Worker 把模板与选中国家的优选 IP 逐条拼成 `vless://...` / `trojan://...`，Base64 编码后返回订阅文本。
- 缓存到 `sub:cache:{hash}`，避免重复计算。

```text
vless://{uuid}@{优选IP}:{port}?encryption=none&security=tls&sni={域名}&type=ws&host={域名}&path={路径}#{国家}-{ip}
```

> 说明：订阅里的「优选 IP」字段就是该国家的最优 IP；用户实际使用时，客户端会直连该 IP 并以 SNI/域名完成握手，等效于走了优选线路。

---

## 8. 前端（Cloudflare Pages）

### 8.1 页面结构（分控面板 + 在线实测）

参考网站 2 的「全球节点阵列 + 勾选 + 订阅」与网站 1 的「优选域名 + 测速」融合：

1. **顶部状态条**：调用 `/api/me` 显示「你的国家 / 城市 / 命中 colo / ASN」，自动高亮该国家卡片。
2. **全球节点阵列**：调用 `/api/countries` 平铺所有国家卡片，可勾选（全选/清空）。
3. **IP/域名列表**：选中某国家 → 展示该国的 `ips`（延迟/丢包/速度）与 `domains`，支持一键复制。
4. **订阅生成**：勾选多个国家 → 填写节点模板 → 生成订阅链接 / 复制数据（对应网站 2 的「动态生成 API 订阅接口」）。
5. **浏览器侧实测**：对候选 IP/域名并发 `fetch` 下载测速 + `performance.now()` 测延迟，本地重排（见 8.2）。

### 8.2 浏览器侧在线实测（精度兜底）

集中测速的局限（§6.3）由浏览器自测补偿：

```js
async function probe(host, bytes = 1_000_000) {
  const t0 = performance.now();
  try {
    const r = await fetch(`https://${host}/__down?bytes=${bytes}`, {
      mode: "no-cors", cache: "no-store",
    });
    const buf = await r.arrayBuffer();
    const ms = performance.now() - t0;
    const mbps = (buf.byteLength / 1024 / 1024) / (ms / 1000) * 8;
    return { host, delay: ms, speed: mbps };
  } catch {
    return { host, delay: Infinity, speed: 0 };
  }
}
```

- 注意：浏览器受同源/CORS 限制，`no-cors` 拿不到字节数时退化为「延迟 + 是否可达」评分。
- 探测目标 = 该国家的 `domains`（优选域名）而非裸 IP（裸 IP 无法正确回源，见 §11）。
- 结果本地排序，标记「对你当前网络最优」，与云端相对排名并列展示。

---

## 9. 部署清单（按序执行）

1. **建仓库**：GitHub 新建 `cf-best-ip`，推送上述目录结构。
2. **建 Cloudflare 资源**：登录 CF 控制台创建 KV Namespace（`BESTIP`）与 R2 Bucket（`bestip-history`）。
3. **配 Worker**：`worker/` 目录下 `wrangler login` 授权，`wrangler.toml` 绑定 KV/R2，`wrangler deploy` 上线。
4. **配 Pages**：`pages/` 目录部署到 Cloudflare Pages，拿到站点 URL（`PAGES_URL`）。
5. **配 Secrets**：GitHub → Settings → Secrets 添加 `CF_ACCOUNT_ID`、`CF_API_TOKEN`（最小权限：KV 读写 + R2 读写）。
6. **首次手动触发**：Actions 里 `Run workflow` 跑一次，验证 KV 有 `bestip:HKG` 等数据。
7. **验证闭环**：打开 Pages 站点 → 看到「你所在国家」高亮 → 能出 IP 列表与订阅链接。

---

## 10. 分阶段里程碑

| 阶段 | 交付物 | 验收标准 |
|---|---|---|
| M1 | Worker + Pages 骨架 + `/api/me` | 打开页面能显示访客国家 |
| M2 | Actions 测速 + 入库 | KV 出现 `bestip:{country}` 数据 |
| M3 | 前端面板 + IP/域名列表 | 按国家查看优选 IP 并复制 |
| M4 | 订阅生成 | 勾选国家 → 出 vless/trojan 订阅 |
| M5 | 浏览器侧自测 + 优选域名维护 | 本地实测可重排、域名清单可更新 |

---

## 11. 风险与注意事项

1. **裸 IP 不可直接用**：CF 为 anycast，直接以裸 IP 访问无法正确回源（SNI 不匹配）。优选 IP 必须配合「优选域名 / 你自己的域名 DNS A 记录」使用。
2. **测速位置偏差**：GitHub runner 在美国，测出的是相对排名而非访客绝对值 → 用浏览器自测兜底。
3. **假墙/劫持 IP**：中国移动等网络存在 TCP 劫持导致的「超低延迟假 IP」，必须用 `-tll 40` 下限过滤。
4. **HTTPing 被限流**：服务器端高频 HTTPing 会被 CF/运营商判为扫描而临时限流 → 降低 `-n` 并发。
5. **CF 对代理用途的立场**：CF 明文禁止把 CDN 用于代理中转，个人自用需自行评估风险，勿过度依赖。
6. **KV 最终一致性**：写入后约 60s 全球可见，测速结果更新有轻微延迟，可接受。
7. **配额**：Worker 免费版 10 万请求/天、KV 读 10 万次/天，个人自用绰绰有余；若公开需加缓存与限流。

---

## 附：参考资料

- [XIU2/CloudflareSpeedTest](https://github.com/XIU2/CloudflareSpeedTest) — 测速引擎（含完整参数说明）
- Cloudflare 官方 IP 段：`https://www.cloudflare.com/ips-v4` / `ips-v6`
- Cloudflare Worker 地理信息：`request.cf`（country/city/colo/asn，免费版可用）
- 参考站点：`https://cf.090227.xyz/`（优选域名汇总）、`https://ip.jsnzkpg.ccwu.cc/`（全球优选 IP 分控面板）
