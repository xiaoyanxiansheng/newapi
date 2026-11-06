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

import { translateUpstreamError } from '../errors'
import type { BalanceRefreshResults, UpstreamAccount } from '../types'

export function UpstreamMoneyValue(props: {
  label: 'Key spent' | 'Website balance'
  value?: string
  readTime?: number
}) {
  const { t } = useTranslation()
  let displayed = '—'
  const amount = props.value?.match(/^(-?)([0-9]{1,16})(?:\.([0-9]{1,8}))?$/)
  if (amount) {
    const fraction = (amount[3] || '').padEnd(3, '0')
    let cents = BigInt(amount[2]) * 100n + BigInt(fraction.slice(0, 2))
    if (Number(fraction[2]) >= 5) cents += 1n
    const sign = amount[1] && cents > 0n ? '-' : ''
    displayed = `¥${sign}${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
  }
  return (
    <div
      role='group'
      aria-label={t(props.label)}
      className='min-w-0 space-y-1 text-left'
    >
      <span className='text-muted-foreground block text-xs'>
        {t(props.label)}
      </span>
      <strong
        className='text-primary block font-mono text-base break-all'
        title={amount ? `¥${props.value}` : undefined}
      >
        {displayed}
      </strong>
      <span className='text-muted-foreground block text-[11px]'>
        {props.readTime
          ? t('Read at {{time}}', {
              time: new Date(props.readTime * 1000).toLocaleString(),
            })
          : t('Not read yet')}
      </span>
    </div>
  )
}

export function UpstreamAccountBalances(props: {
  accounts: UpstreamAccount[]
  selectedId: number | null
  busy: boolean
  onSelect: (id: number) => void
  refreshResults?: BalanceRefreshResults
}) {
  const { t } = useTranslation()
  return (
    <div
      role='group'
      aria-label={t('Website balances')}
      className='grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3'
    >
      {props.accounts.map((account) => (
        <button
          key={account.id}
          type='button'
          aria-label={t('Website balance for {{name}}', { name: account.name })}
          aria-pressed={account.id === props.selectedId}
          disabled={props.busy}
          onClick={() => props.onSelect(account.id)}
          className='bg-card hover:border-primary/40 aria-pressed:border-primary/50 min-w-0 rounded-xl border p-4 text-left disabled:opacity-60'
        >
          <span className='block font-semibold break-words'>
            {account.name}
          </span>
          <span className='text-muted-foreground mb-3 block text-xs break-all'>
            {account.website}
          </span>
          <UpstreamMoneyValue
            label='Website balance'
            value={account.balance_cny}
            readTime={account.balance_read_time}
          />
          {props.refreshResults?.[account.id]?.status === 'pending' && (
            <span
              role='status'
              className='text-muted-foreground mt-2 block text-xs'
            >
              {t('Refreshing balance...')}
            </span>
          )}
          {props.refreshResults?.[account.id]?.status === 'success' && (
            <span
              role='status'
              className='mt-2 block text-xs text-emerald-700 dark:text-emerald-400'
            >
              {t('Balance refreshed')}
            </span>
          )}
          {props.refreshResults?.[account.id]?.status === 'error' && (
            <span
              role='alert'
              className='text-destructive mt-2 block text-xs break-words'
            >
              {translateUpstreamError(
                props.refreshResults[account.id].error ||
                  'Could not refresh this balance. Reconnect the upstream website and retry.',
                t
              )}
            </span>
          )}
          {account.balance_issue === 'not_found' && (
            <span className='text-muted-foreground mt-2 block text-xs'>
              {t(
                'Balance not detected. Add its page URL in Account settings and authorize that page.'
              )}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
