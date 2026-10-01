"use client";
import { useId } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Bar,
} from "recharts";
import { copy } from "@/lib/i18n";
import { dateLabel, addDays } from "@/lib/dates";
import { metric } from "@/lib/format";
import { Empty } from "./ui";
export type ChartRow = { [key: string]: number | string | null };
export type Series = {
  key: string;
  name: string;
  tone?: "primary" | "secondary" | "tertiary";
  dashed?: boolean;
  area?: boolean;
  bar?: boolean;
};
export function dailyRows(rows: ChartRow[], keys: string[]): ChartRow[] {
  if (!rows.length) return [];
  const map = new Map(rows.map((r) => [String(r.date), r]));
  const dates = [...map.keys()].sort();
  const result: ChartRow[] = [];
  for (let day = dates[0]; day <= dates.at(-1)!; day = addDays(day, 1))
    result.push(
      map.get(day) ?? {
        date: day,
        ...Object.fromEntries(keys.map((k) => [k, null])),
      },
    );
  return result;
}
export function TrendChart({
  rows,
  series,
  title,
  empty,
  height = 220,
  xKey = "date",
  xFormat = dateLabel,
  yFormat = (v) => metric(Number(v)),
  references = [],
  compact = false,
}: {
  rows: ChartRow[];
  series: Series[];
  title: string;
  empty: string;
  height?: number;
  xKey?: string;
  xFormat?: (value: string) => string;
  yFormat?: (value: number) => string;
  references?: { value: number; label: string }[];
  compact?: boolean;
}) {
  const id = useId();
  const available = rows.some((row) =>
    series.some((s) => typeof row[s.key] === "number"),
  );
  if (!available) return <Empty title={empty} />;
  return (
    <div className="chart-wrap">
      <div
        className="chart-frame"
        role="img"
        aria-label={title}
        style={{ height }}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={1}>
          <ComposedChart
            data={rows}
            margin={{ left: compact ? -20 : 0, right: 12, top: 12, bottom: 0 }}
            accessibilityLayer
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--chart-grid)"
              strokeDasharray="2 4"
            />
            <XAxis
              dataKey={xKey}
              type={xKey === "date" ? "category" : "number"}
              scale={xKey === "date" ? "auto" : "log"}
              domain={xKey === "date" ? undefined : ["dataMin", "dataMax"]}
              tickFormatter={(v) => xFormat(String(v))}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              dy={7}
            />
            <YAxis
              width={compact ? 42 : 52}
              tickFormatter={(v) => yFormat(Number(v))}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              domain={
                references.length
                  ? [
                      (minimum: number) =>
                        Math.min(minimum, ...references.map((r) => r.value)) *
                        0.97,
                      (maximum: number) =>
                        Math.max(maximum, ...references.map((r) => r.value)) *
                        1.03,
                    ]
                  : ["auto", "auto"]
              }
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: 11,
                color: "var(--foreground)",
              }}
              labelFormatter={(v) => xFormat(String(v))}
              formatter={(v, name) => [
                typeof v === "number" ? yFormat(v) : copy.common.none,
                name,
              ]}
            />
            {references.map((r) => (
              <ReferenceLine
                key={r.label}
                y={r.value}
                stroke="var(--chart-secondary)"
                strokeDasharray="4 4"
                label={{
                  value: r.label,
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            ))}
            {series.map((s) =>
              s.bar ? (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  fill={`var(--chart-${s.tone ?? "primary"})`}
                  maxBarSize={24}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              ) : s.area ? (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  type="linear"
                  stroke={`var(--chart-${s.tone ?? "primary"})`}
                  fill="var(--chart-fill)"
                  fillOpacity={0.65}
                  strokeWidth={2}
                  connectNulls={false}
                  dot={rows.length <= 2 ? { r: 3 } : false}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  type="linear"
                  stroke={`var(--chart-${s.tone ?? "primary"})`}
                  strokeDasharray={s.dashed ? "4 4" : undefined}
                  strokeWidth={1.7}
                  connectNulls={false}
                  dot={rows.length <= 2 ? { r: 3 } : false}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!compact && (
        <>
          <div className="chart-legend">
            {series.map((s) => (
              <span key={s.key}>
                <i
                  className={s.dashed ? "dashed" : undefined}
                  style={{
                    background: s.dashed
                      ? "transparent"
                      : `var(--chart-${s.tone ?? "primary"})`,
                    borderColor: `var(--chart-${s.tone ?? "primary"})`,
                  }}
                />
                {s.name}
              </span>
            ))}
          </div>
          <details className="chart-data">
            <summary aria-controls={id}>{copy.common.dataTable}</summary>
            <div className="table-scroll" id={id}>
              <table>
                <caption className="sr-only">{title}</caption>
                <thead>
                  <tr>
                    <th>{xKey === "date" ? copy.common.date : title}</th>
                    {series.map((s) => (
                      <th key={s.key}>{s.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, index) => (
                    <tr key={index}>
                      <th scope="row">{xFormat(String(r[xKey]))}</th>
                      {series.map((s) => (
                        <td key={s.key}>
                          {typeof r[s.key] === "number"
                            ? yFormat(r[s.key] as number)
                            : copy.common.none}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
