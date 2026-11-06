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

import { cn } from '@/lib/utils'

import { TONE_TEXT_CLASS, type RateTone } from '../lib/market-helpers'
import type { MarketScore } from '../types'
import { RadarChart } from './radar-chart'

function scoreTone(total: number | null | undefined): RateTone {
  if (typeof total !== 'number') return 'none'
  if (total >= 80) return 'good'
  if (total >= 60) return 'warn'
  return 'bad'
}

type ScoreBadgeProps = {
  score?: MarketScore | null
  className?: string
  compact?: boolean
}

/** Radar chart next to the big total score. */
export function ScoreBadge(props: ScoreBadgeProps) {
  const { t } = useTranslation()
  const total = props.score?.total
  const hasTotal = typeof total === 'number'

  return (
    <div className={cn('flex items-center gap-2', props.className)}>
      <RadarChart score={props.score} size={props.compact ? 64 : undefined} />
      <div
        className={cn(
          'flex flex-col items-center',
          props.compact ? 'min-w-10' : 'min-w-14'
        )}
        title={hasTotal ? undefined : t('Not enough data')}
      >
        <span className='text-muted-foreground text-[11px]'>
          {t('Overall score')}
        </span>
        <span
          className={cn(
            'font-mono text-3xl leading-tight font-bold',
            props.compact && 'text-2xl',
            TONE_TEXT_CLASS[scoreTone(total)]
          )}
          aria-label={
            hasTotal
              ? t('Overall score {{score}}', { score: total })
              : t('Not enough data')
          }
        >
          {hasTotal ? total : '—'}
        </span>
        {!hasTotal && (
          <span className='text-muted-foreground text-[10px]'>
            {t('Not enough data')}
          </span>
        )}
      </div>
    </div>
  )
}
