// 跨域部署时把 API 指向 Worker 域名
const API = 'https://api.goodip.cc.cd';

let pool = [];              // 候选池（对象数组：ip/delay/rtt/…）
const selected = new Set(); // 用户勾选的 IP

async function j(url) {
  const r = await fetch(API + url);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function init() {
  // 1. 访客信息（含真实 IP）
  try {
    const me = await j('/api/me');
    const el = document.getElementById('me');
    el.textContent =
      `你的 IP: ${me.ip || '未知'} · 国家: ${me.country || '?'} · 城市: ${me.city || '?'} · 命中节点: ${me.colo || '?'}`;
  } catch (e) {
    document.getElementById('me').textContent = '未识别到访客信息';
  }

  // 2. 加载候选池并自动实测
  try {
    const data = await j('/api/best?country=auto');
    pool = data.ips;
    await runProbe();
  } catch (e) {
    document.getElementById('hint').textContent = '加载失败：' + e.message;
  }

  bindEvents();
}

async function runProbe() {
  const hint = document.getElementById('hint');
  hint.textContent = `正在用你的网络实测 ${pool.length} 个候选 IP…`;
  const results = await Promise.all(pool.map(probeOne));
  results.sort((a, b) => a.rtt - b.rtt);
  pool = results;
  renderList();
  hint.textContent = `实测完成：已按你当前网络的连接延迟排序（${results.length} 个）。勾选节点后可生成订阅。`;
}

function renderList() {
  const rows = pool
    .map(
      (r, i) => `
    <tr>
      <td><input type="checkbox" class="ck" data-ip="${r.ip}" ${selected.has(r.ip) ? 'checked' : ''}></td>
      <td>${i + 1}</td>
      <td class="mono">${r.ip}</td>
      <td>${r.rtt < 3000 ? r.rtt + ' ms' : '超时'}</td>
      <td>${r.delay ? r.delay.toFixed(1) + ' ms' : '—'}</td>
      <td><button class="copy" data-ip="${r.ip}">复制</button></td>
    </tr>`
    )
    .join('');
  document.getElementById('ipList').innerHTML = `
    <table>
      <thead><tr><th></th><th>#</th><th>IP</th><th>实测延迟</th><th>云端延迟</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  bindCopy();
  document.querySelectorAll('.ck').forEach(c => {
    c.onchange = () => {
      if (c.checked) selected.add(c.dataset.ip);
      else selected.delete(c.dataset.ip);
    };
  });
}

// 浏览器实测：fetch https://IP 测 TCP+TLS 建连耗时（CF anycast 证书会失败，但耗时≈RTT）
function probeOne(item) {
  const t0 = performance.now();
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ ...item, rtt: 3000 }), 3000);
    fetch(`https://${item.ip}`, { mode: 'no-cors', cache: 'no-store' })
      .then(() => { clearTimeout(timer); resolve({ ...item, rtt: Math.round(performance.now() - t0) }); })
      .catch(() => { clearTimeout(timer); resolve({ ...item, rtt: Math.round(performance.now() - t0) }); });
  });
}

function bindCopy() {
  document.querySelectorAll('.copy').forEach(b => (b.onclick = () => copy(b.dataset.ip)));
}

function copy(text) {
  if (!text) return toast('没有可复制的内容');
  navigator.clipboard.writeText(text).then(() => toast('已复制'), () => toast('复制失败'));
}

function selectedIps() {
  return pool.filter(r => selected.has(r.ip)).map(r => r.ip);
}

function bindEvents() {
  document.getElementById('selectAll').onclick = () => {
    pool.forEach(r => selected.add(r.ip));
    renderList();
  };
  document.getElementById('clearAll').onclick = () => {
    selected.clear();
    renderList();
  };
  document.getElementById('reprobe').onclick = () => runProbe();
  document.getElementById('copySel').onclick = () => copy(selectedIps().join('\n'));

  document.getElementById('genSub').onclick = async () => {
    const ips = selectedIps();
    if (!ips.length) return toast('请先勾选要用的节点');
    const type = document.getElementById('type').value;
    const p = new URLSearchParams({ type });
    p.set('ips', ips.join(','));
    if (type !== 'list') {
      const uuid = document.getElementById('uuid').value.trim();
      if (!uuid) return toast('请填写 UUID / 密码');
      p.set('uuid', uuid);
      p.set('port', document.getElementById('port').value);
      p.set('sni', document.getElementById('sni').value.trim());
      p.set('network', document.getElementById('network').value);
      p.set('path', document.getElementById('path').value.trim());
    }
    const r = await fetch(API + '/api/sub?' + p.toString());
    const text = await r.text();
    const box = document.getElementById('subResult');
    if (type === 'list') {
      box.innerHTML = `<pre>${text}</pre><button id="copyList">复制</button>`;
      document.getElementById('copyList').onclick = () => copy(text);
    } else {
      const url = API + '/api/sub?' + p.toString();
      box.innerHTML = `<p>订阅地址（导入客户端，共 ${ips.length} 个节点）：</p><pre>${url}</pre><button id="copySub">复制订阅地址</button>`;
      document.getElementById('copySub').onclick = () => copy(url);
    }
  };
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1500);
}

init();
