'use client';

import { useReducedMotion } from 'motion/react';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { RadarPoint } from '@/lib/skill-value';
import { cn } from '@/lib/utils';

const LINE_HEIGHT = 15;
const WRAP_AT = 15;

/** Greedy word wrap for the axis labels (SVG text does not wrap). */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

type TickProps = { x: number | string; y: number | string; index: number; textAnchor: 'start' | 'middle' | 'end' | 'inherit'; payload: { coordinate: number } };

/**
 * A 0–4 radar of profile values: one axis per point, polygon grid rings at 1–4.
 * - `domains`: an ink polygon; each axis label links to that domain's section, in the accent colour when it holds a focus skill.
 * - `focus`: an accent polygon over the focus skills.
 * The svg is backed by a visually hidden table with the same values.
 */
export function ProfileRadar({
  points,
  variant,
  caption,
  className,
}: {
  points: RadarPoint[];
  variant: 'domains' | 'focus';
  caption: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const config = {
    value: { label: 'Level', color: variant === 'focus' ? 'var(--primary)' : 'var(--foreground)' },
  } satisfies ChartConfig;

  const tick = ({ x, y, index, textAnchor, payload }: TickProps) => {
    const point = points[index];
    if (!point) return <g />;
    const lines = wrap(point.name, WRAP_AT);
    // Labels above the centre grow upwards, below it downwards, beside it around the axis end.
    const sin = Math.sin((payload.coordinate * Math.PI) / 180);
    const block = (lines.length - 1) * LINE_HEIGHT;
    const firstDy = sin > 0.3 ? -block - 2 : sin < -0.3 ? 10 : 4 - block / 2;
    const text = (
      <text x={x} y={y} textAnchor={textAnchor} className="font-sans text-[12.5px]">
        {lines.map((line, i) => (
          <tspan key={i} x={x} dy={i === 0 ? firstDy : LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>
    );
    if (variant === 'focus') return <g className="fill-muted-foreground">{text}</g>;
    return (
      <a
        href={`#domain-${point.id}`}
        className={cn(
          'outline-none hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
          point.focused ? 'fill-primary' : 'fill-muted-foreground hover:fill-foreground',
        )}
      >
        {text}
      </a>
    );
  };

  return (
    <figure className={cn('relative w-full max-w-[380px]', className)}>
      <ChartContainer
        config={config}
        initialDimension={{ width: 380, height: 380 }}
        className="aspect-square w-full [&_.recharts-surface]:overflow-visible"
      >
        <RadarChart data={points} outerRadius="60%" margin={{ top: 8, right: 8, bottom: 8, left: 8 }} title={caption}>
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideIndicator
                formatter={(value, _name, item) => (
                  <span className="flex w-full items-baseline justify-between gap-3">
                    <span className="text-background/70">{(item.payload as RadarPoint).levelLabel}</span>
                    <span className="font-mono">{Number(value).toFixed(1)}</span>
                  </span>
                )}
              />
            }
          />
          <PolarGrid gridType="polygon" stroke="var(--border)" />
          <PolarRadiusAxis domain={[0, 4]} tickCount={5} tick={false} axisLine={false} />
          <PolarAngleAxis dataKey="name" tick={tick} tickLine={false} />
          <Radar
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={1.5}
            fill="var(--color-value)"
            fillOpacity={variant === 'focus' ? 0.14 : 0.1}
            dot={{ r: 2.5, fillOpacity: 1, strokeWidth: 0 }}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={reduceMotion !== true}
          />
        </RadarChart>
      </ChartContainer>
      {/* A table inside sr-only: a table sized by its content would overflow the 1px box. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{variant === 'focus' ? 'Skill' : 'Domain'}</th>
              <th scope="col">Level</th>
              <th scope="col">Score out of 4</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.name}</th>
                <td>{p.levelLabel}</td>
                <td>{p.value.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
