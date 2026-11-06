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
import { api } from '@/lib/api'

import type { BrowserDiscovery } from './lib/browser-discovery'
import { refreshThroughBrowser } from './lib/browser-read'
import type {
  AccountDetail,
  AccountInput,
  UpstreamAccount,
  CatalogDetail,
  Preview,
  Quote,
  Selection,
  Source,
  SourceInput,
  ManualKeyInput,
  ManualPrice,
  Prices,
  RouteQuotes,
} from './types'

const BASE = '/api/market/admin/upstreams'
const ACCOUNTS = '/api/market/admin/upstream-accounts'
const MANUAL = '/api/market/admin/manual-keys'
const options = {
  skipErrorHandler: true,
  skipBusinessError: true,
  timeout: 45000,
}

function result<T>(data: { success: boolean; message?: string; data: T }): T {
  if (!data.success) {
    throw new Error(
      data.message ||
        'Upstream operation failed. Review the account settings and retry.'
    )
  }
  return data.data
}
export async function getSources(): Promise<Source[]> {
  return result((await api.get(BASE, options)).data)
}
export async function getManualKeys(): Promise<Source[]> {
  return result((await api.get(MANUAL, options)).data)
}
export async function saveManualKey(
  input: ManualKeyInput,
  id?: number
): Promise<{ id: number }> {
  if (id) return result((await api.put(`${MANUAL}/${id}`, input, options)).data)
  return result((await api.post(MANUAL, input, options)).data)
}
export async function getManualPrice(
  id: number,
  model: string
): Promise<ManualPrice> {
  return result(
    (
      await api.get(`${MANUAL}/${id}/price`, {
        ...options,
        params: { model },
      })
    ).data
  )
}
export async function saveManualPrice(
  id: number,
  revision: number,
  model: string,
  cost: Prices
): Promise<void> {
  result(
    (
      await api.post(
        `${MANUAL}/${id}/price`,
        { revision, model, cost },
        options
      )
    ).data
  )
}
export async function getSource(id: number): Promise<CatalogDetail> {
  return result((await api.get(`${BASE}/${id}`, options)).data)
}
export async function getRouteQuotes(id: number): Promise<RouteQuotes> {
  return result((await api.get(`${BASE}/${id}/route-quotes`, options)).data)
}
export async function saveListingDescription(
  id: number,
  description: string
): Promise<void> {
  result(
    (
      await api.put(
        `/api/market/admin/listings/${id}`,
        { description },
        options
      )
    ).data
  )
}
export async function saveListingPresentation(
  id: number,
  defaultSuccess: boolean
): Promise<void> {
  result(
    (
      await api.put(
        `/api/market/admin/listings/${id}`,
        { default_success: defaultSuccess },
        options
      )
    ).data
  )
}
export async function saveListingProbeEndpoint(
  id: number,
  probeEndpoint: string
): Promise<void> {
  result(
    (
      await api.put(
        `/api/market/admin/listings/${id}`,
        { probe_endpoint: probeEndpoint },
        options
      )
    ).data
  )
}
export async function saveSource(
  input: SourceInput,
  id?: number
): Promise<{ id: number }> {
  if (id) return result((await api.put(`${BASE}/${id}`, input, options)).data)
  return result((await api.post(BASE, input, options)).data)
}
export async function refreshSource(id: number): Promise<void> {
  result((await api.post(`${BASE}/${id}/refresh`, {}, options)).data)
}
export async function importCatalog(
  id: number,
  revision: number,
  models: Quote[]
): Promise<void> {
  result(
    (await api.post(`${BASE}/${id}/import`, { revision, models }, options)).data
  )
}
export async function previewSelection(
  id: number,
  selection: Selection
): Promise<Preview> {
  return result(
    (await api.post(`${BASE}/${id}/preview`, selection, options)).data
  )
}
export async function applySelection(
  id: number,
  selection: Selection
): Promise<void> {
  result((await api.post(`${BASE}/${id}/apply`, selection, options)).data)
}
export async function reviewChanges(
  id: number,
  revision: number,
  models: string[],
  pause = false
): Promise<void> {
  result(
    (
      await api.post(
        `${BASE}/${id}/review`,
        { revision, models, pause },
        options
      )
    ).data
  )
}
export async function getHistory(
  id: number,
  historyId: number
): Promise<Quote[]> {
  return result(
    (await api.get(`${BASE}/${id}/history/${historyId}`, options)).data
  )
}

export async function getAccounts(): Promise<UpstreamAccount[]> {
  return result((await api.get(ACCOUNTS, options)).data)
}
export async function setChannelDisabled(
  kind: 'account' | 'manual',
  id: number,
  revision: number,
  disabled: boolean
): Promise<void> {
  const base = kind === 'account' ? ACCOUNTS : MANUAL
  result(
    (await api.post(`${base}/${id}/state`, { revision, disabled }, options))
      .data
  )
}
export async function deleteChannel(
  kind: 'account' | 'manual',
  id: number,
  revision: number
): Promise<void> {
  const base = kind === 'account' ? ACCOUNTS : MANUAL
  result(
    (await api.delete(`${base}/${id}`, { ...options, data: { revision } })).data
  )
}
export async function getAccount(id: number): Promise<AccountDetail> {
  return result((await api.get(`${ACCOUNTS}/${id}`, options)).data)
}
export async function saveAccount(
  input: AccountInput,
  id?: number
): Promise<{ id: number }> {
  if (id) {
    return result((await api.put(`${ACCOUNTS}/${id}`, input, options)).data)
  }
  return result((await api.post(ACCOUNTS, input, options)).data)
}
export async function refreshAccount(id: number): Promise<void> {
  const detail = await getAccount(id)
  if (detail.account.discovery_mode) {
    await refreshThroughBrowser(id)
    return
  }
  result((await api.post(`${ACCOUNTS}/${id}/refresh`, {}, options)).data)
}
export async function refreshBalance(id: number): Promise<void> {
  await refreshThroughBrowser(id, { moneyOnly: true })
}
export async function manageListing(
  id: number,
  revision: number,
  model: string,
  enabled: boolean,
  remove = false
): Promise<void> {
  result(
    (
      await api.post(
        `${BASE}/${id}/listing-state`,
        { revision, model, enabled, remove },
        options
      )
    ).data
  )
}

export async function connectBrowser(
  id: number,
  revision: number,
  access_token: string,
  user_id: number,
  discovery?: BrowserDiscovery
): Promise<void> {
  result(
    (
      await api.post(
        `${ACCOUNTS}/${id}/browser-authorization`,
        {
          revision,
          access_token,
          user_id,
          ...(discovery ? { discovery } : {}),
        },
        options
      )
    ).data
  )
}
