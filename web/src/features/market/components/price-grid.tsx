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

import {
  formatDynamicUnitPrice,
  getDynamicPricingSummary,
} from '@/features/pricing/lib/dynamic-price'
import { isTokenBasedModel } from '@/features/pricing/lib/model-helpers'
import { formatPrice, formatRequestPrice } from '@/features/pricing/lib/price'
import { cn } from '@/lib/utils'

import {
  MARKET_TOKEN_UNIT,
  toPricingModel,
  toListingPricingModel,
} from '../lib/market-helpers'
import type { MarketModel, MarketChannel } from '../types'

type PriceCell = {
  key: string
  label: string
  value: string
}

type PriceGridProps = {
  channel?: MarketChannel
  model: MarketModel
  /** Channel ratio applied on top of the base model price */
  ratio: number
  className?: string
  compact?: boolean
  plaza?: boolean
}

function hasRatio(value: number | null | undefined): boolean {
  return value !== undefined && value !== null && Number.isFinite(Number(value))
}

/** 4-cell price grid (input / output / cache read / cache write per 1M). */
export function PriceGrid(props: PriceGridProps) {
  const { t } = useTranslation()
  const pricing = props.channel
    ? toListingPricingModel(props.model, props.channel)
    : toPricingModel(props.model, props.ratio)
  const displayRatio = props.channel?.billing_mode?.includes('expr')
    ? 1
    : props.ratio

  let cells: PriceCell[]
  let fallback: string | null = null

  const dynamicSummary = getDynamicPricingSummary(pricing, {
    tokenUnit: MARKET_TOKEN_UNIT,
    groupRatioMultiplier: displayRatio,
  })

  if (dynamicSummary) {
    const formatted = new Map(
      dynamicSummary.entries.map((entry) => [entry.field, entry.formatted])
    )
    if (props.channel?.billing_mode === 'fixed_expr') {
      for (const [variable, field] of [
        ['p', 'inputPrice'],
        ['c', 'outputPrice'],
        ['cr', 'cacheReadPrice'],
        ['cc', 'cacheCreatePrice'],
      ]) {
        if (
          dynamicSummary.tier?.[field] === 0 &&
          new RegExp(`\\b${variable}\\s*\\*`).test(dynamicSummary.rawExpression)
        ) {
          formatted.set(
            field,
            formatDynamicUnitPrice(0, {
              tokenUnit: MARKET_TOKEN_UNIT,
              groupRatioMultiplier: 1,
            })
          )
        }
      }
    }
    cells = [
      { key: 'input', label: t('Input /1M'), field: 'inputPrice' },
      { key: 'output', label: t('Output /1M'), field: 'outputPrice' },
      { key: 'cache', label: t('Cache read /1M'), field: 'cacheReadPrice' },
      {
        key: 'create_cache',
        label: t('Cache write /1M'),
        field: 'cacheCreatePrice',
      },
    ].map(({ key, label, field }) => ({
      key,
      label,
      value: formatted.get(field) ?? '-',
    }))
    if (!formatted.has('inputPrice') && !formatted.has('outputPrice')) {
      fallback = t('Dynamic Pricing')
    }
  } else if (!isTokenBasedModel(pricing)) {
    cells = [
      {
        key: 'request',
        label: t('Per request'),
        value: t('{{price}} / request', {
          price: formatRequestPrice(pricing),
        }),
      },
    ]
  } else {
    const unit = MARKET_TOKEN_UNIT
    cells = [
      {
        key: 'input',
        label: t('Input /1M'),
        value: formatPrice(pricing, 'input', unit),
      },
      {
        key: 'output',
        label: t('Output /1M'),
        value: formatPrice(pricing, 'output', unit),
      },
      {
        key: 'cache',
        label: t('Cache read /1M'),
        value: hasRatio(pricing.cache_ratio)
          ? formatPrice(pricing, 'cache', unit)
          : '-',
      },
      {
        key: 'create_cache',
        label: t('Cache write /1M'),
        value: hasRatio(pricing.create_cache_ratio)
          ? formatPrice(pricing, 'create_cache', unit)
          : '-',
      },
    ]
  }

  if (fallback) {
    return (
      <span className={cn('text-muted-foreground text-sm', props.className)}>
        {fallback}
      </span>
    )
  }

  return (
    <dl
      className={cn(
        'grid gap-1.5',
        cells.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
        !props.compact && !props.plaza && '@xl:grid-cols-4 @4xl:grid-cols-2',
        // Keep the plaza prices at two columns. The labels contain units and
        // become unreadable when four cells are forced into a narrow card.
        props.plaza && 'grid-cols-2',
        props.className
      )}
    >
      {(props.compact
        ? cells
            .filter((cell) => ['output', 'input', 'request'].includes(cell.key))
            .sort(
              (a, b) => Number(b.key === 'output') - Number(a.key === 'output')
            )
        : [...cells].sort((a, b) =>
            props.plaza
              ? Number(b.key === 'output') - Number(a.key === 'output')
              : 0
          )
      ).map((cell) => (
        <div
          key={cell.key}
          className={cn(
            'bg-muted/30 flex min-w-0 flex-col rounded-lg px-3 py-2',
            (props.compact || props.plaza) &&
              ['output', 'request'].includes(cell.key) &&
              'bg-primary/6'
          )}
        >
          <dt className='text-muted-foreground text-[11px] leading-tight'>
            {cell.label}
          </dt>
          <dd
            title={cell.value}
            className={cn(
              'truncate font-mono text-[13px] font-semibold',
              (props.compact || props.plaza) &&
                ['output', 'request'].includes(cell.key) &&
                'text-primary mt-1 text-base tracking-tight'
            )}
          >
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
