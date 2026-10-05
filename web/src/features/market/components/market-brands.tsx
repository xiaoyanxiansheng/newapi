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

import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import type { VendorSection } from '../lib/market-helpers'
import type { MarketRegion } from '../types'

type MarketBrandsProps = {
  sections: VendorSection[]
  selectedVendorId: number | null
  /** Called with null to clear the filter */
  onSelect: (vendorId: number | null) => void
}

function useRegionTitle() {
  const { t } = useTranslation()
  return (region: MarketRegion): string => {
    if (region === 'intl') return t('Overseas')
    if (region === 'cn') return t('China')
    return t('Other')
  }
}

/** Brand cards grouped by region; click a card to filter, click again to clear. */
export function MarketBrands(props: MarketBrandsProps) {
  const { t } = useTranslation()
  const regionTitle = useRegionTitle()

  if (props.sections.length === 0) return null

  return (
    <div className='flex flex-col gap-4'>
      {props.sections.map((section) => (
        <section
          key={section.region || 'other'}
          className='flex flex-col gap-2'
        >
          <h2 className='text-muted-foreground text-sm font-semibold'>
            {regionTitle(section.region)}
          </h2>
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'>
            {section.vendors.map(({ vendor, channelCount }) => {
              const selected = props.selectedVendorId === vendor.id
              return (
                <button
                  key={vendor.id}
                  type='button'
                  aria-pressed={selected}
                  onClick={() => props.onSelect(selected ? null : vendor.id)}
                  className={cn(
                    'bg-card hover:bg-muted/50 flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors',
                    selected &&
                      'border-primary bg-primary/5 ring-primary/30 ring-2'
                  )}
                >
                  <span className='bg-muted/40 flex size-9 shrink-0 items-center justify-center rounded-lg'>
                    {getLobeIcon(vendor.icon, 24)}
                  </span>
                  <span className='min-w-0'>
                    <span className='block truncate text-sm font-semibold'>
                      {vendor.name}
                    </span>
                    <span className='text-muted-foreground block text-xs'>
                      {t('{{count}} channels', { count: channelCount })}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
