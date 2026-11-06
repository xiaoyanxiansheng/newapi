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
import { CatalogTable } from '../components/catalog-table'
import { SelectionPreview } from '../components/selection-preview'
import type { CatalogDetail, Preview, Source, UpstreamAccount } from '../types'

const account: UpstreamAccount = {
  id: 1,
  name: 'CCTQ',
  website: 'https://www.cctq.ai',
  username: 'owner',
  markup: '1.1',
  revision: 0,
  last_sync: 1000,
  last_error: '',
  workflow: 'cctq-existing-keys-v1',
}
const source: Source = {
  id: 33,
  account_id: 1,
  remote_key_id: 7,
  key_masked: 'abcd****wxyz',
  key_status: 1,
  key_missing: false,
  name: 'My existing Key',
  base_url: account.website,
  catalog_url: '',
  adapter: 'account',
  price_group: 'vip',
  purchase_multiplier: '1',
  markup: '1.1',
  channel_id: 0,
  revision: 1,
  latest_time: 1000,
  last_error: '',
  has_catalog_key: false,
  has_relay_key: true,
}
const detail: CatalogDetail = {
  source,
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
        display_currency: 'CNY',
        unit: 'per_million_tokens',
        original: {
          input: '20',
          output: '80',
          cache_read: '2',
          cache_write: '25',
        },
        cost: {
          input: '2',
          output: '8',
          cache_read: '0.2',
          cache_write: '2.5',
        },
        upstream_ratio: '0.1',
      },
    },
  ],
}
const preview: Preview = {
  fingerprint: 'verified-server-price-fingerprint',
  channel_name: source.name,
  creates_channel: true,
  proposals: [
    {
      model: 'example',
      markup: '1.1',
      original: { input: '20', output: '80' },
      cost: { input: '2', output: '8' },
      sale: { input: '2.2', output: '8.8' },
      unit: 'per_million_tokens',
      display_currency: 'CNY',
      ratio: 0.11,
      current_ratio: 0,
      listing_id: 0,
      enabled: true,
    },
  ],
}
let client: QueryClient | undefined
afterEach(() => {
  client?.clear()
  vi.restoreAllMocks()
})
function mount(
  current: CatalogDetail = detail,
  currentAccount: UpstreamAccount = account,
  keys: Source[] = [current.source]
) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/market/admin/upstream-accounts') {
      return { data: { success: true, data: [currentAccount] } }
    }
    if (url === '/api/market/admin/upstream-accounts/1') {
      return {
        data: { success: true, data: { account: currentAccount, keys } },
      }
    }
    if (url === '/api/market/admin/upstreams/33') {
      return { data: { success: true, data: current } }
    }
    throw new Error(`Unexpected endpoint: ${url}`)
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <UpstreamCatalog />
    </QueryClientProvider>
  )
}
async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Models for My existing Key' })
  )
  await screen.findByRole('checkbox', { name: 'Select example' })
}

test('administrator model IDs match plaza IDs and search accepts formatted or numeric IDs', async () => {
  const row = detail.rows[0]
  mount({
    ...detail,
    rows: [
      row,
      {
        ...row,
        model: 'claude-sonnet',
        listing: { id: 13, ratio: 1, enabled: true },
      },
      {
        ...row,
        model: 'claude-sonnet-other',
        listing: { id: 113, ratio: 1, enabled: false },
      },
    ],
  })
  const user = userEvent.setup()
  await expand(user)
  expect(
    screen.getByRole('columnheader', { name: 'Model ID' })
  ).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: 'ID00013' })).toBeInTheDocument()
  const search = screen.getByRole('textbox', {
    name: 'Search model name or ID',
  })
  for (const query of ['id00013', ' 13 ']) {
    await user.clear(search)
    await user.type(search, query)
    expect(
      screen.getByRole('checkbox', { name: 'Select claude-sonnet' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Select claude-sonnet-other' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Select example' })
    ).not.toBeInTheDocument()
  }
  await user.clear(search)
  await user.type(search, 'example')
  expect(
    screen.getByRole('checkbox', { name: 'Select example' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('cell', { name: 'ID00013' })
  ).not.toBeInTheDocument()
})

test('listed and paused models sort before others and can be filtered independently of price changes', async () => {
  const row = detail.rows[0]
  mount({
    ...detail,
    rows: [
      row,
      { ...row, model: 'paused', listing: { id: 2, ratio: 1, enabled: false } },
      {
        ...row,
        model: 'listed',
        change: 'unchanged',
        listing: { id: 1, ratio: 1, enabled: true },
      },
    ],
  })
  const user = userEvent.setup()
  await expand(user)
  expect(
    screen
      .getAllByRole('checkbox', { name: /^Select / })
      .map((e) => e.getAttribute('aria-label'))
  ).toEqual(['Select listed', 'Select paused', 'Select example'])
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Listing status' }),
    'paused'
  )
  expect(
    screen.getByRole('checkbox', { name: 'Select paused' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('checkbox', { name: 'Select listed' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Only changes' }))
  expect(
    screen.getByRole('checkbox', { name: 'Select paused' })
  ).toBeInTheDocument()
})

test('monitoring is visible for listed and paused models and absent for other models', () => {
  const row = detail.rows[0]
  render(
    <CatalogTable
      rows={[
        row,
        {
          ...row,
          model: 'listed',
          listing: { id: 1, ratio: 1, enabled: true },
        },
        {
          ...row,
          model: 'paused',
          listing: { id: 2, ratio: 1, enabled: false },
        },
      ]}
      selected={{}}
      busy={false}
      markup='1.1'
      onSelect={vi.fn()}
      onReview={vi.fn()}
    />
  )
  expect(
    screen.getAllByRole('group', { name: /Channel monitoring/ })
  ).toHaveLength(2)
  const scroll = screen.getByRole('region', { name: 'Upstream model table' })
  expect(scroll).toHaveClass('max-w-full', 'min-w-0')
  expect(scroll).not.toHaveClass('overflow-x-auto')
})

test('editing a channel description saves only the description and preserves its listing state', async () => {
  mount({
    ...detail,
    rows: [
      {
        ...detail.rows[0],
        listing: { id: 1, ratio: 1, enabled: false, description: 'Before' },
      },
    ],
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  await expand(user)
  await user.click(
    screen.getByRole('button', { name: 'Edit description for example' })
  )
  const input = screen.getByRole('textbox', { name: 'Channel description' })
  await user.clear(input)
  await user.paste('Stable upstream; priority support')
  await user.click(screen.getByRole('button', { name: 'Save description' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/market/admin/listings/1',
      { description: 'Stable upstream; priority support' },
      expect.anything()
    )
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Channel description' })
    ).not.toBeInTheDocument()
  )
})

test('Google account offers a real connection dialog with a scoped authorization bookmark', async () => {
  mount(detail, { ...account, auth_type: 'browser', has_session: false }, [])
  const user = userEvent.setup()
  expect(
    await screen.findByRole('button', { name: 'Read existing Keys' })
  ).toBeDisabled()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Account settings' })
    ).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Account settings' }))
  const dialog = screen.getByRole('dialog', {
    name: 'Account settings',
  })
  expect(
    within(dialog).getByRole('link', { name: 'Connect to hwjai' })
  ).toHaveAttribute('draggable', 'true')
  expect(
    within(dialog).getByRole('button', { name: 'Open upstream website' })
  ).toBeEnabled()
})

test('dynamic publishing preview displays both tiers of the final selling contract', () => {
  const original =
    'len < 272000 ? tier("standard", p * 5 + c * 30 + cr * 0.5) : tier("long", p * 10 + c * 45 + cr * 1)'
  const sale =
    'len < 272000 ? tier("standard", p * 1.21 + c * 7.26 + cr * 0.121) : tier("long", p * 2.42 + c * 10.89 + cr * 0.242)'
  render(
    <SelectionPreview
      preview={{
        ...preview,
        proposals: [
          {
            ...preview.proposals[0],
            billing_mode: 'tiered_expr',
            original_expr: original,
            cost_expr: sale,
            billing_expr: sale,
          },
        ],
      }}
      busy={false}
      onClose={() => {}}
      onApply={() => {}}
    />
  )
  const selling = screen.getByRole('region', { name: 'Dynamic selling prices' })
  expect(within(selling).getAllByText('¥7.2600').length).toBeGreaterThan(0)
  expect(within(selling).getAllByText('¥10.8900').length).toBeGreaterThan(0)
  expect(within(selling).getAllByText(/272K/).length).toBeGreaterThan(0)
  expect(
    screen.getByRole('button', { name: 'Confirm publishing' })
  ).toBeEnabled()
})

test('expands an existing Key, displays its multiplier and previews exact prices before publishing', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: preview } })
  mount()
  const user = userEvent.setup()
  await expand(user)
  expect(screen.getByText('0.1x')).toBeInTheDocument()
  expect(screen.getByText('¥2')).toBeInTheDocument()
  expect(screen.getByText('¥25')).toBeInTheDocument()
  expect(
    screen.queryByLabelText('Price API access token')
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Publish model' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Review selling prices',
  })
  expect(within(dialog).getByText('¥2.2')).toBeInTheDocument()
  expect(within(dialog).getByText('¥8.8')).toBeInTheDocument()
  expect(post).toHaveBeenCalledWith(
    '/api/market/admin/upstreams/33/preview',
    { revision: 1, models: { example: '' } },
    expect.any(Object)
  )
  expect(post.mock.calls.some(([url]) => String(url).endsWith('/apply'))).toBe(
    false
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm publishing' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/market/admin/upstreams/33/apply',
      {
        revision: 1,
        models: { example: '' },
        fingerprint: preview.fingerprint,
      },
      expect.any(Object)
    )
  )
})

test('a failed upstream refresh keeps the saved Key models visible and never applies prices', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: false,
      message: 'Upstream returned HTTP 403; check login and retry.',
    },
  })
  mount()
  const user = userEvent.setup()
  await expand(user)
  await user.click(
    screen.getByRole('button', { name: 'Refresh models and prices' })
  )
  expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent(
    'Upstream returned HTTP 403'
  )
  expect(screen.getByText('¥80')).toBeInTheDocument()
  expect(
    post.mock.calls.every(([url]) => String(url).endsWith('/refresh'))
  ).toBe(true)
})

test('a saved verified model can be reviewed for publishing after browser authorization expires without a forced upstream refresh', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: preview } })
  mount(detail, { ...account, auth_type: 'browser', has_session: false })
  const user = userEvent.setup()
  await expand(user)
  await user.click(screen.getByRole('button', { name: 'Publish model' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Review selling prices',
  })
  expect(within(dialog).getByText('¥2.2')).toBeInTheDocument()
  expect(post.mock.calls.map(([url]) => url)).toEqual([
    '/api/market/admin/upstreams/33/preview',
  ])
})

test('missing and unverified prices cannot be selected or published', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  mount({
    ...detail,
    rows: [
      ...detail.rows,
      { ...detail.rows[0], model: 'removed', change: 'removed', latest: null },
      {
        ...detail.rows[0],
        model: 'unknown',
        latest: {
          currency: 'USD',
          unit: '',
          original: {},
          cost: {},
          model: 'unknown',
          price_issue: 'Confirm the output price first.',
        },
      },
    ],
  })
  const user = userEvent.setup()
  await expand(user)
  expect(
    screen.getByRole('checkbox', { name: 'Select removed' })
  ).toBeDisabled()
  expect(
    screen.getByRole('checkbox', { name: 'Select unknown' })
  ).toBeDisabled()
  expect(
    screen.getByText('Confirm the output price first.')
  ).toBeInTheDocument()
  expect(
    screen
      .getAllByRole('button', { name: 'Publish model' })
      .filter((button) => !button.hasAttribute('disabled'))
  ).toHaveLength(1)
})

test('editing markup selects the model and preserves the draft when clearing and reselecting', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: preview } })
  mount()
  const user = userEvent.setup()
  await expand(user)
  const markup = screen.getByRole('textbox', { name: 'Markup for example' })
  await user.type(markup, '1.25')
  expect(screen.getByRole('checkbox', { name: 'Select example' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Clear selection' }))
  expect(markup).toHaveValue('1.25')
  await user.click(screen.getByRole('button', { name: 'Select this page' }))
  await user.click(
    screen.getByRole('button', { name: 'Publish selected models (1)' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/market/admin/upstreams/33/preview',
      { revision: 1, models: { example: '1.25' } },
      expect.any(Object)
    )
  )
})

test('published models can be paused or unpublished inside their existing Key', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  mount({
    ...detail,
    rows: [
      { ...detail.rows[0], listing: { id: 7, ratio: 0.11, enabled: true } },
    ],
  })
  const user = userEvent.setup()
  await expand(user)
  await user.click(screen.getByRole('button', { name: 'Pause listing' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/market/admin/upstreams/33/listing-state',
      { revision: 1, model: 'example', enabled: false, remove: false },
      expect.any(Object)
    )
  )
  await user.click(screen.getByRole('button', { name: 'Unpublish model' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/market/admin/upstreams/33/listing-state',
      { revision: 1, model: 'example', enabled: false, remove: true },
      expect.any(Object)
    )
  )
})

test('incompatible price dimensions block publishing from the server preview', () => {
  render(
    <SelectionPreview
      preview={{
        ...preview,
        proposals: [
          {
            ...preview.proposals[0],
            issue: 'Input and output require different ratios.',
          },
        ],
      }}
      busy={false}
      onClose={vi.fn()}
      onApply={vi.fn()}
    />
  )
  expect(screen.getByRole('alert')).toHaveTextContent('different ratios')
  expect(
    screen.getByRole('button', { name: 'Confirm publishing' })
  ).toBeDisabled()
})

test('opening a Key requiring refresh blocks publishing until the current refresh completes', async () => {
  let finishRefresh: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    finishRefresh = resolve
  })
  vi.spyOn(api, 'post').mockImplementation(async () => {
    await pending
    return { data: { success: true } }
  })
  mount(detail, account, [{ ...source, latest_time: 0 }])
  const user = userEvent.setup()
  await expand(user)
  expect(
    screen.getByRole('checkbox', { name: 'Select example' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Publish model' })).toBeDisabled()
  finishRefresh?.()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Publish model' })).toBeEnabled()
  )
})

test('a browser-login account without authorization explains how to reuse browser login and blocks Key reading', async () => {
  mount(detail, { ...account, auth_type: 'browser', has_session: false }, [])
  expect(
    await screen.findByRole('button', { name: 'Read existing Keys' })
  ).toBeDisabled()
  expect(
    await screen.findByText(
      'Open the upstream website and click the connection bookmark to read existing Keys. Your browser login is reused; sign in only if the website asks.'
    )
  ).toBeInTheDocument()
  expect(
    screen.queryByText(
      'Read existing Keys to load this account. Keys are never created automatically.'
    )
  ).not.toBeInTheDocument()
})

test('a password account with an upstream login conflict offers browser authorization without editing account settings', async () => {
  mount(detail, {
    ...account,
    auth_type: 'password',
    last_error:
      'upstream login returned HTTP 409; sign in on the upstream website, review active sessions and connect browser authorization',
  })
  const user = userEvent.setup()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Account settings' })
    ).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Account settings' }))
  expect(
    screen.getByRole('dialog', { name: 'Account settings' })
  ).toBeInTheDocument()
})

test('a new website requests browser authorization instead of domain-specific adaptation', async () => {
  mount(
    detail,
    {
      ...account,
      website: 'https://unknown.example',
      workflow: 'browser-auto-v1',
      auth_type: 'browser',
      has_session: false,
    },
    []
  )
  expect(
    await screen.findByRole('button', { name: 'Read existing Keys' })
  ).toBeDisabled()
  expect(
    await screen.findByText(
      'Open the upstream website and click the connection bookmark to read existing Keys. Your browser login is reused; sign in only if the website asks.'
    )
  ).toBeInTheDocument()
  expect(
    screen.queryByText(
      'Read existing Keys to load this account. Keys are never created automatically.'
    )
  ).not.toBeInTheDocument()
})
