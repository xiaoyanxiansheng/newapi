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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Power, PowerOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { API_KEY_ROUTES_QUERY_KEY } from '@/features/keys/constants'
import { MARKET_MODELS_QUERY_KEY } from '@/features/market/api'

import * as api from '../api'
import { translateUpstreamError } from '../errors'
import type { Source, UpstreamAccount } from '../types'

export function UpstreamLifecycleActions(props: {
  kind: 'account' | 'manual'
  channel: Pick<Source, 'id' | 'name' | 'revision' | 'disabled'>
  busy?: boolean
  onDeleted?: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const action = useMutation({
    mutationFn: async (remove: boolean) => {
      if (remove) {
        await api.deleteChannel(
          props.kind,
          props.channel.id,
          props.channel.revision
        )
      } else {
        await api.setChannelDisabled(
          props.kind,
          props.channel.id,
          props.channel.revision,
          !props.channel.disabled
        )
      }
      if (remove) {
        if (props.kind === 'account') {
          client.setQueryData<UpstreamAccount[]>(
            ['upstream-accounts'],
            (previous) =>
              previous?.filter((item) => item.id !== props.channel.id)
          )
        } else {
          client.setQueryData<Source[]>(['upstream-manual-keys'], (previous) =>
            previous?.filter((item) => item.id !== props.channel.id)
          )
        }
        setDeleting(false)
        props.onDeleted?.()
      }
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['upstream-accounts'] }),
        client.invalidateQueries({ queryKey: ['upstream-account'] }),
        client.invalidateQueries({ queryKey: ['upstream-source'] }),
        client.invalidateQueries({ queryKey: ['upstream-manual-keys'] }),
        client.invalidateQueries({ queryKey: MARKET_MODELS_QUERY_KEY }),
        client.invalidateQueries({ queryKey: [API_KEY_ROUTES_QUERY_KEY] }),
      ])
    },
  })
  const busy = !!props.busy || action.isPending
  const error = action.error instanceof Error ? action.error.message : null
  const StateIcon = props.channel.disabled ? Power : PowerOff
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-2'>
      <Button
        variant='outline'
        size='sm'
        disabled={busy}
        aria-label={t(
          props.channel.disabled
            ? 'Enable channel {{name}}'
            : 'Disable channel {{name}}',
          { name: props.channel.name }
        )}
        onClick={() => action.mutate(false)}
      >
        <StateIcon aria-hidden='true' />
        {t(props.channel.disabled ? 'Enable channel' : 'Disable channel')}
      </Button>
      <Button
        variant='ghost'
        size='sm'
        className='text-destructive'
        disabled={busy}
        aria-label={t('Delete channel {{name}}', { name: props.channel.name })}
        onClick={() => {
          action.reset()
          setDeleting(true)
        }}
      >
        <Trash2 aria-hidden='true' />
        {t('Delete channel')}
      </Button>
      {error && !deleting && (
        <p role='alert' className='text-destructive w-full text-sm'>
          {translateUpstreamError(error, t)}
        </p>
      )}
      <ConfirmDialog
        className='max-h-[85vh] overflow-y-auto break-words'
        open={deleting}
        onOpenChange={(open) => {
          if (!busy) setDeleting(open)
        }}
        title={t('Delete upstream channel?')}
        desc={t(
          'Delete {{name}} and all its local bound Keys, models, listings and saved credentials? This cannot be undone. Keys on the upstream website are unchanged.',
          { name: props.channel.name }
        )}
        confirmText={t('Confirm deletion')}
        destructive
        isLoading={busy}
        handleConfirm={() => action.mutate(true)}
      >
        {error && (
          <p role='alert' className='text-destructive text-sm'>
            {translateUpstreamError(error, t)}
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}
