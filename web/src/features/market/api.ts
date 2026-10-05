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

import type {
  MarketData,
  MarketKeysResponse,
  MarketRouteInput,
  MarketRoutesResponse,
} from './types'

// ----------------------------------------------------------------------------
// Market APIs
// ----------------------------------------------------------------------------

/**
 * Raised when the backend answers with `success: false`. The HTTP client
 * interceptor has already shown the message as a toast.
 */
export class MarketBusinessError extends Error {}

/** Shared by the plaza and the key route dialog so both read one cache. */
export const MARKET_MODELS_QUERY_KEY = ['market', 'models'] as const

export function marketModelsQueryKey(tokenId: number | null | undefined) {
  return [...MARKET_MODELS_QUERY_KEY, tokenId ?? null] as const
}

export async function getMarketModels(tokenId?: number): Promise<MarketData> {
  const res = await api.get('/api/market/models', {
    params: tokenId ? { token_id: tokenId } : undefined,
  })
  return res.data
}

export async function getMarketKeys(): Promise<MarketKeysResponse> {
  const res = await api.get('/api/token/?p=1&size=100')
  return res.data
}

export async function createMarketKey(name: string): Promise<void> {
  const res = await api.post('/api/token/', {
    name,
    remain_quota: 0,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    auto_route: true,
  })
  if (!res.data?.success) {
    throw new MarketBusinessError(res.data?.message)
  }
}

export async function joinMarketRoute(
  input: MarketRouteInput
): Promise<MarketRoutesResponse> {
  const res = await api.post(`/api/token/${input.tokenId}/routes`, {
    model: input.model,
    channel_id: input.channelId,
  })
  if (!res.data?.success) {
    throw new MarketBusinessError(res.data?.message)
  }
  return res.data
}

export async function leaveMarketRoute(
  input: MarketRouteInput
): Promise<MarketRoutesResponse> {
  const res = await api.delete(`/api/token/${input.tokenId}/routes`, {
    data: { model: input.model, channel_id: input.channelId },
  })
  if (!res.data?.success) {
    throw new MarketBusinessError(res.data?.message)
  }
  return res.data
}
