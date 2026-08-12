// 订阅生成器：把「节点模板 + 优选 IP」拼成 vless/trojan 链接并 Base64 输出
// 支持两种 IP 来源：?ips=1.1.1.1,2.2.2.2（前端实测排序后直传）或 ?countries=HK,JP（从 KV 读）
function utf8Base64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export async function makeSubscription(params, env) {
  const type = (params.get('type') || 'vless').toLowerCase();

  const uuid = params.get('uuid') || '';
  const port = params.get('port') || '443';
  const sni = params.get('sni') || '';
  const host = params.get('host') || sni || '';
  const path = params.get('path') || '';
  const network = params.get('network') || 'ws';
  const security = params.get('security') || 'tls';

  if (!uuid && type !== 'list') {
    return new Response(JSON.stringify({ error: '缺少 uuid 参数' }), {
      status: 400,
      headers: { 'content-type': 'application/json;charset=utf-8' },
    });
  }

  // 收集 IP：优先用 ?ips= 直传（含前端实测排序），否则用 ?countries= 从 KV 读
  let items = [];
  const ipsParam = params.get('ips');
  if (ipsParam) {
    items = ipsParam
      .split(',')
      .map(s => s.trim())
      .filter(s => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s))
      .map(ip => ({ ip, label: ip }));
  } else {
    const countries = (params.get('countries') || '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    for (const country of countries) {
      const data = await env.BESTIP.get(`bestip:${country}`, 'json');
      if (!data) continue;
      for (const item of data.ips.slice(0, 3)) {
        items.push({ ip: item.ip, label: `${country}-${item.ip}` });
      }
    }
  }

  if (items.length === 0) {
    return new Response(JSON.stringify({ error: '无可用 IP（检查 ips/countries 参数）' }), {
      status: 404,
      headers: { 'content-type': 'application/json;charset=utf-8' },
    });
  }

  const lines = [];
  for (const { ip, label } of items) {
    if (type === 'list') {
      lines.push(ip);
    } else if (type === 'trojan') {
      lines.push(`trojan://${uuid}@${ip}:${port}?sni=${sni}&type=${network}&host=${host}&path=${encodeURIComponent(path)}#${label}`);
    } else {
      const qs = new URLSearchParams({ encryption: 'none', security, sni, type: network, host, path });
      lines.push(`vless://${uuid}@${ip}:${port}?${qs.toString()}#${label}`);
    }
  }

  if (type === 'list') {
    return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain;charset=utf-8' } });
  }

  return new Response(utf8Base64(lines.join('\n')), { headers: { 'content-type': 'text/plain;charset=utf-8' } });
}
