const API = 'https://api.goodip.cc.cd';
const $ = (s) => document.querySelector(s);

const state = {
  me: null,
  ips: { cf: [], bestproxy: [], proxy: [] },
  meta: null,
  group: 'cf',
  selected: new Set(), // 统一存 host：cf 组=IP，rev 组=IP:port
  domains: [],
  speedData: {}, // { host: { ok, ms } }
  rev: { data: [], total: 0, ports: [], countries: [], port: '', country: '', limit: 200, offset: 0, loading: false },
};

async function api(path) {
  const r = await fetch(API + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.json();
}

/* ---------- Toast 通知（替代 alert，更成熟） ---------- */
function toast(msg, type = 'info') {
  let box = $('#toastBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastBox';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

/* 延迟分级配色 */
function speedTier(ms) {
  if (ms == null || ms > 5000) return { cls: 'bad', grad: 'var(--grad-speed-slow)', label: '超时' };
  if (ms < 150) return { cls: 'ok', grad: 'var(--grad-speed-fast)', label: ms + ' ms' };
  if (ms < 400) return { cls: 'ok', grad: 'var(--grad-speed-mid)', label: ms + ' ms' };
  return { cls: 'bad', grad: 'var(--grad-speed-slow)', label: ms + ' ms' };
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
    $('.dot').style.background = 'var(--c-ok)';
  } catch (e) {
    $('#locText').textContent = '定位失败';
    toast('定位失败：' + e.message, 'bad');
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
  if (state.domains.length === 0) {
    box.innerHTML = '<p class="hint">暂无优选域名数据，等待 cron 刷新…</p>';
    return;
  }
  box.innerHTML = state.domains.map((n) => `
    <div class="domain-row" data-host="${n.host}">
      <div>
        <div class="name">${n.name}</div>
        <div class="meta">${n.host} ${n.note ? '· ' + n.note : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
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
    const tier = speedTier(ok ? ms : null);
    const pct = ok ? Math.max(8, Math.min(100, 100 - ms / 3)) : 5;
    const bar = row.querySelector('.bar > i');
    bar.style.width = pct + '%';
    bar.style.background = tier.grad;
    const tag = row.querySelector('.tag');
    tag.textContent = tier.label;
    tag.className = 'tag ' + tier.cls;
  }
}

/* ---------- 优选 IP 库 ---------- */
async function loadIps() {
  try {
    if (state.group === 'rev') {
      await loadRevPage();
    } else {
      const d = await api('/api/ips');
      if (d.ips) state.ips = d.ips;
      if (d.meta) state.meta = d.meta;
    }
  } catch (e) {
    toast('加载 IP 库失败：' + e.message, 'bad');
  }
  if (state.meta && state.meta.updatedAt) {
    const d = new Date(state.meta.updatedAt);
    const t = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('#footMeta').textContent = '更新于 ' + t;
  }
  renderRevControls();
  renderIps();
}

async function loadRevPage() {
  state.rev.loading = true;
  renderIps();
  try {
    const p = new URLSearchParams({ group: 'rev', limit: state.rev.limit, offset: state.rev.offset });
    if (state.rev.port) p.set('port', state.rev.port);
    if (state.rev.country) p.set('country', state.rev.country);
    const d = await api('/api/ips?' + p.toString());
    state.rev.data = d.ips || [];
    state.rev.total = d.total || 0;
    if (d.ports) state.rev.ports = d.ports;
    if (d.countries) state.rev.countries = d.countries;
    if (d.meta) state.meta = d.meta;
  } catch (e) {
    toast('加载反代全量失败：' + e.message, 'bad');
  }
  state.rev.loading = false;
  renderRevControls();
  renderIps();
}

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
    $('#revControls').hidden = state.group !== 'rev';
    $('#ipSearch').closest('.search-wrap').classList.toggle('hidden', state.group === 'rev');
    if (state.group === 'rev') {
      state.rev.offset = 0;
      loadRevPage();
    } else {
      renderRevControls();
      renderIps();
    }
    renderTabs();
  });
}

function renderRevControls() {
  const rc = $('#revControls');
  if (!rc) return;
  const portSel = $('#revPort');
  const countrySel = $('#revCountry');
  if (state.rev.ports.length && portSel.options.length <= 1) {
    portSel.innerHTML = '<option value="">全部端口</option>' + state.rev.ports.map((p) => `<option value="${p}">${p}</option>`).join('');
  }
  if (state.rev.countries.length && countrySel.options.length <= 1) {
    countrySel.innerHTML = '<option value="">全部国家</option>' + state.rev.countries.map((c) => `<option value="${c}">${c}</option>`).join('');
  }
  portSel.value = state.rev.port;
  countrySel.value = state.rev.country;
  const total = state.rev.total;
  const start = total === 0 ? 0 : state.rev.offset + 1;
  const end = Math.min(state.rev.offset + state.rev.limit, total);
  $('#revStat').textContent = total ? `第 ${start.toLocaleString()}-${end.toLocaleString()} / 共 ${total.toLocaleString()} 条` : '无数据';
  $('#revPrev').disabled = state.rev.offset <= 0;
  $('#revNext').disabled = state.rev.offset + state.rev.limit >= total;
}

function currentIps() {
  if (state.group === 'rev') {
    const q = ($('#ipSearch').value || '').trim().toUpperCase();
    let arr = state.rev.data.map((x) => ({ ...x, key: x.ip + ':' + x.port }));
    if (q) arr = arr.filter((x) => (x.country || '').toUpperCase().includes(q) || x.ip.includes(q));
    return arr;
  }
  const q = ($('#ipSearch').value || '').trim().toUpperCase();
  let arr = state.ips[state.group] || [];
  if (q) arr = arr.filter((x) => (x.country || '').toUpperCase().includes(q) || x.ip.includes(q));
  return arr.map((x) => ({ ...x, key: x.ip }));
}

function renderIps() {
  if (state.group === 'rev' && state.rev.loading) {
    $('#ipList').innerHTML = Array.from({ length: 8 }).map(() => '<div class="skeleton-row"></div>').join('');
    return;
  }
  const arr = currentIps();
  if (arr.length === 0) {
    $('#ipList').innerHTML = '<p class="hint">该分组暂无数据，等待 cron 刷新或调整筛选…</p>';
    updateSelCount();
    return;
  }
  $('#ipList').innerHTML = arr.map((x) => {
    const sp = state.speedData[x.key];
    const tier = sp ? speedTier(sp.ok ? sp.ms : null) : null;
    const portTag = x.port ? `<span class="cc port">:${x.port}</span>` : '';
    return `
    <div class="ip-row ${state.selected.has(x.key) ? 'sel' : ''}" data-ip="${x.key}">
      <input type="checkbox" ${state.selected.has(x.key) ? 'checked' : ''} />
      <span class="ip">${x.ip}</span>
      ${portTag}
      ${x.country ? `<span class="cc">${x.country}</span>` : ''}
      <span class="ms ${tier ? tier.cls : ''}" data-ms="${x.key}">${tier ? tier.label : '—'}</span>
    </div>`;
  }).join('');
  $('#ipList').querySelectorAll('.ip-row').forEach((row) => {
    const key = row.dataset.ip;
    row.querySelector('input').onchange = (e) => {
      if (e.target.checked) state.selected.add(key); else state.selected.delete(key);
      row.classList.toggle('sel', e.target.checked);
      updateSelCount();
    };
    row.querySelector('.ip').onclick = () => { row.querySelector('input').click(); };
  });
  updateSelCount();
}
function updateSelCount() { $('#selCount').textContent = state.selected.size; }

/* ---------- 批量测速（服务端 /api/speed，测完自动按延迟排序） ---------- */
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
  if (state.selected.size === 0) { toast('请先勾选要测速的 IP', 'warn'); return; }
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
    state.rev.data = sortIps(state.rev.data.map((x) => ({ ...x, key: x.ip + ':' + x.port })), all).map((x) => ({ ip: x.ip, port: x.port, country: x.country }));
  } else {
    const cur = state.ips[state.group];
    if (cur && cur.length) state.ips[state.group] = sortIps(cur, all);
  }
  renderIps();
  toast('测速完成，已按延迟排序', 'ok');
  $('#btnSpeed').disabled = false;
}

/* ---------- 绑定子域·浏览器实测 ---------- */
async function bindSpeedSelected() {
  if (state.selected.size === 0) { toast('请先勾选要绑定测速的 IP', 'warn'); return; }
  const keys = [...state.selected];
  if (!confirm(`将把 ${keys.length} 个 IP 绑定为 *.goodip.cc.cd 子域用于浏览器实测（会创建对应 DNS 记录，灰云直连）。测完记得点「解绑清理」。继续？`)) return;
  $('#btnBindSpeed').disabled = true;
  $('#btnUnbind').disabled = false;
  for (const key of keys) {
    const ip = key.split(':')[0];
    const el = document.querySelector(`.ms[data-ms="${key}"]`);
    const host = ip.replace(/\./g, '-') + '.goodip.cc.cd';
    if (el) { el.textContent = '绑定中…'; el.className = 'ms'; }
    try { await fetch(API + '/api/dns-bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ip, action: 'bind' }) }); } catch {}
    let ms = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      const s = performance.now();
      try {
        await fetch(`https://${host}/cdn-cgi/trace`, { mode: 'no-cors', cache: 'no-store', redirect: 'manual' });
        ms = Math.round(performance.now() - s);
        break;
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    state.speedData[key] = { ok: ms != null, ms: ms || 0 };
    if (el) {
      const tier = speedTier(ms);
      el.textContent = ms != null ? ms + ' ms(子域)' : '超时';
      el.className = 'ms ' + tier.cls;
    }
  }
  $('#btnBindSpeed').disabled = false;
  toast('子域实测完成', 'ok');
}
async function unbindAll() {
  const keys = [...state.selected];
  if (keys.length === 0) { toast('请先勾选要解绑的 IP', 'warn'); return; }
  $('#btnUnbind').disabled = true;
  for (const key of keys) {
    const ip = key.split(':')[0];
    try { await fetch(API + '/api/dns-bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ip, action: 'unbind' }) }); } catch {}
    delete state.speedData[key];
    const el = document.querySelector(`.ms[data-ms="${key}"]`);
    if (el) { el.textContent = '—'; el.className = 'ms'; }
  }
  $('#btnUnbind').disabled = false;
  toast(`已解绑 ${keys.length} 个 IP 的子域 DNS 记录`, 'ok');
}

/* ---------- 订阅生成 ---------- */
async function genSub() {
  if (state.selected.size === 0) { toast('请先勾选要生成订阅的 IP', 'warn'); return; }
  const type = $('#subType').value;
  const uuid = $('#subUuid').value.trim();
  const sni = $('#subSni').value.trim() || 'www.visa.cn';
  const port = $('#subPort').value.trim() || '443';
  const useDomain = $('#subUseDomain').checked;
  let url, label;
  if (useDomain) {
    const hosts = [...state.selected].map((k) => k.split(':')[0].replace(/\./g, '-') + '.goodip.cc.cd').join(',');
    url = `/api/sub?type=${type}&hosts=${encodeURIComponent(hosts)}&sni=${encodeURIComponent(sni)}&port=${port}` + (uuid ? `&uuid=${encodeURIComponent(uuid)}` : '');
    label = `${state.selected.size} 个子域`;
  } else {
    const ips = [...state.selected].join(','); // cf 组=IP；rev 组=IP:port（订阅模块逐条解析端口）
    url = `/api/sub?type=${type}&ips=${encodeURIComponent(ips)}&sni=${encodeURIComponent(sni)}&port=${port}` + (uuid ? `&uuid=${encodeURIComponent(uuid)}` : '');
    label = `${state.selected.size} 个 IP`;
  }
  try {
    const r = await fetch(API + url, { cache: 'no-store' });
    const text = await r.text();
    $('#subResult').value = (type === 'vless' || type === 'trojan') ? API + url : text;
    $('#subInfo').textContent = `已生成 ${label} · ${type}` + (useDomain ? ' · 子域版（证书有效·防超时）' : '');
    toast('订阅已生成', 'ok');
  } catch (e) { $('#subInfo').textContent = '生成失败：' + e.message; toast('生成失败：' + e.message, 'bad'); }
}
async function copySub() {
  const v = $('#subResult').value;
  if (!v) return;
  try { await navigator.clipboard.writeText(v); toast('已复制订阅', 'ok'); $('#subInfo').textContent = '已复制'; } catch {}
}

/* ---------- 优选 IP API（一键生成纯文本地址，供 free-bw8 等） ---------- */
async function genApiUrl() {
  if (state.selected.size === 0) { toast('请先勾选要用的 IP', 'warn'); return; }
  const port = ($('#apiPort').value || '443').trim() || '443';
  let url;
  if (state.group === 'rev') {
    // rev 组选中项已是 IP:port，直接透传
    const hosts = [...state.selected].join(',');
    url = `${API}/api/iplist?ips=${encodeURIComponent(hosts)}`;
  } else {
    const ips = [...state.selected].join(',');
    url = `${API}/api/iplist?ips=${encodeURIComponent(ips)}&port=${port}`;
  }
  $('#apiUrl').value = url;
  $('#apiInfo').textContent = `已生成优选IP API（${state.selected.size} 个 IP）`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const txt = await r.text();
    const lines = txt.trim().split('\n').filter(Boolean);
    $('#apiPreview').textContent = lines.slice(0, 15).join('\n') + (lines.length > 15 ? `\n… 共 ${lines.length} 个` : '');
    toast('API URL 已生成', 'ok');
  } catch { $('#apiPreview').textContent = ''; }
}
async function copyApiUrl() {
  const v = $('#apiUrl').value;
  if (!v) return;
  try { await navigator.clipboard.writeText(v); toast('已复制 API URL', 'ok'); } catch {}
}

/* ---------- 域名配优选 IP ---------- */
async function genDns() {
  const domain = $('#dnsDomain').value.trim();
  if (!domain) { toast('请输入你的域名', 'warn'); return; }
  try {
    const d = await api('/api/dns-config?domain=' + encodeURIComponent(domain));
    const ips = (d.recommendedIps || []).map((ip) => `<div class="ip-line">${ip}</div>`).join('');
    const tut = (d.tutorial || []).map((t) => `<li>${t}</li>`).join('');
    $('#dnsResult').innerHTML = `
      <div class="note">${d.note}</div>
      <div style="margin-top:12px"><b>推荐填入 DNS 的优选 IP（取 CF 官方已优选前 ${d.recommendedIps.length} 个）：</b>${ips}</div>
      <ol>${tut}</ol>`;
    toast('配置已生成', 'ok');
  } catch (e) { $('#dnsResult').innerHTML = '<div class="note">生成失败：' + e.message + '</div>'; toast('生成失败：' + e.message, 'bad'); }
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  $('#btnProbeDomains').onclick = probeDomains;
  $('#btnSpeed').onclick = speedSelected;
  $('#btnBindSpeed').onclick = bindSpeedSelected;
  $('#btnUnbind').onclick = unbindAll;
  $('#btnSelectAll').onclick = () => { currentIps().forEach((x) => state.selected.add(x.key)); renderIps(); };
  $('#btnClear').onclick = () => { state.selected.clear(); renderIps(); };
  $('#ipSearch').oninput = renderIps;
  $('#btnGenSub').onclick = genSub;
  $('#btnCopySub').onclick = copySub;
  $('#btnGenApi').onclick = genApiUrl;
  $('#btnCopyApi').onclick = copyApiUrl;
  $('#btnDns').onclick = genDns;
  $('#revPort').onchange = () => { state.rev.port = $('#revPort').value; state.rev.offset = 0; loadRevPage(); };
  $('#revCountry').onchange = () => { state.rev.country = $('#revCountry').value; state.rev.offset = 0; loadRevPage(); };
  $('#revPrev').onclick = () => { if (state.rev.offset >= state.rev.limit) { state.rev.offset -= state.rev.limit; loadRevPage(); } };
  $('#revNext').onclick = () => { if (state.rev.offset + state.rev.limit < state.rev.total) { state.rev.offset += state.rev.limit; loadRevPage(); } };
}

/* ---------- 启动 ---------- */
bindEvents();
loadMe();
loadDomains();
loadIps();
