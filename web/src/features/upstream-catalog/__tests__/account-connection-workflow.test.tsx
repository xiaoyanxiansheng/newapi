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
import type { UpstreamAccount } from '../types'

const existing: UpstreamAccount = {
  id: 1,
  name: 'CCTQ',
  website: 'https://www.cctq.ai',
  username: 'owner',
  markup: '1.1',
  revision: 2,
  last_sync: 100,
  last_error: '',
  workflow: 'cctq-existing-keys-v1',
  auth_type: 'browser',
  has_session: true,
}
let client: QueryClient

afterEach(() => {
  client?.clear()
  vi.restoreAllMocks()
})

function mount(saved: UpstreamAccount, detailError = false) {
  let created = false
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/market/admin/upstream-accounts') {
      return {
        data: { success: true, data: created ? [saved, existing] : [existing] },
      }
    }
    if (url === '/api/market/admin/upstream-accounts/1') {
      return { data: { success: true, data: { account: existing, keys: [] } } }
    }
    if (url === '/api/market/admin/upstream-accounts/2') {
      if (detailError) throw new Error('Account details need a retry')
      return { data: { success: true, data: { account: saved, keys: [] } } }
    }
    throw new Error(`Unexpected endpoint: ${url}`)
  })
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    created = true
    return { data: { success: true, data: { id: 2 } } }
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UpstreamCatalog />
    </QueryClientProvider>
  )
  return post
}

async function createAccount(page: string) {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Add upstream' }))
  const dialog = screen.getByRole('dialog', { name: 'Add upstream' })
  await user.type(within(dialog).getByLabelText('Website name'), 'New site')
  await user.type(within(dialog).getByLabelText('Key management page'), page)
  await user.click(
    within(dialog).getByRole('button', { name: 'Save upstream account' })
  )
  return user
}

const saved: UpstreamAccount = {
  ...existing,
  id: 2,
  name: 'New site',
  website: 'https://xxapi.info',
  key_page_url: 'https://xxapi.info/console/token#keys',
  username: '',
  workflow: 'xxapi-existing-keys-v1',
  has_session: false,
  revision: 0,
}

test('creating an account opens one combined settings and authorization dialog with its saved Key page', async () => {
  const opened = { postMessage: vi.fn() } as unknown as Window
  const open = vi.spyOn(window, 'open').mockReturnValue(opened)
  const post = mount(saved)
  const user = await createAccount('https://xxapi.info/console/token#keys')
  const dialog = await screen.findByRole('dialog', {
    name: 'Account settings',
  })
  expect(
    screen.queryByRole('dialog', { name: 'Add upstream' })
  ).not.toBeInTheDocument()
  expect(post).toHaveBeenCalledWith(
    '/api/market/admin/upstream-accounts',
    {
      name: 'New site',
      markup: '1.1',
      auth_type: 'browser',
      key_page_url: saved.key_page_url,
      revision: undefined,
    },
    expect.anything()
  )
  // Opening remains a user gesture so popup blockers do not intercept an async save.
  expect(open).not.toHaveBeenCalled()
  await user.click(
    within(dialog).getByRole('button', { name: 'Open upstream website' })
  )
  expect(open).toHaveBeenCalledWith(
    saved.key_page_url,
    expect.stringContaining('hwjai-upstream-connect-')
  )
})

test('account settings and authorization share one dialog and open the edited same-site page', async () => {
  const open = vi
    .spyOn(window, 'open')
    .mockReturnValue({ postMessage: vi.fn() } as unknown as Window)
  mount(saved)
  const user = userEvent.setup()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Account settings' })
    ).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Account settings' }))
  const dialog = screen.getByRole('dialog', { name: 'Account settings' })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(
    within(dialog).getByRole('link', { name: 'Connect to hwjai' })
  ).toBeInTheDocument()
  const page = within(dialog).getByLabelText('Key management page')
  await user.clear(page)
  await user.type(page, 'https://www.cctq.ai/console/token#keys')
  await user.click(
    within(dialog).getByRole('button', { name: 'Open upstream website' })
  )
  expect(open).toHaveBeenCalledWith(
    'https://www.cctq.ai/console/token#keys',
    expect.stringContaining('hwjai-upstream-connect-')
  )
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
})

test('creating a previously unknown website opens authorization without requiring an adapter', async () => {
  mount({
    ...saved,
    website: 'https://unknown.example',
    key_page_url: 'https://unknown.example/keys',
    workflow: 'browser-auto-v1',
  })
  await createAccount('https://unknown.example/keys')
  const dialog = await screen.findByRole('dialog', { name: 'Account settings' })
  expect(
    within(dialog).getByRole('link', { name: 'Connect to hwjai' })
  ).toBeInTheDocument()
  expect(within(dialog).getByLabelText('Key management page')).toHaveValue(
    'https://unknown.example/keys'
  )
})

test('editing an already authorized account keeps its connection without reopening authorization', async () => {
  mount(saved)
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: { id: 1 } } })
  const user = userEvent.setup()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Account settings' })
    ).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Account settings' }))
  const dialog = screen.getByRole('dialog', { name: 'Account settings' })
  await user.click(
    within(dialog).getByRole('button', { name: 'Save upstream account' })
  )
  await waitFor(() => expect(put).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(
    screen.getByRole('button', { name: 'Read existing Keys' })
  ).toBeEnabled()
})

test('a successful creation followed by a details error closes the editor so retry cannot create a duplicate', async () => {
  const post = mount(saved, true)
  await createAccount('https://xxapi.info/console/token#keys')
  expect(
    await screen.findByText(
      'Could not load the upstream account. Retry to see its saved Keys.'
    )
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('dialog', { name: 'Add upstream' })
  ).not.toBeInTheDocument()
  expect(post).toHaveBeenCalledOnce()
})
