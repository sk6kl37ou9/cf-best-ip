import { getGeo } from './geo.js';
import { makeSubscription } from './subscribe.js';
import { NODES, IPS, DOMAINS } from './data.js';

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

async function kvJson(env, key, fallback) {
  try {
    const v = await env.BESTIP.get(key, 'json');
    if (v) return v;
  } catch {}
  return fallback;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // 访客真实地理（修复：国内直连会显示 HK 的 bug）
    if (path === '/api/me') {
      const ip =
        request.headers.get('cf-connecting-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      const geo = ip ? await getGeo(ip, env) : null;
      return json({
        ip,
        geo,
        edge: { country: request.cf?.country, colo: request.cf?.colo, city: request.cf?.city },
      });
    }

    // 浏览器实测节点列表（优选域名 + 各运营商优选IP的可测端点）
    if (path === '/api/nodes') {
      const nodes = await kvJson(env, 'nodes', NODES);
      return json({ nodes });
    }

    // 各运营商优选IP完整列表（用于复制/订阅）
    if (path === '/api/ips') {
      const group = url.searchParams.get('group');
      if (group && IPS[group]) return json({ group, ips: IPS[group] });
      return json({ ips: IPS });
    }

    // 优选域名列表
    if (path === '/api/domains') {
      return json({ domains: await kvJson(env, 'domains', DOMAINS) });
    }

    // 订阅生成（带 ECH + DoH）
    if (path === '/api/sub') {
      return withCors(makeSubscription(url.searchParams));
    }

    if (env.PAGES_URL) return Response.redirect(env.PAGES_URL, 302);
    return new Response('CF 优选 IP', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
