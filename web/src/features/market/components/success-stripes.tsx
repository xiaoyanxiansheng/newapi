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

import {
  TONE_BG_CLASS,
  TONE_TEXT_CLASS,
  blockTone,
  formatRate,
  rateTone,
} from '../lib/market-helpers'
import type { MarketStats, MarketStatsWindow } from '../types'

type StripeRowProps = {
  label: string
  window?: MarketStatsWindow
  /** Number of placeholder blocks when there is no data */
  placeholderBlocks: number
}

function StripeRow(props: StripeRowProps) {
  const { t } = useTranslation()
  const blocks = props.window?.blocks ?? []
  const rate = props.window?.rate ?? null
  const tone = rateTone(rate)
  const count = blocks.length > 0 ? blocks.length : props.placeholderBlocks

  return (
    <div className='flex items-center gap-1.5'>
      <span className='text-muted-foreground w-7 shrink-0 text-[11px]'>
        {props.label}
      </span>
      <div className='flex h-3.5 min-w-0 flex-1 items-stretch gap-[2px]'>
        {Array.from({ length: count }, (_, index) => {
          const block = blocks[index]
          return (
            <span
              key={index}
              title={
                block
                  ? t('Success {{ok}} / Failed {{fail}}', {
                      ok: block.ok,
                      fail: block.fail,
                    })
                  : undefined
              }
              className={cn(
                'min-w-[3px] flex-1 rounded-[2px]',
                TONE_BG_CLASS[blockTone(block)]
              )}
            />
          )
        })}
      </div>
      <span
        className={cn(
          'w-11 shrink-0 text-right font-mono text-[11px] font-semibold',
          TONE_TEXT_CLASS[tone]
        )}
      >
        {formatRate(rate)}
      </span>
    </div>
  )
}

type SuccessStripesProps = {
  stats?: MarketStats | null
  className?: string
}

/** Three stripes (realtime / 24h / 7d) of colored success-rate blocks. */
export function SuccessStripes(props: SuccessStripesProps) {
  const { t } = useTranslation()
  const stats = props.stats

  const summary = stats
    ? t('Success rate: realtime {{realtime}}, 24h {{day}}, 7d {{week}}', {
        realtime: formatRate(stats.realtime?.rate),
        day: formatRate(stats.day?.rate),
        week: formatRate(stats.week?.rate),
      })
    : t('Not enough data')

  return (
    <div
      role='img'
      aria-label={summary}
      className={cn('flex min-w-0 flex-col gap-1', props.className)}
    >
      <StripeRow
        label={t('Realtime')}
        window={stats?.realtime}
        placeholderBlocks={12}
      />
      <StripeRow label='24h' window={stats?.day} placeholderBlocks={12} />
      <StripeRow label='7d' window={stats?.week} placeholderBlocks={14} />
    </div>
  )
}
