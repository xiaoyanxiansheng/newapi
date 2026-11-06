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
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { UpstreamCatalog } from '..'

const manual = {
  id: 88,
  account_id: 0,
  adapter: 'direct-key',
  name: 'My manual Key',
  base_url: 'https://provider.example',
  key_masked: 'sk-****test',
  key_status: 1,
  key_missing: false,
  has_relay_key: true,
  has_catalog_key: false,
  price_group: '',
  purchase_multiplier: '1',
  markup: '1.1',
  revision: 1,
  latest_time: 1000,
  last_error: '',
  channel_id: 0,
  catalog_url: '',
}
let client: QueryClient
afterEach(() => {
  client?.clear()
  vi.restoreAllMocks()
})

function mount(saved = false) {
  let exists = saved
  let confirmed = false
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/market/admin/upstream-accounts') {
      return { data: { success: true, data: [] } }
    }
    if (url === '/api/market/admin/manual-keys') {
      return { data: { success: true, data: exists ? [manual] : [] } }
    }
    if (url === '/api/market/admin/upstreams/88') {
      return {
        data: {
          success: true,
          data: {
            source: manual,
            history: [],
            rows: [
              {
                model: 'example',
                change: 'new',
                listing: null,
                markup_override: '',
                reviewed: null,
                latest: {
                  model: 'example',
                  currency: 'USD',
                  unit: 'per_million_tokens',
                  original: confirmed ? { input: '20', output: '80' } : {},
                  cost: confirmed ? { input: '2', output: '8' } : {},
                  price_issue: confirmed
                    ? undefined
                    : 'Verify upstream prices before publishing this manually entered Key.',
                },
              },
            ],
          },
        },
      }
    }
    if (url === '/api/market/admin/manual-keys/88/price') {
      return {
        data: {
          success: true,
          data: {
            model: 'example',
            original: { input: '20', output: '80' },
            cost: {},
            unit: 'per_million_tokens',
            currency: 'USD',
          },
        },
      }
    }
    throw new Error(`Unexpected endpoint: ${url}`)
  })
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/market/admin/manual-keys') {
      exists = true
      return { data: { success: true, data: { id: 88 } } }
    }
    if (url === '/api/market/admin/manual-keys/88/price') confirmed = true
    return { data: { success: true } }
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UpstreamCatalog />
    </QueryClientProvider>
  )
  return post
}

test('adding a manual Key asks for its address and Key without a website login and displays only its mask after saving', async () => {
  const post = mount()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Add upstream' }))
  await user.click(screen.getByRole('tab', { name: 'Enter address and Key' }))
  const dialog = screen.getByRole('dialog', { name: 'Add upstream' })
  expect(
    within(dialog).queryByLabelText('Website login password')
  ).not.toBeInTheDocument()
  await user.type(within(dialog).getByLabelText('Key name'), manual.name)
  await user.type(
    within(dialog).getByLabelText('API address'),
    `${manual.base_url}/v1`
  )
  await user.type(
    within(dialog).getByLabelText('API Key'),
    'sk-private-manual-test'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save Key' }))
  await screen.findByRole('button', { name: 'Models for My manual Key' })
  expect(post).toHaveBeenCalledWith(
    '/api/market/admin/manual-keys',
    {
      name: manual.name,
      base_url: `${manual.base_url}/v1`,
      key: 'sk-private-manual-test',
      markup: '1.1',
    },
    expect.any(Object)
  )
  expect(screen.getByRole('tab', { name: 'Manual Keys' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByText(manual.key_masked)).toBeInTheDocument()
  expect(
    screen.queryByDisplayValue('sk-private-manual-test')
  ).not.toBeInTheDocument()
})

test('a manually entered Key reads its models and cannot publish until upstream prices are explicitly confirmed', async () => {
  const post = mount(true)
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: 'Manual Keys' }))
  await user.click(
    await screen.findByRole('button', { name: 'Models for My manual Key' })
  )
  expect(
    await screen.findByRole('button', { name: 'Publish model' })
  ).toBeDisabled()
  expect(post).toHaveBeenCalledWith(
    '/api/market/admin/upstreams/88/refresh',
    {},
    expect.any(Object)
  )
  await user.click(
    screen.getByRole('button', { name: 'Confirm prices for example' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Confirm upstream prices',
  })
  await user.type(
    await within(dialog).findByLabelText('Purchase price: Input'),
    '2'
  )
  await user.type(within(dialog).getByLabelText('Purchase price: Output'), '8')
  await user.click(
    within(dialog).getByRole('button', { name: 'Save reference prices' })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Publish model' })).toBeEnabled()
  )
  expect(post).toHaveBeenCalledWith(
    '/api/market/admin/manual-keys/88/price',
    { revision: 1, model: 'example', cost: { input: '2', output: '8' } },
    expect.any(Object)
  )
  expect(post.mock.calls.some(([url]) => String(url).endsWith('/apply'))).toBe(
    false
  )
})

test('a rejected manual Key save keeps the form and never opens a model list', async () => {
  const post = mount()
  post.mockResolvedValue({
    data: { success: false, message: 'invalid API key' },
  })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Add upstream' }))
  await user.click(screen.getByRole('tab', { name: 'Enter address and Key' }))
  await user.type(screen.getByLabelText('API address'), manual.base_url)
  await user.type(screen.getByLabelText('API Key'), 'wrong-key')
  await user.click(screen.getByRole('button', { name: 'Save Key' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid API key')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Models for My manual Key' })
  ).not.toBeInTheDocument()
})
