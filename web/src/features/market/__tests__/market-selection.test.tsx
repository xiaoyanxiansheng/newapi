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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, expect, test, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { Market } from '..'
import { marketModelsQueryKey } from '../api'
import type { MarketModel } from '../types'

let client: QueryClient
let router: ReturnType<typeof createRouter>
const originalRouter = window.__TSR_ROUTER__
afterEach(async () => {
  cleanup()
  router?.cancelMatches()
  await client?.cancelQueries()
  client?.clear()
  window.__TSR_ROUTER__ = originalRouter
  localStorage.clear()
  await i18n.changeLanguage('en')
  i18n.removeResourceBundle('zhCN', 'translation')
  vi.restoreAllMocks()
})

const models: MarketModel[] = [
  {
    model_name: 'alpha',
    vendor_id: 1,
    model_ratio: 1,
    completion_ratio: 4,
    quota_type: 0,
    min_ratio: 0.1,
    channels: [
      {
        channel_id: 10,
        listing_id: 10,
        ratio: 0.1,
        joined: false,
        position: 0,
        score: { total: 70, price: 80, stability: 90, speed: 80, cache: 50 },
      },
      {
        channel_id: 11,
        listing_id: 11,
        ratio: 0.2,
        joined: false,
        position: 0,
        score: { total: 96, price: 60, stability: 99, speed: 95, cache: 50 },
      },
    ],
  },
  {
    model_name: 'beta',
    vendor_id: 2,
    model_ratio: 1,
    completion_ratio: 2,
    quota_type: 0,
    min_ratio: 0.1,
    channels: [
      {
        channel_id: 20,
        listing_id: 20,
        ratio: 0.1,
        joined: false,
        position: 0,
        score: { total: 85, price: 90, stability: 90, speed: 90, cache: 50 },
      },
    ],
  },
]
async function mountMarket(marketModels = models) {
  await i18n.changeLanguage('en')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['status'], {})
  client.setQueryData(['market', 'keys'], {
    success: true,
    data: { items: [{ id: 1, name: 'Project', status: 1 }], total: 1 },
  })
  client.setQueryData(marketModelsQueryKey(1), {
    success: true,
    data: marketModels,
    vendors: [
      { id: 1, name: 'International AI', region: 'intl' },
      { id: 2, name: 'Domestic AI', region: 'cn' },
    ],
  })
  const root = createRootRoute({ component: Outlet })
  const auth = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: Outlet,
  })
  const market = createRoute({
    getParentRoute: () => auth,
    path: 'market',
    component: Outlet,
  })
  const index = createRoute({
    getParentRoute: () => market,
    path: '/',
    component: Market,
    validateSearch: () => ({ key: undefined }),
  })
  router = createRouter({
    routeTree: root.addChildren([
      auth.addChildren([market.addChildren([index])]),
    ]),
    history: createMemoryHistory({ initialEntries: ['/market'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('region', { name: 'Choose a brand' })
}

test('supplier routes share one base-model choice, show all matching listings and join using their unchanged access names', async () => {
  const routedModels: MarketModel[] = [
    'claude-opus-5-5@s1c13',
    'claude-opus-5-5@s46c260',
  ].map((name, index) => ({
    ...models[0],
    model_name: name,
    channels: [
      {
        ...models[0].channels[0],
        channel_id: 31,
        listing_id: 62 + index,
        ratio: 0.1 + index * 0.1,
      },
    ],
  }))
  const data = [...routedModels, models[1]]
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: {} } })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/market/models') {
      return {
        data: {
          success: true,
          data,
          vendors: [
            { id: 1, name: 'International AI', region: 'intl' },
            { id: 2, name: 'Domestic AI', region: 'cn' },
          ],
        },
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  await mountMarket(data)
  const selector = screen.getByRole('region', { name: 'Choose a model' })
  const choices = within(selector).getAllByRole('button', {
    name: /^claude-opus-5-5/,
  })
  expect(choices).toHaveLength(1)
  expect(choices[0]).toHaveAttribute('title', 'claude-opus-5-5')
  expect(within(selector).queryByText(/@s/)).not.toBeInTheDocument()
  expect(
    within(choices[0]).getByRole('group', { name: 'Original price' })
  ).toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(choices[0])
  expect(choices[0]).toHaveAttribute('aria-pressed', 'true')
  const listings = screen.getAllByRole('article')
  expect(listings).toHaveLength(2)
  for (let index = 0; index < listings.length; index++) {
    expect(
      within(listings[index]).getByRole('heading', {
        name: 'claude-opus-5-5',
      })
    ).toHaveAttribute('title', 'claude-opus-5-5')
    expect(
      within(listings[index]).getByText(`ID000${62 + index}`)
    ).toBeInTheDocument()
  }
  await user.click(
    within(listings[0]).getByRole('button', { name: 'Join route' })
  )
  expect(post).toHaveBeenCalledWith('/api/token/1/routes', {
    model: 'claude-opus-5-5@s1c13',
    channel_id: 31,
    listing_id: 62,
  })
  await user.click(
    within(selector).getByRole('button', { name: /^All models/ })
  )
  expect(screen.getAllByRole('article')).toHaveLength(3)
})

test('places search and sorting after the brand and model selectors and immediately before channel results', async () => {
  await mountMarket()
  const selection = screen.getByRole('region', { name: 'Choose a model' })
  const filters = screen.getByRole('search', { name: 'Filter model results' })
  const row = screen.getAllByRole('article')[0]
  expect(
    selection.compareDocumentPosition(filters) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    filters.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    within(filters).getByRole('combobox', { name: 'Sort models by' })
  ).toHaveValue('price')
  expect(screen.getAllByRole('article')).toHaveLength(3)
  expect(within(row).getByText('ID00020')).toBeInTheDocument()
})

test('switches region and model selection and clears a stale model when the brand changes', async () => {
  await mountMarket()
  const user = userEvent.setup()
  const selector = screen.getByRole('region', { name: 'Choose a model' })
  await user.click(within(selector).getByRole('button', { name: /^alpha/ }))
  expect(
    within(selector).getByRole('button', { name: /^alpha/ })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('article')).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Domestic providers' }))
  expect(
    screen.getByRole('button', { name: 'Domestic providers' })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(
    within(screen.getByRole('article')).getByRole('heading', { name: 'beta' })
  ).toBeInTheDocument()
  expect(
    within(selector).getByRole('button', { name: /^All models/ })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.queryByRole('button', { name: /^International AI/ })
  ).not.toBeInTheDocument()
})

test('orders every channel by output price when selected and supports a search with no matches', async () => {
  await mountMarket()
  const user = userEvent.setup()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Sort models by' }),
    'price'
  )
  expect(
    screen
      .getAllByRole('article')
      .map((row) => within(row).getByText(/ID\d+/).textContent)
  ).toEqual(['ID00020', 'ID00010', 'ID00011'])
  await user.type(
    screen.getByRole('textbox', {
      name: 'Search model name or description...',
    }),
    'unavailable'
  )
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(
    screen.getByText('No models match your current filters.')
  ).toBeInTheDocument()
})

test('updates brand and model filters and sorting labels when switching to Chinese', async () => {
  await mountMarket()
  i18n.addResourceBundle('zhCN', 'translation', zh.translation)
  await i18n.changeLanguage('zhCN')
  expect(
    await screen.findByRole('region', { name: '选择品牌' })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '国际厂商' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '国内厂商' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '选择模型' })).toBeInTheDocument()
  expect(
    screen.getByRole('option', { name: '按输出价格从低到高' })
  ).toBeInTheDocument()
})
