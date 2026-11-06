import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { CatalogTable } from '../components/catalog-table'
import { KeyModelPanel } from '../components/key-model-panel'
import { UpstreamKeyCard } from '../components/upstream-key-card'
import type { CatalogRow, Source } from '../types'

const source: Source = {
  id: 17,
  name: 'Composite Key',
  adapter: 'account',
  price_group: '',
  pricing_mode: 'model_routes',
  purchase_multiplier: '1',
  markup: '1.1',
  base_url: 'https://example.com',
  catalog_url: '',
  channel_id: 0,
  revision: 2,
  latest_time: 100,
  last_error: '',
  key_status: 1,
  has_relay_key: true,
  has_catalog_key: false,
}
const row: CatalogRow = {
  model: 'gpt-example@s1c13',
  reviewed: null,
  listing: null,
  change: 'new',
  markup_override: '',
  latest: {
    model: 'gpt-example@s1c13',
    base_model: 'gpt-example',
    pricing_mode: 'model_routes',
    channel_no: 'ID00013',
    listing_id: 287,
    supplier_id: 1,
    upstream_ratio: '0.3333333333333333',
    currency: 'CNY',
    display_currency: 'CNY',
    unit: 'per_million_tokens',
    original: { input: '4', output: '20' },
    cost: { input: '0.1', output: '0.5' },
    long_context_threshold: 272000,
    long_context_input_multiplier: '2',
    long_context_output_multiplier: '1.5',
  },
}
let client: QueryClient | undefined
afterEach(() => {
  client?.clear()
  vi.restoreAllMocks()
})

test('merchant model card shows complete route identity and tier rules while preserving publish action', async () => {
  const publish = vi.fn()
  render(
    <CatalogTable
      rows={[row]}
      selected={{}}
      busy={false}
      markup='1.1'
      onSelect={vi.fn()}
      onReview={vi.fn()}
      onPublish={publish}
    />
  )
  const card = screen.getByRole('article', { name: row.model })
  expect(within(card).getByText('Base model: gpt-example')).toBeVisible()
  expect(within(card).getByText('ID00013')).toBeVisible()
  expect(within(card).getByText(/ID00287/)).toBeVisible()
  expect(within(card).getByText('0.3333333333333333x')).toBeVisible()
  expect(within(card).getByText(/272000/)).toHaveTextContent(/uncached/i)
  await userEvent
    .setup()
    .click(within(card).getByRole('button', { name: 'Publish model' }))
  expect(publish).toHaveBeenCalledWith(row.model)
})

test('formal merchant model list can search the complete upstream route ID and filter base models', async () => {
  const other: CatalogRow = {
    ...row,
    model: 'claude-example@s2c14',
    latest: row.latest
      ? {
          ...row.latest,
          model: 'claude-example@s2c14',
          base_model: 'claude-example',
          channel_no: 'ID00014',
          listing_id: 581,
        }
      : null,
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { source, history: [], rows: [row, other] } },
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <KeyModelPanel
        sourceId={17}
        filters={{ listingStatus: 'all', onlyChanges: false }}
      />
    </QueryClientProvider>
  )
  await screen.findByRole('article', { name: row.model })
  const user = userEvent.setup()
  const search = screen.getByRole('textbox', {
    name: 'Search model name or ID',
  })
  await user.type(search, 'ID00013')
  expect(screen.getByRole('article', { name: row.model })).toBeVisible()
  expect(
    screen.queryByRole('article', { name: other.model })
  ).not.toBeInTheDocument()
  await user.clear(search)
  await user.type(search, 'ID00287')
  expect(screen.getByRole('article', { name: row.model })).toBeVisible()
  expect(
    screen.queryByRole('article', { name: other.model })
  ).not.toBeInTheDocument()
  await user.clear(search)
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Base model' }),
    'claude-example'
  )
  expect(screen.getByRole('article', { name: other.model })).toBeVisible()
  expect(
    screen.queryByRole('article', { name: row.model })
  ).not.toBeInTheDocument()
})

test('verified composite Key shows per-model pricing instead of an unconfirmed group', () => {
  render(
    <UpstreamKeyCard
      source={source}
      expanded={false}
      busy={false}
      available
      onExpand={vi.fn()}
    />
  )
  expect(screen.getByText('Per-model route pricing')).toBeVisible()
  expect(screen.queryByText('Group unconfirmed')).not.toBeInTheDocument()
})
