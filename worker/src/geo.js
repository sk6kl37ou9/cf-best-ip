// 真实地理定位：基于访客真实 IP（CF-Connecting-IP）查 api.ip.sb，KV 缓存 24h。
// 比 request.cf.country 准：国内用户直连时 request.cf 返回的是 CF 边缘节点（如 HK），而非真实省份。
// 选 ip.sb 原因：ipwho.is / ipinfo.io 在 Cloudflare Worker 出口被限流(429)，ip.sb 稳定返回 200 且字段全。

const GEO_TTL = 60 * 60 * 24; // 24h
const UA = { 'user-agent': 'cf-best-ip/1.0' };

export async function getGeo(ip, env) {
  if (!ip) return null;
  const cacheKey = `geo:${ip}`;
  try {
    const cached = await env.BESTIP.get(cacheKey, 'json');
    if (cached) return cached;
  } catch {}

  let geo = null;
  // 主源：api.ip.sb（免费、无需 key、含 country/region/city/isp/org/asn）
  try {
    const r = await fetch(`https://api.ip.sb/geoip/${ip}`, { headers: UA });
    const d = await r.json();
    if (d && d.ip) {
      geo = {
        ip,
        country: d.country,
        countryCode: d.country_code,
        region: d.region,
        city: d.city,
        isp: d.isp || d.organization || '',
        org: d.organization || '',
        asn: String(d.asn || ''),
        asnOrg: d.asn_organization || '',
        lat: d.latitude,
        lon: d.longitude,
        source: 'ip.sb',
      };
    }
  } catch {}

  // 备源：ipwho.is（被限流时兜底）
  if (!geo) {
    try {
      const r = await fetch(`https://ipwho.is/${ip}`, { headers: UA });
      const d = await r.json();
      if (d && d.success) {
        geo = {
          ip,
          country: d.country,
          countryCode: d.country_code,
          region: d.region,
          city: d.city,
          isp: d.connection?.isp || d.connection?.org || '',
          org: d.connection?.org || '',
          asn: String(d.connection?.asn || ''),
          source: 'ipwho.is',
        };
      }
    } catch {}
  }

  if (geo) {
    try {
      await env.BESTIP.put(cacheKey, JSON.stringify(geo), { expirationTtl: GEO_TTL });
    } catch {}
  }
  return geo;
}

// 运营商识别：从 ISP/Org/ASN 字符串推断访客出口运营商（吸收 GetCFipToDns 的 CM/CU/CT 分组思路）
export function carrierOf(geo) {
  if (!geo) return { code: 'AB', label: '境外' };
  const s = `${geo.isp || ''} ${geo.org || ''} ${geo.asnOrg || ''}`.toLowerCase();
  const cn = geo.countryCode === 'CN';
  if (/移动|mobile|cmcc/.test(s)) return { code: 'CM', label: '中国移动' };
  if (/联通|unicom/.test(s)) return { code: 'CU', label: '中国联通' };
  if (/电信|telecom|chinatelecom/.test(s)) return { code: 'CT', label: '中国电信' };
  if (/腾讯|阿里|华为|网宿|百度|腾讯云|阿里云/.test(s)) return { code: 'CN-IDC', label: '国内 IDC' };
  if (cn) return { code: 'CN', label: '中国' };
  return { code: 'AB', label: '境外' };
}
