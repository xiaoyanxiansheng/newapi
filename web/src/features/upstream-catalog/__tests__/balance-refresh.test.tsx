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
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { UpstreamCatalog } from '..'
import { RefreshBalancesButton } from '../components/refresh-balances-button'
import { UpstreamAccountBalances } from '../components/upstream-funds'
import {
  registerBrowserReader,
  type BrowserReadOptions,
} from '../lib/browser-read'
import type { BalanceRefreshResults, UpstreamAccount } from '../types'

const accounts: UpstreamAccount[] = [1, 2].map((id) => ({
  id,
  name: `Website ${id}`,
  website: `https://site${id}.example`,
  username: '',
  markup: '1.1',
  revision: 1,
  last_sync: 0,
  last_error: '',
  workflow: 'browser-auto-v1',
  balance_cny: '12.00',
  balance_read_time: 100,
}))
const cleanupReaders: Array<() => void> = []
let client: QueryClient | undefined
afterEach(() => {
  client?.clear()
  cleanupReaders.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
})
function Harness(props: { onRefreshed: () => Promise<void> }) {
  const [results, setResults] = useState<BalanceRefreshResults>({})
  return (
    <>
      <RefreshBalancesButton
        accounts={accounts}
        disabled={false}
        onResults={setResults}
        onRefreshed={props.onRefreshed}
      />
      <UpstreamAccountBalances
        accounts={accounts}
        selectedId={1}
        busy={false}
        onSelect={vi.fn()}
        refreshResults={results}
      />
    </>
  )
}
test('one click reads every website in balance-only mode, prevents duplicate reads and reports partial results without hiding retained balances', async () => {
  let finishFirst: () => void = () => {}
  const first = new Promise<void>((resolve) => {
    finishFirst = resolve
  })
  const readFirst = vi.fn(async (options?: BrowserReadOptions) => {
    expect(options).toEqual({ moneyOnly: true })
    await first
  })
  const readSecond = vi.fn(async (options?: BrowserReadOptions) => {
    expect(options).toEqual({ moneyOnly: true })
    throw new Error('The balance window is closed.')
  })
  cleanupReaders.push(
    registerBrowserReader(1, readFirst),
    registerBrowserReader(2, readSecond)
  )
  const onRefreshed = vi.fn(async () => {})
  render(<Harness onRefreshed={onRefreshed} />)
  const user = userEvent.setup()
  const button = screen.getByRole('button', { name: 'Refresh all balances' })
  await user.click(button)
  expect(button).toBeDisabled()
  await user.click(button)
  expect(readFirst).toHaveBeenCalledOnce()
  expect(readSecond).toHaveBeenCalledOnce()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The balance window is closed.'
  )
  expect(screen.getAllByText('¥12.00')).toHaveLength(2)
  finishFirst()
  await waitFor(() => expect(onRefreshed).toHaveBeenCalledOnce())
  await waitFor(() => expect(button).toBeEnabled())
  expect(
    within(
      screen.getByRole('button', { name: 'Website balance for Website 1' })
    ).getByRole('status')
  ).toHaveTextContent('Balance refreshed')
})
test.each([
  { websites: [], disabled: false },
  { websites: accounts, disabled: true },
])(
  'balance refresh is disabled with $websites.length websites and disabled $disabled',
  (state) => {
    render(
      <RefreshBalancesButton
        accounts={state.websites}
        disabled={state.disabled}
        onResults={vi.fn()}
        onRefreshed={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Refresh all balances' })
    ).toBeDisabled()
  }
)

test('a retained balance without a live browser connection shows a reconnect instruction and keeps its actual read time', async () => {
  render(<Harness onRefreshed={vi.fn(async () => {})} />)
  const originalReadTime = within(
    screen.getByRole('button', { name: 'Website balance for Website 1' })
  ).getByText(/^Read at /).textContent
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Refresh all balances' }))
  const card = screen.getByRole('button', {
    name: 'Website balance for Website 1',
  })
  expect(within(card).getByRole('alert')).toHaveTextContent(
    'Open the upstream website and click the authorization bookmark to refresh its balance.'
  )
  expect(within(card).getByText('¥12.00')).toBeInTheDocument()
  expect(within(card).getByText(originalReadTime || '')).toBeInTheDocument()
})

test('the header refresh action displays newly read amounts for all websites and preserves the selected channel', async () => {
  let savedAccounts = accounts
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/market/admin/upstream-accounts') {
      return { data: { success: true, data: savedAccounts } }
    }
    const account = savedAccounts.find(
      (item) => url === `/api/market/admin/upstream-accounts/${item.id}`
    )
    if (account) return { data: { success: true, data: { account, keys: [] } } }
    throw new Error(`Unexpected endpoint: ${url}`)
  })
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new Error('Unexpected Key or model change'))
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UpstreamCatalog />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Website balance for Website 2' })
  )
  cleanupReaders.push(
    ...accounts.map((account) =>
      registerBrowserReader(account.id, async (options) => {
        expect(options).toEqual({ moneyOnly: true })
        savedAccounts = savedAccounts.map((item) =>
          item.id === account.id
            ? {
                ...item,
                balance_cny: `${account.id}.00`,
                balance_read_time: 200,
              }
            : item
        )
      })
    )
  )
  await user.click(screen.getByRole('button', { name: 'Refresh all balances' }))
  await waitFor(() => {
    expect(
      within(
        screen.getByRole('button', { name: 'Website balance for Website 1' })
      ).getByText('¥1.00')
    ).toBeInTheDocument()
    expect(
      within(
        screen.getByRole('button', { name: 'Website balance for Website 2' })
      ).getByText('¥2.00')
    ).toBeInTheDocument()
  })
  expect(
    screen.getByRole('button', { name: 'Website balance for Website 2' })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.getByRole('combobox', { name: 'Upstream account' })
  ).toHaveValue('2')
  expect(screen.getByRole('button', { name: 'Add upstream' })).toBeEnabled()
  expect(post).not.toHaveBeenCalled()
})
