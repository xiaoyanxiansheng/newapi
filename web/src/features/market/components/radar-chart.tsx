/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useTranslation } from 'react-i18next'

import type { MarketScore } from '../types'

const SIZE = 100
const CENTER = SIZE / 2
const RADIUS = 24
const RINGS = [1 / 3, 2 / 3, 1]

type RadarChartProps = {
  score?: MarketScore | null
  size?: number
}

function clamp(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** Point on the axis `index` (0 = top, clockwise) at `fraction` of the radius. */
function axisPoint(index: number, fraction: number): [number, number] {
  const angle = (-90 + index * 90) * (Math.PI / 180)
  return [
    CENTER + Math.cos(angle) * RADIUS * fraction,
    CENTER + Math.sin(angle) * RADIUS * fraction,
  ]
}

function toPoints(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

/** Four-axis radar: price / stability / speed / cache. Null values plot as 0. */
export function RadarChart(props: RadarChartProps) {
  const { t } = useTranslation()
  const score = props.score
  const size = props.size ?? 84

  const axes = [
    { label: t('Price'), value: score?.price },
    { label: t('Stability'), value: score?.stability },
    { label: t('Speed'), value: score?.speed },
    { label: t('Cache'), value: score?.cache },
  ]

  const dataPoints = axes.map((axis, index) =>
    axisPoint(index, clamp(axis.value) / 100)
  )
  const summary = axes
    .map((axis) => `${axis.label} ${axis.value ?? t('Not enough data')}`)
    .join(', ')

  return (
    <svg
      role='img'
      aria-label={t('Score radar: {{summary}}', { summary })}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={size}
      height={size}
      className='shrink-0'
    >
      {RINGS.map((fraction) => (
        <polygon
          key={fraction}
          points={toPoints(axes.map((_, index) => axisPoint(index, fraction)))}
          fill='none'
          className='stroke-border'
          strokeWidth={0.8}
        />
      ))}
      {axes.map((axis, index) => {
        const [x, y] = axisPoint(index, 1)
        return (
          <line
            key={axis.label}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            className='stroke-border'
            strokeWidth={0.8}
          />
        )
      })}
      <polygon
        points={toPoints(dataPoints)}
        className='fill-primary/25 stroke-primary'
        strokeWidth={1.5}
        strokeLinejoin='round'
      />
      <g className='fill-muted-foreground' fontSize={8.5} aria-hidden='true'>
        <text x={CENTER} y={9} textAnchor='middle'>
          {axes[0].label}
        </text>
        <text x={SIZE - 1} y={CENTER + 3} textAnchor='end'>
          {axes[1].label}
        </text>
        <text x={CENTER} y={SIZE - 2} textAnchor='middle'>
          {axes[2].label}
        </text>
        <text x={1} y={CENTER + 3} textAnchor='start'>
          {axes[3].label}
        </text>
      </g>
    </svg>
  )
}
