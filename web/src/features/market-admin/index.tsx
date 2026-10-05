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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { useDebounce } from '@/hooks'

import { AddListingDialog } from './components/add-listing-dialog'
import { BatchResultDialog } from './components/batch-result-dialog'
import { BulkBar } from './components/bulk-bar'
import { DeleteConfirmDialog } from './components/delete-confirm-dialog'
import { GenerateDialog } from './components/generate-dialog'
import { ListingPagination } from './components/listing-pagination'
import { ListingTable } from './components/listing-table'
import { ListingToolbar } from './components/listing-toolbar'
import { useListingActions } from './hooks/use-listing-actions'
import { useChannelOptions, useListings } from './hooks/use-market-admin'

const DEFAULT_PAGE_SIZE = 50

export function MarketAdmin() {
  const { t } = useTranslation()
  const [channelId, setChannelId] = useState<number | null>(null)
  const [keywordInput, setKeywordInput] = useState('')
  const keyword = useDebounce(keywordInput.trim(), 300)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [generateOpen, setGenerateOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const listingsQuery = useListings({ channelId, keyword })
  const channelsQuery = useChannelOptions()
  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data])
  const listings = useMemo(
    () => listingsQuery.data?.data ?? [],
    [listingsQuery.data]
  )

  const pageCount = Math.max(1, Math.ceil(listings.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageRows = useMemo(
    () => listings.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [listings, currentPage, pageSize]
  )

  // Drop selections that no longer match the filtered result set.
  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(listings.map((row) => row.id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [listings])

  const selectedList = [...selectedIds]
  const actions = useListingActions({
    selectedIds: selectedList,
    onDeleted: (ids) =>
      setSelectedIds(
        (prev) => new Set([...prev].filter((id) => !ids.includes(id)))
      ),
  })

  const handleSelectedChange = (id: number, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleSelectPage = (selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const row of pageRows) {
        if (selected) next.add(row.id)
        else next.delete(row.id)
      }
      return next
    })
  }

  const busy = actions.mutations.batch.isPending

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Market Listings')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <ListingToolbar
            channels={channels}
            channelId={channelId}
            keyword={keywordInput}
            onChannelChange={(value) => {
              setChannelId(value)
              setPage(1)
              setSelectedIds(new Set())
            }}
            onKeywordChange={(value) => {
              setKeywordInput(value)
              setPage(1)
            }}
            onGenerate={() => setGenerateOpen(true)}
            onAdd={() => setAddOpen(true)}
          />
          {selectedIds.size > 0 ? (
            <BulkBar
              selectedCount={selectedIds.size}
              filteredCount={listings.length}
              busy={busy}
              onSelectAllFiltered={() =>
                setSelectedIds(new Set(listings.map((row) => row.id)))
              }
              onClear={() => setSelectedIds(new Set())}
              onSetRatio={actions.setRatio}
              onSetEnabled={actions.setEnabled}
              onDelete={() => actions.requestDelete(selectedList)}
            />
          ) : null}
          <div className='rounded-lg border'>
            <ListingTable
              rows={pageRows}
              loading={listingsQuery.isLoading}
              selectedIds={selectedIds}
              onSelectedChange={handleSelectedChange}
              onSelectPage={handleSelectPage}
              onUpdate={actions.updateOne}
              onDelete={(id) => actions.requestDelete([id])}
            />
          </div>
          <ListingPagination
            page={currentPage}
            pageSize={pageSize}
            total={listings.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </div>
      </SectionPageLayout.Content>

      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        channels={channels}
        defaultChannelId={channelId}
        generating={actions.mutations.generate.isPending}
        onGenerate={actions.mutations.generate.mutateAsync}
      />
      <AddListingDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        channels={channels}
        defaultChannelId={channelId}
        saving={actions.mutations.create.isPending}
        onCreate={actions.mutations.create.mutateAsync}
      />
      <DeleteConfirmDialog
        count={actions.pendingDeleteIds.length}
        deleting={actions.mutations.remove.isPending}
        onConfirm={actions.confirmDelete}
        onCancel={actions.cancelDelete}
      />
      <BatchResultDialog
        failures={actions.failures}
        onClose={actions.closeFailures}
      />
    </SectionPageLayout>
  )
}
