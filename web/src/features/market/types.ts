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
import type { PricingModel, PricingVendor } from '@/features/pricing/types'

// ----------------------------------------------------------------------------
// Market Types
// ----------------------------------------------------------------------------

export type MarketRegion = 'intl' | 'cn' | ''

export type MarketVendor = PricingVendor & {
  /** '' (or missing) means the vendor is not assigned to a region */
  region?: MarketRegion
}

/** One bucket of the success-rate stripes. */
export type MarketBlock = {
  ok: number
  fail: number
}

export type MarketStatsWindow = {
  blocks: MarketBlock[]
  /** 0..1, null when there are no samples in the window */
  rate: number | null
}

export type MarketStats = {
  /** 12 blocks of 10 minutes, oldest first */
  realtime: MarketStatsWindow
  /** 12 blocks of 2 hours, oldest first */
  day: MarketStatsWindow
  /** 14 blocks of 12 hours, oldest first */
  week: MarketStatsWindow
  /** Unix seconds, 0 = never */
  last_success_at: number
  /** Requests in the last 7 days */
  samples: number
}

/** Every value is an integer in 0..100; null means not enough data. */
export type MarketScore = {
  price: number
  stability: number | null
  speed: number | null
  cache: number
  total: number | null
}

export type MarketChannel = {
  channel_id: number
  listing_id: number
  ratio: number
  description?: string
  joined: boolean
  /** 1-based order inside the key's route for the model, 0 when not joined */
  position: number
  /** Recent probe / user failures */
  abnormal?: boolean
  stats?: MarketStats | null
  score?: MarketScore | null
}

export type MarketModel = Omit<PricingModel, 'id' | 'enable_groups'> & {
  id?: number
  enable_groups?: string[]
  min_ratio: number
  /** Sorted by ratio asc, then channel id; the first one is the cheapest */
  channels: MarketChannel[]
}

export type MarketData = {
  success: boolean
  message?: string
  data: MarketModel[]
  vendors: MarketVendor[]
  supported_endpoint?: Record<string, unknown>
}

export type MarketActions = {
  tokenId: number | null
  busy: boolean
  onJoin: (model: string, channelId: number) => void
  onLeave: (model: string, channelId: number) => void
  /** Only provided where reordering makes sense (the key route dialog) */
  onMove?: (model: string, channelId: number, delta: -1 | 1) => void
}

export type MarketKey = {
  id: number
  name: string
  status: number
}

export type MarketKeysResponse = {
  success: boolean
  message?: string
  data?: {
    items: MarketKey[]
    total: number
  }
}

export type MarketRouteChannel = {
  channel_id: number
  ratio: number
  description?: string
  available?: boolean
}

export type MarketRoutesResponse = {
  success: boolean
  message?: string
  data?: {
    auto_route: boolean
    routes: { model: string; channels: MarketRouteChannel[] }[]
  }
}

export type MarketRouteInput = {
  tokenId: number
  model: string
  channelId: number
}
