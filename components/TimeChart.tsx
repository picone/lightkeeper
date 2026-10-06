"use client";

import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatTime } from "./format";

export type Series = { key: string; name: string; color: string };

type Props = {
  data: Record<string, number>[];
  series: Series[];
  format: (v: number) => string;
  days: number;
  height?: number;
  /** Shown as the heading of the enlarged view. */
  title?: string;
};

type ChartProps = Omit<Props, "title" | "height">;

// Plot area insets inside the chart; must match the margin and YAxis width in <Chart>.
const PLOT_LEFT = 72;
const PLOT_RIGHT = 8;

export default function TimeChart({ title, height = 220, ...chart }: Props) {
  const [zoomed, setZoomed] = useState(false);

  if (chart.data.length === 0) return <p className="muted empty">暂无数据</p>;
  return (
    <>
      <div
        className="chart-zoomable"
        role="button"
        tabIndex={0}
        title="点击放大"
        aria-label={title ? `放大 ${title}` : "放大图表"}
        onClick={() => setZoomed(true)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setZoomed(true))}
      >
        <Chart {...chart} height={height} />
      </div>
      {zoomed && <ChartModal title={title} chart={chart} onClose={() => setZoomed(false)} />}
    </>
  );
}

/**
 * Landscape on phones:
 * - "native": fullscreen + screen.orientation.lock (Android Chrome). The chart works as usual.
 * - "css": the dialog is rotated 90° with CSS (iOS, which has no orientation lock). Recharts
 *   ignores the rotation when mapping touches, so the tooltip index is computed here instead.
 */
type Landscape = "off" | "native" | "css";

function ChartModal({ title, chart, onClose }: { title?: string; chart: ChartProps; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [landscape, setLandscape] = useState<Landscape>("off");
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);

  // Kept in a ref so a parent re-render (e.g. a data refresh) doesn't rerun the effect below
  // and drop out of landscape.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      exitNativeLandscape();
    };
  }, []);

  // Leaving fullscreen (e.g. the Android back gesture) also ends native landscape.
  useEffect(() => {
    if (landscape !== "native") return;
    const onChange = () => !document.fullscreenElement && setLandscape("off");
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [landscape]);

  async function toggleLandscape() {
    setTooltipIndex(null);
    if (landscape !== "off") {
      if (landscape === "native") exitNativeLandscape();
      setLandscape("off");
      return;
    }
    try {
      await modalRef.current!.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock(o: string): Promise<void> }).lock("landscape");
      setLandscape("native");
    } catch {
      exitNativeLandscape();
      setLandscape("css");
    }
  }

  // In the rotated dialog the chart's x axis runs down the screen.
  function pickPoint(clientY: number) {
    const el = plotRef.current;
    if (!el) return;
    const width = el.offsetWidth - PLOT_LEFT - PLOT_RIGHT;
    const x = clientY - el.getBoundingClientRect().top - PLOT_LEFT;
    const ts = chart.data.map((d) => d.t);
    const min = Math.min(...ts);
    const max = Math.max(...ts);
    const target = min + Math.min(1, Math.max(0, x / width)) * (max - min);
    let best = 0;
    ts.forEach((t, i) => Math.abs(t - target) < Math.abs(ts[best] - target) && (best = i));
    setTooltipIndex(best);
  }

  const rotated = landscape === "css";
  return (
    <div
      ref={modalRef}
      className={`chart-modal${rotated ? " rotated" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "图表"}
      onClick={onClose}
    >
      <div className="chart-modal-body card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>{title}</h2>
          <div className="row">
            <button className={`btn landscape-btn${landscape !== "off" ? " on" : ""}`} onClick={toggleLandscape}>
              {landscape === "off" ? "横屏" : "竖屏"}
            </button>
            <button className="btn" onClick={onClose} autoFocus>
              关闭
            </button>
          </div>
        </div>
        <div
          ref={plotRef}
          className="chart-modal-chart"
          onPointerDown={rotated ? (e) => pickPoint(e.clientY) : undefined}
          onPointerMove={rotated ? (e) => pickPoint(e.clientY) : undefined}
        >
          {/* Remount on mode change: Recharts ignores defaultIndex once it has seen pointer input. */}
          <Chart key={landscape} {...chart} height="100%" tooltipIndex={rotated ? tooltipIndex : undefined} />
        </div>
      </div>
    </div>
  );
}

function exitNativeLandscape() {
  try {
    screen.orientation?.unlock();
  } catch {}
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function Chart({
  data,
  series,
  format,
  days,
  height,
  tooltipIndex,
}: ChartProps & { height: number | `${number}%`; tooltipIndex?: number | null }) {
  // undefined: Recharts tracks the pointer itself. A number or null: the caller controls the tooltip.
  const controlled = tooltipIndex !== undefined;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: PLOT_RIGHT, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(t) => formatTime(t, days > 1)}
          stroke="var(--muted)"
          fontSize={12}
          minTickGap={40}
        />
        <YAxis tickFormatter={format} stroke="var(--muted)" fontSize={12} width={PLOT_LEFT} />
        <Tooltip
          labelFormatter={(t) => formatTime(Number(t))}
          formatter={(v) => format(Number(v))}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}
          {...(controlled && { active: tooltipIndex !== null, defaultIndex: tooltipIndex ?? undefined })}
        />
        {series.length > 1 && <Legend />}
        {series.map((s) => (
          <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
