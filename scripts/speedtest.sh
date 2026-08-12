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

# 3. 全量测速：只做 TCPing 延迟测速（-dd 禁用下载测速，避免 IP 直连下载被限速）
# 结果按延迟排序，候选池交给前端浏览器实测重排
./cfst_linux_amd64/cfst \
  -f ip.txt \
  -n 200 -t 4 \
  -tl 200 \
  -dd \
  -p 0 -o "result.csv"

echo "=== 测速完成 ==="
if [ -f "result.csv" ]; then
  echo "结果行数: $(wc -l < result.csv)"
else
  echo "警告: 无满足条件的 IP，未生成结果文件"
fi
