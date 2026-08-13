const API = 'https://api.goodip.cc.cd';
const $ = (s) => document.querySelector(s);

const state = {
  me: null,
  ips: { cf: [], bestproxy: [], proxy: [] },
  group: 'cf',
  selected: new Set(),
  domains: [],
};

async function api(path) {
  const r = await fetch(API + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.json();
}

/* ---------- 定位 ---------- */
async function loadMe() {
  try {
    const d = await api('/api/me');
    state.me = d;
    $('#meIp').textContent = d.ip || '—';
    const g = d.geo;
    $('#meGeo').textContent = g ? `${g.country || ''} ${g.region || ''} ${g.city || ''}`.trim() || '—' : '—';
    const c = d.carrier || { code: 'AB', label: '境外' };
    $('#meCarrier').innerHTML = `<span class="tag ${c.code === 'AB' ? '' : 'ok'}">${c.label}（${c.code}）</span>`;
    $('#meEdge').textContent = d.edge ? `${d.edge.country} · ${d.edge.colo}` : '—';
    $('#locText').textContent = `${d.ip} · ${c.label}`;
    $('.dot').style.background = 'var(--ok)';
  } catch (e) {
    $('#locText').textContent = '定位失败';
  }
}

/* ---------- 优选域名实测（浏览器真实延迟） ---------- */
async function loadDomains() {
  try {
    const d = await api('/api/nodes');
    state.domains = d.nodes || [];
  } catch { state.domains = []; }
  renderDomains();
  probeDomains();
}
async function probeDomains() {
  const box = $('#domainList');
  box.innerHTML = state.domains.map((n) => `
    <div class="domain-row" data-host="${n.host}">
      <div><div class="name">${n.name}</div><div class="meta">${n.host} ${n.note ? '· ' + n.note : ''}</div></div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="bar"><i style="width:0%"></i></div>
        <span class="tag">测速中…</span>
      </div>
    </div>`).join('');
  for (const n of state.domains) {
    const row = box.querySelector(`[data-host="${n.host}"]`);
    const t0 = performance.now();
    let ok = false;
    try {
      await fetch(`https://${n.host}/cdn-cgi/trace`, { mode: 'no-cors', cache: 'no-store', redirect: 'manual' });
      ok = true;
    } catch {}
    const ms = Math.round(performance.now() - t0);
    const pct = Math.max(6, Math.min(100, 100 - ms / 2));
    row.querySelector('.bar > i').style.width = pct + '%';
    const tag = row.querySelector('.tag');
    tag.textContent = ok ? `${ms} ms` : '超时';
    tag.className = 'tag ' + (ok ? 'ok' : 'bad');
  }
}

/* ---------- 优选 IP 库 ---------- */
async function loadIps() {
  try {
    const d = await api('/api/ips');
    if (d.ips) state.ips = d.ips;
  } catch {}
  renderTabs();
  renderIps();
}
function renderTabs() {
  const labels = { cf: `优选 CF 官方 (${state.ips.cf.length})`, bestproxy: `优选反代 (${state.ips.bestproxy.length})`, proxy: `反代池 (${state.ips.proxy.length})` };
  $('#ipTabs').innerHTML = Object.keys(labels).map((g) =>
    `<button class="tab ${g === state.group ? 'active' : ''}" data-g="${g}">${labels[g]}</button>`).join('');
  $('#ipTabs').querySelectorAll('.tab').forEach((b) => b.onclick = () => { state.group = b.dataset.g; renderTabs(); renderIps(); });
}
function currentIps() {
  const q = ($('#ipSearch').value || '').trim().toUpperCase();
  let arr = state.ips[state.group] || [];
  if (q) arr = arr.filter((x) => (x.country || '').toUpperCase().includes(q) || x.ip.includes(q));
  return arr;
}
function renderIps() {
  const arr = currentIps();
  $('#ipList').innerHTML = arr.map((x) => `
    <div class="ip-row ${state.selected.has(x.ip) ? 'sel' : ''}" data-ip="${x.ip}">
      <input type="checkbox" ${state.selected.has(x.ip) ? 'checked' : ''} />
      <span class="ip">${x.ip}</span>
      ${x.country ? `<span class="cc">${x.country}</span>` : ''}
      <span class="ms" data-ms="${x.ip}">—</span>
    </div>`).join('');
  $('#ipList').querySelectorAll('.ip-row').forEach((row) => {
    const ip = row.dataset.ip;
    row.querySelector('input').onchange = (e) => {
      if (e.target.checked) state.selected.add(ip); else state.selected.delete(ip);
      row.classList.toggle('sel', e.target.checked);
      updateSelCount();
    };
    row.querySelector('.ip').onclick = () => { row.querySelector('input').click(); };
  });
  updateSelCount();
}
function updateSelCount() { $('#selCount').textContent = state.selected.size; }

/* ---------- 批量测速（服务端 /api/speed） ---------- */
async function speedSelected() {
  if (state.selected.size === 0) { alert('请先勾选要测速的 IP'); return; }
  const ips = [...state.selected];
  $('#btnSpeed').disabled = true;
  const all = {};
  for (let i = 0; i < ips.length; i += 40) {
    const batch = ips.slice(i, i + 40).join(',');
    try {
      const d = await api('/api/speed?hosts=' + encodeURIComponent(batch));
      d.results.forEach((r) => { all[r.host] = r; });
    } catch {}
  }
  // 回填
  document.querySelectorAll('.ms[data-ms]').forEach((el) => {
    const ip = el.dataset.ms; const r = all[ip];
    if (!r) return;
    if (r.ok) { el.textContent = r.ms + ' ms'; el.className = 'ms ok'; }
    else { el.textContent = '超时'; el.className = 'ms bad'; }
  });
  $('#btnSpeed').disabled = false;
}

/* ---------- 订阅生成 ---------- */
async function genSub() {
  if (state.selected.size === 0) { alert('请先勾选要生成订阅的 IP'); return; }
  const type = $('#subType').value;
  const uuid = $('#subUuid').value.trim();
  const sni = $('#subSni').value.trim() || 'www.visa.cn';
  const port = $('#subPort').value.trim() || '443';
  const ips = [...state.selected].join(',');
  const url = `/api/sub?type=${type}&ips=${encodeURIComponent(ips)}&sni=${encodeURIComponent(sni)}&port=${port}` + (uuid ? `&uuid=${encodeURIComponent(uuid)}` : '');
  try {
    const r = await fetch(API + url, { cache: 'no-store' });
    const text = await r.text();
    $('#subResult').value = (type === 'vless' || type === 'trojan') ? API + url : text;
    $('#subInfo').textContent = `已生成 ${state.selected.size} 个节点 · ${type}`;
  } catch (e) { $('#subInfo').textContent = '生成失败：' + e.message; }
}
async function copySub() {
  const v = $('#subResult').value;
  if (!v) return;
  try { await navigator.clipboard.writeText(v); $('#subInfo').textContent = '已复制'; } catch {}
}

/* ---------- 域名配优选 IP ---------- */
async function genDns() {
  const domain = $('#dnsDomain').value.trim();
  if (!domain) { alert('请输入你的域名'); return; }
  try {
    const d = await api('/api/dns-config?domain=' + encodeURIComponent(domain));
    const ips = (d.recommendedIps || []).map((ip) => `<div class="ip-line">${ip}</div>`).join('');
    const tut = (d.tutorial || []).map((t) => `<li>${t}</li>`).join('');
    $('#dnsResult').innerHTML = `
      <div class="note">${d.note}</div>
      <div style="margin-top:10px"><b>推荐填入 DNS 的优选 IP（取 CF 官方已优选前 ${d.recommendedIps.length} 个）：</b>${ips}</div>
      <ol>${tut}</ol>`;
  } catch (e) { $('#dnsResult').innerHTML = '<div class="note">生成失败：' + e.message + '</div>'; }
}

/* ---------- 事件绑定 ---------- */
$('#btnProbeDomains').onclick = probeDomains;
$('#btnSpeed').onclick = speedSelected;
$('#btnSelectAll').onclick = () => { currentIps().forEach((x) => state.selected.add(x.ip)); renderIps(); };
$('#btnClear').onclick = () => { state.selected.clear(); renderIps(); };
$('#ipSearch').oninput = renderIps;
$('#btnGenSub').onclick = genSub;
$('#btnCopySub').onclick = copySub;
$('#btnDns').onclick = genDns;

/* ---------- 启动 ---------- */
loadMe();
loadDomains();
loadIps();
