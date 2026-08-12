// 解析 CloudflareST 输出的 result_{COLO}.csv -> bestip_{COUNTRY}.json
const fs = require('fs');
const path = require('path');

const colo = process.argv[2];
if (!colo) {
  console.error('用法: node scripts/parse.js <COLO>');
  process.exit(1);
}

const coloMap = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'colo-map.json'), 'utf8')
);
const info = coloMap[colo] || { country: colo, name: colo };

const csvFile = path.join(process.cwd(), `result_${colo}.csv`);
if (!fs.existsSync(csvFile)) {
  console.log(`跳过: 无结果文件 ${csvFile}`);
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
    delay: cols[4] ? parseFloat(cols[4]) : 0,   // 平均延迟 ms
    loss: cols[3] ? parseFloat(cols[3]) : 0,    // 丢包率 0~1
    speed: cols[5] ? parseFloat(cols[5]) : 0,   // 下载速度 MB/s
    colo,
  });
}

if (ips.length === 0) {
  console.log(`跳过: 无有效 IP 数据 ${csvFile}`);
  process.exit(0);
}

const out = {
  country: info.country,
  countryName: info.name,
  colo,
  updatedAt: new Date().toISOString(),
  ips,
  domains: [],
};

const outFile = path.join(process.cwd(), `bestip_${info.country}.json`);
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`写入 ${outFile}，共 ${ips.length} 条 IP`);
