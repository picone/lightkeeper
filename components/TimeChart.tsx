"use client";

import { useEffect, useState } from "react";
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

export default function TimeChart({ title, height = 220, ...chart }: Props) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [zoomed]);

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
      {zoomed && (
        <div className="chart-modal" role="dialog" aria-modal="true" aria-label={title ?? "图表"} onClick={() => setZoomed(false)}>
          <div className="chart-modal-body card" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <h2>{title}</h2>
              <button className="btn" onClick={() => setZoomed(false)} autoFocus>
                关闭
              </button>
            </div>
            <div className="chart-modal-chart">
              <Chart {...chart} height="100%" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Chart({ data, series, format, days, height }: Omit<Props, "title" | "height"> & { height: number | `${number}%` }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
        <YAxis tickFormatter={format} stroke="var(--muted)" fontSize={12} width={72} />
        <Tooltip
          labelFormatter={(t) => formatTime(Number(t))}
          formatter={(v) => format(Number(v))}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}
        />
        {series.length > 1 && <Legend />}
        {series.map((s) => (
          <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
