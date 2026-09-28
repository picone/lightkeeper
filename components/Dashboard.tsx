"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TimeChart from "./TimeChart";
import { formatBytes, formatNumber, formatTime } from "./format";

type Range = 1 | 3 | 7;
type Point = { t: number; v: number };
type StaticIp = { name: string; ipAddress: string | null; isAttached: boolean; attachedTo: string | null };

type Status = {
  region: string;
  instance: {
    name: string;
    state: string;
    publicIp: string | null;
    ipv6: string[];
    isStaticIp: boolean;
    blueprint: string | null;
    bundleId: string | null;
    cpuCount: number | null;
    ramGb: number | null;
    zone: string | null;
  };
  attachedStaticIp: StaticIp | null;
  unattachedStaticIps: StaticIp[];
  metrics: { period: number; series: Record<string, Point[]> };
};

type Traffic = {
  traffic: {
    http: { host: string; requests: number; bytes: number; series: { t: number; requests: number; bytes: number }[] }[];
    dns: { name: string; queries: number; series: { t: number; queries: number }[] }[];
  };
  records: { name: string; records: { content: string; proxied: boolean }[] }[];
  recordsError: string | null;
};

type Operation = {
  id: string;
  createdAt: string | null;
  type: string;
  resourceType: string;
  resourceName: string;
  status: string;
  errorCode: string | null;
  errorDetails: string | null;
};

type Step = { label: string; status: "ok" | "failed" | "skipped"; detail?: string };
type RotateResult = { ok: boolean; steps: Step[]; oldIp: string | null; newIp: string | null; alert: string | null };

type Loadable<T> = { data: T | null; error: string | null; loading: boolean };
const initial = { data: null, error: null, loading: true };

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T & { error?: string } }> {
  const res = await fetch(path, { cache: "no-store", ...init });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("未登录");
  }
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  return { ok: res.ok, status: res.status, body };
}

function useLoad<T>(path: string | null): [Loadable<T>, () => void] {
  const [state, setState] = useState<Loadable<T>>(initial);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path)
      .then(({ ok, body }) => {
        if (cancelled) return;
        setState(ok ? { data: body, error: null, loading: false } : { data: null, error: body.error ?? "加载失败", loading: false });
      })
      .catch((err) => !cancelled && setState({ data: null, error: String(err.message ?? err), loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);
  return [state, useCallback(() => setTick((n) => n + 1), [])];
}

const STATE_TONE: Record<string, string> = { running: "ok", stopped: "danger", stopping: "warn", pending: "warn", rebooting: "warn" };

export default function Dashboard({ username }: { username: string }) {
  const [days, setDays] = useState<Range>(1);
  const [status, reloadStatus] = useLoad<Status>(`/api/lightsail/status?days=${days}`);
  const [traffic, reloadTraffic] = useLoad<Traffic>(`/api/cloudflare/traffic?days=${days}`);
  const [logs, reloadLogs] = useLoad<{ operations: Operation[] }>("/api/lightsail/logs");
  const [busy, setBusy] = useState<"reboot" | "rotate" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [rotation, setRotation] = useState<RotateResult | null>(null);

  const reloadAll = useCallback(() => {
    reloadStatus();
    reloadTraffic();
    reloadLogs();
  }, [reloadStatus, reloadTraffic, reloadLogs]);

  const instanceName = status.data?.instance.name ?? "实例";

  async function reboot() {
    if (!confirm(`确定重启 ${instanceName}？重启期间服务不可用。`)) return;
    setBusy("reboot");
    setNotice(null);
    try {
      const { ok, body } = await api<{ status: string }>("/api/lightsail/reboot", { method: "POST" });
      if (ok) setNotice({ tone: "ok", text: `已发送重启指令（${body.status}）` });
      else {
        setNotice({ tone: "danger", text: `重启失败：${body.error}` });
        alert(`重启失败：${body.error}`);
      }
    } finally {
      setBusy(null);
      reloadAll();
    }
  }

  async function rotate() {
    if (!confirm(`确定更换 ${instanceName} 的 IP？\n\n将依次：解绑并删除旧 static IP → 创建新 IP → 绑定 → 更新 Cloudflare A 记录。\n旧 IP 删除后无法找回。`)) return;
    setBusy("rotate");
    setNotice(null);
    setRotation(null);
    try {
      const { body } = await api<RotateResult>("/api/lightsail/rotate-ip", { method: "POST" });
      if (Array.isArray(body.steps)) {
        setRotation(body);
        if (!body.ok && body.alert) alert(body.alert);
      } else {
        const text = `换 IP 失败：${body.error ?? "未知错误"}`;
        setNotice({ tone: "danger", text });
        alert(text);
      }
    } catch (err) {
      const text = `换 IP 请求失败，结果未知，请刷新并检查 static IP 状态：${err instanceof Error ? err.message : err}`;
      setNotice({ tone: "danger", text });
      alert(text);
    } finally {
      setBusy(null);
      reloadAll();
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="page">
      <header className="topbar">
        <h1 className="brand"><img src="/icon.svg" alt="" width={28} height={28} />lightkeeper</h1>
        <div className="row topbar-actions">
          <RangePicker value={days} onChange={setDays} />
          <button className="btn" onClick={reloadAll}>刷新</button>
          <span className="muted user">{username}</span>
          <button className="btn" onClick={logout}>退出</button>
        </div>
      </header>

      {notice && <p className={`banner ${notice.tone}`}>{notice.text}</p>}
      {rotation && <RotationReport result={rotation} onClose={() => setRotation(null)} />}

      <InstanceCard status={status} busy={busy} onReboot={reboot} onRotate={rotate} />
      <MetricsCard status={status} days={days} />
      <TrafficCard traffic={traffic} days={days} instanceIp={status.data?.instance.publicIp ?? null} />
      <LogsCard logs={logs} />
    </main>
  );
}

function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="segmented" role="group" aria-label="时间范围">
      {([1, 3, 7] as Range[]).map((d) => (
        <button key={d} className={d === value ? "active" : ""} onClick={() => onChange(d)}>
          {d} 天
        </button>
      ))}
    </div>
  );
}

function Section({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Failure({ error }: { error: string }) {
  return <p className="banner danger">{error}</p>;
}

function InstanceCard({ status, busy, onReboot, onRotate }: {
  status: Loadable<Status>;
  busy: "reboot" | "rotate" | null;
  onReboot: () => void;
  onRotate: () => void;
}) {
  const s = status.data;
  const actions = (
    <div className="row card-actions">
      <button className="btn" onClick={onReboot} disabled={!!busy || !s}>{busy === "reboot" ? "重启中…" : "重启实例"}</button>
      <button className="btn primary" onClick={onRotate} disabled={!!busy || !s}>{busy === "rotate" ? "更换中…" : "更换 IP"}</button>
    </div>
  );
  return (
    <Section title="实例状态" extra={actions}>
      {status.error && <Failure error={status.error} />}
      {!s && status.loading && <p className="muted">加载中…</p>}
      {s && (
        <>
          {s.unattachedStaticIps.length > 0 && (
            <p className="banner danger">
              ⚠️ 有未绑定的 static IP 正在计费：
              {s.unattachedStaticIps.map((ip) => `${ip.name}（${ip.ipAddress}）`).join("、")}。请到 Lightsail 控制台绑定或删除。
            </p>
          )}
          {!s.attachedStaticIp && (
            <p className="banner warn">{s.instance.name} 当前没有绑定 static IP，公网 IP 重启后可能会变。</p>
          )}
          <dl className="facts">
            <Fact label="名称" value={s.instance.name} />
            <Fact label="状态" value={<span className={`badge ${STATE_TONE[s.instance.state] ?? "warn"}`}>{s.instance.state}</span>} />
            <Fact label="公网 IP" value={s.instance.publicIp ?? "-"} />
            <Fact label="Static IP" value={s.attachedStaticIp ? `${s.attachedStaticIp.name}` : "未绑定"} />
            <Fact label="IPv6" value={s.instance.ipv6.length ? s.instance.ipv6.join(", ") : "未启用"} />
            <Fact label="区域" value={s.instance.zone ?? s.region} />
            <Fact label="规格" value={[s.instance.bundleId, s.instance.cpuCount && `${s.instance.cpuCount} vCPU`, s.instance.ramGb && `${s.instance.ramGb} GB`].filter(Boolean).join(" · ") || "-"} />
            <Fact label="系统" value={s.instance.blueprint ?? "-"} />
          </dl>
        </>
      )}
    </Section>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MetricsCard({ status, days }: { status: Loadable<Status>; days: Range }) {
  const m = status.data?.metrics;
  const cpu = useMemo(() => (m?.series.cpu ?? []).map((p) => ({ t: p.t, cpu: p.v })), [m]);
  const network = useMemo(() => {
    if (!m) return [];
    // Sums per period -> bytes per second.
    const rows = new Map<number, { t: number; in: number; out: number }>();
    for (const p of m.series.networkIn ?? []) rows.set(p.t, { t: p.t, in: p.v / m.period, out: 0 });
    for (const p of m.series.networkOut ?? []) {
      const row = rows.get(p.t) ?? { t: p.t, in: 0, out: 0 };
      row.out = p.v / m.period;
      rows.set(p.t, row);
    }
    return [...rows.values()].sort((a, b) => a.t - b.t);
  }, [m]);
  const checks = useMemo(() => (m?.series.statusCheckFailed ?? []).map((p) => ({ t: p.t, failed: p.v })), [m]);
  const totalIn = (m?.series.networkIn ?? []).reduce((n, p) => n + p.v, 0);
  const totalOut = (m?.series.networkOut ?? []).reduce((n, p) => n + p.v, 0);
  const failedChecks = checks.reduce((n, p) => n + p.failed, 0);

  return (
    <Section title={`实例监控 · 最近 ${days} 天`}>
      {!m && status.loading && <p className="muted">加载中…</p>}
      {m && (
        <div className="grid">
          <div>
            <h3>CPU 使用率</h3>
            <TimeChart data={cpu} days={days} format={(v) => `${v.toFixed(1)}%`} series={[{ key: "cpu", name: "CPU", color: "var(--c1)" }]} />
          </div>
          <div>
            <h3>网络 IO <span className="muted">入 {formatBytes(totalIn)} · 出 {formatBytes(totalOut)}</span></h3>
            <TimeChart
              data={network}
              days={days}
              format={(v) => `${formatBytes(v)}/s`}
              series={[
                { key: "in", name: "入站", color: "var(--c1)" },
                { key: "out", name: "出站", color: "var(--c2)" },
              ]}
            />
          </div>
          <div>
            <h3>状态检查失败 <span className="muted">共 {failedChecks} 次</span></h3>
            <TimeChart data={checks} days={days} height={140} format={(v) => String(Math.round(v))} series={[{ key: "failed", name: "失败", color: "var(--danger)" }]} />
          </div>
        </div>
      )}
    </Section>
  );
}

const DNS_COLORS = ["var(--c1)", "var(--c2)", "var(--ok)", "var(--danger)"];

function TrafficCard({ traffic, days, instanceIp }: { traffic: Loadable<Traffic>; days: Range; instanceIp: string | null }) {
  const t = traffic.data;
  const dnsSeries = useMemo(() => {
    if (!t) return [];
    // One row per hour with a column per record name.
    const rows = new Map<number, Record<string, number>>();
    t.traffic.dns.forEach((rec, i) => {
      for (const p of rec.series) {
        const row = rows.get(p.t) ?? { t: p.t };
        row[`q${i}`] = p.queries;
        rows.set(p.t, row);
      }
    });
    return [...rows.values()].sort((a, b) => a.t - b.t);
  }, [t]);

  return (
    <Section title={`Cloudflare · 最近 ${days} 天`}>
      {traffic.error && <Failure error={traffic.error} />}
      {!t && traffic.loading && <p className="muted">加载中…</p>}
      {t?.recordsError && <p className="banner warn">读取 DNS 记录失败：{t.recordsError}</p>}
      {t && (
        <div className="grid">
          <div>
            <h3>
              DNS 解析次数{" "}
              <span className="muted">
                {t.traffic.dns.map((d) => `${d.name} ${formatNumber(d.queries)}`).join(" · ")}
              </span>
            </h3>
            {t.records.map((r) => {
              const mismatch = instanceIp && r.records.some((x) => x.content !== instanceIp);
              return (
                <p key={r.name} className="muted record">
                  {r.name} → {r.records.map((x) => `${x.content}${x.proxied ? "（代理）" : ""}`).join(", ") || "无记录"}
                  {mismatch && <span className="badge warn">与实例 IP 不一致</span>}
                </p>
              );
            })}
            <TimeChart
              data={dnsSeries}
              days={days}
              format={formatNumber}
              series={t.traffic.dns.map((d, i) => ({ key: `q${i}`, name: d.name, color: DNS_COLORS[i % DNS_COLORS.length] }))}
            />
          </div>
          {t.traffic.http.map((host) => {
            const recs = t.records.find((r) => r.name === host.host)?.records ?? [];
            const dnsOnly = recs.length > 0 && recs.every((r) => !r.proxied);
            return (
              <div key={host.host}>
                <h3>
                  {host.host} 流量{" "}
                  <span className="muted">{formatNumber(host.requests)} 请求 · {formatBytes(host.bytes)}</span>
                </h3>
                {dnsOnly && <p className="banner warn">该记录未开启代理（灰色云朵），Cloudflare 统计不到 HTTP 流量</p>}
                <TimeChart
                  data={host.series.map((p) => ({ t: p.t, requests: p.requests }))}
                  days={days}
                  height={160}
                  format={formatNumber}
                  series={[{ key: "requests", name: "请求数", color: "var(--c1)" }]}
                />
                <TimeChart
                  data={host.series.map((p) => ({ t: p.t, bytes: p.bytes }))}
                  days={days}
                  height={160}
                  format={formatBytes}
                  series={[{ key: "bytes", name: "流量", color: "var(--c2)" }]}
                />
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function LogsCard({ logs }: { logs: Loadable<{ operations: Operation[] }> }) {
  const ops = logs.data?.operations ?? [];
  return (
    <Section title="Lightsail 操作日志">
      {logs.error && <Failure error={logs.error} />}
      {!logs.data && logs.loading && <p className="muted">加载中…</p>}
      {logs.data && ops.length === 0 && <p className="muted">暂无记录</p>}
      {ops.length > 0 && (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>资源</th>
                <th>状态</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((op) => (
                <tr key={op.id}>
                  <td data-label="时间" className="nowrap">{op.createdAt ? formatTime(op.createdAt) : "-"}</td>
                  <td data-label="操作">{op.type}</td>
                  <td data-label="资源">{op.resourceName} <span className="muted">{op.resourceType}</span></td>
                  <td data-label="状态"><span className={`badge ${op.status === "Succeeded" ? "ok" : op.status === "Failed" ? "danger" : "warn"}`}>{op.status}</span></td>
                  <td data-label="错误" className={op.errorCode ? "" : "empty-cell"}>{op.errorCode ? `${op.errorCode} ${op.errorDetails ?? ""}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function RotationReport({ result, onClose }: { result: RotateResult; onClose: () => void }) {
  return (
    <section className={`card report ${result.ok ? "ok" : "danger"}`}>
      <div className="card-head">
        <h2>{result.ok ? `换 IP 成功：${result.oldIp ?? "无"} → ${result.newIp}` : "换 IP 未完成"}</h2>
        <button className="btn" onClick={onClose}>关闭</button>
      </div>
      {result.alert && <p className="banner danger">{result.alert}</p>}
      <ol className="steps">
        {result.steps.map((s, i) => (
          <li key={i} className={s.status}>
            <span className="icon">{s.status === "ok" ? "✓" : s.status === "failed" ? "✗" : "–"}</span>
            {s.label}
            {s.detail && <span className="muted"> · {s.detail}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
