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
export type MarketListing = {
  id: number
  channel_id: number
  model_name: string
  ratio: number
  enabled: boolean
  description: string
  sort_order: number
  created_time: number
  updated_time: number
  channel_name: string
  channel_status: number
  channel_has_model: boolean
  has_base_price: boolean
  sellable: boolean
  probe: ListingProbe | null
  stats: ListingStats | null
}

export type ListingProbe = {
  at: number
  ok: boolean
  latency_ms: number
  error?: string
}

export type ListingStats = {
  day: { rate: number | null }
  samples: number
  last_success_at: number
  abnormal: boolean
}

export type ApiResult<T = undefined> = {
  success: boolean
  message?: string
  data?: T
}

export type ListingFilters = {
  channelId: number | null
  keyword: string
}

export type CreateListingPayload = {
  channel_id: number
  model_name: string
  ratio: number
  enabled: boolean
  description: string
  sort_order: number
}

export type UpdateListingPayload = {
  ratio?: number
  enabled?: boolean
  description?: string
  sort_order?: number
}

export type BatchListingPayload = {
  ids: number[]
  ratio?: number
  enabled?: boolean
}

export type BatchFailure = {
  id: number
  model_name?: string
  message: string
}

export type BatchListingResult = {
  updated: number
  failed: BatchFailure[]
}

export type ChannelOption = {
  id: number
  name: string
  status: number
  models: string[]
}
