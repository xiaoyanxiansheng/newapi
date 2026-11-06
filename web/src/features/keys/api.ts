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
  ApiKey,
  ApiResponse,
  GetApiKeysParams,
  GetApiKeysResponse,
  SearchApiKeysParams,
  ApiKeyFormData,
  TokenRoutesData,
} from './types'

// ============================================================================
// API Key Management
// ============================================================================

// Get paginated API keys list
export async function getApiKeys(
  params: GetApiKeysParams = {}
): Promise<GetApiKeysResponse> {
  const { p = 1, size = 10 } = params
  const res = await api.get(`/api/token/?p=${p}&size=${size}`)
  return res.data
}

// Search API keys by keyword or token (with pagination)
export async function searchApiKeys(
  params: SearchApiKeysParams
): Promise<GetApiKeysResponse> {
  const { keyword = '', token = '', p, size } = params
  const queryParams = new URLSearchParams()
  if (keyword) queryParams.set('keyword', keyword)
  if (token) queryParams.set('token', token)
  if (p != null) queryParams.set('p', String(p))
  if (size != null) queryParams.set('size', String(size))
  const res = await api.get(`/api/token/search?${queryParams.toString()}`)
  return res.data
}

// Get single API key by ID
export async function getApiKey(id: number): Promise<ApiResponse<ApiKey>> {
  const res = await api.get(`/api/token/${id}`)
  return res.data
}

// Routes of one key: models with their ordered channel list.
export async function getTokenRoutes(
  id: number
): Promise<ApiResponse<TokenRoutesData>> {
  const res = await api.get(`/api/token/${id}/routes`)
  return res.data
}

export async function removeTokenRoute(
  id: number,
  model: string,
  channelId: number
): Promise<ApiResponse<TokenRoutesData>> {
  const res = await api.delete(`/api/token/${id}/routes`, {
    data: { model, channel_id: channelId },
  })
  return res.data
}

export async function addTokenRouteModel(
  id: number,
  model: string
): Promise<ApiResponse<TokenRoutesData>> {
  const res = await api.post(`/api/token/${id}/routes/models`, { model })
  return res.data
}

export async function removeTokenRouteModel(
  id: number,
  model: string
): Promise<ApiResponse<TokenRoutesData>> {
  const res = await api.delete(`/api/token/${id}/routes/models`, {
    data: { model },
  })
  return res.data
}

export async function reorderTokenRoute(
  id: number,
  model: string,
  channels: number[],
  listingIds?: number[]
): Promise<ApiResponse<TokenRoutesData>> {
  const res = await api.put(`/api/token/${id}/routes/order`, {
    model,
    channels,
    ...(listingIds ? { listing_ids: listingIds } : {}),
  })
  return res.data
}

export async function setTokenAutoRoute(
  id: number,
  autoRoute: boolean
): Promise<ApiResponse<TokenRoutesData>> {
  const res = await api.put(`/api/token/${id}/auto-route`, {
    auto_route: autoRoute,
  })
  return res.data
}

// Create a new API key
export async function createApiKey(
  data: ApiKeyFormData
): Promise<ApiResponse<ApiKey>> {
  const res = await api.post('/api/token/', data)
  return res.data
}

// Update an existing API key
export async function updateApiKey(
  data: ApiKeyFormData & { id: number }
): Promise<ApiResponse<ApiKey>> {
  const res = await api.put('/api/token/', data)
  return res.data
}

// Delete a single API key
export async function deleteApiKey(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/token/${id}/`)
  return res.data
}

// Batch delete multiple API keys
export async function batchDeleteApiKeys(
  ids: number[]
): Promise<ApiResponse<number>> {
  const res = await api.post('/api/token/batch', { ids })
  return res.data
}

// Update API key status (enable/disable)
export async function updateApiKeyStatus(
  id: number,
  status: number
): Promise<ApiResponse<ApiKey>> {
  const res = await api.put('/api/token/?status_only=true', { id, status })
  return res.data
}

// Fetch the real (unmasked) key for a token by ID
export async function fetchTokenKey(
  id: number
): Promise<{ success: boolean; message?: string; data?: { key: string } }> {
  const res = await api.post(`/api/token/${id}/key`)
  return res.data
}

// Batch fetch real (unmasked) keys for multiple tokens
export async function fetchTokenKeysBatch(ids: number[]): Promise<{
  success: boolean
  message?: string
  data?: { keys: Record<number, string> }
}> {
  const res = await api.post('/api/token/batch/keys', { ids })
  return res.data
}
