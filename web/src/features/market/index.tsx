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

import { MarketBrands } from './components/market-brands'
import { MarketList } from './components/market-list'
import { MarketToolbar } from './components/market-toolbar'
import { NoKeyNotice } from './components/no-key-notice'
import { useMarketKeys } from './hooks/use-market-keys'
import { useMarketModels } from './hooks/use-market-models'
import {
  buildVendorSections,
  filterMarketModels,
  sortMarketModels,
} from './lib/market-helpers'
import type { MarketActions } from './types'

const route = getRouteApi('/_authenticated/market/')

export function Market() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const [query, setQuery] = useState('')
  const [vendorId, setVendorId] = useState<number | null>(null)
  const [routerOpen, setRouterOpen] = useState(false)

  const keys = useMarketKeys(search.key)
  const tokenId = keys.selectedKey?.id ?? null
  const market = useMarketModels(tokenId)

  const vendorSections = useMemo(
    () => buildVendorSections(market.vendors, market.models),
    [market.vendors, market.models]
  )
  const visibleModels = useMemo(
    () => sortMarketModels(filterMarketModels(market.models, query, vendorId)),
    [market.models, query, vendorId]
  )

  const { join, leave, isMutating } = market
  const actions = useMemo<MarketActions>(
    () => ({
      tokenId,
      busy: isMutating,
      onJoin: (model, channelId) => {
        if (tokenId !== null) join({ tokenId, model, channelId })
      },
      onLeave: (model, channelId) => {
        if (tokenId !== null) leave({ tokenId, model, channelId })
      },
    }),
    [tokenId, isMutating, join, leave]
  )

  const hasNoKey = !keys.isLoading && keys.keys.length === 0

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Model Plaza')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          {hasNoKey && (
            <NoKeyNotice
              isCreating={keys.isCreating}
              onCreate={keys.createKey}
            />
          )}
          <MarketToolbar
            search={query}
            onSearchChange={setQuery}
            keys={keys.keys}
            selectedKey={keys.selectedKey}
            isCreating={keys.isCreating}
            onSelectKey={keys.selectKey}
            onCreateKey={keys.createKey}
            onOpenRouter={() => setRouterOpen(true)}
            showKeySelector={!hasNoKey}
          />
          <MarketBrands
            sections={vendorSections}
            selectedVendorId={vendorId}
            onSelect={setVendorId}
          />
          <MarketList
            models={visibleModels}
            vendors={market.vendors}
            actions={actions}
            isLoading={market.isLoading}
            isFiltered={market.models.length > 0}
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
