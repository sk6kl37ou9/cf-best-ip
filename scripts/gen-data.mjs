// 读取抓取好的优选IP源，生成 worker/src/data.js（内置快照）
// 浏览器实测只取优选域名（有证书，可真测延迟+下载）；裸 IP 经 cf.090227.xyz 各运营商列表提供复制/订阅。
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../data/sources/', import.meta.url);
const parse = (f) =>
  readFileSync(new URL(f, SRC), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [ip, label] = l.split('#');
      return { ip: ip.trim(), label: (label || '').trim() };
    });

const ct = parse('ct.txt');
const cu = parse('cu.txt');
const cm = parse('cm.txt');
const global = parse('global.txt');

const domains = JSON.parse(readFileSync(new URL('../domains.json', SRC), 'utf8')).domains;

const ips = { ct: [], cu: [], cm: [], global: [] };
for (const [group, list] of [['ct', ct], ['cu', cu], ['cm', cm], ['global', global]]) {
  list.forEach(({ ip }) => ips[group].push(ip));
}

// 浏览器实测节点 = 优选域名（均有有效证书，可真测延迟+下载）。
const nodes = domains.map((d) => ({
  id: `dom-${d.host}`,
  group: 'domain',
  label: d.name,
  host: d.host,
  note: d.note,
  testable: true,
}));

const out = `// 自动生成，勿手改。由 scripts/gen-data.mjs 生成。
export const IPS = ${JSON.stringify(ips, null, 2)};

export const NODES = ${JSON.stringify(nodes, null, 2)};

export const DOMAINS = ${JSON.stringify(domains, null, 2)};
`;

writeFileSync(new URL('../worker/src/data.js', import.meta.url), out);
console.log(`生成完成: ${nodes.length} 个测试节点, IP 总数 ${ct.length + cu.length + cm.length + global.length}`);
