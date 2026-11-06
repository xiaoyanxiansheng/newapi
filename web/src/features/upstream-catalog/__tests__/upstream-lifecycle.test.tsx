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

import { KeyModelPanel } from '../components/key-model-panel'
import { UpstreamLifecycleActions } from '../components/upstream-lifecycle-actions'

let client: QueryClient
const channel = { id: 7, name: 'My website', revision: 4, disabled: false }
afterEach(() => {
  client?.clear()
  vi.restoreAllMocks()
})
function mount(kind: 'account' | 'manual' = 'account', disabled = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(
    ['upstream-accounts'],
    [channel, { ...channel, id: 8, name: 'Other' }]
  )
  client.setQueryData(
    ['upstream-manual-keys'],
    [channel, { ...channel, id: 8, name: 'Other' }]
  )
  const onDeleted = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <UpstreamLifecycleActions
        kind={kind}
        channel={{ ...channel, disabled }}
        onDeleted={onDeleted}
      />
    </QueryClientProvider>
  )
  return onDeleted
}
test('disabling a website submits its current revision and enabling uses an explicit false state', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  mount()
  await userEvent.click(
    screen.getByRole('button', { name: 'Disable channel My website' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/market/admin/upstream-accounts/7/state',
      { revision: 4, disabled: true },
      expect.anything()
    )
  )
})
test('reenabling a disabled channel unlocks it without sending model resume requests', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  mount('account', true)
  await userEvent.click(
    screen.getByRole('button', { name: 'Enable channel My website' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/market/admin/upstream-accounts/7/state',
      { revision: 4, disabled: false },
      expect.anything()
    )
  )
  expect(post).toHaveBeenCalledTimes(1)
})
test('deleting a website requires confirmation, cancels without a request and removes only the confirmed website from the selector', async () => {
  const remove = vi
    .spyOn(api, 'delete')
    .mockResolvedValue({ data: { success: true } })
  const onDeleted = mount()
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: 'Delete channel My website' })
  )
  let dialog = screen.getByRole('alertdialog', {
    name: 'Delete upstream channel?',
  })
  expect(dialog).toHaveTextContent(
    'Keys on the upstream website are unchanged.'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(remove).not.toHaveBeenCalled()
  await user.click(
    screen.getByRole('button', { name: 'Delete channel My website' })
  )
  dialog = screen.getByRole('alertdialog', { name: 'Delete upstream channel?' })
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm deletion' })
  )
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  expect(remove).toHaveBeenCalledWith(
    '/api/market/admin/upstream-accounts/7',
    expect.objectContaining({ data: { revision: 4 } })
  )
  expect(client.getQueryData(['upstream-accounts'])).toEqual([
    { ...channel, id: 8, name: 'Other' },
  ])
})
test('a rejected manual channel deletion keeps its confirmation and saved Key visible', async () => {
  vi.spyOn(api, 'delete').mockResolvedValue({
    data: {
      success: false,
      message: 'Key changed; reload before managing this channel',
    },
  })
  const onDeleted = mount('manual')
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete channel My website' })
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm deletion' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Key changed')
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  expect(onDeleted).not.toHaveBeenCalled()
  expect(client.getQueryData(['upstream-manual-keys'])).toHaveLength(2)
})
test('models of a disabled website remain visible but publishing and resuming are blocked', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        source: {
          ...channel,
          account_disabled: true,
          adapter: 'account',
          key_status: 1,
          key_missing: false,
          latest_time: 1000,
          last_error: '',
          markup: '1.1',
        },
        history: [],
        rows: [
          {
            model: 'example',
            latest: {
              model: 'example',
              currency: 'USD',
              unit: 'per_million_tokens',
              original: { input: '2', output: '8' },
              cost: { input: '1', output: '4' },
            },
            reviewed: null,
            change: 'unchanged',
            markup_override: '',
            listing: { id: 9, enabled: false, ratio: 1 },
          },
        ],
      },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <KeyModelPanel
        sourceId={7}
        filters={{ listingStatus: 'all', onlyChanges: false }}
      />
    </QueryClientProvider>
  )
  expect(
    await screen.findByRole('button', { name: 'Update selling price' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Resume listing' })).toBeDisabled()
  expect(
    screen.getByRole('checkbox', { name: 'Select example' })
  ).toBeDisabled()
})
