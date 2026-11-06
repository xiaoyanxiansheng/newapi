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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { BatchBrowserConnection } from '../components/batch-browser-connection'
import type { UpstreamAccount } from '../types'

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
}))
afterEach(() => vi.restoreAllMocks())
function installHelper() {
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    if (message.type !== 'hwjai-helper-request') return
    let result: unknown = { ready: true, version: 1 }
    if (message.operation === 'open') result = { opened: [1, 2] }
    if (message.operation === 'read') {
      result = {
        results: [
          {
            id: 1,
            discovery: {
              page_url: accounts[0].website + '/keys',
              connector: { kind: 'newapi' },
              identity: { id: 5, username: 'owner', email: '' },
              keys: [],
              complete: true,
              reader_version: 2,
              balance_cny: '0.00',
            },
          },
          {
            id: 2,
            error:
              'The upstream page could not be read. Complete its login and retry authorization.',
          },
        ],
      }
    }
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: {
          type: 'hwjai-helper-response',
          request_id: message.request_id,
          result,
        },
      })
    )
  })
}
test('batch connection opens saved websites and authorization imports only successful reads without publishing or changing prices', async () => {
  installHelper()
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    const account = accounts.find((item) => url.endsWith(`/${item.id}`))
    return { data: { success: true, data: { account, keys: [] } } }
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const onRefreshed = vi.fn(async () => {})
  render(
    <BatchBrowserConnection
      accounts={accounts}
      disabled={false}
      onRefreshed={onRefreshed}
      onPendingChange={vi.fn()}
    />
  )
  await screen.findByText('Browser helper connected')
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Connect all websites' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    '2 websites opened'
  )
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Authorize all websites' }))
  await waitFor(() => expect(onRefreshed).toHaveBeenCalled())
  expect(screen.getByRole('alert')).toHaveTextContent('Complete its login')
  expect(post).toHaveBeenCalledTimes(1)
  expect(post).toHaveBeenCalledWith(
    '/api/market/admin/upstream-accounts/1/browser-authorization',
    expect.objectContaining({
      revision: 1,
      discovery: expect.objectContaining({ balance_cny: '0.00' }),
    }),
    expect.anything()
  )
  expect(
    screen.getByRole('button', { name: 'Authorize all websites' })
  ).toBeEnabled()
})
test('missing helper offers a downloadable extension and installation instructions instead of pretending websites are authorized', async () => {
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    if (message.type === 'hwjai-helper-request') {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: location.origin,
          data: {
            type: 'hwjai-helper-response',
            request_id: message.request_id,
            error: 'Browser helper is not installed.',
          },
        })
      )
    }
  })
  render(
    <BatchBrowserConnection
      accounts={accounts}
      disabled={false}
      onRefreshed={vi.fn()}
      onPendingChange={vi.fn()}
    />
  )
  await act(async () => {})
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Connect all websites' }))
  const link = await screen.findByRole('link', {
    name: 'Download browser helper',
  })
  expect(link).toHaveAttribute(
    'href',
    '/downloads/hwjai-upstream-helper-1.0.3.zip'
  )
  expect(screen.getByRole('dialog')).toHaveTextContent('chrome://extensions')
  expect(screen.getByRole('dialog')).toHaveTextContent('edge://extensions')
})
