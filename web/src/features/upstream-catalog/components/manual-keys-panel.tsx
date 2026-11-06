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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import * as api from '../api'
import { translateUpstreamError } from '../errors'
import type { CatalogFilters, Source } from '../types'
import { KeyModelPanel } from './key-model-panel'
import { ManualKeyEditor } from './manual-key-editor'
import { UpstreamKeyCard } from './upstream-key-card'
import { UpstreamLifecycleActions } from './upstream-lifecycle-actions'

export function ManualKeysPanel({ filters }: { filters: CatalogFilters }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const keys = useQuery({
    queryKey: ['upstream-manual-keys'],
    queryFn: api.getManualKeys,
    retry: false,
  })
  const [openKey, setOpenKey] = useState<number | null>(null)
  const [editor, setEditor] = useState<Source | null>(null)
  const action = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['upstream-manual-keys'] }),
        client.invalidateQueries({ queryKey: ['upstream-source'] }),
      ])
    },
  })
  const error = action.error instanceof Error ? action.error.message : null
  if (keys.isPending) return <p role='status'>{t('Loading...')}</p>
  if (keys.isError) {
    return (
      <div role='alert'>
        <p>
          {t(
            'Could not load manually entered Keys. Retry to load the saved Keys.'
          )}
        </p>
        <Button onClick={() => keys.refetch()}>{t('Retry')}</Button>
      </div>
    )
  }
  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Expand a Key to read its available models. Confirm upstream prices before reviewing and publishing your selling prices.'
        )}
      </p>
      {error && !editor && openKey === null && (
        <p
          role='alert'
          className='text-destructive bg-destructive/5 rounded-xl p-3'
        >
          {translateUpstreamError(error, t)}
        </p>
      )}
      {keys.data?.length === 0 && (
        <p className='text-muted-foreground rounded-xl border p-6'>
          {t('Add an API address and an existing Key to get started.')}
        </p>
      )}
      {keys.data?.map((key) => (
        <UpstreamKeyCard
          key={key.id}
          source={key}
          expanded={openKey === key.id}
          busy={action.isPending}
          available={!key.disabled && key.key_status === 1 && !key.key_missing}
          actions={
            <UpstreamLifecycleActions
              kind='manual'
              channel={key}
              busy={action.isPending}
              onDeleted={() => setOpenKey(null)}
            />
          }
          onSettings={() => {
            action.reset()
            setEditor(key)
          }}
          onExpand={() => {
            if (openKey === key.id) {
              setOpenKey(null)
              return
            }
            if (key.disabled) {
              setOpenKey(key.id)
              return
            }
            action.mutate(async () => {
              setOpenKey(key.id)
              await api.refreshSource(key.id)
            })
          }}
        >
          <KeyModelPanel
            sourceId={key.id}
            filters={filters}
            refreshing={action.isPending}
            refreshError={editor ? null : error}
          />
        </UpstreamKeyCard>
      ))}
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !action.isPending) setEditor(null)
        }}
      >
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('Key settings')}</DialogTitle>
          </DialogHeader>
          {editor && (
            <ManualKeyEditor
              source={editor}
              busy={action.isPending}
              onCancel={() => setEditor(null)}
              onSave={(input) =>
                action.mutate(async () => {
                  await api.saveManualKey(input, editor.id)
                  setEditor(null)
                })
              }
            />
          )}
          {error && editor && (
            <p role='alert' className='text-destructive'>
              {translateUpstreamError(error, t)}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
