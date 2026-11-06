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
import { ChevronDown, KeyRound, Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { translateUpstreamError } from '../errors'
import type { Source } from '../types'
import { UpstreamMoneyValue } from './upstream-funds'

export function UpstreamKeyCard(props: {
  source: Source
  expanded: boolean
  busy: boolean
  available: boolean
  onExpand: () => void
  onSettings?: () => void
  actions?: ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const key = props.source
  let groupLabel = key.price_group || t('Group unconfirmed')
  if (key.adapter === 'direct-key') {
    groupLabel = t('Manual Key')
  } else if (key.pricing_mode === 'model_routes') {
    groupLabel = t('Per-model route pricing')
  }
  let status = t(props.available ? 'Available' : 'Unavailable')
  if (key.adapter === 'direct-key') {
    if (key.last_error) status = t('Read failed')
    else if (!key.latest_time) status = t('Not read yet')
  }
  if (key.disabled || key.account_disabled) status = t('Channel disabled')
  return (
    <article className='bg-card w-full max-w-full min-w-0 overflow-hidden rounded-2xl border shadow-sm'>
      <div className='flex items-center'>
        <button
          type='button'
          className='hover:bg-primary/5 flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 p-4 text-left transition-colors sm:p-5'
          aria-expanded={props.expanded}
          aria-controls={`key-models-${key.id}`}
          aria-label={t('Models for {{key}}', { key: key.name })}
          disabled={props.busy}
          onClick={props.onExpand}
        >
          <div className='flex min-w-0 items-center gap-3'>
            <span className='bg-primary/10 text-primary rounded-xl p-2.5'>
              <KeyRound className='size-5' aria-hidden='true' />
            </span>
            <div className='min-w-0'>
              <h3 className='font-semibold break-words'>{key.name}</h3>
              <p className='text-muted-foreground mt-1 font-mono text-xs break-all'>
                {key.key_masked}
              </p>
              {key.adapter === 'direct-key' && (
                <p className='text-muted-foreground mt-1 text-xs break-all'>
                  {key.base_url}
                </p>
              )}
            </div>
          </div>
          <div className='flex w-full min-w-0 flex-wrap items-center gap-3 sm:w-auto'>
            {!!key.account_id && (
              <UpstreamMoneyValue
                label='Key spent'
                value={key.key_used_cny}
                readTime={key.key_usage_read_time}
              />
            )}
            <span className='bg-primary/10 text-primary rounded-lg px-3 py-1.5 text-xs font-medium'>
              {groupLabel}
            </span>
            <span
              className={
                key.disabled || key.account_disabled
                  ? 'text-destructive text-xs font-medium'
                  : 'text-muted-foreground text-xs'
              }
            >
              {status}
            </span>
            <ChevronDown
              className={props.expanded ? 'size-4 rotate-180' : 'size-4'}
              aria-hidden='true'
            />
          </div>
        </button>
        {props.onSettings && (
          <Button
            className='mr-4'
            size='icon'
            variant='outline'
            disabled={props.busy}
            aria-label={t('Key settings for {{key}}', { key: key.name })}
            onClick={props.onSettings}
          >
            <Settings2 aria-hidden='true' />
          </Button>
        )}
      </div>
      {props.actions && (
        <div className='border-t px-4 py-3 sm:px-5'>{props.actions}</div>
      )}
      {key.key_issue && (
        <p className='text-destructive px-5 pb-3 text-xs'>
          {translateUpstreamError(key.key_issue, t)}
        </p>
      )}
      {props.expanded && (
        <div className='max-w-full min-w-0' id={`key-models-${key.id}`}>
          {props.children}
        </div>
      )}
    </article>
  )
}
