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
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import {
  batchUpdateListings,
  createListing,
  deleteListings,
  generateListings,
  getChannelOptions,
  getListings,
  updateListing,
} from '../api'
import type {
  BatchListingPayload,
  CreateListingPayload,
  ListingFilters,
  UpdateListingPayload,
} from '../types'

export const marketAdminKeys = {
  all: ['market-admin'] as const,
  listings: (filters: ListingFilters) =>
    ['market-admin', 'listings', filters.channelId, filters.keyword] as const,
  channels: ['market-admin', 'channels'] as const,
}

export function useListings(filters: ListingFilters) {
  return useQuery({
    queryKey: marketAdminKeys.listings(filters),
    queryFn: () => getListings(filters),
    placeholderData: keepPreviousData,
  })
}

export function useChannelOptions() {
  return useQuery({
    queryKey: marketAdminKeys.channels,
    queryFn: getChannelOptions,
    staleTime: 60 * 1000,
  })
}

export function useListingMutations() {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['market-admin', 'listings'] })

  const create = useMutation({
    mutationFn: (payload: CreateListingPayload) => createListing(payload),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (input: { id: number; payload: UpdateListingPayload }) =>
      updateListing(input.id, input.payload),
    onSuccess: invalidate,
  })
  const batch = useMutation({
    mutationFn: (payload: BatchListingPayload) => batchUpdateListings(payload),
    onSuccess: invalidate,
  })
  const generate = useMutation({
    mutationFn: (channelId: number) => generateListings(channelId),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (ids: number[]) => deleteListings(ids),
    onSuccess: invalidate,
  })

  return { create, update, batch, generate, remove }
}
