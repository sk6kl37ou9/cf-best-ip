const API = 'https://api.goodip.cc.cd';
const $ = (s) => document.querySelector(s);

// ---------- 定位 ----------
async function loadMe() {
  const el = $('#loc');
  try {
    const r = await fetch(`${API}/api/me`);
    const d = await r.json();
    const g = d.geo;
    if (g) {
      el.innerHTML = `
        <span><span class="k">你的 IP</span> <span class="v">${g.ip}</span></span>
        <span><span class="k">国家</span> <b>${g.country} (${g.countryCode})</b></span>
        <span><span class="k">省份</span> <span class="v">${g.region || '-'}</span></span>
        <span><span class="k">城市</span> <span class="v">${g.city || '-'}</span></span>
        <span><span class="k">运营商</span> <span class="v">${g.isp || g.org || '-'}</span></span>
        <span><span class="k">ASN</span> <span class="v">${g.asn ? 'AS' + g.asn : '-'}</span></span>
        <span><span class="k">CF 边缘</span> <span class="v">${d.edge?.colo || '-'}</span></span>`;
    } else {
      el.innerHTML = `<span><span class="k">IP</span> <span class="v">${d.ip}</span></span><span><span class="k">CF 边缘</span> <span class="v">${d.edge?.colo || '-'}</span></span><span class="muted">（地理定位暂不可用）</span>`;
    }
  } catch (e) {
    el.innerHTML = `<span class="muted">定位失败：${e.message}</span>`;
  }
}

// ---------- 优选节点实测 ----------
let NODES = [];
async function loadNodes() {
  const r = await fetch(`${API}/api/nodes`);
  const d = await r.json();
  NODES = d.nodes || [];
  renderNodes(NODES);
}

function renderNodes(list) {
  const box = $('#nodes');
  box.innerHTML = '';
  list.forEach((n) => {
    const div = document.createElement('div');
    div.className = 'node';
    div.id = `node-${CSS.escape(n.id)}`;
    div.innerHTML = `
      <div>
        <div class="name">${n.label}</div>
        <div class="note">${n.host}${n.note ? ' · ' + n.note : ''}</div>
        <div class="bar" style="width:0"></div>
      </div>
      <div class="lat" id="lat-${CSS.escape(n.id)}"><span class="muted">未测</span></div>`;
    box.appendChild(div);
  });
}

async function ping(host, timeout = 4000) {
  const t0 = performance.now();
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeout);
    await fetch(`https://${host}/cdn-cgi/trace`, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    clearTimeout(id);
    return performance.now() - t0;
  } catch {
    return null;
  }
}

async function testNodes() {
  const btn = $('#btn-test');
  btn.disabled = true;
  $('#speed-info').innerHTML = '测速中…（每节点 3 次取平均）';
  const results = [];
  for (const n of NODES) {
    const samples = [];
    for (let i = 0; i < 3; i++) samples.push(await ping(n.host));
    const ok = samples.filter((x) => x != null);
    const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
    results.push({ n, avg, loss: samples.length - ok.length });
    setLat(n.id, avg, samples.length - ok.length);
  }
  results.sort((a, b) => (a.avg ?? 1e9) - (b.avg ?? 1e9));
  const ranked = results.map((r) => r.n);
  renderNodes(ranked);
  results.forEach((r, i) => {
    setLat(r.n.id, r.avg, r.loss);
    if (i === 0 && r.avg != null) $('#node-' + CSS.escape(r.n.id))?.classList.add('best');
  });
  // 整体下载速度（speed.cloudflare.com）
  const sp = await measureSpeed();
  $('#speed-info').innerHTML = `测速完成。最快节点：<b>${results[0]?.n.label || '-'}</b>（${results[0]?.avg ? results[0].avg.toFixed(0) + ' ms' : '超时'}）。你的网络→Cloudflare 下载速度：<b>${sp ? sp.toFixed(2) + ' MB/s' : '—'}</b>`;
  btn.disabled = false;
}

function setLat(id, avg, loss) {
  const el = $('#lat-' + CSS.escape(id));
  if (!el) return;
  const node = $('#node-' + CSS.escape(id));
  const bar = node?.querySelector('.bar');
  if (avg == null) {
    el.innerHTML = `<span class="to">超时${loss ? ` (丢${loss}/3)` : ''}</span>`;
    if (bar) bar.style.width = '0';
    return;
  }
  el.innerHTML = `<span class="ms">${avg.toFixed(0)} ms</span>`;
  if (bar) bar.style.width = Math.max(8, Math.min(100, 100 - avg / 3)) + '%';
}

async function measureSpeed() {
  try {
    const t0 = performance.now();
    const r = await fetch('https://speed.cloudflare.com/__down?bytes=25000000', { cache: 'no-store', mode: 'no-cors' });
    await r.blob();
    const sec = (performance.now() - t0) / 1000;
    return (25000000 / sec) / 1024 / 1024;
  } catch {
    return null;
  }
}

// ---------- 各运营商优选 IP ----------
let currentGroup = 'ct';
async function loadIps(group) {
  currentGroup = group;
  const r = await fetch(`${API}/api/ips?group=${group}`);
  const d = await r.json();
  const ips = d.ips || [];
  const box = $('#ip-list');
  box.innerHTML = '';
  ips.forEach((ip, i) => {
    const row = document.createElement('label');
    row.className = 'ip-row';
    row.innerHTML = `<input type="checkbox" class="ipchk" value="${ip}" /><span class="ip">${ip}</span><span class="tag">#${i + 1}</span>`;
    box.appendChild(row);
  });
}

// ---------- 订阅生成 ----------
function selectedIps() {
  return [...document.querySelectorAll('.ipchk:checked')].map((c) => c.value);
}
async function genSub() {
  const type = $('#sub-type').value;
  const secret = $('#sub-secret').value.trim();
  const sni = $('#sub-sni').value.trim() || 'www.visa.cn';
  const port = $('#sub-port').value.trim() || '443';
  const ips = $('#sub-ips').value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!ips.length) return alert('请先填入 IP（点上方「用选中生成订阅」）');
  const params = new URLSearchParams({ type, ips: ips.join(','), sni, port });
  if (type === 'trojan') { if (secret) params.set('password', secret); }
  else { if (secret) params.set('uuid', secret); }
  const r = await fetch(`${API}/api/sub?${params}`);
  const text = await r.text();
  const box = $('#sub-result');
  box.textContent = text;
  box.classList.add('show');
  box.dataset.raw = text;
  copyText(text);
}

function copyText(t) {
  navigator.clipboard?.writeText(t).catch(() => {});
}

// ---------- 事件 ----------
$('#btn-test').addEventListener('click', testNodes);
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    loadIps(t.dataset.group);
  })
);
$('#ip-sel-all').addEventListener('click', () => document.querySelectorAll('.ipchk').forEach((c) => (c.checked = true)));
$('#ip-sel-none').addEventListener('click', () => document.querySelectorAll('.ipchk').forEach((c) => (c.checked = false)));
$('#ip-copy').addEventListener('click', () => copyText(selectedIps().join('\n')));
$('#ip-to-sub').addEventListener('click', () => {
  const s = selectedIps();
  if (!s.length) return alert('请先勾选 IP');
  $('#sub-ips').value = s.join(',');
  document.querySelector('section:nth-of-type(3)').scrollIntoView({ behavior: 'smooth' });
});
$('#btn-sub').addEventListener('click', genSub);

// ---------- 初始化 ----------
loadMe();
loadNodes();
loadIps('ct');
