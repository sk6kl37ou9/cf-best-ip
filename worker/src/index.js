import { getBest } from './geolocate.js';
import { makeSubscription } from './subscribe.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json;charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

export default {
  async fetch(request, env) {
    // OPTIONS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': '*',
        },
      });
    }
    const res = await handle(request, env);
    const headers = new Headers(res.headers);
    headers.set('access-control-allow-origin', '*');
    return new Response(res.body, { status: res.status, headers });
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 访客信息（含访客真实 IP）
  if (path === '/api/me') {
    return json({
      ip: request.headers.get('CF-Connecting-IP') || '',
      country: request.cf?.country,
      city: request.cf?.city,
      colo: request.cf?.colo,
      asn: request.cf?.asn,
      timezone: request.cf?.timezone,
    });
  }

  // 最优 IP：country=auto 自动识别访客国家，否则显式指定
  if (path === '/api/best') {
    const req = url.searchParams.get('country') || 'auto';
    const country = req === 'auto' ? (request.cf?.country || 'US') : req.toUpperCase();
    const fmt = url.searchParams.get('format');
    const data = await getBest(country, env);
    if (!data) return json({ error: `no data for ${country}` }, 404);
    if (fmt === 'text') {
      return new Response(data.ips.map(i => i.ip).join('\n'), {
        headers: { 'content-type': 'text/plain;charset=utf-8' },
      });
    }
    return json(data);
  }

  // 可用国家列表
  if (path === '/api/countries') {
    const list = await env.BESTIP.list({ prefix: 'bestip:' });
    const countries = list.keys.map(k => k.name.replace('bestip:', ''));
    return json({ countries });
  }

  // 订阅
  if (path === '/api/sub') {
    return makeSubscription(url.searchParams, env);
  }

  // 根路径跳转到前端
  if (env.PAGES_URL) {
    return Response.redirect(env.PAGES_URL, 302);
  }
  return new Response('CF Best IP API', {
    headers: { 'content-type': 'text/plain;charset=utf-8' },
  });
}
