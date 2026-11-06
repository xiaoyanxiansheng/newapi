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

import { BILLING_PRICING_VARS } from '@/features/pricing/lib/billing-expr'
import {
  formatDynamicUnitPrice,
  getDynamicPricingSummary,
} from '@/features/pricing/lib/dynamic-price'
import { formatPrice, formatRequestPrice } from '@/features/pricing/lib/price'
import type { PriceType } from '@/features/pricing/types'

import { MARKET_TOKEN_UNIT, toPricingModel } from '../lib/market-helpers'
import type { MarketModel } from '../types'

type OriginalPriceCell = { key: string; label: string; value: string }

export function ModelOriginalPrices(props: { model: MarketModel }) {
  const { t } = useTranslation()
  // Reference prices use the existing model prices without a channel discount.
  const pricing = toPricingModel(props.model, 1)
  const options = { tokenUnit: MARKET_TOKEN_UNIT, groupRatioMultiplier: 1 }
  const dynamic = getDynamicPricingSummary(pricing, options)
  let cells: OriginalPriceCell[] = []
  let note: string | null = null
  let tierGroups: { id: string; label: string; cells: OriginalPriceCell[] }[] =
    []
  let contextNotes: string[] = []

  if (dynamic) {
    if (dynamic.tiers.length === 0) {
      note = t('Dynamic Pricing')
    } else {
      const labels: Record<string, string> = {
        inputPrice: t('Input /1M'),
        outputPrice: t('Output /1M'),
        cacheReadPrice: t('Cache read /1M'),
        cacheCreatePrice: t('Cache write /1M'),
      }
      tierGroups = dynamic.tiers.map((tier, index) => {
        let conditions = tier.conditions
        // A two-branch ternary's fallback is the exact complement of its condition.
        if (
          index === 1 &&
          dynamic.tiers.length === 2 &&
          conditions.length === 0 &&
          dynamic.tiers[0].conditions.length === 1
        ) {
          const condition = dynamic.tiers[0].conditions[0]
          const inverse = {
            '<': '>=',
            '<=': '>',
            '>': '<=',
            '>=': '<',
          } as const
          conditions = [{ ...condition, op: inverse[condition.op] }]
        }
        let label = t('Remaining contexts')
        if (dynamic.tiers.length === 1) label = t('Standard pricing')
        if (conditions.length) {
          label = conditions
            .map((condition) => {
              const name = t(
                { len: 'Input context', p: 'Input', c: 'Output' }[condition.var]
              )
              const op = { '<': '<', '<=': '≤', '>': '>', '>=': '≥' }[
                condition.op
              ]
              const amount =
                condition.value >= 1000 && condition.value % 1000 === 0
                  ? `${condition.value / 1000}K`
                  : String(condition.value)
              return `${name} ${op} ${amount}`
            })
            .join(' · ')
        }
        return {
          id: JSON.stringify(tier),
          label,
          cells: BILLING_PRICING_VARS.flatMap((variable) => {
            const field = variable.field
            if (!field) return []
            const configured = new RegExp(
              '\\b' + variable.key + '\\s*\\*'
            ).test(dynamic.rawExpression)
            if (!configured && !(field in labels)) return []
            const value = tier[field]
            return [
              {
                key: variable.key,
                label:
                  labels[field] ??
                  t('{{label}} /1M', { label: t(variable.shortLabel) }),
                value:
                  (configured || variable.isBase) &&
                  typeof value === 'number' &&
                  Number.isFinite(value) &&
                  value >= 0
                    ? formatDynamicUnitPrice(value, options)
                    : '—',
              },
            ]
          }),
        }
      })
      const thresholds = [
        ...new Set(
          dynamic.tiers.flatMap((tier) =>
            tier.conditions
              .filter((condition) => condition.var === 'len')
              .map((condition) => condition.value)
          )
        ),
      ]
      contextNotes = thresholds.map((value) =>
        t(
          '{{threshold}} = {{tokens}} input tokens. The full input context, including cache, selects the price tier for the whole request.',
          {
            threshold: value % 1000 === 0 ? `${value / 1000}K` : String(value),
            tokens: value.toLocaleString('en-US'),
          }
        )
      )
      if (dynamic.tierCount > 1) note = t('Tiered pricing')
      if (dynamic.hasRequestRules) note = t('Request-dependent pricing')
    }
  } else if (pricing.quota_type === 1) {
    const price = pricing.model_price
    cells = [
      {
        key: 'request',
        label: t('Per request'),
        value:
          typeof price === 'number' && Number.isFinite(price) && price >= 0
            ? formatRequestPrice(pricing)
            : '—',
      },
    ]
  } else {
    const definitions: {
      key: PriceType
      label: string
      ratios: (number | null | undefined)[]
      optional?: boolean
    }[] = [
      { key: 'input', label: t('Input /1M'), ratios: [] },
      {
        key: 'output',
        label: t('Output /1M'),
        ratios: [pricing.completion_ratio],
      },
      {
        key: 'cache',
        label: t('Cache read /1M'),
        ratios: [pricing.cache_ratio],
      },
      {
        key: 'create_cache',
        label: t('Cache write /1M'),
        ratios: [pricing.create_cache_ratio],
      },
      {
        key: 'image',
        label: t('Image input /1M'),
        ratios: [pricing.image_ratio],
        optional: true,
      },
      {
        key: 'audio_input',
        label: t('Audio input /1M'),
        ratios: [pricing.audio_ratio],
        optional: true,
      },
      {
        key: 'audio_output',
        label: t('Audio output /1M'),
        ratios: [pricing.audio_ratio, pricing.audio_completion_ratio],
        optional: true,
      },
    ]
    cells = definitions.flatMap((entry) => {
      const configured = entry.ratios.every(
        (ratio) =>
          typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0
      )
      if (entry.optional && !configured) return []
      const validBase =
        Number.isFinite(pricing.model_ratio) && pricing.model_ratio >= 0
      return [
        {
          key: entry.key,
          label: entry.label,
          value:
            configured && validBase
              ? formatPrice(pricing, entry.key, MARKET_TOKEN_UNIT)
              : '—',
        },
      ]
    })
  }

  const priceGroups = tierGroups.length
    ? tierGroups
    : [{ id: 'standard', label: '', cells }]
  return (
    <span
      role='group'
      aria-label={t('Original price')}
      className='hwjai-original-prices block w-full space-y-2 rounded-lg border p-2.5'
    >
      <span className='hwjai-original-label inline-flex rounded-md px-2 py-1 text-[11px] font-bold'>
        {t('Original price')}
      </span>
      {tierGroups.length === 2 ? (
        <span
          role='table'
          aria-label={t('Original price tiers')}
          className='block text-[10px]'
        >
          <span
            role='row'
            className='grid grid-cols-3 items-end gap-2 border-b pb-2'
          >
            <span role='columnheader' className='text-muted-foreground'>
              {t('Original price')}
            </span>
            {tierGroups.map((group) => (
              <span
                key={group.id}
                role='columnheader'
                className='text-right leading-relaxed font-semibold'
              >
                {group.label}
              </span>
            ))}
          </span>
          {tierGroups[0].cells.map((cell) => (
            <span
              key={cell.key}
              role='row'
              className='grid grid-cols-3 items-baseline gap-2 py-1.5'
            >
              <span role='rowheader' className='text-muted-foreground'>
                {cell.label}
              </span>
              {tierGroups.map((group) => (
                <span key={group.id} role='cell' className='text-right'>
                  <strong className='font-mono text-xs font-semibold'>
                    {group.cells.find((entry) => entry.key === cell.key)
                      ?.value ?? '—'}
                  </strong>
                </span>
              ))}
            </span>
          ))}
        </span>
      ) : (
        priceGroups.map((group) => (
          <span
            key={group.id}
            className='block space-y-1.5 border-t pt-2 first:border-t-0'
          >
            {group.label && (
              <span className='block text-[11px] font-semibold'>
                {group.label}
              </span>
            )}
            <span className='grid grid-cols-2 gap-x-3 gap-y-1.5'>
              {group.cells.map((cell) => (
                <span key={cell.key} className='flex min-w-0 flex-col gap-0.5'>
                  <span className='text-muted-foreground text-[10px]'>
                    {cell.label}
                  </span>
                  <strong
                    title={cell.value}
                    className='font-mono text-xs font-semibold break-words'
                  >
                    {cell.value}
                  </strong>
                </span>
              ))}
            </span>
          </span>
        ))
      )}
      {contextNotes.map((note) => (
        <span
          key={note}
          className='text-muted-foreground block border-t pt-2 text-[10px] leading-relaxed'
        >
          {note}
        </span>
      ))}
      {note && (
        <span className='text-muted-foreground block text-[10px]'>{note}</span>
      )}
    </span>
  )
}
