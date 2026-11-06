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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatListingId } from '@/features/market/lib/market-helpers'

import * as api from '../api'
import { translateUpstreamError } from '../errors'
import { getListingStatus, LISTING_STATUS_ORDER } from '../lib/listing-status'
import type { CatalogFilters, Preview, Selection } from '../types'
import { CatalogTable } from './catalog-table'
import { ManualPriceEditor } from './manual-price-editor'
import { RouteQuotesPanel } from './route-quotes-panel'
import { SelectionPreview } from './selection-preview'

export function KeyModelPanel(props: {
  sourceId: number
  filters: CatalogFilters
  refreshing?: boolean
  refreshError?: string | null
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const detail = useQuery({
    queryKey: ['upstream-source', props.sourceId],
    queryFn: () => api.getSource(props.sourceId),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.rows.some((row) => row.listing) ? 60_000 : false,
  })
  const source = detail.data?.source
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [baseModel, setBaseModel] = useState('')
  const baseModels = [
    ...new Set(
      (detail.data?.rows ?? []).flatMap((row) =>
        row.latest?.base_model ? [row.latest.base_model] : []
      )
    ),
  ].sort()
  const { onlyChanges, listingStatus } = props.filters
  const [descriptionEditor, setDescriptionEditor] = useState<{
    id: number
    model: string
    value: string
  } | null>(null)
  const [page, setPage] = useState(1)
  useEffect(() => {
    setPage(1)
  }, [listingStatus, onlyChanges])
  const [priceModel, setPriceModel] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    data: Preview
    selection: Selection
  } | null>(null)
  const action = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['upstream-source'] }),
        client.invalidateQueries({ queryKey: ['upstream-account'] }),
        client.invalidateQueries({ queryKey: ['market'] }),
        client.invalidateQueries({ queryKey: ['upstream-manual-keys'] }),
      ])
    },
  })
  const normalizedSearch = search.trim().toLowerCase()
  const rows = (detail.data?.rows ?? [])
    .filter(
      (row) =>
        (row.model.toLowerCase().includes(normalizedSearch) ||
          !!row.latest?.channel_no?.toLowerCase().includes(normalizedSearch) ||
          (!!row.latest?.listing_id &&
            (formatListingId(row.latest.listing_id).toLowerCase() ===
              normalizedSearch ||
              String(row.latest.listing_id) === normalizedSearch)) ||
          (!!row.listing &&
            (formatListingId(row.listing.id).toLowerCase() ===
              normalizedSearch ||
              String(row.listing.id) === normalizedSearch))) &&
        (!baseModel || row.latest?.base_model === baseModel) &&
        (listingStatus === 'all' || getListingStatus(row) === listingStatus) &&
        (!onlyChanges || row.change !== 'unchanged')
    )
    .sort((a, b) => {
      const rankA = LISTING_STATUS_ORDER[getListingStatus(a)]
      const rankB = LISTING_STATUS_ORDER[getListingStatus(b)]
      return rankA - rankB || a.model.localeCompare(b.model)
    })
  const pageCount = Math.max(1, Math.ceil(rows.length / 50))
  const currentPage = Math.min(page, pageCount)
  const pageRows = rows.slice((currentPage - 1) * 50, currentPage * 50)
  const busy = action.isPending || !!props.refreshing
  const available =
    !!source &&
    !source.disabled &&
    !source.account_disabled &&
    !source.key_missing &&
    source.key_status === 1 &&
    !source.key_issue &&
    !source.last_error &&
    source.latest_time > 0 &&
    (!source.key_expires_at ||
      source.key_expires_at < 0 ||
      source.key_expires_at > Date.now() / 1000)
  const error = action.error instanceof Error ? action.error.message : null
  const panelError = error || props.refreshError || source?.last_error

  function choose(model: string, checked: boolean, markup?: string): void {
    if (markup !== undefined) {
      setDrafts((previous) => ({ ...previous, [model]: markup }))
    }
    setSelected((previous) => {
      const next = { ...previous }
      if (!checked) delete next[model]
      else {
        next[model] =
          markup ??
          drafts[model] ??
          previous[model] ??
          detail.data?.rows.find((row) => row.model === model)
            ?.markup_override ??
          ''
      }
      return next
    })
    setPreview(null)
  }
  function review(models: Record<string, string>): void {
    if (!source) return
    action.mutate(async () => {
      const selection = { revision: source.revision, models }
      setPreview({
        data: await api.previewSelection(source.id, selection),
        selection,
      })
    })
  }
  if (detail.isPending) {
    return (
      <p role='status' className='p-5'>
        {t('Loading...')}
      </p>
    )
  }
  if (detail.isError) {
    return (
      <div role='alert' className='p-5'>
        <p>
          {t(
            'Could not load the model catalog. Retry to see the saved snapshot.'
          )}
        </p>
        <Button onClick={() => detail.refetch()}>{t('Retry')}</Button>
      </div>
    )
  }
  if (!source) return null
  return (
    <div className='w-full max-w-full min-w-0 space-y-4 border-t p-4 sm:p-5'>
      {panelError && !preview && !priceModel && !descriptionEditor && (
        <p
          role='alert'
          className='text-destructive bg-destructive/5 rounded-lg p-3'
        >
          {translateUpstreamError(panelError, t)}
        </p>
      )}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Input
          className='w-full sm:w-64'
          aria-label={t('Search model name or ID')}
          placeholder={t('Search model name or ID')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        {baseModels.length > 0 && (
          <select
            className='border-input bg-background max-w-full min-w-0 rounded-md border px-3 py-2 text-sm'
            aria-label={t('Base model')}
            value={baseModel}
            onChange={(event) => {
              setBaseModel(event.target.value)
              setPage(1)
            }}
          >
            <option value=''>{t('All base models')}</option>
            {baseModels.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <Button
          variant='outline'
          disabled={busy || source.key_missing || source.key_status !== 1}
          onClick={() =>
            action.mutate(async () => {
              await api.refreshSource(source.id)
              setPreview(null)
              setSelected({})
            })
          }
        >
          {t('Refresh models and prices')}
        </Button>
      </div>
      {!!source.account_id && (
        <RouteQuotesPanel sourceId={source.id} revision={source.revision} />
      )}
      {source.pricing_mode === 'model_routes' && (
        <p className='bg-primary/5 text-primary rounded-lg p-3 text-sm'>
          {t(
            'Each merchant route has its own complete access model and purchase prices. Publish a specific route; base-model automatic routing has no single confirmed price.'
          )}
        </p>
      )}
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          variant='outline'
          disabled={busy || !available || Object.keys(selected).length >= 500}
          onClick={() => {
            setSelected((previous) => {
              const next = { ...previous }
              for (const row of pageRows) {
                if (Object.keys(next).length >= 500) break
                if (
                  row.latest &&
                  !row.latest.price_issue &&
                  !(row.model in next)
                ) {
                  next[row.model] = drafts[row.model] ?? row.markup_override
                }
              }
              return next
            })
            setPreview(null)
          }}
        >
          {t('Select this page')}
        </Button>
        <Button
          size='sm'
          variant='ghost'
          disabled={busy || !Object.keys(selected).length}
          onClick={() => {
            setSelected({})
            setPreview(null)
          }}
        >
          {t('Clear selection')}
        </Button>
        <Button
          size='sm'
          disabled={busy || !available || !Object.keys(selected).length}
          onClick={() => review({ ...selected })}
        >
          {t('Publish selected models')} ({Object.keys(selected).length})
        </Button>
        <span className='text-muted-foreground text-xs'>
          {t('Pending changes')}:{' '}
          {detail.data?.rows.filter((row) => row.change !== 'unchanged').length}
        </span>
      </div>
      <CatalogTable
        rows={pageRows}
        selected={selected}
        drafts={drafts}
        busy={busy}
        unavailable={!available}
        markup={source.markup}
        onConfirmPrice={
          source.adapter === 'direct-key'
            ? (model) => {
                action.reset()
                setPriceModel(model)
              }
            : undefined
        }
        onSelect={choose}
        onDescription={(model) => {
          const listing = detail.data?.rows.find(
            (row) => row.model === model
          )?.listing
          if (!listing) return
          action.reset()
          setDescriptionEditor({
            id: listing.id,
            model,
            value: listing.description ?? '',
          })
        }}
        onDefaultSuccess={(model, enabled) => {
          const listing = detail.data?.rows.find(
            (row) => row.model === model
          )?.listing
          if (!listing) return
          action.mutate(async () => {
            await api.saveListingPresentation(listing.id, enabled)
          })
        }}
        onProbeEndpoint={(model, endpoint) => {
          const listing = detail.data?.rows.find(
            (row) => row.model === model
          )?.listing
          if (!listing) return
          action.mutate(async () => {
            await api.saveListingProbeEndpoint(listing.id, endpoint)
          })
        }}
        onPublish={(model) =>
          review({
            [model]:
              drafts[model] ??
              selected[model] ??
              detail.data?.rows.find((row) => row.model === model)
                ?.markup_override ??
              '',
          })
        }
        onState={(model, enabled, remove) =>
          action.mutate(async () => {
            await api.manageListing(
              source.id,
              source.revision,
              model,
              enabled,
              remove
            )
            setPreview(null)
            setSelected({})
          })
        }
        onReview={(model, pause) =>
          action.mutate(async () => {
            await api.reviewChanges(source.id, source.revision, [model], pause)
            setPreview(null)
            setSelected({})
          })
        }
      />
      <div className='flex items-center justify-between text-xs'>
        <span>
          {rows.length} {t('Models')} · {currentPage} / {pageCount}
        </span>
        <div className='flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('Previous')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      </div>
      <SelectionPreview
        preview={preview?.data ?? null}
        error={error}
        busy={busy}
        onClose={() => setPreview(null)}
        onApply={() =>
          action.mutate(async () => {
            if (!preview) return
            await api.applySelection(source.id, {
              ...preview.selection,
              fingerprint: preview.data.fingerprint,
            })
            setPreview(null)
            setSelected({})
          })
        }
      />
      <Dialog
        open={!!descriptionEditor}
        onOpenChange={(open) => {
          if (!open && !busy) setDescriptionEditor(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Channel description')}</DialogTitle>
          </DialogHeader>
          <p className='text-muted-foreground text-sm break-all'>
            {descriptionEditor?.model}
          </p>
          <label className='space-y-2 text-sm'>
            <span>{t('Channel description')}</span>
            <Textarea
              aria-label={t('Channel description')}
              value={descriptionEditor?.value ?? ''}
              disabled={busy}
              maxLength={255}
              onChange={(event) =>
                setDescriptionEditor(
                  (previous) =>
                    previous && { ...previous, value: event.target.value }
                )
              }
            />
          </label>
          <p className='text-muted-foreground text-xs'>
            {t('Shown to users in the model marketplace.')}{' '}
            {t('{{count}} / 255 bytes', {
              count: new TextEncoder().encode(descriptionEditor?.value ?? '')
                .length,
            })}
          </p>
          {error && (
            <p role='alert' className='text-destructive'>
              {translateUpstreamError(error, t)}
            </p>
          )}
          <Button
            disabled={
              busy ||
              !descriptionEditor ||
              new TextEncoder().encode(descriptionEditor.value).length > 255
            }
            onClick={() =>
              action.mutate(async () => {
                if (!descriptionEditor) return
                await api.saveListingDescription(
                  descriptionEditor.id,
                  descriptionEditor.value.trim()
                )
                setDescriptionEditor(null)
              })
            }
          >
            {t('Save description')}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!priceModel}
        onOpenChange={(open) => {
          if (!open && !busy) setPriceModel(null)
        }}
      >
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('Confirm upstream prices')}</DialogTitle>
          </DialogHeader>
          {priceModel && (
            <ManualPriceEditor
              sourceId={source.id}
              revision={source.revision}
              model={priceModel}
              busy={busy}
              onCancel={() => setPriceModel(null)}
              onSave={(cost) =>
                action.mutate(async () => {
                  await api.saveManualPrice(
                    source.id,
                    source.revision,
                    priceModel,
                    cost
                  )
                  setPriceModel(null)
                  setPreview(null)
                  setSelected({})
                })
              }
            />
          )}
          {error && priceModel && (
            <p role='alert' className='text-destructive'>
              {translateUpstreamError(error, t)}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
