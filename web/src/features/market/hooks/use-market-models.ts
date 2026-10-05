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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { API_KEY_ROUTES_QUERY_KEY } from '@/features/keys/constants'

import {
  MARKET_MODELS_QUERY_KEY,
  getMarketModels,
  joinMarketRoute,
  leaveMarketRoute,
  marketModelsQueryKey,
} from '../api'
import { reportMarketError } from '../lib/market-helpers'
import type { MarketModel, MarketVendor } from '../types'

const NO_MODELS: MarketModel[] = []
const NO_VENDORS: MarketVendor[] = []

type UseMarketModelsOptions = {
  /** Set to false to skip fetching (e.g. while a dialog is closed) */
  enabled?: boolean
  /** Called after a join / leave succeeded and the caches were refreshed */
  onChanged?: () => void
}

export function useMarketModels(
  tokenId: number | null,
  options?: UseMarketModelsOptions
) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: marketModelsQueryKey(tokenId),
    queryFn: () => getMarketModels(tokenId ?? undefined),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  })

  const refreshModels = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: MARKET_MODELS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: [API_KEY_ROUTES_QUERY_KEY] }),
    ])
    options?.onChanged?.()
  }

  const joinMutation = useMutation({
    mutationFn: joinMarketRoute,
    onSuccess: async () => {
      toast.success(t('Channel joined'))
      await refreshModels()
    },
    onError: reportMarketError,
  })

  const leaveMutation = useMutation({
    mutationFn: leaveMarketRoute,
    onSuccess: async () => {
      toast.success(t('Channel removed from route'))
      await refreshModels()
    },
    onError: reportMarketError,
  })

  return {
    models: query.data?.data ?? NO_MODELS,
    vendors: query.data?.vendors ?? NO_VENDORS,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    join: joinMutation.mutate,
    leave: leaveMutation.mutate,
    isMutating: joinMutation.isPending || leaveMutation.isPending,
  }
}
