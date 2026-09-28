"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatTime } from "./format";

export type Series = { key: string; name: string; color: string };

type Props = {
  data: Record<string, number>[];
  series: Series[];
  format: (v: number) => string;
  days: number;
  height?: number;
};

export default function TimeChart({ data, series, format, days, height = 220 }: Props) {
  if (data.length === 0) return <p className="muted empty">暂无数据</p>;
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
