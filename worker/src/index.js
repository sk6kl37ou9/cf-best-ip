import { getGeo, carrierOf } from './geo.js';
import { makeSubscription } from './subscribe.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}
function withCors(res) {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}
async function kvJson(env, key, fallback = null) {
  try {
    const v = await env.BESTIP.get(key, 'json');
    if (v) return v;
  } catch {}
  return fallback;
}

// 服务端测速：worker 在 CF 边缘对 host 发起请求测真实连通+延迟。
// 绕过浏览器裸IP证书超时（https://ip 证书失败 / http://ip 被混合内容拦截）。
// 对反代IP返回真实路径延迟；对CF官方IP为CF边缘就近参考值（前端会标注说明）。
async function speedOne(host) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 3500);
    // 用 http /cdn-cgi/trace：TCP 始终可达，CF 官方IP会回 403/1003，但能测往返；反代IP回真实 trace
    const r = await fetch(`http://${host}/cdn-cgi/trace`, { redirect: 'manual', signal: ctrl.signal });
    clearTimeout(to);
    const ms = Date.now() - t0;
    const txt = await r.text().catch(() => '');
    return { host, ok: true, ms, status: r.status, hit: txt.includes('fl=') };
  } catch (e) {
    return { host, ok: false, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'timeout' : 'conn-fail' };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // 访客真实地理 + 运营商（修复国内直连显示 HK 的 bug；新增 CM/CU/CT 识别）
    if (path === '/api/me') {
      const ip =
        request.headers.get('cf-connecting-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      const geo = ip ? await getGeo(ip, env) : null;
      const carrier = carrierOf(geo);
      return json({
        ip,
        geo,
        carrier, // { code: 'CM'|'CU'|'CT'|'CN-IDC'|'CN'|'AB', label }
        edge: { country: request.cf?.country, colo: request.cf?.colo, city: request.cf?.city },
      });
    }

    // 实时优选 IP（来自 IPDB cron，KV 存储）；?group=cf|bestproxy|proxy 过滤
    if (path === '/api/ips') {
      const all = await kvJson(env, 'ips', null);
      const group = url.searchParams.get('group');
      if (!all) return json({ error: '数据未就绪，请等待 cron 拉取' }, 503);
      if (group && all[group]) return json({ group, ips: all[group], meta: await kvJson(env, 'meta', null) });
      return json({ ips: all, meta: await kvJson(env, 'meta', null) });
    }

    // 优选域名测速端点（有证书，浏览器可真测延迟+下载）
    if (path === '/api/nodes') {
      return json({ nodes: await kvJson(env, 'nodes', []) });
    }
    if (path === '/api/domains') {
      return json({ domains: await kvJson(env, 'domains', []) });
    }
    if (path === '/api/meta') {
      return json(await kvJson(env, 'meta', null) || {});
    }

    // 服务端批量测速（裸IP/反代IP/域名均可；绕过证书超时）
    if (path === '/api/speed') {
      const hosts = (url.searchParams.get('hosts') || url.searchParams.get('host') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (hosts.length === 0) return json({ error: '缺少 hosts' }, 400);
      const results = await Promise.all(hosts.slice(0, 60).map(speedOne));
      return json({ results });
    }

    // 域名配优选IP生成器（吸收 GetCFipToDns：把优选IP填DNS让网站走优选节点）
    if (path === '/api/dns-config') {
      const domain = (url.searchParams.get('domain') || '').trim();
      const ips = (await kvJson(env, 'ips', null))?.cf || [];
      // 取延迟参考最优的前若干（这里按 IPDB 已优选顺序，取前 N 个）
      const pick = ips.slice(0, 10).map((x) => x.ip);
      return json({
        domain,
        recommendedIps: pick,
        note: domain
          ? `将下方 IP 填入 ${domain} 的 DNS A 记录（建议分运营商：移动/联通/电信各取就近IP），即可让该域名走 Cloudflare 优选节点，提升国内访问速度。`
          : '请输入你的域名以生成 DNS 配置。',
        tutorial: [
          '1. 登录你的 DNS 服务商（Cloudflare / 阿里云 / DNSPod / 腾讯云）。',
          '2. 为域名添加 A 记录，记录值填上方 recommendedIps 中的优选 IP。',
          '3. 代理状态（橙色云）保持开启，Cloudflare 会按就近路由到优质节点。',
          '4. 建议每小时刷新一次（IPDB 实时优选），可用 GetCFipToDns 项目自动化。',
        ],
      });
    }

    // DNS 自动绑定：把优选IP绑成子域（带证书，浏览器可真测；订阅可用子域替代裸IP）
    // 依赖 Worker Secret CF_DNS_TOKEN（DNS:Edit 权限）+ goodip.cc.cd 所在 zone
    if (path === '/api/dns-bind') {
      const token = env.CF_DNS_TOKEN;
      if (!token) return json({ error: 'CF_DNS_TOKEN 未配置（需在 Worker 注入带 DNS:Edit 的 token）' }, 503);
      const ZONE = 'dd8fb7ebc446680464043093dbe47b4c';
      const ROOT = 'goodip.cc.cd';
      let body = {};
      if (request.method === 'POST') { try { body = await request.json(); } catch {} }
      const ip = (body.ip || url.searchParams.get('ip') || '').trim();
      const action = (body.action || url.searchParams.get('action') || 'bind').trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return json({ error: 'ip 格式不正确' }, 400);
      const sub = ip.replace(/\./g, '-');
      const name = `${sub}.${ROOT}`;
      const api = 'https://api.cloudflare.com/client/v4';
      const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const listUrl = `${api}/zones/${ZONE}/dns_records?name=${encodeURIComponent(name)}&type=A`;
      if (action === 'list') {
        const j = await (await fetch(listUrl, { headers: h })).json();
        return json({ records: j.result || [] });
      }
      if (action === 'unbind') {
        const j = await (await fetch(listUrl, { headers: h })).json();
        const rec = j.result && j.result[0];
        if (!rec) return json({ ok: true, deleted: false });
        const del = await fetch(`${api}/zones/${ZONE}/dns_records/${rec.id}`, { method: 'DELETE', headers: h });
        return json({ ok: (await del.json()).success, deleted: true, host: name });
      }
      // bind：存在则更新，不存在则创建；灰云(DNS only)直连优选IP
      const j = await (await fetch(listUrl, { headers: h })).json();
      const rec = j.result && j.result[0];
      const payload = { type: 'A', name, content: ip, ttl: 60, proxied: false };
      let res;
      if (rec) {
        if (rec.content === ip) return json({ ok: true, exists: true, host: name, ip });
        res = await fetch(`${api}/zones/${ZONE}/dns_records/${rec.id}`, { method: 'PUT', headers: h, body: JSON.stringify(payload) });
      } else {
        res = await fetch(`${api}/zones/${ZONE}/dns_records`, { method: 'POST', headers: h, body: JSON.stringify(payload) });
      }
      const rj = await res.json();
      return json({ ok: rj.success, host: name, ip, errors: rj.errors || null });
    }

    // 订阅生成（vless/trojan/clash/singbox + ECH + DoH）
    if (path === '/api/sub') {
      return withCors(makeSubscription(url.searchParams));
    }

    if (env.PAGES_URL) return Response.redirect(env.PAGES_URL, 302);
    return new Response('CF 优选 IP', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
