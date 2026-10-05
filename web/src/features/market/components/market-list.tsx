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
import { Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'

import type { MarketActions, MarketModel, MarketVendor } from '../types'
import { MarketModelRow } from './market-model-row'

type MarketListProps = {
  models: MarketModel[]
  vendors: MarketVendor[]
  actions: MarketActions
  isLoading: boolean
  /** True when the market has models but none match the current filters */
  isFiltered: boolean
}

export function MarketList(props: MarketListProps) {
  const { t } = useTranslation()

  if (props.isLoading) {
    return (
      <div className='flex flex-col gap-3'>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className='h-28 w-full rounded-xl' />
        ))}
      </div>
    )
  }

  if (props.models.length === 0) {
    return (
      <div className='flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center'>
        <Store
          className='text-muted-foreground/40 mb-3 size-10'
          aria-hidden='true'
        />
        <h3 className='text-base font-semibold'>
          {props.isFiltered
            ? t('No models match your current filters.')
            : t('No models in the market yet')}
        </h3>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      {props.models.map((model) => (
        <MarketModelRow
          key={model.model_name}
          model={model}
          vendor={props.vendors.find((item) => item.id === model.vendor_id)}
          actions={props.actions}
        />
      ))}
    </div>
  )
}
