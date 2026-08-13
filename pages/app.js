const API = 'https://api.goodip.cc.cd';
const $ = (s) => document.querySelector(s);
const ROW = 46; // 与 CSS .ip-row height 一致

const state = {
  me: null,
  ips: { cf: [], bestproxy: [], proxy: [] },
  meta: null,
  group: 'cf',
  selected: new Set(), // cf 组=IP；rev 组=IP:port
  speedData: {}, // { key: { ok, ms } }
  rev: { all: [], total: 0, ports: [], countries: [] },
};

async function api(path) {
  const r = await fetch(API + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.json();
}

/* ---------- Toast ---------- */
function toast(msg, type = 'info') {
  let box = $('#toastBox');
  if (!box) { box = document.createElement('div'); box.id = 'toastBox'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2800);
}

/* ---------- 延迟分级 ---------- */
function speedTier(ms) {
  if (ms == null || ms > 5000) return { cls: 'bad', label: '超时' };
  if (ms < 150) return { cls: 'ok', grad: 'var(--speed-fast)', label: ms + ' ms' };
  if (ms < 400) return { cls: 'ok', grad: 'var(--speed-mid)', label: ms + ' ms' };
  return { cls: 'bad', grad: 'var(--speed-slow)', label: ms + ' ms' };
}

/* ---------- 定位 ---------- */
async function loadMe() {
  try {
    const d = await api('/api/me');
    state.me = d;
    const g = d.geo;
    const c = d.carrier || { code: 'AB', label: '境外' };
    $('#meGeo') && ($('#meGeo').textContent = g ? `${g.country || ''} ${g.region || ''} ${g.city || ''}`.trim() || '—' : '—');
    $('#meCarrier') && ($('#meCarrier').textContent = `${c.label}（${c.code}）`);
    $('#meEdge') && ($('#meEdge').textContent = d.edge ? `${d.edge.country} · ${d.edge.colo}` : '—');
    $('#meIp') && ($('#meIp').textContent = d.ip || '—');
    $('#locText').textContent = `${d.ip} · ${c.label}`;
    const dot = $('.dot'); if (dot) dot.style.background = 'var(--ok)';
  } catch (e) {
    $('#locText').textContent = '定位失败';
    toast('定位失败：' + e.message, 'bad');
  }
}

/* ---------- 加载全部分组 ---------- */
async function loadAll() {
  try {
    const [base, rev] = await Promise.all([
      api('/api/ips'),
      api('/api/ips?group=rev&limit=100000'),
    ]);
    if (base.ips) state.ips = base.ips;
    if (base.meta) state.meta = base.meta;
    if (rev.ips) { state.rev.all = rev.ips; state.rev.total = rev.total || rev.ips.length; }
    if (rev.ports) state.rev.ports = rev.ports;
    if (rev.countries) state.rev.countries = rev.countries;
    if (rev.meta) state.meta = rev.meta;
  } catch (e) {
    toast('加载节点数据失败：' + e.message, 'bad');
  }
  updateStats();
  renderTabs();
  renderVirtual();
}

function updateStats() {
  const cf = state.ips.cf?.length || 0;
  const bp = state.ips.bestproxy?.length || 0;
  const px = state.ips.proxy?.length || 0;
  const rv = state.rev.total || 0;
  $('#statNodes').textContent = (cf + bp + px + rv).toLocaleString();
  $('#statPorts').textContent = (state.rev.ports?.length || 0) + 4; // rev 端口 + 官方常用端口
  $('#statCountries').textContent = (state.rev.countries?.length || 0);
  if (state.meta?.updatedAt) {
    const d = new Date(state.meta.updatedAt);
    $('#statUpdated').textContent = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/* ---------- Tabs ---------- */
function renderTabs() {
  const labels = {
    cf: `CF 官方 (${state.ips.cf.length})`,
    bestproxy: `优选反代 (${state.ips.bestproxy.length})`,
    proxy: `反代池 (${state.ips.proxy.length})`,
    rev: `反代全量 (${state.rev.total ? state.rev.total.toLocaleString() : '…'})`,
  };
  $('#ipTabs').innerHTML = Object.keys(labels).map((g) =>
    `<button class="tab ${g === state.group ? 'active' : ''}" data-g="${g}">${labels[g]}</button>`).join('');
  $('#ipTabs').querySelectorAll('.tab').forEach((b) => b.onclick = () => {
    state.group = b.dataset.g;
    $('#ipList').scrollTop = 0;
    renderTabs();
    renderVirtual();
  });
}

/* ---------- 当前过滤后的节点数组 ---------- */
function currentIpsFlat() {
  let arr;
  if (state.group === 'rev') {
    arr = state.rev.all.map((x) => ({ ip: x.ip, country: x.country, port: x.port, key: x.ip + ':' + x.port }));
  } else {
    arr = (state.ips[state.group] || []).map((x) => ({ ip: x.ip, country: x.country, port: 443, key: x.ip }));
  }
  const q = ($('#ipSearch').value || '').trim().toUpperCase();
  if (q) arr = arr.filter((x) => (x.country || '').toUpperCase().includes(q) || x.ip.includes(q));
  return arr;
}

/* ---------- 虚拟滚动渲染 ---------- */
function renderVirtual() {
  const listEl = $('#ipList');
  if (!listEl) return;
  const items = currentIpsFlat();
  const vh = listEl.clientHeight || listEl.offsetHeight || 400;
  const st = listEl.scrollTop;
  const first = Math.max(0, Math.floor(st / ROW) - 8);
  const last = Math.min(items.length, Math.ceil((st + vh) / ROW) + 8);

  let vp = listEl.querySelector('.ip-vp');
  if (!vp) { vp = document.createElement('div'); vp.className = 'ip-vp'; listEl.appendChild(vp); }
  vp.style.height = (items.length * ROW) + 'px';
  vp.innerHTML = '';

  if (items.length === 0) {
    vp.innerHTML = '<div style="padding:24px;color:var(--c-muted);text-align:center">该分组暂无数据，等待 cron 刷新或调整筛选…</div>';
    updateSelCount();
    return;
  }

  const frag = document.createDocumentFragment();
  for (let i = first; i < last; i++) {
    const x = items[i];
    const key = x.key;
    const sp = state.speedData[key];
    const tier = sp ? speedTier(sp.ok ? sp.ms : null) : null;
    const row = document.createElement('div');
    row.className = 'ip-row' + (state.selected.has(key) ? ' sel' : '');
    row.style.top = (i * ROW) + 'px';
    row.dataset.ip = key;
    row.innerHTML = `<input type="checkbox" ${state.selected.has(key) ? 'checked' : ''}><span class="ip">${x.ip}</span>${x.port ? `<span class="cc port">:${x.port}</span>` : ''}${x.country ? `<span class="cc">${x.country}</span>` : ''}<span class="ms ${tier ? tier.cls : ''}">${tier ? tier.label : '—'}</span>`;
    const cb = row.querySelector('input');
    cb.onchange = (e) => toggle(key, e.target.checked);
    row.querySelector('.ip').onclick = () => { cb.checked = !cb.checked; toggle(key, cb.checked); };
    frag.appendChild(row);
  }
  vp.appendChild(frag);
  updateSelCount();
}

function toggle(key, checked) {
  if (checked) state.selected.add(key); else state.selected.delete(key);
  const row = document.querySelector(`.ip-row[data-ip="${CSS.escape(key)}"]`);
  if (row) row.classList.toggle('sel', checked);
  updateSelCount();
}
function updateSelCount() { const el = $('#selCount'); if (el) el.textContent = state.selected.size; }

/* ---------- 批量测速（服务端 /api/speed，测完按延迟排序） ---------- */
function sortKey(key, results) {
  const r = results[key];
  if (!r) return { grp: 3, ms: Infinity };
  if (!r.ok) return { grp: 2, ms: Infinity };
  return { grp: 1, ms: r.ms };
}
function sortIps(arr, results) {
  return [...arr].sort((a, b) => {
    const ka = sortKey(a.key, results), kb = sortKey(b.key, results);
    if (ka.grp !== kb.grp) return ka.grp - kb.grp;
    return ka.ms - kb.ms;
  });
}
async function speedSelected() {
  if (state.selected.size === 0) { toast('请先勾选要测速的节点', 'warn'); return; }
  const hosts = [...state.selected];
  $('#btnSpeed').disabled = true;
  const all = {};
  for (let i = 0; i < hosts.length; i += 40) {
    const batch = hosts.slice(i, i + 40).join(',');
    try {
      const d = await api('/api/speed?hosts=' + encodeURIComponent(batch));
      d.results.forEach((r) => { all[r.host] = r; state.speedData[r.host] = r; });
    } catch {}
  }
  if (state.group === 'rev') {
    state.rev.all = sortIps(state.rev.all.map((x) => ({ ...x, key: x.ip + ':' + x.port })), all).map((x) => ({ ip: x.ip, port: x.port, country: x.country }));
  } else {
    const cur = state.ips[state.group];
    if (cur && cur.length) state.ips[state.group] = sortIps(cur.map((x) => ({ ...x, key: x.ip })), all).map((x) => ({ ip: x.ip, country: x.country }));
  }
  renderVirtual();
  toast('测速完成，已按延迟排序', 'ok');
  $('#btnSpeed').disabled = false;
}

/* ---------- 绑定子域·浏览器实测 ---------- */
async function bindSpeedSelected() {
  if (state.selected.size === 0) { toast('请先勾选要绑定测速的节点', 'warn'); return; }
  const keys = [...state.selected];
  if (!confirm(`将把 ${keys.length} 个 IP 绑定为 *.goodip.cc.cd 子域用于浏览器实测（创建 DNS 记录，灰云直连）。测完点「解绑」。继续？`)) return;
  $('#btnBindSpeed').disabled = true;
  $('#btnUnbind').disabled = false;
  for (const key of keys) {
    const ip = key.split(':')[0];
    state.speedData[key] = { ok: false, ms: 0 };
    renderVirtual();
    const host = ip.replace(/\./g, '-') + '.goodip.cc.cd';
    try { await fetch(API + '/api/dns-bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ip, action: 'bind' }) }); } catch {}
    let ms = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      const s = performance.now();
      try {
        await fetch(`https://${host}/cdn-cgi/trace`, { mode: 'no-cors', cache: 'no-store', redirect: 'manual' });
        ms = Math.round(performance.now() - s); break;
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    state.speedData[key] = { ok: ms != null, ms: ms || 0 };
    renderVirtual();
  }
  $('#btnBindSpeed').disabled = false;
  toast('子域实测完成', 'ok');
}
async function unbindAll() {
  const keys = [...state.selected];
  if (keys.length === 0) { toast('请先勾选要解绑的节点', 'warn'); return; }
  $('#btnUnbind').disabled = true;
  for (const key of keys) {
    const ip = key.split(':')[0];
    try { await fetch(API + '/api/dns-bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ip, action: 'unbind' }) }); } catch {}
    delete state.speedData[key];
  }
  $('#btnUnbind').disabled = false;
  renderVirtual();
  toast(`已解绑 ${keys.length} 个节点的子域 DNS 记录`, 'ok');
}

/* ---------- 订阅生成 ---------- */
async function genSub() {
  if (state.selected.size === 0) { toast('请先勾选要生成订阅的节点', 'warn'); return; }
  const type = $('#subType').value;
  const uuid = $('#subUuid').value.trim();
  const sni = $('#subSni').value.trim() || 'www.visa.cn';
  const port = $('#subPort').value.trim() || '443';
  const useDomain = $('#subUseDomain').checked;
  let url;
  if (useDomain) {
    const hosts = [...state.selected].map((k) => k.split(':')[0].replace(/\./g, '-') + '.goodip.cc.cd').join(',');
    url = `/api/sub?type=${type}&hosts=${encodeURIComponent(hosts)}&sni=${encodeURIComponent(sni)}&port=${port}` + (uuid ? `&uuid=${encodeURIComponent(uuid)}` : '');
  } else {
    const ips = [...state.selected].join(','); // cf=IP；rev=IP:port（订阅模块逐条解析端口）
    url = `/api/sub?type=${type}&ips=${encodeURIComponent(ips)}&sni=${encodeURIComponent(sni)}&port=${port}` + (uuid ? `&uuid=${encodeURIComponent(uuid)}` : '');
  }
  try {
    const r = await fetch(API + url, { cache: 'no-store' });
    const text = await r.text();
    $('#subResult').value = (type === 'vless' || type === 'trojan') ? API + url : text;
    $('#subInfo').textContent = `已生成 ${state.selected.size} 个节点 · ${type}` + (useDomain ? ' · 子域版（证书有效）' : '');
    toast('订阅已生成', 'ok');
  } catch (e) { $('#subInfo').textContent = '生成失败：' + e.message; toast('生成失败：' + e.message, 'bad'); }
}
async function copySub() {
  const v = $('#subResult').value; if (!v) return;
  try { await navigator.clipboard.writeText(v); toast('已复制订阅', 'ok'); $('#subInfo').textContent = '已复制'; } catch {}
}

/* ---------- 分控输出：动态生成专属 API（按地区抽量） ---------- */
async function genApiUrl() {
  const src = $('#apiSrc').value;
  const per = parseInt($('#apiPer').value || '0', 10);
  const url = `${API}/api/iplist?src=${src}` + (per > 0 ? `&perRegion=${per}` : '');
  $('#apiUrl').value = url;
  $('#apiInfo').textContent = '生成中…';
  try {
    const txt = await (await fetch(url, { cache: 'no-store' })).text();
    const lines = txt.trim().split('\n').filter(Boolean);
    $('#apiInfo').textContent = `精选 ${lines.length} 条 · 每地区 ${per > 0 ? per : '全部'}`;
    $('#apiPreview').textContent = lines.slice(0, 20).join('\n') + (lines.length > 20 ? `\n… 共 ${lines.length} 条` : '');
    toast('专属 API 已生成', 'ok');
  } catch (e) {
    $('#apiInfo').textContent = '生成失败：' + e.message;
    $('#apiPreview').textContent = '';
    toast('生成失败：' + e.message, 'bad');
  }
}
async function copyApiUrl() {
  const v = $('#apiUrl').value; if (!v) return;
  try { await navigator.clipboard.writeText(v); toast('已复制 API 链接', 'ok'); } catch {}
}

/* ---------- 强制拉取总控源 ---------- */
async function forceRefresh() {
  $('#btnRefresh').disabled = true;
  $('#btnRefresh').textContent = '🔄 刷新中…';
  try {
    const d = await api('/api/refresh');
    if (d.ok) {
      toast(`已拉取最新总控源：${JSON.stringify(d.counts)}`, 'ok');
      await loadAll();
    } else toast('刷新失败：' + (d.error || '未知'), 'bad');
  } catch (e) { toast('刷新失败：' + e.message, 'bad'); }
  $('#btnRefresh').disabled = false;
  $('#btnRefresh').textContent = '🔄 强制刷新';
}

/* ---------- 域名配优选 IP ---------- */
async function genDns() {
  const domain = $('#dnsDomain').value.trim();
  if (!domain) { toast('请输入你的域名', 'warn'); return; }
  try {
    const d = await api('/api/dns-config?domain=' + encodeURIComponent(domain));
    const ips = (d.recommendedIps || []).map((ip) => `<div class="ip-line">${ip}</div>`).join('');
    const tut = (d.tutorial || []).map((t) => `<li>${t}</li>`).join('');
    $('#dnsResult').innerHTML = `<div class="note">${d.note}</div><div style="margin-top:12px"><b>推荐填入 DNS 的优选 IP（取 CF 官方已优选前 ${d.recommendedIps.length} 个）：</b>${ips}</div><ol>${tut}</ol>`;
    toast('配置已生成', 'ok');
  } catch (e) { $('#dnsResult').innerHTML = '<div class="note">生成失败：' + e.message + '</div>'; toast('生成失败：' + e.message, 'bad'); }
}

/* ---------- 事件 ---------- */
function bindEvents() {
  $('#btnRefresh').onclick = forceRefresh;
  $('#btnSpeed').onclick = speedSelected;
  $('#btnBindSpeed').onclick = bindSpeedSelected;
  $('#btnUnbind').onclick = unbindAll;
  $('#btnSelectAll').onclick = () => { currentIpsFlat().forEach((x) => state.selected.add(x.key)); renderVirtual(); };
  $('#btnClear').onclick = () => { state.selected.clear(); renderVirtual(); };
  $('#ipSearch').oninput = renderVirtual;
  $('#ipList').addEventListener('scroll', () => requestAnimationFrame(renderVirtual));
  $('#btnGenApi').onclick = genApiUrl;
  $('#btnCopyApi').onclick = copyApiUrl;
  $('#btnGenSub').onclick = genSub;
  $('#btnCopySub').onclick = copySub;
  $('#btnDns').onclick = genDns;
}

bindEvents();
loadMe();
loadAll();
