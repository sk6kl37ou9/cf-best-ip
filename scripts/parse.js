// 解析 result.csv -> bestip_GLOBAL.json（全局优选 IP 候选池）
const fs = require('fs');
const path = require('path');

const csvFile = path.join(process.cwd(), 'result.csv');
if (!fs.existsSync(csvFile)) {
  console.log('跳过: 无结果文件 result.csv');
  process.exit(0);
}

const lines = fs.readFileSync(csvFile, 'utf8').split(/\r?\n/).filter(Boolean);
const ips = [];

for (const line of lines) {
  const cols = line.split(',').map(s => s.trim());
  const ip = cols[0];
  // 只解析合法 IPv4 行，自动跳过表头
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) continue;
  ips.push({
    ip,
    delay: cols[4] ? parseFloat(cols[4]) : 0,   // 平均延迟 ms（测速机视角）
    loss: cols[3] ? parseFloat(cols[3]) : 0,    // 丢包率 0~1
    speed: cols[5] ? parseFloat(cols[5]) : 0,   // 下载速度 MB/s
  });
}

if (ips.length === 0) {
  console.log('跳过: 无有效 IP 数据');
  process.exit(0);
}

const out = {
  country: 'GLOBAL',
  countryName: '全球候选池（浏览器实测后按你的网络重排）',
  updatedAt: new Date().toISOString(),
  ips,
  domains: [],
};

const outFile = path.join(process.cwd(), 'bestip_GLOBAL.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`写入 ${outFile}，共 ${ips.length} 条 IP`);
