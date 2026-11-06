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
import { Search, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import type { MarketSort } from '../lib/market-helpers'

export function MarketResultFilters(props: {
  search: string
  onSearchChange: (value: string) => void
  sort: MarketSort
  onSortChange: (value: MarketSort) => void
  count: number
}) {
  const { t } = useTranslation()
  return (
    <div
      className='hwjai-result-filters'
      role='search'
      aria-label={t('Filter model results')}
    >
      <div className='relative min-w-0 flex-1'>
        <Search
          className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
          aria-hidden='true'
        />
        <Input
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder={t('Search model name or description...')}
          aria-label={t('Search model name or description...')}
          className='bg-background/80 h-10 rounded-xl pl-9'
        />
      </div>
      <span
        className='text-muted-foreground shrink-0 text-xs'
        aria-live='polite'
      >
        {t('{{count}} channels', { count: props.count })}
      </span>
      <label className='bg-background/80 flex items-center gap-2 rounded-xl border px-3'>
        <SlidersHorizontal
          className='text-primary size-4 shrink-0'
          aria-hidden='true'
        />
        <select
          value={props.sort}
          onChange={(event) =>
            props.onSortChange(event.target.value as MarketSort)
          }
          aria-label={t('Sort models by')}
          className='text-foreground focus-visible:ring-ring h-10 min-w-0 bg-transparent text-sm outline-none focus-visible:ring-2'
        >
          <option value='price'>{t('Output price: low to high')}</option>
          <option value='listed'>{t('Listing time: newest first')}</option>
          <option value='score'>{t('Sort by score')}</option>
        </select>
      </label>
    </div>
  )
}
