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
import type { Row } from '@tanstack/react-table'
import { KeyRound, ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { API_KEY_STATUS, API_KEY_STATUSES } from '../constants'
import type { ApiKey } from '../types'
import { ApiKeyTimestampCell } from './api-key-timestamp-cell'
import { ApiKeyCell } from './api-keys-cells'
import { useApiKeys } from './api-keys-provider'
import { DataTableRowActions } from './data-table-row-actions'

export function ApiKeyProjectCard(props: {
  row: Row<ApiKey>
  now: number
  isSelected: boolean
}) {
  const { t, i18n } = useTranslation()
  const { setOpen, setCurrentRow } = useApiKeys()
  const key = props.row.original
  const status = API_KEY_STATUSES[key.status]
  const routes = key.routes ?? []
  const editRoutes = () => {
    setCurrentRow(key)
    setOpen('routes')
  }
  return (
    <article
      className={cn(
        'hwjai-project-card flex h-full min-w-0 flex-col gap-4 rounded-2xl p-4 sm:p-5',
        props.isSelected && 'ring-primary/40 ring-2',
        key.status !== API_KEY_STATUS.ENABLED && 'opacity-70'
      )}
    >
      <div className='flex min-w-0 items-start gap-3'>
        <span className='bg-primary/8 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl'>
          <KeyRound className='size-5' aria-hidden='true' />
        </span>
        <div className='min-w-0 flex-1'>
          <h3 className='truncate text-base font-semibold' title={key.name}>
            {key.name}
          </h3>
          {status && (
            <StatusBadge
              label={t(status.label)}
              variant={status.variant}
              copyable={false}
            />
          )}
        </div>
        <Checkbox
          checked={props.isSelected}
          onCheckedChange={(value) => props.row.toggleSelected(Boolean(value))}
          aria-label={t('Select {{name}}', { name: key.name })}
        />
      </div>
      <div className='bg-muted/40 border-border/40 min-w-0 rounded-lg border px-3 py-1.5'>
        <ApiKeyCell apiKey={key} />
      </div>
      <button
        type='button'
        onClick={editRoutes}
        className='group hover:bg-muted/40 flex min-w-0 flex-1 flex-col gap-2 rounded-xl p-2 text-left transition-colors'
      >
        <span className='flex w-full items-center justify-between gap-2 text-sm font-medium'>
          {t('Models ({{count}})', { count: routes.length })}
          <ArrowUpRight
            className='text-muted-foreground group-hover:text-primary size-4'
            aria-hidden='true'
          />
        </span>
        <span className='flex max-w-full flex-wrap gap-1.5'>
          {routes.slice(0, 3).map((route) => (
            <span
              key={route.model}
              className='bg-muted/60 max-w-full truncate rounded-md px-2 py-1 font-mono text-xs'
            >
              {route.model}
            </span>
          ))}
          {routes.length > 3 && (
            <span className='text-muted-foreground text-xs'>
              +{routes.length - 3}
            </span>
          )}
          {routes.length === 0 && (
            <span className='text-muted-foreground text-xs'>
              {t('Choose models to connect this key.')}
            </span>
          )}
        </span>
        {routes.length > 0 && (
          <span className='text-muted-foreground text-xs'>
            {key.auto_route ? t('Auto route on') : t('Auto route off')}
          </span>
        )}
      </button>
      <dl className='border-border/50 grid grid-cols-2 gap-3 border-t pt-3 text-xs'>
        <div>
          <dt className='text-muted-foreground'>{t('Remaining quota')}</dt>
          <dd className='mt-1 font-medium tabular-nums'>
            {key.unlimited_quota
              ? t('Unlimited')
              : formatQuota(key.remain_quota)}
          </dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>{t('Last Used')}</dt>
          <dd className='mt-1'>
            <ApiKeyTimestampCell
              timestamp={key.accessed_time}
              now={props.now}
              locale={toIntlLocale(i18n.resolvedLanguage || i18n.language)}
              justNowLabel={t('Just now')}
            />
          </dd>
        </div>
      </dl>
      <div className='flex items-center justify-between gap-2'>
        <Button type='button' size='sm' variant='outline' onClick={editRoutes}>
          {t('Configure models')}
        </Button>
        <DataTableRowActions row={props.row} />
      </div>
    </article>
  )
}
