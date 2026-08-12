// 跨域部署时，把 API 指向 Worker 域名（例如 https://cf-best-ip.xxx.workers.dev）；
// 同域部署（Pages 前挂 Worker 或自定义域名路由）时保持为空字符串
const API = 'https://cf-best-ip.gpcqm17284.workers.dev';

let selected = new Set();

async function j(url) {
  const r = await fetch(API + url);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function init() {
  // 访客信息 + 自动高亮所在国家（含就近回退）
  try {
    const me = await j('/api/me');
    const el = document.getElementById('me');
    el.textContent =
      `你的国家: ${me.country || '?'} · 城市: ${me.city || '?'} · 命中节点: ${me.colo || '?'} · ASN: ${me.asn || '?'}`;
    try {
      const best = await j('/api/best?country=auto');
      selected.add(best.country);
    } catch (e) {}
  } catch (e) {
    document.getElementById('me').textContent =
      '无法识别（需部署到 Cloudflare 后才能拿到访客地理信息）';
  }

  try {
    const { countries } = await j('/api/countries');
    renderCountries(countries);
  } catch (e) {
    document.getElementById('countries').textContent = '加载失败：' + e.message;
  }

  bindEvents();
}

function renderCountries(countries) {
  const grid = document.getElementById('countries');
  grid.innerHTML = '';
  const sorted = [...countries].sort();
  for (const c of sorted) {
    const el = document.createElement('div');
    el.className = 'card' + (selected.has(c) ? ' on' : '');
    el.dataset.country = c;
    el.textContent = c;
    el.onclick = () => {
      if (selected.has(c)) selected.delete(c);
      else selected.add(c);
      el.classList.toggle('on');
      loadDetail(c);
    };
    grid.appendChild(el);
  }
  if (selected.size) loadDetail([...selected][0]);
}

async function loadDetail(country) {
  const box = document.getElementById('ipList');
  box.innerHTML = '<p class="hint">加载中…</p>';
  try {
    const data = await j('/api/best?country=' + country);
    const rows = data.ips
      .map(
        (ip, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="mono">${ip.ip}</td>
        <td>${ip.delay.toFixed(1)} ms</td>
        <td>${(ip.loss * 100).toFixed(1)}%</td>
        <td>${ip.speed.toFixed(1)} MB/s</td>
        <td><button class="copy" data-ip="${ip.ip}">复制</button></td>
      </tr>`
      )
      .join('');
    box.innerHTML = `
      <div class="detail-head">
        <strong>${data.countryName || data.country}</strong>
        <span>更新于 ${data.updatedAt} · ${data.ips.length} 条</span>
        <button id="copyAll">复制全部 IP</button>
        <button id="probe">检测连通性</button>
      </div>
      <table>
        <thead><tr><th>#</th><th>IP</th><th>延迟</th><th>丢包</th><th>速度</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    bindCopy();
    document.getElementById('copyAll').onclick = () => copy(data.ips.map(i => i.ip).join('\n'));
    document.getElementById('probe').onclick = () => probe(data.ips);
  } catch (e) {
    box.innerHTML = '<p class="hint">无数据：' + e.message + '</p>';
  }
}

function bindCopy() {
  document.querySelectorAll('.copy').forEach(b => (b.onclick = () => copy(b.dataset.ip)));
}

function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast('已复制'));
}

function bindEvents() {
  document.getElementById('selectAll').onclick = () => {
    document.querySelectorAll('.card').forEach(el => {
      selected.add(el.dataset.country);
      el.classList.add('on');
    });
  };
  document.getElementById('clearAll').onclick = () => {
    selected.clear();
    document.querySelectorAll('.card').forEach(el => el.classList.remove('on'));
  };

  document.getElementById('genSub').onclick = async () => {
    const countries = [...selected].join(',');
    if (!countries) return toast('请先勾选国家');
    const p = new URLSearchParams({ countries });
    const type = document.getElementById('type').value;
    p.set('type', type);
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
      const url = (API || location.origin) + '/api/sub?' + p.toString();
      box.innerHTML = `<p>订阅地址（导入客户端）：</p><pre>${url}</pre><button id="copySub">复制订阅地址</button>`;
      document.getElementById('copySub').onclick = () => copy(url);
    }
  };
}

async function probe(ips) {
  toast('开始探测（约需几秒）…');
  const results = await Promise.all(ips.map(probeOne));
  results.sort((a, b) => a.rtt - b.rtt);
  const box = document.getElementById('ipList');
  box.querySelector('tbody').innerHTML = results
    .map(
      (ip, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="mono">${ip.ip}</td>
      <td>${ip.rtt} ms</td>
      <td>${ip.ok ? '有响应' : '超时'}</td>
      <td></td><td></td>
    </tr>`
    )
    .join('');
  bindCopy();
}

function probeOne(ip) {
  const t0 = performance.now();
  return Promise.race([
    fetch(`https://${ip}`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
  ]).then(
    () => ({ ip: ip.ip, rtt: Math.round(performance.now() - t0), ok: true }),
    () => ({ ip: ip.ip, rtt: 3000, ok: false })
  );
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1500);
}

init();
