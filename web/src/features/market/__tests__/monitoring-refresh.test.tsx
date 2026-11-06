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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { marketModelsQueryKey } from '../api'
import { useMarketModels } from '../hooks/use-market-models'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

test('switching from administrator to ordinary user fetches identity-specific model data', async () => {
  const admin = { id: 1, username: 'admin', role: ROLE.ADMIN }
  useAuthStore.getState().auth.setUser(admin)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const channel = {
    listing_id: 13,
    channel_id: 4,
    ratio: 1,
    joined: false,
    position: 0,
  }
  const data = {
    success: true,
    vendors: [],
    data: [{ model_name: 'gpt-test', channels: [channel] }],
  }
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: {
        ...data,
        data: [
          {
            ...data.data[0],
            channels: [
              { ...channel, website_name: 'CCTQ', channel_name: 'cc-asw' },
            ],
          },
        ],
      },
    })
    .mockResolvedValueOnce({ data })
  function Wrapper(props: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
  const hook = renderHook(() => useMarketModels(1), { wrapper: Wrapper })
  try {
    await waitFor(() =>
      expect(hook.result.current.models[0]?.channels[0]?.channel_name).toBe(
        'cc-asw'
      )
    )
    expect(hook.result.current.models[0]?.channels[0]?.website_name).toBe(
      'CCTQ'
    )
    act(() =>
      useAuthStore
        .getState()
        .auth.setUser({ id: 2, username: 'user', role: ROLE.USER })
    )
    await waitFor(() =>
      expect(hook.result.current.models[0]?.channels[0]).toEqual(channel)
    )
  } finally {
    hook.unmount()
    client.clear()
  }
})

test('an open market refreshes monitoring every minute and a closed dialog stops polling', async () => {
  vi.useFakeTimers()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(marketModelsQueryKey(1), {
    success: true,
    data: [],
    vendors: [],
  })
  const request = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [{ model_name: 'newly-listed', channels: [] }],
      vendors: [],
    },
  })
  function Wrapper(props: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
  const hook = renderHook(({ enabled }) => useMarketModels(1, { enabled }), {
    initialProps: { enabled: true },
    wrapper: Wrapper,
  })
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001)
    })
    expect(request).toHaveBeenCalledOnce()
    expect(hook.result.current.models[0]?.model_name).toBe('newly-listed')
    hook.rerender({ enabled: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(request).toHaveBeenCalledOnce()
  } finally {
    hook.unmount()
    client.clear()
  }
})
