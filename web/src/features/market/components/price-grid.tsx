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

import { getDynamicPricingSummary } from '@/features/pricing/lib/dynamic-price'
import { isTokenBasedModel } from '@/features/pricing/lib/model-helpers'
import { formatPrice, formatRequestPrice } from '@/features/pricing/lib/price'
import { cn } from '@/lib/utils'

import { MARKET_TOKEN_UNIT, toPricingModel } from '../lib/market-helpers'
import type { MarketModel } from '../types'

type PriceCell = {
  key: string
  label: string
  value: string
}

type PriceGridProps = {
  model: MarketModel
  /** Channel ratio applied on top of the base model price */
  ratio: number
  className?: string
}

function hasRatio(value: number | null | undefined): boolean {
  return value !== undefined && value !== null && Number.isFinite(Number(value))
}

/** 4-cell price grid (input / output / cache read / cache write per 1M). */
export function PriceGrid(props: PriceGridProps) {
  const { t } = useTranslation()
  const pricing = toPricingModel(props.model, props.ratio)

  let cells: PriceCell[]
  let fallback: string | null = null

  const dynamicSummary = getDynamicPricingSummary(pricing, {
    tokenUnit: MARKET_TOKEN_UNIT,
    groupRatioMultiplier: props.ratio,
  })

  if (dynamicSummary) {
    const formatted = new Map(
      dynamicSummary.entries.map((entry) => [entry.field, entry.formatted])
    )
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
        cells.length > 1
          ? 'grid-cols-2 @xl:grid-cols-4 @4xl:grid-cols-2'
          : 'grid-cols-1',
        props.className
      )}
    >
      {cells.map((cell) => (
        <div
          key={cell.key}
          className='bg-muted/50 flex min-w-0 flex-col rounded-md px-2 py-1'
        >
          <dt className='text-muted-foreground text-[11px] whitespace-nowrap'>
            {cell.label}
          </dt>
          <dd className='truncate font-mono text-[13px] font-semibold'>
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
