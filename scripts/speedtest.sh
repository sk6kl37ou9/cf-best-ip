#!/usr/bin/env bash
# 按 colo 分桶测速：下载 CloudflareSpeedTest，拉取 CF 官方 IP 段，用 -cfcolo 测指定数据中心
set -euo pipefail

COLO="${1:-HKG}"
BASE_URL="https://github.com/XIU2/CloudflareSpeedTest/releases/download"

echo "=== 目标数据中心: ${COLO} ==="

# 1. 获取最新版本号
VER="$(curl -fsSL https://api.github.com/repos/XIU2/CloudflareSpeedTest/releases/latest \
  | grep -oP '"tag_name":\s*"\K[^"]+' | head -n1)"
echo "CloudflareSpeedTest 版本: ${VER}"

# 2. 下载并解压（linux_amd64，v2.3+ 资产名已改为小写 cfst_*）
curl -fsSL -o cfst.tar.gz "${BASE_URL}/${VER}/cfst_linux_amd64.tar.gz"
tar -xzf cfst.tar.gz
chmod +x cfst_linux_amd64/cfst

# 3. 拉取 Cloudflare 官方 IPv4 段作为测速池
curl -fsSL https://www.cloudflare.com/ips-v4 -o ip.txt

# 4. 按 colo 测速（HTTPing 模式才支持 -cfcolo，二进制在解压出的子目录里）
./cfst_linux_amd64/cfst \
  -f ip.txt \
  -cfcolo "${COLO}" \
  -httping \
  -url "https://speed.cloudflare.com/__down?bytes=200000000" \
  -n 200 -t 4 -dn 10 -dt 10 \
  -tl 200 -tll 40 -sl 1 \
  -p 0 -o "result_${COLO}.csv"

echo "=== 测速完成 ==="
if [ -f "result_${COLO}.csv" ]; then
  echo "结果行数: $(wc -l < result_${COLO}.csv)"
else
  echo "警告: 无满足条件的 IP，未生成结果文件"
fi
