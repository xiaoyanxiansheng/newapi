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
import { getRouteApi } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { ApiKeyDialog } from '@/features/keys/components/api-key-dialog'

import { MarketBrands, type BrandRegion } from './components/market-brands'
import { MarketList } from './components/market-list'
import { MarketModelSelector } from './components/market-model-selector'
import { MarketResultFilters } from './components/market-result-filters'
import { MarketToolbar } from './components/market-toolbar'
import { NoKeyNotice } from './components/no-key-notice'
import { useMarketKeys } from './hooks/use-market-keys'
import { useMarketModels } from './hooks/use-market-models'
import {
  buildVendorSections,
  filterMarketModels,
  getMarketBaseModelName,
  type MarketSort,
  sortMarketModels,
} from './lib/market-helpers'
import type { MarketActions } from './types'

const route = getRouteApi('/_authenticated/market/')

export function Market() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const [query, setQuery] = useState('')
  const [vendorId, setVendorId] = useState<number | null>(null)
  const [region, setRegion] = useState<BrandRegion>('all')
  const [modelName, setModelName] = useState<string | null>(null)
  const [routerOpen, setRouterOpen] = useState(false)
  const [sort, setSort] = useState<MarketSort>('price')

  const keys = useMarketKeys(search.key)
  const tokenId = keys.selectedKey?.id ?? null
  const market = useMarketModels(tokenId)

  const vendorSections = useMemo(
    () => buildVendorSections(market.vendors, market.models),
    [market.vendors, market.models]
  )
  const selectableModels = useMemo(
    () =>
      sortMarketModels(
        filterMarketModels(market.models, '', vendorId).filter(
          (model) =>
            region === 'all' ||
            market.vendors.find((vendor) => vendor.id === model.vendor_id)
              ?.region === region
        )
      ),
    [market.models, market.vendors, vendorId, region]
  )
  const visibleModels = useMemo(
    () =>
      sortMarketModels(
        filterMarketModels(selectableModels, query, null).filter(
          (model) =>
            modelName === null ||
            getMarketBaseModelName(model.model_name) === modelName
        ),
        sort
      ),
    [selectableModels, query, modelName, sort]
  )

  const { join, leave, isMutating } = market
  const actions = useMemo<MarketActions>(
    () => ({
      tokenId,
      busy: isMutating,
      onJoin: (model, channelId, listingId) => {
        if (tokenId !== null) join({ tokenId, model, channelId, listingId })
      },
      onLeave: (model, channelId, listingId) => {
        if (tokenId !== null) leave({ tokenId, model, channelId, listingId })
      },
    }),
    [tokenId, isMutating, join, leave]
  )

  const hasNoKey = !keys.isLoading && keys.keys.length === 0

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Model Plaza')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-[1440px] flex-col gap-3 sm:gap-4'>
          <p className='text-muted-foreground max-w-2xl text-sm'>
            {t(
              'Find the right model. Compare scores and output prices, then connect it to your API key.'
            )}
          </p>
          {hasNoKey && (
            <NoKeyNotice
              isCreating={keys.isCreating}
              onCreate={keys.createKey}
            />
          )}
          <div className='hwjai-market-selection'>
            <MarketBrands
              sections={vendorSections}
              selectedVendorId={vendorId}
              region={region}
              onRegionChange={(value) => {
                setRegion(value)
                setVendorId(null)
                setModelName(null)
              }}
              onSelect={(value) => {
                setVendorId(value)
                setModelName(null)
              }}
            />
            <MarketModelSelector
              models={selectableModels}
              selected={modelName}
              onSelect={setModelName}
            />
          </div>
          <MarketToolbar
            keys={keys.keys}
            selectedKey={keys.selectedKey}
            isCreating={keys.isCreating}
            onSelectKey={keys.selectKey}
            onCreateKey={keys.createKey}
            onOpenRouter={() => setRouterOpen(true)}
            showKeySelector={!hasNoKey}
          />
          <MarketResultFilters
            search={query}
            onSearchChange={setQuery}
            sort={sort}
            onSortChange={setSort}
            count={visibleModels.reduce(
              (count, model) => count + model.channels.length,
              0
            )}
          />
          <MarketList
            models={visibleModels}
            vendors={market.vendors}
            actions={actions}
            isLoading={market.isLoading}
            isFiltered={market.models.length > 0}
            sort={sort}
          />
          <ApiKeyDialog
            open={routerOpen && tokenId !== null}
            onOpenChange={setRouterOpen}
            tokenId={tokenId ?? undefined}
            hideMarketLink
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
