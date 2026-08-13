// 从 ymyuuu/IPDB 实时拉取优选 IP，写入 Cloudflare KV。
// 替代旧的静态快照（gen-data.mjs / sync-dns.mjs）。
// 数据源：https://github.com/ymyuuu/IPDB  （bestcf / bestproxy / proxy，带 #国家）
// 运行：node scripts/fetch-ips.mjs   （需要 CF_API_TOKEN / CF_ACCOUNT_ID / KV_NAMESPACE_ID 环境变量）

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const KV = process.env.KV_NAMESPACE_ID;
const TOKEN = process.env.CF_API_TOKEN;

const RAW = 'https://raw.githubusercontent.com/ymyuuu/IPDB/main';

async function getText(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'cf-best-ip/1.0' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return (await r.text()).trim();
}

// 解析 "IP#国家" 或纯 "IP"
function parseLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => /^[\d.]+#?[A-Z]{0,2}$/.test(l) || /^[\d.]+$/.test(l))
    .map((l) => {
      const [ip, country] = l.split('#');
      return { ip, country: country || '' };
    });
}

// 优选域名测速端点（有有效证书，浏览器可真测延迟+下载，规避裸IP证书超时）
const DOMAINS = [
  { host: 'www.visa.cn', name: 'Visa 官方优选', note: 'CF 官方优选域名，证书有效，浏览器可测' },
  { host: 'youxuan.cf.090227.xyz', name: '090227 优选域名', note: '社区维护优选域名' },
  { host: 'www.who.int', name: 'WHO 官方', note: 'CF 官方域名，证书有效' },
  { host: 'www.boa.com', name: 'BOA 官方', note: 'CF 官方域名，证书有效' },
];

async function api(method, path, body) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t;
}

async function main() {
  console.log('开始拉取 IPDB ...');
  const [bestcf, bestproxy, proxy] = await Promise.all([
    getText(`${RAW}/BestCF/bestcfv4.txt`).then(parseLines),
    getText(`${RAW}/BestProxy/bestproxy&country.txt`).then(parseLines),
    getText(`${RAW}/proxy.txt`).then(parseLines),
  ]);

  // 补全 bestcf 国家（anycast，国家不重要，统一标 CF）
  const cf = bestcf.map((x) => ({ ip: x.ip, country: x.country || 'CF' }));
  console.log(`  bestcf=${cf.length}  bestproxy=${bestproxy.length}  proxy=${proxy.length}`);

  const ips = {
    cf, // 优选 CF 官方 IP（anycast，全球通用）
    bestproxy, // 优选 Cloudflare 反代 IP（按出口地区 #HK/#JP...）
    proxy, // Cloudflare 反代 IP 池（按出口地区）
  };

  const meta = {
    updatedAt: new Date().toISOString(),
    counts: { cf: cf.length, bestproxy: bestproxy.length, proxy: proxy.length },
    source: 'ymyuuu/IPDB',
  };

  await api('PUT', `/storage/kv/namespaces/${KV}/values/ips`, JSON.stringify(ips));
  await api('PUT', `/storage/kv/namespaces/${KV}/values/nodes`, JSON.stringify(DOMAINS));
  await api('PUT', `/storage/kv/namespaces/${KV}/values/domains`, JSON.stringify(DOMAINS));
  await api('PUT', `/storage/kv/namespaces/${KV}/values/meta`, JSON.stringify(meta));
  console.log('KV 写入完成:', JSON.stringify(meta.counts));
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
