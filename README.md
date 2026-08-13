# CF 优选 IP 工具

根据访客当前 IP 自动优选 Cloudflare 节点 / 反代 IP，生成防 DNS 泄露的代理订阅。零服务器成本，GitHub Actions + Cloudflare 全托管。

**在线地址：** https://goodip.cc.cd （API：https://api.goodip.cc.cd）

## 灵感来源（三个开源项目）
- [jaaazzz/GetCFipToDns](https://github.com/jaaazzz/GetCFipToDns)：把 CF 优选 IP 动态写进你的域名 DNS，让网站走优选节点；按运营商 CM/CU/CT 分组。本工具的「域名配优选 IP」生成器即吸收此思路。
- [ymyuu/IPDB](https://github.com/ymyuu/IPDB)：实时优选 IP 数据源（bestcf 官方 / bestproxy 反代优选 / proxy 反代池，带出口地区）。本工具每小时 cron 拉取。
- [ymyuu/Cloudflare-Workers-Proxy](https://github.com/ymyuu/Cloudflare-Workers-Proxy)：Cloudflare Worker 反向代理机制，用于把优选 IP 用于访问目标站点（防 DNS 污染）。

## 架构
```
GitHub Actions (每小时) ──fetch-ips.mjs──▶ IPDB 实时优选 IP ──▶ Cloudflare KV
                                                        │
Cloudflare Worker (api.goodip.cc.cd)                   │ 读 KV
  /api/me       访客真实 IP + 地理 + 运营商(CM/CU/CT)    │
  /api/ips      优选 IP 库(cf/bestproxy/proxy)          ◀┘
  /api/speed    服务端测速(裸IP/反代IP，绕过证书超时)
  /api/dns-config  域名→优选IP DNS 配置生成器
  /api/sub      vless/trojan/clash/singbox 订阅(含 ECH+DoH)
        │
Cloudflare Pages (goodip.cc.cd) ── 前端：定位 + 优选域名实测 + IP库分组实测 + 订阅 + 域名生成器
```

## 关键点
- **定位准确**：用真实出口 IP 查 `api.ip.sb`（不用 `request.cf.country`，国内直连会被就近路由误标 HK），并识别运营商 CM/CU/CT/AB。
- **真测速不超时**：优选域名走浏览器 `fetch /cdn-cgi/trace`（有证书）；裸 IP / 反代 IP 走 Worker 服务端 `/api/speed`（绕过浏览器裸 IP 证书失败 / 混合内容拦截）。
- **防 DNS 泄露**：订阅中 server 用 IP 字面量 + ECH（隐藏 SNI）+ DoH 1.1.1.1。

## 本地开发
```bash
# 前端
cd pages && npx wrangler pages deploy . --project-name cf-best-ip
# Worker
cd worker && npx wrangler deploy
# 手动刷新数据（需 CF_* 环境变量）
node scripts/fetch-ips.mjs
```

## 部署（首次）
1. Cloudflare 建 KV Namespace，填 `worker/wrangler.toml` 的 `id`。
2. 仓库配 Secrets：`CF_ACCOUNT_ID` / `CF_API_TOKEN` / `KV_NAMESPACE_ID`。
3. `git push` 后 Actions 自动每小时刷新数据；手动可在 Actions 页点 `fetch-ips` 跑一次。
4. Pages 绑自定义域 `goodip.cc.cd`（需手动加 CNAME 到 `*.pages.dev`，当前 token 无 DNS 编辑权限）。

## 说明
- 服务端测速为 Cloudflare 边缘节点参考延迟（对 CF 官方 IP 是就近值）；浏览器实测优选域名才是你当前网络真值。
- 若给 Cloudflare token 加 **DNS:Edit** 权限，可启用「通配符证书 + 每个裸 IP 浏览器实测」（代码已预留）。
