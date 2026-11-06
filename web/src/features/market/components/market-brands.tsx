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
import { Globe2, Layers, MapPin, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { VendorSection } from '../lib/market-helpers'
import type { MarketRegion } from '../types'
import { VendorMark } from './vendor-mark'

export type BrandRegion = MarketRegion | 'all'
type MarketBrandsProps = {
  sections: VendorSection[]
  selectedVendorId: number | null
  region: BrandRegion
  onRegionChange: (region: BrandRegion) => void
  onSelect: (vendorId: number | null) => void
}

export function MarketBrands(props: MarketBrandsProps) {
  const { t } = useTranslation()
  const regions = [
    { id: 'all' as const, label: t('All brands'), icon: Layers },
    { id: 'intl' as const, label: t('International providers'), icon: Globe2 },
    { id: 'cn' as const, label: t('Domestic providers'), icon: MapPin },
  ]
  const vendors = props.sections
    .filter(
      (section) => props.region === 'all' || section.region === props.region
    )
    .flatMap((section) =>
      section.vendors.map((card) => ({ ...card, region: section.region }))
    )
  return (
    <section aria-label={t('Choose a brand')} className='space-y-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <h3 className='text-sm font-semibold'>{t('Choose a brand')}</h3>
        <div className='flex flex-wrap gap-1.5'>
          {regions.map((region) => (
            <button
              key={region.id}
              type='button'
              aria-pressed={props.region === region.id}
              onClick={() => props.onRegionChange(region.id)}
              className={cn(
                'hwjai-region-tab',
                `hwjai-region-${region.id}`,
                props.region === region.id && 'is-selected'
              )}
            >
              <region.icon className='size-3.5' aria-hidden='true' />
              {region.label}
            </button>
          ))}
        </div>
      </div>
      <div className='hwjai-selection-rail'>
        <button
          type='button'
          aria-pressed={props.selectedVendorId === null}
          onClick={() => props.onSelect(null)}
          className={cn(
            'hwjai-brand-choice',
            props.selectedVendorId === null && 'is-selected'
          )}
        >
          <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl'>
            <Layers className='size-5' />
          </span>
          <span>
            <span className='block text-sm font-semibold'>
              {t('All brands')}
            </span>
            <span className='text-muted-foreground text-xs'>
              {t('{{count}} providers', { count: vendors.length })}
            </span>
          </span>
        </button>
        {vendors.map(({ vendor, channelCount, region }) => (
          <button
            key={vendor.id}
            type='button'
            aria-pressed={props.selectedVendorId === vendor.id}
            onClick={() =>
              props.onSelect(
                props.selectedVendorId === vendor.id ? null : vendor.id
              )
            }
            className={cn(
              'hwjai-brand-choice',
              `hwjai-brand-${region}`,
              props.selectedVendorId === vendor.id && 'is-selected'
            )}
          >
            <span className='bg-background/80 flex size-9 shrink-0 items-center justify-center rounded-xl'>
              <VendorMark icon={vendor.icon} name={vendor.name} />
            </span>
            <span className='min-w-0'>
              <span className='block truncate text-sm font-semibold'>
                {vendor.name}
              </span>
              <span className='text-muted-foreground text-xs'>
                {t('{{count}} channels', { count: channelCount })}
              </span>
            </span>
            {props.selectedVendorId === vendor.id && (
              <Check
                className='text-primary ml-auto size-3.5 shrink-0'
                aria-hidden='true'
              />
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
