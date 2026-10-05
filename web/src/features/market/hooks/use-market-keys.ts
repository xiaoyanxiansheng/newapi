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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { API_KEY_STATUS } from '@/features/keys/constants'

import { createMarketKey, getMarketKeys } from '../api'
import { reportMarketError } from '../lib/market-helpers'
import type { MarketKey } from '../types'

const STORAGE_KEY = 'market_selected_token_id'
const KEYS_QUERY_KEY = ['market', 'keys'] as const

function readStoredTokenId(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? Number(raw) : Number.NaN
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * @param presetKeyId key to preselect (e.g. from the `key` search param); it
 * is ignored unless it belongs to one of the user's enabled keys.
 */
export function useMarketKeys(presetKeyId?: number) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [storedId, setStoredId] = useState<number | null>(readStoredTokenId)

  const keysQuery = useQuery({
    queryKey: KEYS_QUERY_KEY,
    queryFn: getMarketKeys,
  })

  const keys = useMemo<MarketKey[]>(() => {
    const items = keysQuery.data?.data?.items ?? []
    return items.filter((item) => item.status === API_KEY_STATUS.ENABLED)
  }, [keysQuery.data])

  const selectedKey = useMemo<MarketKey | null>(() => {
    const matched = keys.find((item) => item.id === storedId)
    return matched ?? keys[0] ?? null
  }, [keys, storedId])

  const selectKey = useCallback((id: number) => {
    setStoredId(id)
    try {
      localStorage.setItem(STORAGE_KEY, String(id))
    } catch {
      // Storage may be unavailable; the selection still works in memory.
    }
  }, [])

  const appliedPresetRef = useRef<number | null>(null)
  useEffect(() => {
    if (presetKeyId === undefined || appliedPresetRef.current === presetKeyId) {
      return
    }
    if (!keys.some((item) => item.id === presetKeyId)) return
    appliedPresetRef.current = presetKeyId
    selectKey(presetKeyId)
  }, [presetKeyId, keys, selectKey])

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      await createMarketKey(name)
      const latest = await getMarketKeys()
      const items = latest.data?.items ?? []
      queryClient.setQueryData(KEYS_QUERY_KEY, latest)
      return items.reduce<MarketKey | null>(
        (newest, item) => (!newest || item.id > newest.id ? item : newest),
        null
      )
    },
    onSuccess: (newest) => {
      toast.success(t('API key created'))
      if (newest) selectKey(newest.id)
    },
    onError: reportMarketError,
  })

  return {
    keys,
    selectedKey,
    selectKey,
    isLoading: keysQuery.isLoading,
    createKey: createMutation.mutate,
    isCreating: createMutation.isPending,
  }
}
