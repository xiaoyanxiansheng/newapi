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

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import * as api from '../api'
import { translateUpstreamError } from '../errors'
import {
  authorizationBookmark,
  readAuthorizationMessage,
} from '../lib/browser-authorization'
import { registerBrowserReader } from '../lib/browser-read'
import type { AccountInput, UpstreamAccount } from '../types'
import { AccountEditor } from './account-editor'

export function BrowserConnection(props: {
  account: UpstreamAccount
  open: boolean
  onClose: () => void
  onConnected: () => Promise<void>
  onBalanceRead?: () => Promise<void>
  onDisconnected?: () => void
  onSave: (input: AccountInput) => void
  saving?: boolean
  saveError?: string | null
}) {
  const { t } = useTranslation()
  const [nonce] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const opened = useRef<Window | null>(null)
  const balanceWindowPage = useRef<string>('')
  const pending = useRef(false)
  const discovering = useRef(false)
  const requested = useRef<{
    id: string
    moneyOnly: boolean
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const currentProps = useRef(props)
  currentProps.current = props
  const accountId = props.account.id
  const upstreamOrigin = new URL(props.account.website).origin
  const bookmark = authorizationBookmark(
    upstreamOrigin,
    window.location.origin,
    nonce
  )
  useEffect(
    () =>
      registerBrowserReader(accountId, async (options) => {
        if (!opened.current || opened.current.closed) {
          throw new Error(
            options?.moneyOnly
              ? 'Open the upstream website and click the authorization bookmark to refresh its balance.'
              : 'Open the upstream website and click the authorization bookmark to refresh its Keys.'
          )
        }
        if (requested.current || pending.current || discovering.current) {
          throw new Error(
            'A Key page read is already running. Wait for it to finish.'
          )
        }
        await new Promise<void>((resolve, reject) => {
          const id = crypto.randomUUID()
          const timer = setTimeout(() => {
            requested.current = null
            discovering.current = false
            setBusy(false)
            reject(
              new Error(
                options?.moneyOnly
                  ? 'The balance page did not respond. Open the upstream website and click the authorization bookmark again.'
                  : 'The browser Key page did not respond. Open it again and click the authorization bookmark.'
              )
            )
          }, 120000)
          requested.current = {
            id,
            moneyOnly: options?.moneyOnly === true,
            resolve,
            reject,
            timer,
          }
          opened.current?.postMessage(
            { type: 'hwjai-upstream-read', nonce, request_id: id },
            upstreamOrigin
          )
        })
      }),
    [accountId, nonce, upstreamOrigin]
  )
  useEffect(() => {
    let active = true
    async function receive(event: MessageEvent): Promise<void> {
      if (
        opened.current &&
        event.source === opened.current &&
        event.origin === upstreamOrigin &&
        event.data?.type === 'hwjai-upstream-disconnected' &&
        event.data.nonce === nonce
      ) {
        setError(
          'Browser authorization could not be renewed. Open the upstream website and click the connection bookmark again.'
        )
        currentProps.current.onDisconnected?.()
        setBusy(false)
        discovering.current = false
        if (
          requested.current &&
          event.data.request_id === requested.current.id
        ) {
          clearTimeout(requested.current.timer)
          requested.current.reject(
            new Error(
              typeof event.data.error === 'string'
                ? event.data.error
                : 'The browser Key page could not be read.'
            )
          )
          requested.current = null
        }
        return
      }
      if (
        opened.current &&
        event.source === opened.current &&
        event.origin === upstreamOrigin &&
        event.data?.type === 'hwjai-upstream-request'
      ) {
        opened.current?.postMessage(
          {
            type: 'hwjai-upstream-challenge',
            nonce,
            upstream_origin: upstreamOrigin,
            key_page_url: currentProps.current.account.key_page_url,
            balance_page_url:
              balanceWindowPage.current ||
              currentProps.current.account.balance_page_url,
            money_only:
              requested.current?.moneyOnly === true ||
              !!balanceWindowPage.current,
            recipe: (() => {
              try {
                return JSON.parse(
                  currentProps.current.account.discovery_recipe || 'null'
                )
              } catch {
                return null
              }
            })(),
          },
          upstreamOrigin
        )
        return
      }
      if (
        opened.current &&
        event.source === opened.current &&
        event.origin === upstreamOrigin &&
        event.data?.type === 'hwjai-upstream-progress' &&
        event.data.nonce === nonce
      ) {
        discovering.current = true
        setBusy(true)
        setError(null)
        return
      }
      const payload = readAuthorizationMessage(
        event,
        upstreamOrigin,
        nonce,
        opened.current
      )
      if (!payload || pending.current) return
      if (
        event.data.request_id &&
        event.data.request_id !== requested.current?.id
      ) {
        return
      }
      // Ignore background renewal responses while a balance request is waiting.
      if (
        requested.current?.moneyOnly &&
        event.data.request_id !== requested.current.id
      ) {
        return
      }
      const moneyRequest = requested.current?.moneyOnly === true
      discovering.current = false
      pending.current = true
      setBusy(true)
      setError(null)
      try {
        if (moneyRequest && payload.discovery?.money_only !== true) {
          throw new Error(
            'This authorization reader does not support balance-only refresh. Open the upstream website and use the current authorization bookmark.'
          )
        }
        const current = await api.getAccount(accountId)
        await api.connectBrowser(
          accountId,
          current.account.revision,
          payload.access_token,
          payload.user_id,
          payload.discovery
        )
        if (event.data?.renewal !== true && !payload.discovery?.money_only) {
          if (!payload.discovery) await api.refreshAccount(accountId)
          const updated = await api.getAccount(accountId)
          const results = await Promise.allSettled(
            updated.keys
              .filter(
                (key) =>
                  !key.key_missing &&
                  key.key_status === 1 &&
                  !key.key_issue &&
                  (!key.key_expires_at ||
                    key.key_expires_at < 0 ||
                    key.key_expires_at > Date.now() / 1000) &&
                  (key.latest_time === 0 || !!key.last_error)
              )
              .map((key) => api.refreshSource(key.id))
          )
          const failed = results.find((result) => result.status === 'rejected')
          if (failed?.status === 'rejected') {
            throw failed.reason
          }
        }
        if (active) {
          if (moneyRequest) {
            await currentProps.current.onBalanceRead?.()
          } else {
            await currentProps.current.onConnected()
          }
        }
        if (
          moneyRequest &&
          (!payload.discovery?.balance_cny ||
            payload.discovery.balance_issue === 'not_found')
        ) {
          throw new Error(
            'Balance not detected. Add its page URL in Account settings and authorize that page.'
          )
        }
        if (
          requested.current &&
          event.data.request_id === requested.current.id
        ) {
          clearTimeout(requested.current.timer)
          requested.current.resolve()
          requested.current = null
        }
      } catch (e) {
        if (active) {
          if (event.data?.renewal === true && !moneyRequest) {
            currentProps.current.onDisconnected?.()
          }
          setError(
            e instanceof Error
              ? e.message
              : 'Browser authorization could not be connected. Reopen sign-in and reconnect.'
          )
          if (
            requested.current &&
            event.data.request_id === requested.current.id
          ) {
            clearTimeout(requested.current.timer)
            requested.current.reject(
              e instanceof Error
                ? e
                : new Error('The Key page import could not be saved.')
            )
            requested.current = null
          }
        }
      } finally {
        pending.current = false
        if (active) setBusy(false)
      }
    }
    const listener = (event: MessageEvent): void => {
      void receive(event)
    }
    window.addEventListener('message', listener)
    return () => {
      active = false
      window.removeEventListener('message', listener)
      if (requested.current) {
        clearTimeout(requested.current.timer)
        requested.current.reject(
          new Error('The browser connection was closed.')
        )
        requested.current = null
      }
    }
  }, [upstreamOrigin, nonce, accountId])
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !busy && !props.saving) props.onClose()
      }}
    >
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('Account settings')}</DialogTitle>
        </DialogHeader>
        <AccountEditor
          account={props.account}
          busy={busy || !!props.saving}
          onSave={props.onSave}
          onCancel={props.onClose}
          connection={{
            bookmark,
            onOpen: (page, kind) => {
              setError(null)
              balanceWindowPage.current = kind === 'balance' ? page : ''
              opened.current = window.open(
                page,
                `hwjai-upstream-connect-${nonce}`
              )
              if (!opened.current) {
                setError(
                  'The sign-in window was blocked. Allow popups and open it again.'
                )
              }
            },
          }}
        />
        {(error || props.saveError) && (
          <p role='alert' className='text-destructive text-sm'>
            {translateUpstreamError(error || props.saveError || '', t)}
          </p>
        )}
        {busy && (
          <p role='status'>
            {t('Verifying authorization and reading existing Keys...')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
