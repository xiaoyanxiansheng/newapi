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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type {
  BatchFailure,
  BatchListingPayload,
  UpdateListingPayload,
} from '../types'
import { useListingMutations } from './use-market-admin'

type UseListingActionsOptions = {
  selectedIds: number[]
  onDeleted: (ids: number[]) => void
}

export function useListingActions(options: UseListingActionsOptions) {
  const { t } = useTranslation()
  const mutations = useListingMutations()
  const [pendingDeleteIds, setPendingDeleteIds] = useState<number[]>([])
  const [failures, setFailures] = useState<BatchFailure[] | null>(null)

  const updateOne = async (
    id: number,
    payload: UpdateListingPayload
  ): Promise<boolean> => {
    try {
      const result = await mutations.update.mutateAsync({ id, payload })
      return result.success
    } catch {
      return false
    }
  }

  const runBatch = async (payload: Omit<BatchListingPayload, 'ids'>) => {
    try {
      const result = await mutations.batch.mutateAsync({
        ids: options.selectedIds,
        ...payload,
      })
      if (!result.success) return false
      const failed = result.data?.failed ?? []
      toast.success(
        t('Updated {{count}} listings', { count: result.data?.updated ?? 0 })
      )
      if (failed.length > 0) setFailures(failed)
      return true
    } catch {
      return false
    }
  }

  const confirmDelete = async () => {
    const ids = pendingDeleteIds
    try {
      const result = await mutations.remove.mutateAsync(ids)
      if (!result.success) return
      toast.success(t('Deleted {{count}} listings', { count: ids.length }))
      options.onDeleted(ids)
      setPendingDeleteIds([])
    } catch {
      // Request errors are surfaced by the global error handler.
    }
  }

  return {
    mutations,
    updateOne,
    setRatio: (ratio: number) => runBatch({ ratio }),
    setEnabled: (enabled: boolean) => runBatch({ enabled }),
    pendingDeleteIds,
    requestDelete: setPendingDeleteIds,
    cancelDelete: () => setPendingDeleteIds([]),
    confirmDelete,
    failures,
    closeFailures: () => setFailures(null),
  }
}
