// 订阅生成：把优选 IP + 反代域名拼成 vless / trojan / clash / sing-box 配置。
// 防 DNS 泄露三件套：① server 用 IP 字面量（不解析目标域名）② ECH 隐藏 SNI ③ DoH(1.1.1.1) 兜底解析。

const ECH = 1; // 启用 ECH（客户端自动从 DNS 拉取 echConfig）

function b64u(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function vlessLinks(ips, opts) {
  const { uuid, sni, port } = opts;
  return ips.map((ip, i) => {
    const name = encodeURIComponent(`CF反代-${i + 1}-${ip}`);
    const q = new URLSearchParams({
      encryption: 'none',
      security: 'tls',
      sni,
      type: 'ws',
      path: '%2F',
      host: sni,
      fp: 'chrome',
      pbk: '',
      sid: '',
      spx: '',
      ech: String(ECH),
    }).toString();
    return `vless://${uuid}@${ip}:${port}?${q}#${name}`;
  });
}

function trojanLinks(ips, opts) {
  const { password, sni, port } = opts;
  return ips.map((ip, i) => {
    const name = encodeURIComponent(`CF反代-${i + 1}-${ip}`);
    const q = new URLSearchParams({ security: 'tls', sni, fp: 'chrome', type: 'ws', path: '%2F', host: sni, ech: String(ECH) }).toString();
    return `trojan://${encodeURIComponent(password)}@${ip}:${port}?${q}#${name}`;
  });
}

function clashYaml(ips, opts) {
  const { uuid, sni, port, protocol } = opts;
  const proxies = ips.map((ip, i) => {
    if (protocol === 'trojan') {
      return `  - name: CF反代-${i + 1}-${ip}
    type: trojan
    server: ${ip}
    port: ${port}
    password: "${opts.password}"
    network: ws
    ws-opts:
      path: "/"
      headers:
        Host: ${sni}
    tls: true
    sni: ${sni}
    client-fingerprint: chrome
    ech: true`;
    }
    return `  - name: CF反代-${i + 1}-${ip}
    type: vless
    server: ${ip}
    port: ${port}
    uuid: ${uuid}
    network: ws
    ws-opts:
      path: "/"
      headers:
        Host: ${sni}
    tls: true
    servername: ${sni}
    client-fingerprint: chrome
    ech: true
    udp: true`;
  }).join('\n');
  return `mixed-port: 7890
mode: rule
dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver:
    - https://1.1.1.1/dns-query
  fallback:
    - https://1.1.1.1/dns-query
proxies:
${proxies}
`;
}

function singboxJson(ips, opts) {
  const { uuid, sni, port, protocol } = opts;
  const outbounds = ips.map((ip, i) => {
    const o = {
      type: protocol === 'trojan' ? 'trojan' : 'vless',
      tag: `CF反代-${i + 1}-${ip}`,
      server: ip,
      server_port: Number(port),
      tls: { enabled: true, server_name: sni, utls: { enabled: true, fingerprint: 'chrome' }, ech: { enabled: true } },
    };
    if (protocol === 'trojan') o.password = opts.password;
    else { o.uuid = uuid; o.packet_encoding = 'xudp'; }
    o.transport = { type: 'ws', path: '/', headers: { Host: sni } };
    return o;
  });
  return JSON.stringify({
    dns: { servers: [{ address: 'https://1.1.1.1/dns-query', detour: 'CF反代-1-' + ips[0] }] },
    outbounds: [...outbounds, { type: 'direct', tag: 'direct' }, { type: 'dns', tag: 'dns-out' }],
  }, null, 2);
}

export function makeSubscription(params) {
  const ips = (params.get('ips') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const type = params.get('type') || 'vless';
  const sni = params.get('sni') || 'www.visa.cn';
  const port = params.get('port') || '443';
  if (ips.length === 0) return new Response('缺少 ips 参数', { status: 400 });

  if (type === 'vless') {
    const uuid = params.get('uuid') || '00000000-0000-0000-0000-000000000000';
    const links = vlessLinks(ips, { uuid, sni, port });
    return new Response(b64u(links.join('\n')), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (type === 'trojan') {
    const password = params.get('password') || 'your-password';
    const links = trojanLinks(ips, { password, sni, port });
    return new Response(b64u(links.join('\n')), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (type === 'clash') {
    const uuid = params.get('uuid') || '00000000-0000-0000-0000-000000000000';
    const yaml = clashYaml(ips, { uuid, sni, port, protocol: params.get('protocol') || 'vless', password: params.get('password') });
    return new Response(yaml, { headers: { 'content-type': 'text/yaml; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (type === 'singbox') {
    const uuid = params.get('uuid') || '00000000-0000-0000-0000-000000000000';
    const json = singboxJson(ips, { uuid, sni, port, protocol: params.get('protocol') || 'vless', password: params.get('password') });
    return new Response(json, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return new Response('未知 type', { status: 400 });
}
