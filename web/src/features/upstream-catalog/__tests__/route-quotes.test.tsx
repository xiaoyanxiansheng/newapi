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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { RouteQuotesPanel } from '../components/route-quotes-panel'
import type { RouteQuotes } from '../types'

const quotes: RouteQuotes = {
  read_only: true,
  currency: 'CNY',
  source_id: 17,
  snapshot_time: 100,
  snapshot_stale: true,
  quote_time: 200,
  origin: 'public_marketplace',
  model_count: 2,
  route_count: 3,
  issues: [],
  models: [
    {
      model: 'claude-opus',
      routes: [
        {
          access_model: 'claude-opus@s1c13',
          channel_no: 'ID00013',
          unit: 'per_million_tokens',
          prices: { input: '0.036577', output: '0.182885' },
          original: { input: '4', output: '20' },
          multiplier: '0.00914425',
          origin: 'public_marketplace',
          access_verified: false,
        },
        {
          access_model: 'claude-opus@s2c14',
          channel_no: 'ID00014',
          unit: 'per_million_tokens',
          prices: { input: '0.4', output: '2' },
          original: {},
          origin: 'public_marketplace',
          access_verified: false,
        },
      ],
    },
    {
      model: 'gpt-example',
      routes: [
        {
          access_model: 'gpt-example@s3c15',
          channel_no: 'ID00015',
          unit: 'per_request',
          prices: { request: '0.1' },
          original: {},
          origin: 'public_marketplace',
          access_verified: false,
        },
      ],
    },
  ],
}
let client: QueryClient
afterEach(() => {
  client?.clear()
  vi.restoreAllMocks()
})
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouteQuotesPanel sourceId={17} revision={1} />
    </QueryClientProvider>
  )
}

test('an unconfirmed billing unit does not display a guessed per-million price unit', async () => {
  const unknown = {
    ...quotes,
    models: [
      {
        model: 'claude-opus',
        routes: [
          {
            ...quotes.models[0].routes[0],
            unit: '',
            prices: {},
            original: {},
            issue: 'pricing_unit_unconfirmed',
          },
        ],
      },
    ],
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: unknown },
  })
  mount()
  await userEvent.click(
    screen.getByRole('button', { name: 'Route quotes by model (read-only)' })
  )
  const route = await screen.findByRole('article', {
    name: 'claude-opus@s1c13',
  })
  expect(within(route).queryByText('CNY / 1M tokens')).not.toBeInTheDocument()
  expect(
    within(route).getByText(
      'This route has an unconfirmed price dimension or billing contract.'
    )
  ).toBeVisible()
})

test('opening route quotes reads only GET data and shows every distinct route in RMB without publishing', async () => {
  const read = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: quotes } })
  const write = vi.spyOn(api, 'post')
  mount()
  expect(read).not.toHaveBeenCalled()
  const toggle = screen.getByRole('button', {
    name: 'Route quotes by model (read-only)',
  })
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const first = await screen.findByRole('article', {
    name: 'claude-opus@s1c13',
  })
  expect(within(first).getByText('ID00013')).toBeVisible()
  expect(within(first).getByText('¥0.036577')).toBeVisible()
  expect(within(first).getByText('¥4')).toBeVisible()
  expect(within(first).getByText('0.00914425×')).toBeVisible()
  const second = screen.getByRole('article', { name: 'claude-opus@s2c14' })
  expect(within(second).getByText('Unconfirmed')).toBeVisible()
  expect(within(second).queryByText('1×')).not.toBeInTheDocument()
  expect(first).toHaveClass('max-w-full', 'min-w-0')
  expect(read).toHaveBeenCalledWith(
    '/api/market/admin/upstreams/17/route-quotes',
    expect.any(Object)
  )
  expect(write).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: /publish/i })
  ).not.toBeInTheDocument()
})

test('selecting a model and searching full ID keeps route identity and per-request units', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: quotes },
  })
  mount()
  await userEvent.click(
    screen.getByRole('button', { name: 'Route quotes by model (read-only)' })
  )
  const choose = await screen.findByRole('combobox', {
    name: 'Choose quote model',
  })
  await userEvent.selectOptions(choose, 'gpt-example')
  const request = screen.getByRole('article', { name: 'gpt-example@s3c15' })
  expect(within(request).getByText('¥0.1')).toBeVisible()
  expect(within(request).getByText('CNY / request')).toBeVisible()
  await userEvent.type(
    screen.getByRole('textbox', {
      name: 'Search route model, access name or ID',
    }),
    'ID00013'
  )
  expect(
    screen.getByRole('article', { name: 'claude-opus@s1c13' })
  ).toBeVisible()
  expect(
    screen.queryByRole('article', { name: 'claude-opus@s2c14' })
  ).not.toBeInTheDocument()
})

test('a failed read offers a GET retry and empty results have a visible explanation', async () => {
  const read = vi
    .spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({
      data: {
        success: true,
        data: { ...quotes, models: [], model_count: 0, route_count: 0 },
      },
    })
  mount()
  await userEvent.click(
    screen.getByRole('button', { name: 'Route quotes by model (read-only)' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not read route quotes'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByText('No route quotes match this Key and search.')
  ).toBeVisible()
  expect(read).toHaveBeenCalledTimes(2)
})
