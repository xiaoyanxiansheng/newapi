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
import * as api from '../api'
import type { UpstreamAccount } from '../types'
import type { BrowserDiscovery } from './browser-discovery'
import type {
  HelperAccount,
  HelperReply,
  HelperRequest,
} from './browser-helper-protocol'

let reading: Promise<unknown> = Promise.resolve()
export function requestBrowserHelper(
  operation: HelperRequest['operation'],
  accounts: HelperAccount[] = [],
  moneyOnly = false,
  signal?: AbortSignal
): Promise<HelperReply> {
  if (operation !== 'read') {
    return sendHelperRequest(operation, accounts, moneyOnly, signal)
  }
  const request = reading.then(() =>
    sendHelperRequest(operation, accounts, moneyOnly, signal)
  )
  reading = request.catch(() => {})
  return request
}
function sendHelperRequest(
  operation: HelperRequest['operation'],
  accounts: HelperAccount[],
  moneyOnly: boolean,
  signal?: AbortSignal
): Promise<HelperReply> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            operation === 'ping'
              ? 'Browser helper is not installed.'
              : 'The browser helper did not respond. Return to hwjai and retry authorization.'
          )
        ),
      operation === 'ping' ? 1500 : 240000
    )
    function finish(error?: Error, result?: HelperReply): void {
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      signal?.removeEventListener('abort', aborted)
      if (error) reject(error)
      else resolve(result ?? {})
    }
    function aborted(): void {
      finish(new Error('The browser helper request was cancelled.'))
    }
    function receive(event: MessageEvent): void {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.type !== 'hwjai-helper-response' ||
        event.data.request_id !== id
      ) {
        return
      }
      if (event.data.error) {
        finish(new Error(String(event.data.error)))
        return
      }
      if (event.data.result?.pending) return
      finish(undefined, event.data.result)
    }
    window.addEventListener('message', receive)
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) {
      aborted()
      return
    }
    window.postMessage(
      {
        type: 'hwjai-helper-request',
        operation,
        request_id: id,
        accounts,
        money_only: moneyOnly,
      },
      location.origin
    )
  })
}
export function helperAccount(account: UpstreamAccount): HelperAccount {
  let recipe
  try {
    recipe = JSON.parse(account.discovery_recipe || 'null') ?? undefined
  } catch {
    recipe = undefined
  }
  return {
    id: account.id,
    name: account.name,
    url: account.key_page_url || new URL('/keys', account.website).href,
    balance_page_url: account.balance_page_url,
    recipe,
  }
}
export async function saveHelperDiscovery(
  accountId: number,
  discovery: BrowserDiscovery,
  moneyOnly = false
): Promise<void> {
  const current = await api.getAccount(accountId)
  const origin = new URL(current.account.website).origin
  if (
    new URL(discovery.page_url).origin !== origin ||
    !Array.isArray(discovery.keys) ||
    discovery.keys.length > 10000 ||
    !['newapi', 'api', 'page'].includes(discovery.connector?.kind) ||
    JSON.stringify(discovery).length > 8 * 1024 * 1024
  ) {
    throw new Error('Invalid website reading result.')
  }
  if (moneyOnly && discovery.money_only !== true) {
    throw new Error('The helper did not return a balance-only reading.')
  }
  if (!moneyOnly && discovery.money_only) {
    throw new Error('The helper did not return a Key reading.')
  }
  await api.connectBrowser(
    accountId,
    current.account.revision,
    '',
    discovery.identity?.id || 0,
    discovery
  )
  if (moneyOnly) {
    if (
      discovery.balance_cny === undefined ||
      discovery.balance_issue === 'not_found'
    ) {
      throw new Error(
        'Balance not detected. Add its page URL in Account settings and authorize that page.'
      )
    }
    return
  }
  const updated = await api.getAccount(accountId)
  for (const key of updated.keys) {
    if (
      !key.key_missing &&
      key.key_status === 1 &&
      !key.key_issue &&
      (!key.key_expires_at ||
        key.key_expires_at < 0 ||
        key.key_expires_at > Date.now() / 1000) &&
      (key.latest_time === 0 || !!key.last_error)
    ) {
      await api.refreshSource(key.id)
    }
  }
}
