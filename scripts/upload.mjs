// 上传 bestip_GLOBAL.json 到 Cloudflare KV（通过 REST API）
import fs from 'node:fs';
import path from 'node:path';

const { CF_ACCOUNT_ID, CF_API_TOKEN, KV_NAMESPACE_ID } = process.env;
if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !KV_NAMESPACE_ID) {
  console.error('缺少环境变量: CF_ACCOUNT_ID / CF_API_TOKEN / KV_NAMESPACE_ID');
  process.exit(1);
}

const file = path.join(process.cwd(), 'bestip_GLOBAL.json');
if (!fs.existsSync(file)) {
  console.log('无数据文件，跳过上传');
  process.exit(0);
}
const value = fs.readFileSync(file, 'utf8');

const key = 'bestip:GLOBAL';
const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${CF_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: value,
});

if (res.ok) {
  console.log(`已上传 KV: ${key}`);
} else {
  console.error(`上传失败 (${res.status}): ${await res.text()}`);
  process.exit(1);
}
