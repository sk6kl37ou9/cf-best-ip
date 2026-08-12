// 跨域部署时把 API 指向 Worker 域名
const API = 'https://cf-best-ip.gpcqm17284.workers.dev';

let pool = []; // 候选池（对象数组：ip/delay/speed/rtt/ok）

async function j(url) {
  const r = await fetch(API + url);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function init() {
  // 1. 访客信息
  try {
    const me = await j('/api/me');
    document.getElementById('me').textContent =
      `你的国家: ${me.country || '?'} · 城市: ${me.city || '?'} · 命中节点: ${me.colo || '?'} · ASN: ${me.asn || '?'}`;
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
  renderList(results);
  hint.textContent = `实测完成：已按你当前网络的延迟排序（${results.length} 个）。点击「重新实测」可复测。`;
}

function renderList(results) {
  const rows = results
    .map(
      (r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="mono">${r.ip}</td>
      <td>${r.rtt} ms</td>
      <td>${r.ok ? '有响应' : '超时'}</td>
      <td>${r.delay ? r.delay.toFixed(1) + ' ms' : '—'}</td>
      <td>${r.speed ? r.speed.toFixed(1) + ' MB/s' : '—'}</td>
      <td><button class="copy" data-ip="${r.ip}">复制</button></td>
    </tr>`
    )
    .join('');
  document.getElementById('ipList').innerHTML = `
    <table>
      <thead><tr><th>#</th><th>IP</th><th>实测延迟</th><th>状态</th><th>云端延迟</th><th>云端速度</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  bindCopy();
}

function probeOne(item) {
  const t0 = performance.now();
  return Promise.race([
    fetch(`https://${item.ip}`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
  ]).then(
    () => ({ ...item, rtt: Math.round(performance.now() - t0), ok: true }),
    () => ({ ...item, rtt: 3000, ok: false })
  );
}

function bindCopy() {
  document.querySelectorAll('.copy').forEach(b => (b.onclick = () => copy(b.dataset.ip)));
}

function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast('已复制'));
}

function bindEvents() {
  document.getElementById('reprobe').onclick = () => runProbe();
  document.getElementById('copyAll').onclick = () => copy(pool.map(r => r.ip).join('\n'));

  document.getElementById('genSub').onclick = async () => {
    if (!pool.length) return toast('还没有可用的 IP');
    const type = document.getElementById('type').value;
    const p = new URLSearchParams({ type });
    p.set('ips', pool.slice(0, 10).map(r => r.ip).join(','));
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
      box.innerHTML = `<p>订阅地址（导入客户端）：</p><pre>${url}</pre><button id="copySub">复制订阅地址</button>`;
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
