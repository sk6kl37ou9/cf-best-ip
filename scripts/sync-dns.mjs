// 同步脚本：把 nodes / ips / domains 写入 KV（供 Worker 读取）。
// 由 GitHub Actions 每日运行，也可本地手动跑。
// 注：逐个 IP 的浏览器实测需要 DNS:Edit 权限建灰云子域，当前 token 无此权限，故 IP 以列表形式提供。
import { IPS, NODES, DOMAINS } from '../worker/src/data.js';

const TOKEN = process.env.CF_API_TOKEN;
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const KV = process.env.KV_NAMESPACE_ID || 'c70128782af344e9a8392c5d5139a636';

async function api(method, path, body) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!d.success) throw new Error(`${method} ${path}: ${JSON.stringify(d.errors)}`);
  return d.result;
}

async function main() {
  await api('PUT', `/accounts/${ACCOUNT}/storage/kv/namespaces/${KV}/values/nodes`, NODES);
  await api('PUT', `/accounts/${ACCOUNT}/storage/kv/namespaces/${KV}/values/ips`, IPS);
  await api('PUT', `/accounts/${ACCOUNT}/storage/kv/namespaces/${KV}/values/domains`, DOMAINS);
  console.log(`KV 已写入: nodes=${NODES.length}, IP总数=${IPS.ct.length + IPS.cu.length + IPS.cm.length + IPS.global.length}, domains=${DOMAINS.length}`);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
