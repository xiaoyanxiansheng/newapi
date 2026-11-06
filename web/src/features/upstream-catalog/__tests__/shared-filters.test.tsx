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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { UpstreamCatalog } from '..'
import type { CatalogRow, Source, UpstreamAccount } from '../types'

const accounts: UpstreamAccount[] = [1, 2].map((id) => ({
  id,
  name: `Website ${id}`,
  website: `https://site${id}.example`,
  username: 'owner',
  markup: '1.1',
  revision: 1,
  last_sync: 1000,
  last_error: '',
  workflow: 'existing-keys',
}))
const sources: Source[] = [11, 12, 21, 31].map((id) => ({
  id,
  account_id: id === 31 ? undefined : Math.floor(id / 10),
  name: `Key ${id}`,
  base_url: 'https://api.example',
  catalog_url: '',
  adapter: id === 31 ? 'direct-key' : 'account',
  price_group: 'default',
  purchase_multiplier: '1',
  markup: '1.1',
  channel_id: id,
  revision: 1,
  latest_time: 1000,
  last_error: '',
  has_catalog_key: false,
  has_relay_key: true,
  key_status: 1,
  key_missing: false,
}))
const rows: CatalogRow[] = [
  {
    model: 'paused-changed',
    change: 'changed',
    listing: { id: 1, ratio: 1, enabled: false },
    markup_override: '',
    reviewed: null,
    latest: null,
  },
  {
    model: 'paused-unchanged',
    change: 'unchanged',
    listing: { id: 2, ratio: 1, enabled: false },
    markup_override: '',
    reviewed: null,
    latest: null,
  },
  {
    model: 'listed-changed',
    change: 'changed',
    listing: { id: 3, ratio: 1, enabled: true },
    markup_override: '',
    reviewed: null,
    latest: null,
  },
]
let client: QueryClient
afterEach(() => {
  client?.clear()
  vi.restoreAllMocks()
})
function mount(catalogRows = rows) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/market/admin/upstream-accounts') {
      return { data: { success: true, data: accounts } }
    }
    if (url === '/api/market/admin/manual-keys') {
      return { data: { success: true, data: [sources[3]] } }
    }
    const account = accounts.find(
      (item) => url === `/api/market/admin/upstream-accounts/${item.id}`
    )
    if (account) {
      return {
        data: {
          success: true,
          data: {
            account,
            keys: sources.filter((source) => source.account_id === account.id),
          },
        },
      }
    }
    const source = sources.find(
      (item) => url === `/api/market/admin/upstreams/${item.id}`
    )
    if (source) {
      return {
        data: {
          success: true,
          data: { source, rows: catalogRows, history: [] },
        },
      }
    }
    throw new Error(`Unexpected endpoint: ${url}`)
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UpstreamCatalog />
    </QueryClientProvider>
  )
}

test('listing and change filters remain outside Key cards and apply when switching Keys, websites and source tabs', async () => {
  mount()
  const user = userEvent.setup()
  await screen.findByRole(
    'button',
    { name: 'Models for Key 11' },
    { timeout: 5000 }
  )
  // Both controls must be available before any Key is opened.
  const listingStatus = screen.getByRole('combobox', { name: 'Listing status' })
  const onlyChanges = screen.getByRole('checkbox', { name: 'Only changes' })
  await user.selectOptions(listingStatus, 'paused')
  await user.click(onlyChanges)
  for (const id of [11, 12, 21, 31, 11]) {
    if (id === 21) {
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Upstream account' }),
        '2'
      )
    } else if (id === 31) {
      await user.click(screen.getByRole('tab', { name: 'Manual Keys' }))
    } else if (
      id === 11 &&
      screen
        .getByRole('tab', { name: 'Manual Keys' })
        .getAttribute('aria-selected') === 'true'
    ) {
      await user.click(screen.getByRole('tab', { name: 'Account Keys' }))
      await user.selectOptions(
        await screen.findByRole('combobox', { name: 'Upstream account' }),
        '1'
      )
    }
    await user.click(
      await screen.findByRole('button', { name: `Models for Key ${id}` })
    )
    expect(
      await screen.findByRole('checkbox', { name: 'Select paused-changed' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Select paused-unchanged' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Select listed-changed' })
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('combobox', { name: 'Listing status' })
    ).toHaveLength(1)
    expect(
      screen.getAllByRole('checkbox', { name: 'Only changes' })
    ).toHaveLength(1)
    expect(listingStatus).toHaveValue('paused')
    expect(onlyChanges).toBeChecked()
    expect(listingStatus.closest('article')).toBeNull()
    expect(onlyChanges.closest('article')).toBeNull()
  }
})

test('changing a shared filter resets model pagination to the first page', async () => {
  mount(
    Array.from({ length: 52 }, (_, index) => ({
      ...rows[0],
      model: `model-${String(index).padStart(3, '0')}`,
      listing: null,
      change: index < 51 ? 'changed' : 'unchanged',
    }))
  )
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Models for Key 11' })
  )
  await screen.findByRole('checkbox', { name: 'Select model-000' })
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(
    screen.getByRole('checkbox', { name: 'Select model-050' })
  ).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Only changes' }))
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Select model-000' })
    ).toBeInTheDocument()
  )
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Listing status' }),
    'other'
  )
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Select model-000' })
    ).toBeInTheDocument()
  )
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
})
