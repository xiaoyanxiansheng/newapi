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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import type { MarketModel } from '@/features/market/types'

import * as api from '../api'
import { ApiKeyDialog } from '../components/api-key-dialog'
import type { RouteModel } from '../types'

const mutations = vi.hoisted(() => ({ join: vi.fn(), leave: vi.fn() }))
const models: MarketModel[] = [
  {
    model_name: 'claude-opus-5-5',
    model_ratio: 1,
    completion_ratio: 5,
    quota_type: 0,
    min_ratio: 1,
    channels: [46, 47].map((listing_id, index) => ({
      channel_id: 14,
      listing_id,
      ratio: 1,
      joined: true,
      position: index + 1,
    })),
  },
]
vi.mock('@/features/market/hooks/use-market-models', () => ({
  useMarketModels: () => ({
    models,
    isLoading: false,
    isMutating: false,
    ...mutations,
  }),
}))
vi.mock('../components/api-key-settings-form', () => ({
  ApiKeySettingsForm: () => null,
}))

function mount(routes: RouteModel[]) {
  const response = { success: true, data: { auto_route: true, routes } }
  vi.spyOn(api, 'getTokenRoutes').mockResolvedValue(response)
  vi.spyOn(api, 'getApiKey').mockResolvedValue({
    success: true,
    data: { id: 1 },
  } as Awaited<ReturnType<typeof api.getApiKey>>)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ApiKeyDialog open onOpenChange={() => {}} tokenId={1} hideMarketLink />
    </QueryClientProvider>
  )
  return response
}

test('the API key picker offers one public model with all supplier IDs', async () => {
  const response = mount([])
  const add = vi.spyOn(api, 'addTokenRouteModel').mockResolvedValue(response)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Add model' }))
  const options = await screen.findAllByRole('option')
  expect(options).toHaveLength(1)
  expect(within(options[0]).getByText('claude-opus-5-5')).toBeInTheDocument()
  expect(screen.queryByText(/@s[0-9]+c/)).not.toBeInTheDocument()
  await user.click(options[0])
  await waitFor(() => expect(add).toHaveBeenCalledWith(1, 'claude-opus-5-5'))
})

test('supplier IDs on the same channel can be reordered and removed independently', async () => {
  const response = mount([
    {
      model: 'claude-opus-5-5',
      channels: [46, 47].map((listing_id) => ({
        channel_id: 14,
        listing_id,
        ratio: 1,
        description: '',
        available: true,
      })),
    },
  ])
  const reorder = vi.spyOn(api, 'reorderTokenRoute').mockResolvedValue(response)
  const user = userEvent.setup()
  expect(await screen.findByText(/ID00046/)).toBeInTheDocument()
  expect(screen.getByText(/ID00047/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Toggle options' }))
  const up = screen.getAllByRole('button', { name: 'Move up' })
  expect(up[0]).toBeDisabled()
  expect(up[1]).toBeEnabled()
  await user.click(up[1])
  await waitFor(() =>
    expect(reorder).toHaveBeenCalledWith(
      1,
      'claude-opus-5-5',
      [14, 14],
      [47, 46]
    )
  )
  await user.click(screen.getAllByRole('button', { name: 'Leave route' })[0])
  expect(mutations.leave).toHaveBeenCalledWith({
    tokenId: 1,
    model: 'claude-opus-5-5',
    channelId: 14,
    listingId: 46,
  })
})
