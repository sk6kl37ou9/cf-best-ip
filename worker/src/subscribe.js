// 订阅生成：把优选 IP / 子域拼成 vless / trojan / clash / sing-box 配置。
// 防 DNS 泄露三件套：① server 用 IP 字面量或自有子域（不解析目标域名）② ECH 隐藏 SNI ③ DoH(1.1.1.1) 兜底解析。
// 域名模式（hosts 模式）：server 用 *.goodip.cc.cd 子域（有合法证书、不超时），SNI 用根域 goodip.cc.cd。

const ECH = 1; // 启用 ECH（客户端自动从 DNS 拉取 echConfig）

function b64u(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 从子域取根域（1-1-1-1.goodip.cc.cd -> goodip.cc.cd）用作 SNI/Host（匹配 Cloudflare 通配证书）
function rootOf(host) {
  const p = host.split('.');
  return p.length > 2 ? p.slice(1).join('.') : host;
}

function vlessOne(host, sni, uuid, port, i, isDomain) {
  const name = encodeURIComponent(`CF${isDomain ? '子域' : '反代'}-${i + 1}-${host}`);
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
  return `vless://${uuid}@${host}:${port}?${q}#${name}`;
}

function trojanOne(host, sni, password, port, i, isDomain) {
  const name = encodeURIComponent(`CF${isDomain ? '子域' : '反代'}-${i + 1}-${host}`);
  const q = new URLSearchParams({ security: 'tls', sni, fp: 'chrome', type: 'ws', path: '%2F', host: sni, ech: String(ECH) }).toString();
  return `trojan://${encodeURIComponent(password)}@${host}:${port}?${q}#${name}`;
}

function clashYaml(targets, opts) {
  const { uuid, sni, port, protocol, isDomain } = opts;
  const proxies = targets.map((host, i) => {
    const s = isDomain ? rootOf(host) : sni;
    if (protocol === 'trojan') {
      return `  - name: CF${isDomain ? '子域' : '反代'}-${i + 1}-${host}
    type: trojan
    server: ${host}
    port: ${port}
    password: "${opts.password}"
    network: ws
    ws-opts:
      path: "/"
      headers:
        Host: ${s}
    tls: true
    sni: ${s}
    client-fingerprint: chrome
    ech: true`;
    }
    return `  - name: CF${isDomain ? '子域' : '反代'}-${i + 1}-${host}
    type: vless
    server: ${host}
    port: ${port}
    uuid: ${uuid}
    network: ws
    ws-opts:
      path: "/"
      headers:
        Host: ${s}
    tls: true
    servername: ${s}
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

function singboxJson(targets, opts) {
  const { uuid, sni, port, protocol, isDomain } = opts;
  const outbounds = targets.map((host, i) => {
    const s = isDomain ? rootOf(host) : sni;
    const o = {
      type: protocol === 'trojan' ? 'trojan' : 'vless',
      tag: `CF${isDomain ? '子域' : '反代'}-${i + 1}-${host}`,
      server: host,
      server_port: Number(port),
      tls: { enabled: true, server_name: s, utls: { enabled: true, fingerprint: 'chrome' }, ech: { enabled: true } },
    };
    if (protocol === 'trojan') o.password = opts.password;
    else { o.uuid = uuid; o.packet_encoding = 'xudp'; }
    o.transport = { type: 'ws', path: '/', headers: { Host: s } };
    return o;
  });
  const first = targets[0];
  const sd = isDomain ? rootOf(first) : sni;
  return JSON.stringify({
    dns: { servers: [{ address: 'https://1.1.1.1/dns-query', detour: `CF${isDomain ? '子域' : '反代'}-1-${first}` }] },
    outbounds: [...outbounds, { type: 'direct', tag: 'direct' }, { type: 'dns', tag: 'dns-out' }],
  }, null, 2);
}

export function makeSubscription(params) {
  const ips = (params.get('ips') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const hosts = (params.get('hosts') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const type = params.get('type') || 'vless';
  const sni = params.get('sni') || 'www.visa.cn';
  const port = params.get('port') || '443';

  const isDomain = hosts.length > 0;
  const targets = isDomain ? hosts : ips;
  if (targets.length === 0) return new Response('缺少 ips / hosts 参数', { status: 400 });

  if (type === 'vless') {
    const uuid = params.get('uuid') || '00000000-0000-0000-0000-000000000000';
    const links = targets.map((h, i) => vlessOne(h, isDomain ? rootOf(h) : sni, uuid, port, i, isDomain));
    return new Response(b64u(links.join('\n')), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (type === 'trojan') {
    const password = params.get('password') || 'your-password';
    const links = targets.map((h, i) => trojanOne(h, isDomain ? rootOf(h) : sni, password, port, i, isDomain));
    return new Response(b64u(links.join('\n')), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (type === 'clash') {
    const uuid = params.get('uuid') || '00000000-0000-0000-0000-000000000000';
    const yaml = clashYaml(targets, { uuid, sni, port, protocol: params.get('protocol') || 'vless', password: params.get('password'), isDomain });
    return new Response(yaml, { headers: { 'content-type': 'text/yaml; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (type === 'singbox') {
    const uuid = params.get('uuid') || '00000000-0000-0000-0000-000000000000';
    const json = singboxJson(targets, { uuid, sni, port, protocol: params.get('protocol') || 'vless', password: params.get('password'), isDomain });
    return new Response(json, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return new Response('未知 type', { status: 400 });
}
