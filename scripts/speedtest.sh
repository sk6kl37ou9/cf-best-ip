#!/usr/bin/env bash
# 全量测速：下载 CloudflareSpeedTest，拉取 CF 官方 IP 段，测出全局优选 IP 候选池
set -euo pipefail

echo "=== 开始全量测速 ==="

# 1. 下载并解压（latest 直链，避免 api.github.com 限流；v2.3+ 资产名为小写 cfst_*）
curl -fsSL -o cfst.tar.gz "https://github.com/XIU2/CloudflareSpeedTest/releases/latest/download/cfst_linux_amd64.tar.gz"
tar -xzf cfst.tar.gz
chmod +x cfst_linux_amd64/cfst

# 2. 拉取 Cloudflare 官方 IPv4 段作为测速池
curl -fsSL https://www.cloudflare.com/ips-v4 -o ip.txt

# 3. 全量测速：TCPing 延迟 + 下载测速，产出 top 15（这些是 anycast 全局通用的优质 IP 段）
./cfst_linux_amd64/cfst \
  -f ip.txt \
  -url "https://speed.cloudflare.com/__down?bytes=200000000" \
  -n 200 -t 4 -dn 15 -dt 10 \
  -tl 200 -tll 40 -sl 1 \
  -p 0 -o "result.csv"

echo "=== 测速完成 ==="
if [ -f "result.csv" ]; then
  echo "结果行数: $(wc -l < result.csv)"
else
  echo "警告: 无满足条件的 IP，未生成结果文件"
fi
