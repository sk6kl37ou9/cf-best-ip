const API = 'https://api.goodip.cc.cd';
const $ = (s) => document.querySelector(s);

const state = {
  me: null,
  ips: { cf: [], bestproxy: [], proxy: [] },
  group: 'cf',
  selected: new Set(),
  domains: [],
  speedData: {}, // { ip: { ok, ms } } 测速结果缓存
};

async function api(path) {
  const r = await fetch(API + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.json();
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
    const d = await api('/api/ips');
    if (d.ips) state.ips = d.ips;
  } catch {}
  renderTabs();
  renderIps();
}
function renderTabs() {
  const labels = { cf: `CF 官方 (${state.ips.cf.length})`, bestproxy: `优选反代 (${state.ips.bestproxy.length})`, proxy: `反代池 (${state.ips.proxy.length})` };
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
  $('#ipList').innerHTML = arr.map((x, i) => {
    const sp = state.speedData[x.ip];
    const tier = sp ? speedTier(sp.ok ? sp.ms : null) : null;
    return `
    <div class="ip-row ${state.selected.has(x.ip) ? 'sel' : ''}" data-ip="${x.ip}">
      <input type="checkbox" ${state.selected.has(x.ip) ? 'checked' : ''} />
      <span class="ip">${x.ip}</span>
      ${x.country ? `<span class="cc">${x.country}</span>` : ''}
      <span class="ms ${tier ? tier.cls : ''}" data-ms="${x.ip}">${tier ? tier.label : '—'}</span>
    </div>`;
  }).join('');
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

/* ---------- 批量测速（服务端 /api/speed，测完自动按延迟排序） ---------- */
function sortKey(ip, results) {
  const r = results[ip];
  if (!r) return { grp: 3, ms: Infinity }; // 未测速
  if (!r.ok) return { grp: 2, ms: Infinity }; // 超时
  return { grp: 1, ms: r.ms }; // 正常，按延迟
}
function sortIps(arr, results) {
  return [...arr].sort((a, b) => {
    const ka = sortKey(a.ip, results), kb = sortKey(b.ip, results);
    if (ka.grp !== kb.grp) return ka.grp - kb.grp;
    return ka.ms - kb.ms;
  });
}
async function speedSelected() {
  if (state.selected.size === 0) { alert('请先勾选要测速的 IP'); return; }
  const ips = [...state.selected];
  $('#btnSpeed').disabled = true;
  const all = {};
  for (let i = 0; i < ips.length; i += 40) {
    const batch = ips.slice(i, i + 40).join(',');
    try {
      const d = await api('/api/speed?hosts=' + encodeURIComponent(batch));
      d.results.forEach((r) => { all[r.host] = r; state.speedData[r.host] = r; });
    } catch {}
  }
  // 按延迟自动排序（测过的按 ms 升序，超时次之，未测最后）再重渲染
  const cur = state.ips[state.group];
  if (cur && cur.length) {
    state.ips[state.group] = sortIps(cur, all);
    renderIps();
  }
  $('#btnSpeed').disabled = false;
}

/* ---------- 绑定子域·浏览器实测（用 DNS token 自动建子域，证书有效不超时） ---------- */
async function bindSpeedSelected() {
  if (state.selected.size === 0) { alert('请先勾选要绑定测速的 IP'); return; }
  const ips = [...state.selected];
  if (!confirm(`将把 ${ips.length} 个 IP 绑定为 *.goodip.cc.cd 子域用于浏览器实测（会创建对应 DNS 记录，灰云直连）。测完记得点「解绑清理」。继续？`)) return;
  $('#btnBindSpeed').disabled = true;
  $('#btnUnbind').disabled = false;
  for (const ip of ips) {
    const el = document.querySelector(`.ms[data-ms="${ip}"]`);
    const host = ip.replace(/\./g, '-') + '.goodip.cc.cd';
    if (el) { el.textContent = '绑定中…'; el.className = 'ms'; }
    // 1) 建子域
    try { await fetch(API + '/api/dns-bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ip, action: 'bind' }) }); } catch {}
    // 2) 浏览器轮询实测（等 DNS 生效，最多 12s）
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
    state.speedData[ip] = { ok: ms != null, ms: ms || 0 };
    if (el) {
      const tier = speedTier(ms);
      el.textContent = ms != null ? ms + ' ms(子域)' : '超时';
      el.className = 'ms ' + tier.cls;
    }
  }
  $('#btnBindSpeed').disabled = false;
}
async function unbindAll() {
  const ips = [...state.selected];
  if (ips.length === 0) { alert('请先勾选要解绑的 IP'); return; }
  $('#btnUnbind').disabled = true;
  for (const ip of ips) {
    try { await fetch(API + '/api/dns-bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ip, action: 'unbind' }) }); } catch {}
    delete state.speedData[ip];
    const el = document.querySelector(`.ms[data-ms="${ip}"]`);
    if (el) { el.textContent = '—'; el.className = 'ms'; }
  }
  $('#btnUnbind').disabled = false;
  alert(`已解绑 ${ips.length} 个 IP 的子域 DNS 记录`);
}

/* ---------- 订阅生成 ---------- */
async function genSub() {
  if (state.selected.size === 0) { alert('请先勾选要生成订阅的 IP'); return; }
  const type = $('#subType').value;
  const uuid = $('#subUuid').value.trim();
  const sni = $('#subSni').value.trim() || 'www.visa.cn';
  const port = $('#subPort').value.trim() || '443';
  const useDomain = $('#subUseDomain').checked;
  let url, label;
  if (useDomain) {
    const hosts = [...state.selected].map((ip) => ip.replace(/\./g, '-') + '.goodip.cc.cd').join(',');
    url = `/api/sub?type=${type}&hosts=${encodeURIComponent(hosts)}&sni=${encodeURIComponent(sni)}&port=${port}` + (uuid ? `&uuid=${encodeURIComponent(uuid)}` : '');
    label = `${state.selected.size} 个子域`;
  } else {
    const ips = [...state.selected].join(',');
    url = `/api/sub?type=${type}&ips=${encodeURIComponent(ips)}&sni=${encodeURIComponent(sni)}&port=${port}` + (uuid ? `&uuid=${encodeURIComponent(uuid)}` : '');
    label = `${state.selected.size} 个 IP`;
  }
  try {
    const r = await fetch(API + url, { cache: 'no-store' });
    const text = await r.text();
    $('#subResult').value = (type === 'vless' || type === 'trojan') ? API + url : text;
    $('#subInfo').textContent = `已生成 ${label} · ${type}` + (useDomain ? ' · 子域版（证书有效·防超时）' : '');
  } catch (e) { $('#subInfo').textContent = '生成失败：' + e.message; }
}
async function copySub() {
  const v = $('#subResult').value;
  if (!v) return;
  try { await navigator.clipboard.writeText(v); $('#subInfo').textContent = '已复制'; } catch {}
}

/* ---------- 优选 IP API（一键生成纯文本地址，供 free-bw8 等） ---------- */
async function genApiUrl() {
  if (state.selected.size === 0) { alert('请先勾选要用的 IP'); return; }
  const port = ($('#apiPort').value || '443').trim() || '443';
  const ips = [...state.selected].join(',');
  const url = `${API}/api/iplist?ips=${encodeURIComponent(ips)}&port=${port}`;
  $('#apiUrl').value = url;
  $('#apiInfo').textContent = `已生成优选IP API（${state.selected.size} 个 IP）`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const txt = await r.text();
    const lines = txt.trim().split('\n').filter(Boolean);
    $('#apiPreview').textContent = lines.slice(0, 15).join('\n') + (lines.length > 15 ? `\n… 共 ${lines.length} 个` : '');
  } catch { $('#apiPreview').textContent = ''; }
}
async function copyApiUrl() {
  const v = $('#apiUrl').value;
  if (!v) return;
  try { await navigator.clipboard.writeText(v); $('#apiInfo').textContent = '已复制 API URL'; } catch {}
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
      <div style="margin-top:12px"><b>推荐填入 DNS 的优选 IP（取 CF 官方已优选前 ${d.recommendedIps.length} 个）：</b>${ips}</div>
      <ol>${tut}</ol>`;
  } catch (e) { $('#dnsResult').innerHTML = '<div class="note">生成失败：' + e.message + '</div>'; }
}

/* ---------- 事件绑定 ---------- */
$('#btnProbeDomains').onclick = probeDomains;
$('#btnSpeed').onclick = speedSelected;
$('#btnBindSpeed').onclick = bindSpeedSelected;
$('#btnUnbind').onclick = unbindAll;
$('#btnSelectAll').onclick = () => { currentIps().forEach((x) => state.selected.add(x.ip)); renderIps(); };
$('#btnClear').onclick = () => { state.selected.clear(); renderIps(); };
$('#ipSearch').oninput = renderIps;
$('#btnGenSub').onclick = genSub;
$('#btnCopySub').onclick = copySub;
$('#btnGenApi').onclick = genApiUrl;
$('#btnCopyApi').onclick = copyApiUrl;
$('#btnDns').onclick = genDns;

/* ---------- 启动 ---------- */
loadMe();
loadDomains();
loadIps();
