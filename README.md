# CF 优选 IP 工具

按你当前网络**真实实测** Cloudflare 优选节点，并提供反代 IP 订阅（防 DNS 泄露）。

## 在线地址
- 前端：`https://goodip.cc.cd`
- API：`https://api.goodip.cc.cd`

## 功能
1. **真实地理定位**：读取访客真实 IP（`CF-Connecting-IP`）→ `api.ip.sb` 查国家/省/市/运营商/ASN。解决了旧版 `request.cf.country` 把国内用户误标为 HK 的问题。
2. **优选节点实测**：浏览器对「优选域名」（`/cdn-cgi/trace` 测真实延迟）排序，并对 `speed.cloudflare.com` 测整体下载速度。**全走有证书的 HTTPS 端点**，不再对裸 IP 走会超时的 HTTPS。
3. **各运营商优选 IP**：电信/联通/移动/全球，来自 cf.090227.xyz 与 GitHub IPDB，可复制或一键生成订阅。
4. **订阅生成（防 DNS 泄露）**：vless / trojan / clash / sing-box。每个节点 `server` 用 **IP 字面量**（不解析目标域名）+ **ECH**（加密 SNI）+ **DoH 1.1.1.1**（兜底解析）。

## 为什么这样设计
- Cloudflare 是 anycast：单一测速点测不出"各国节点"，且裸 IP 无证书、浏览器无法 HTTPS 测速。
- 因此测速放在**浏览器（你的网络）**对**有证书的优选域名**进行；反代 IP 用于客户端配置（客户端自带 SNI 测速）。
- 想让每个裸 IP 也能浏览器实测：需给 Cloudflare token 加 **DNS:Edit** 权限，建灰云 A 记录 `ip-{group}-{i}.goodip.cc.cd` → 该 IP（脚本已写好，待权限开启即可启用）。

## 部署
- Worker：`worker/`（wrangler deploy）
- 前端：`pages/`（wrangler pages deploy）
- KV：`BESTIP` Namespace，键 `nodes` / `ips` / `domains` / `geo:*`
- 数据刷新：`.github/workflows/update.yml`（每日 04:00 UTC 拉取源 → 写 KV）

## 数据来源
- 各运营商优选 IP：https://cf.090227.xyz （`/ct` `/cu` `/cm`）
- 全球反代池：GitHub `liwp914/IPDB` `bestcf.txt`
- 地理定位：https://api.ip.sb
