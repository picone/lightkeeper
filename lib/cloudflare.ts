import "server-only";
import { cloudflareConfig } from "./env";
import type { Range } from "./http";

const API = "https://api.cloudflare.com/client/v4";

type Envelope<T> = { success: boolean; errors: { code: number; message: string }[]; result: T };

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = cloudflareConfig();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const body = (await res.json()) as Envelope<T>;
  if (!res.ok || !body.success) {
    const reason = body.errors?.map((e) => `${e.code} ${e.message}`).join("; ") || res.statusText;
    throw new Error(`Cloudflare ${res.status}: ${reason}`);
  }
  return body.result;
}

type DnsRecord = { id: string; name: string; type: string; content: string; proxied: boolean; ttl: number };

async function findARecords(name: string): Promise<DnsRecord[]> {
  const { zoneId } = cloudflareConfig();
  const query = new URLSearchParams({ type: "A", name });
  return cf<DnsRecord[]>(`/zones/${encodeURIComponent(zoneId)}/dns_records?${query}`);
}

export async function getARecords() {
  const { recordNames } = cloudflareConfig();
  const lists = await Promise.all(recordNames.map(findARecords));
  return recordNames.map((name, i) => ({
    name,
    records: lists[i].map((r) => ({ content: r.content, proxied: r.proxied, ttl: r.ttl })),
  }));
}

/** Points every A record with this name at `address`, keeping ttl/proxied as they are. */
export async function updateARecord(name: string, address: string): Promise<number> {
  const { zoneId } = cloudflareConfig();
  const records = await findARecords(name);
  if (records.length === 0) throw new Error(`找不到 A 记录 ${name}`);
  for (const r of records) {
    await cf(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ content: address }),
    });
  }
  return records.length;
}

type HttpRow = {
  count: number;
  sum: { edgeResponseBytes: number };
  dimensions: { datetimeHour: string; clientRequestHTTPHost: string };
};

type DnsRow = {
  count: number;
  dimensions: { datetimeHour: string; queryName: string };
};

export type TrafficPoint = { t: number; requests: number; bytes: number };
export type DnsPoint = { t: number; queries: number };

// Adaptive datasets cap a single query at one day on lower plans, so the range
// is split into day-sized aliases inside one GraphQL request: h<i> for HTTP
// traffic, q<i> for DNS queries.
function buildQuery(chunks: number): string {
  const vars = ["$zone: string!", "$httpHosts: [string!]", "$dnsNames: [string!]"];
  const fields: string[] = [];
  for (let i = 0; i < chunks; i++) {
    vars.push(`$s${i}: Time!`, `$e${i}: Time!`);
    fields.push(`h${i}: httpRequestsAdaptiveGroups(
      limit: 10000
      orderBy: [datetimeHour_ASC]
      filter: { datetime_geq: $s${i}, datetime_lt: $e${i}, clientRequestHTTPHost_in: $httpHosts }
    ) { count sum { edgeResponseBytes } dimensions { datetimeHour clientRequestHTTPHost } }`);
    fields.push(`q${i}: dnsAnalyticsAdaptiveGroups(
      limit: 10000
      orderBy: [datetimeHour_ASC]
      filter: { datetime_geq: $s${i}, datetime_lt: $e${i}, queryName_in: $dnsNames }
    ) { count dimensions { datetimeHour queryName } }`);
  }
  return `query (${vars.join(", ")}) { viewer { zones(filter: { zoneTag: $zone }) { ${fields.join("\n")} } } }`;
}

function hourlyBuckets<T>(names: string[], start: number, end: number, empty: (t: number) => T) {
  const out = new Map<string, Map<number, T>>();
  for (const name of names) {
    const bucket = new Map<number, T>();
    for (let t = start; t < end; t += 3600_000) bucket.set(t, empty(t));
    out.set(name, bucket);
  }
  return out;
}

export async function getTraffic(days: Range) {
  const { token, zoneId, recordNames, trafficHosts } = cloudflareConfig();
  const hourMs = 3600_000;
  const end = Math.floor(Date.now() / hourMs) * hourMs + hourMs; // include the current hour
  const start = end - days * 24 * hourMs;

  const variables: Record<string, unknown> = { zone: zoneId, httpHosts: trafficHosts, dnsNames: recordNames };
  for (let i = 0; i < days; i++) {
    variables[`s${i}`] = new Date(start + i * 24 * hourMs).toISOString();
    variables[`e${i}`] = new Date(start + (i + 1) * 24 * hourMs).toISOString();
  }

  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildQuery(days), variables }),
    cache: "no-store",
  });
  const body = (await res.json()) as {
    data?: { viewer: { zones: Record<string, (HttpRow | DnsRow)[]>[] } };
    errors?: { message: string }[] | null;
  };
  if (!res.ok || body.errors?.length) {
    throw new Error(`Cloudflare GraphQL: ${body.errors?.map((e) => e.message).join("; ") || res.statusText}`);
  }
  const zone = body.data?.viewer.zones[0];
  if (!zone) throw new Error("Cloudflare GraphQL: 找不到 zone，检查 CF_ZONE_ID 和 token 权限");

  // Zero-filled hourly buckets so charts line up.
  const http = hourlyBuckets<TrafficPoint>(trafficHosts, start, end, (t) => ({ t, requests: 0, bytes: 0 }));
  const dns = hourlyBuckets<DnsPoint>(recordNames, start, end, (t) => ({ t, queries: 0 }));
  for (const [alias, rows] of Object.entries(zone)) {
    for (const row of rows) {
      const t = Date.parse(row.dimensions.datetimeHour);
      if (alias.startsWith("h")) {
        const r = row as HttpRow;
        const point = http.get(r.dimensions.clientRequestHTTPHost.toLowerCase())?.get(t);
        if (!point) continue;
        point.requests += r.count;
        point.bytes += r.sum.edgeResponseBytes;
      } else {
        const r = row as DnsRow;
        const point = dns.get(r.dimensions.queryName.toLowerCase().replace(/\.$/, ""))?.get(t);
        if (point) point.queries += r.count;
      }
    }
  }

  return {
    http: trafficHosts.map((host) => {
      const series = [...http.get(host)!.values()];
      return {
        host,
        requests: series.reduce((n, p) => n + p.requests, 0),
        bytes: series.reduce((n, p) => n + p.bytes, 0),
        series,
      };
    }),
    dns: recordNames.map((name) => {
      const series = [...dns.get(name)!.values()];
      return { name, queries: series.reduce((n, p) => n + p.queries, 0), series };
    }),
  };
}
