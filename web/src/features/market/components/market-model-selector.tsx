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
import { Boxes, Check } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { getMarketBaseModelName } from '../lib/market-helpers'
import type { MarketModel } from '../types'
import { ModelOriginalPrices } from './model-original-prices'

export function MarketModelSelector(props: {
  models: MarketModel[]
  selected: string | null
  onSelect: (name: string | null) => void
}) {
  const { t } = useTranslation()
  const choices = useMemo(() => {
    const grouped = new Map<string, MarketModel>()
    for (const model of props.models) {
      const name = getMarketBaseModelName(model.model_name)
      // Use the base model's reference pricing when it is listed directly.
      if (!grouped.has(name) || model.model_name === name) {
        grouped.set(name, model)
      }
    }
    return [...grouped]
  }, [props.models])
  return (
    <section
      aria-label={t('Choose a model')}
      className='border-border/50 space-y-3 border-t pt-3'
    >
      <div className='flex items-center gap-2'>
        <Boxes className='text-primary size-4' aria-hidden='true' />
        <h3 className='text-sm font-semibold'>{t('Choose a model')}</h3>
        <span className='text-muted-foreground text-xs'>{choices.length}</span>
      </div>
      <div className='hwjai-selection-rail'>
        <button
          type='button'
          className={cn(
            'hwjai-model-choice',
            props.selected === null && 'is-selected'
          )}
          aria-pressed={props.selected === null}
          onClick={() => props.onSelect(null)}
        >
          <span className='font-semibold'>{t('All models')}</span>
          <span className='text-muted-foreground text-xs'>
            {t('Compare scores and prices')}
          </span>
        </button>
        {choices.map(([name, model]) => {
          return (
            <button
              key={name}
              type='button'
              aria-pressed={props.selected === name}
              onClick={() =>
                props.onSelect(props.selected === name ? null : name)
              }
              className={cn(
                'hwjai-model-choice',
                props.selected === name && 'is-selected'
              )}
              title={name}
            >
              <span className='flex min-w-0 items-center gap-2'>
                <span className='truncate font-semibold'>{name}</span>
                {props.selected === name && (
                  <Check
                    className='text-primary size-3.5 shrink-0'
                    aria-hidden='true'
                  />
                )}
              </span>
              <ModelOriginalPrices model={model} />
            </button>
          )
        })}
      </div>
    </section>
  )
}
