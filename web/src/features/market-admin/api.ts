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
import { getChannels } from '@/features/channels/api'
import { api } from '@/lib/api'

import type {
  ApiResult,
  BatchListingPayload,
  BatchListingResult,
  ChannelOption,
  CreateListingPayload,
  ListingFilters,
  ListingProbe,
  MarketListing,
  UpdateListingPayload,
} from './types'

const BASE = '/api/market/admin/listings'

export async function getListings(
  filters: ListingFilters
): Promise<ApiResult<MarketListing[]>> {
  const params: Record<string, string | number> = {}
  if (filters.channelId !== null) params.channel_id = filters.channelId
  if (filters.keyword) params.keyword = filters.keyword
  const res = await api.get(BASE, { params })
  return res.data
}

export async function createListing(
  payload: CreateListingPayload
): Promise<ApiResult<MarketListing>> {
  const res = await api.post(BASE, payload)
  return res.data
}

export async function updateListing(
  id: number,
  payload: UpdateListingPayload
): Promise<ApiResult<MarketListing>> {
  const res = await api.put(`${BASE}/${id}`, payload)
  return res.data
}

export async function batchUpdateListings(
  payload: BatchListingPayload
): Promise<ApiResult<BatchListingResult>> {
  const res = await api.put(`${BASE}/batch`, payload)
  return res.data
}

export async function generateListings(
  channelId: number
): Promise<ApiResult<{ created: number }>> {
  const res = await api.post(`${BASE}/generate`, { channel_id: channelId })
  return res.data
}

export async function deleteListings(ids: number[]): Promise<ApiResult> {
  const res = await api.post(`${BASE}/delete`, { ids })
  return res.data
}

export async function probeListing(
  id: number
): Promise<ApiResult<ListingProbe>> {
  const res = await api.post(`${BASE}/${id}/probe`)
  return res.data
}

export async function getChannelOptions(): Promise<ChannelOption[]> {
  const res = await getChannels({ p: 1, page_size: 1000, id_sort: true })
  const items = res.data?.items ?? []
  return items.map((channel) => ({
    id: channel.id,
    name: channel.name,
    status: channel.status,
    models: channel.models
      ? channel.models
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean)
      : [],
  }))
}
