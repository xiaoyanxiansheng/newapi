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
import { useEffect, useRef, useState } from 'react'
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
import {
  helperAccount,
  requestBrowserHelper,
  saveHelperDiscovery,
} from '../lib/browser-helper'
import { registerBrowserReader } from '../lib/browser-read'
import type { UpstreamAccount } from '../types'

export function BatchBrowserConnection(props: {
  accounts: UpstreamAccount[]
  disabled: boolean
  onRefreshed: (moneyOnly?: boolean) => Promise<void>
  onPendingChange: (pending: boolean) => void
}) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [install, setInstall] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{
    key: string
    count?: number
  } | null>(null)
  const [results, setResults] = useState<Array<{ id: number; error?: string }>>(
    []
  )
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  const current = useRef(props)
  current.current = props
  useEffect(() => {
    const abort = new AbortController()
    void requestBrowserHelper('ping', [], false, abort.signal)
      .then((reply) => {
        if (!abort.signal.aborted) {
          setReady(reply.ready === true && reply.version === 1)
        }
      })
      .catch(() => {})
    return () => abort.abort()
  }, [])
  useEffect(() => {
    if (!ready) return
    const cleanup = props.accounts.map((account) =>
      registerBrowserReader(
        account.id,
        async (options) => {
          const latest = await api.getAccount(account.id)
          const reply = await requestBrowserHelper(
            'read',
            [helperAccount(latest.account)],
            options?.moneyOnly === true
          )
          const result = reply.results?.find((item) => item.id === account.id)
          if (!result?.discovery) {
            throw new Error(
              result?.error ||
                'The upstream page could not be read. Complete its login and retry authorization.'
            )
          }
          await saveHelperDiscovery(
            account.id,
            result.discovery,
            options?.moneyOnly === true
          )
          await current.current.onRefreshed(options?.moneyOnly === true)
        },
        true
      )
    )
    return () => cleanup.forEach((dispose) => dispose())
  }, [ready, props.accounts])
  async function run(operation: 'open' | 'read'): Promise<void> {
    if (running.current || props.disabled) return
    running.current = true
    setPending(true)
    props.onPendingChange(true)
    setError(null)
    setMessage(null)
    setResults([])
    try {
      const available =
        ready || (await requestBrowserHelper('ping')).ready === true
      if (!available) {
        setInstall(true)
        return
      }
      setReady(true)
      const accounts = props.accounts.filter((account) => !account.disabled)
      if (!accounts.length) return
      if (operation === 'read') {
        setMessage({
          key: 'Reading authorized websites. Allow website access in the extension window if requested.',
        })
      }
      const reply = await requestBrowserHelper(
        operation,
        accounts.map(helperAccount)
      )
      if (operation === 'open') {
        setResults(reply.results ?? [])
        setMessage({
          key: '{{count}} websites opened. Complete any required login, then authorize all websites.',
          count: reply.opened?.length || 0,
        })
        return
      }
      const completed: Array<{ id: number; error?: string }> = []
      for (const account of accounts) {
        const result = reply.results?.find((item) => item.id === account.id)
        try {
          if (!result?.discovery) {
            throw new Error(
              result?.error ||
                'The upstream page could not be read. Complete its login and retry authorization.'
            )
          }
          await saveHelperDiscovery(account.id, result.discovery)
          completed.push({ id: account.id })
        } catch (error) {
          completed.push({
            id: account.id,
            error:
              error instanceof Error
                ? error.message
                : 'The upstream page could not be read. Complete its login and retry authorization.',
          })
        }
        setResults([...completed])
      }
      await props.onRefreshed()
      setMessage({
        key: 'Website authorization finished. See each website result below.',
      })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Browser helper is not installed.'
      ) {
        setInstall(true)
      } else {
        setError(
          error instanceof Error
            ? error.message
            : 'The browser helper did not respond. Return to hwjai and retry authorization.'
        )
      }
    } finally {
      running.current = false
      setPending(false)
      props.onPendingChange(false)
    }
  }
  const disabled =
    props.disabled ||
    pending ||
    !props.accounts.some((account) => !account.disabled)
  return (
    <>
      <div className='max-w-lg min-w-0 space-y-2'>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            disabled={disabled}
            aria-busy={pending}
            onClick={() => void run('open')}
          >
            {t('Connect all websites')}
          </Button>
          <Button
            variant='outline'
            disabled={disabled}
            aria-busy={pending}
            onClick={() => void run('read')}
          >
            {t('Authorize all websites')}
          </Button>
        </div>
        <p className='text-muted-foreground text-xs'>
          {t(
            ready
              ? 'Browser helper connected'
              : 'Install the browser helper once to connect and authorize websites together.'
          )}
        </p>
        {message && (
          <p role='status' className='text-primary text-xs break-words'>
            {t(message.key, { count: message.count })}
          </p>
        )}
        {error && (
          <p role='alert' className='text-destructive text-xs break-words'>
            {translateUpstreamError(error, t)}
          </p>
        )}
        {results.length > 0 && (
          <ul className='space-y-1 text-xs'>
            {results.map((result) => (
              <li key={result.id} className='break-words'>
                <strong>
                  {
                    props.accounts.find((account) => account.id === result.id)
                      ?.name
                  }
                  :{' '}
                </strong>
                {result.error ? (
                  <span role='alert' className='text-destructive'>
                    {translateUpstreamError(result.error, t)}
                  </span>
                ) : (
                  <span className='text-emerald-700 dark:text-emerald-400'>
                    {t('Website authorized and read')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={install} onOpenChange={setInstall}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Install browser helper')}</DialogTitle>
          </DialogHeader>
          <p className='text-sm'>
            {t(
              'Install once in the browser where you log in to upstream websites. Existing logins are reused; expired logins and verification still need you.'
            )}
          </p>
          <a
            className='text-primary font-semibold underline'
            href='/downloads/hwjai-upstream-helper-1.0.3.zip'
            download
          >
            {t('Download browser helper')}
          </a>
          <ol className='list-decimal space-y-2 pl-5 text-sm'>
            <li>
              {t('Download and extract the ZIP into a folder you will keep.')}
            </li>
            <li>
              {t('Open the browser extensions page:')}{' '}
              <code>chrome://extensions</code> / <code>edge://extensions</code>
            </li>
            <li>
              {t(
                'Enable Developer mode, choose Load unpacked, and select the extracted folder.'
              )}
            </li>
            <li>
              {t(
                'Reload this page, connect all websites, then authorize all websites.'
              )}
            </li>
          </ol>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Only selected website origins are authorized. The helper reads existing Keys and balances; login cookies stay in your browser.'
            )}
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
