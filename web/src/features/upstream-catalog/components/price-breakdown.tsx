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

import type { Prices } from '../types'

export function PriceBreakdown(props: {
  prices: Prices
  unit?: string
  currency?: string
}) {
  const { t } = useTranslation()
  const currency = props.currency === 'CNY' ? 'CNY' : 'USD'
  const symbol = currency === 'CNY' ? '¥' : '$'
  let unitLabel = t('{{currency}} / 1M tokens', { currency })
  if (props.unit === 'per_request') {
    unitLabel = t('{{currency}} / request', { currency })
  }
  if (props.unit === 'per_image') {
    unitLabel = t('{{currency}} / image', { currency })
  }
  const labels: Record<keyof Prices, string> = {
    input: t('Input'),
    output: t('Output'),
    cache_read: t('Cache read'),
    cache_write: t('Cache write'),
    image_input: t('Image input'),
    audio_input: t('Audio input'),
    audio_output: t('Audio output'),
    request: props.unit === 'per_image' ? t('Per image') : t('Per request'),
  }
  return (
    <div className='space-y-1'>
      <span className='text-muted-foreground text-[10px]'>{unitLabel}</span>
      <dl className='grid gap-1'>
        {(Object.keys(labels) as (keyof Prices)[])
          .filter((key) => props.prices[key] !== undefined)
          .map((key) => (
            <div
              key={key}
              className='flex items-baseline justify-between gap-3 text-xs'
            >
              <dt className='text-muted-foreground'>{labels[key]}</dt>
              <dd
                className={
                  key === 'output' || key === 'request'
                    ? 'text-primary font-mono font-semibold'
                    : 'font-mono'
                }
              >
                {`${symbol}${props.prices[key]}`}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  )
}
