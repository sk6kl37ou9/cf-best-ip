// 国家就近回退表：访客国家无本地数据时，按顺序回退到邻近地区
// 中国没有本地 CF 节点，回退到港台日韩新等周边
const FALLBACK = {
  CN: ['HK', 'TW', 'JP', 'SG', 'KR', 'US'],
  HK: ['TW', 'JP', 'SG', 'KR'],
  TW: ['HK', 'JP', 'SG', 'KR'],
  MO: ['HK', 'TW', 'JP', 'SG'],
  JP: ['KR', 'TW', 'HK', 'SG'],
  KR: ['JP', 'TW', 'HK', 'SG'],
  SG: ['MY', 'TH', 'HK', 'JP'],
  MY: ['SG', 'TH', 'VN', 'HK'],
  TH: ['SG', 'MY', 'VN', 'HK'],
  VN: ['SG', 'TH', 'HK', 'JP'],
  PH: ['HK', 'SG', 'TW', 'JP'],
  ID: ['SG', 'MY', 'AU', 'HK'],
  IN: ['SG', 'AE', 'HK', 'JP'],
  AE: ['IN', 'TR', 'DE', 'GB'],
  US: ['CA', 'MX', 'GB', 'DE'],
  CA: ['US', 'GB', 'DE'],
  MX: ['US', 'BR', 'ES'],
  GB: ['DE', 'NL', 'FR', 'US'],
  DE: ['NL', 'FR', 'GB', 'IT'],
  FR: ['DE', 'NL', 'GB', 'ES'],
  NL: ['DE', 'FR', 'GB'],
  IT: ['DE', 'FR', 'ES'],
  ES: ['FR', 'IT', 'DE'],
  BR: ['AR', 'US', 'CL'],
  AR: ['BR', 'CL', 'US'],
  CL: ['BR', 'AR', 'US'],
  AU: ['NZ', 'SG', 'JP', 'US'],
  NZ: ['AU', 'SG', 'JP', 'US'],
  ZA: ['AE', 'GB', 'DE'],
  TR: ['DE', 'GB', 'AE'],
  DEFAULT: ['US', 'HK', 'SG', 'JP', 'DE', 'GB'],
};

export async function getBest(country, env) {
  // 优先查访客国家的数据，缺失时按就近回退链，最终兜底到全局候选池 GLOBAL
  const chain = [country, ...(FALLBACK[country] || []), ...FALLBACK.DEFAULT, 'GLOBAL'];
  const seen = new Set();
  for (const c of chain) {
    if (seen.has(c)) continue;
    seen.add(c);
    const data = await env.BESTIP.get(`bestip:${c}`, 'json');
    if (data) return data;
  }
  return null;
}
