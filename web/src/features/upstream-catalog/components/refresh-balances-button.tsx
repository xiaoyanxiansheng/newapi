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
import { RefreshCw } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { refreshBalance } from '../api'
import { translateUpstreamError } from '../errors'
import type { BalanceRefreshResults, UpstreamAccount } from '../types'

export function RefreshBalancesButton(props: {
  accounts: UpstreamAccount[]
  disabled: boolean
  onResults: (results: BalanceRefreshResults) => void
  onRefreshed: () => Promise<void>
  onPendingChange?: (pending: boolean) => void
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)

  async function refresh(): Promise<void> {
    if (running.current || props.disabled || props.accounts.length === 0) return
    running.current = true
    setPending(true)
    setError(null)
    props.onPendingChange?.(true)
    const results: BalanceRefreshResults = Object.fromEntries(
      props.accounts.map((account) => [account.id, { status: 'pending' }])
    )
    props.onResults({ ...results })
    try {
      await Promise.all(
        props.accounts.map(async (account) => {
          try {
            await refreshBalance(account.id)
            results[account.id] = { status: 'success' }
          } catch (error) {
            results[account.id] = {
              status: 'error',
              error:
                error instanceof Error
                  ? error.message
                  : 'Could not refresh this balance. Reconnect the upstream website and retry.',
            }
          }
          props.onResults({ ...results })
        })
      )
      await props.onRefreshed()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not reload website balances. Retry to display the latest amounts.'
      )
    } finally {
      running.current = false
      setPending(false)
      props.onPendingChange?.(false)
    }
  }

  return (
    <div className='min-w-0'>
      <Button
        variant='outline'
        disabled={pending || props.disabled || props.accounts.length === 0}
        aria-busy={pending}
        onClick={() => void refresh()}
      >
        <RefreshCw
          aria-hidden='true'
          className={pending ? 'animate-spin' : ''}
        />
        {t('Refresh all balances')}
      </Button>
      {error && (
        <p
          role='alert'
          className='text-destructive mt-2 max-w-sm text-xs break-words'
        >
          {translateUpstreamError(error, t)}
        </p>
      )}
    </div>
  )
}
