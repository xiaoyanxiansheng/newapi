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

import * as upstreamApi from '../api'
import { BrowserConnection } from '../components/browser-connection'
import type { UpstreamAccount } from '../types'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test.each([
  { balance: '0.00', moneyOnly: true, error: undefined },
  {
    balance: undefined,
    moneyOnly: true,
    error:
      'Balance not detected. Add its page URL in Account settings and authorize that page.',
  },
  {
    balance: '999.00',
    moneyOnly: false,
    error:
      'This authorization reader does not support balance-only refresh. Open the upstream website and use the current authorization bookmark.',
  },
])(
  'a balance-only request with balance $balance and money-only $moneyOnly never refreshes Keys or models and reports its actual result',
  async (response) => {
    const account: UpstreamAccount = {
      id: 5,
      name: 'site',
      website: 'https://site.example',
      key_page_url: 'https://site.example/keys',
      balance_page_url: 'https://site.example/wallet',
      username: 'owner',
      markup: '1.1',
      revision: 2,
      last_sync: 0,
      last_error: '',
      workflow: 'browser-auto-v1',
      auth_type: 'browser',
    }
    const opened = { postMessage: vi.fn(), closed: false } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(opened)
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { account, keys: [{ id: 17, key_status: 1, latest_time: 0 }] },
      },
    })
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const onConnected = vi.fn(async () => {})
    const onBalanceRead = vi.fn(async () => {})
    render(
      <BrowserConnection
        account={account}
        open
        onClose={vi.fn()}
        onConnected={onConnected}
        onBalanceRead={onBalanceRead}
        onSave={vi.fn()}
      />
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Open upstream website' })
    )
    const read = upstreamApi.refreshBalance(5).then(
      () => undefined,
      (error: Error) => error.message
    )
    await waitFor(() => expect(opened.postMessage).toHaveBeenCalled())
    const request = vi.mocked(opened.postMessage).mock.calls[0][0]
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: account.website,
        source: opened,
        data: { type: 'hwjai-upstream-request' },
      })
    )
    const challenge = vi.mocked(opened.postMessage).mock.calls[1][0]
    expect(challenge.money_only).toBe(true)
    expect(challenge.balance_page_url).toBe(account.balance_page_url)
    // A delayed response from another request must not overwrite this read.
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: account.website,
        source: opened,
        data: {
          type: 'hwjai-upstream-authorization',
          nonce: challenge.nonce,
          request_id: 'expired-request',
          discovery: {
            page_url: account.key_page_url,
            connector: { kind: 'newapi' },
            identity: { id: 7, username: 'owner', email: '' },
            keys: [],
            complete: false,
            money_only: true,
            balance_cny: '777.00',
          },
        },
      })
    )
    const discovery = {
      page_url: account.key_page_url,
      connector: { kind: 'newapi' },
      identity: { id: 7, username: 'owner', email: '' },
      keys: [],
      complete: false,
      money_only: response.moneyOnly,
      balance_cny: response.balance,
      balance_issue: response.balance === undefined ? 'not_found' : undefined,
    }
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: account.website,
        source: opened,
        data: {
          type: 'hwjai-upstream-authorization',
          nonce: challenge.nonce,
          request_id: request.request_id,
          discovery,
        },
      })
    )
    expect(await read).toBe(response.error)
    expect(onConnected).not.toHaveBeenCalled()
    if (response.moneyOnly) {
      expect(post).toHaveBeenCalledOnce()
      expect(post).toHaveBeenCalledWith(
        '/api/market/admin/upstream-accounts/5/browser-authorization',
        expect.objectContaining({ discovery }),
        expect.anything()
      )
      expect(onBalanceRead).toHaveBeenCalledOnce()
    } else {
      expect(post).not.toHaveBeenCalled()
      expect(onBalanceRead).not.toHaveBeenCalled()
    }
  }
)

test('a timed-out balance read clears the loading state and allows a later balance read to succeed', async () => {
  const account: UpstreamAccount = {
    id: 8,
    name: 'site',
    website: 'https://site.example',
    key_page_url: 'https://site.example/keys',
    username: 'owner',
    markup: '1.1',
    revision: 2,
    last_sync: 0,
    last_error: '',
    workflow: 'browser-auto-v1',
    auth_type: 'browser',
  }
  const opened = { postMessage: vi.fn(), closed: false } as unknown as Window
  vi.spyOn(window, 'open').mockReturnValue(opened)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { account, keys: [] } },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  render(
    <BrowserConnection
      account={account}
      open
      onClose={vi.fn()}
      onConnected={vi.fn(async () => {})}
      onSave={vi.fn()}
    />
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Open upstream website' })
  )
  vi.useFakeTimers()
  const firstRead = upstreamApi
    .refreshBalance(8)
    .catch((error: Error) => error.message)
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: { type: 'hwjai-upstream-request' },
    })
  )
  const nonce = vi.mocked(opened.postMessage).mock.calls[1][0].nonce
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: account.website,
        source: opened,
        data: { type: 'hwjai-upstream-progress', nonce },
      })
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000)
  })
  expect(await firstRead).toBe(
    'The balance page did not respond. Open the upstream website and click the authorization bookmark again.'
  )
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  const nextRead = upstreamApi
    .refreshBalance(8)
    .catch((error: Error) => error.message)
  const request = vi.mocked(opened.postMessage).mock.calls.at(-1)?.[0]
  expect(request?.type).toBe('hwjai-upstream-read')
  vi.useRealTimers()
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: account.website,
        source: opened,
        data: {
          type: 'hwjai-upstream-authorization',
          nonce,
          request_id: request.request_id,
          discovery: {
            page_url: account.key_page_url,
            connector: { kind: 'newapi' },
            identity: { id: 7 },
            keys: [],
            complete: false,
            money_only: true,
            balance_cny: '0.00',
          },
        },
      })
    )
    expect(await nextRead).toBeUndefined()
  })
  expect(post).toHaveBeenCalledOnce()
})

test('a saved Key snapshot with a failed catalog refresh keeps the dialog open and shows the actual route-reading error', async () => {
  const account: UpstreamAccount = {
    id: 5,
    name: 'merchant',
    website: 'https://merchant.example',
    key_page_url: 'https://merchant.example/keys',
    username: 'owner',
    markup: '1.1',
    revision: 2,
    last_sync: 0,
    last_error: '',
    workflow: 'browser-auto-v1',
    auth_type: 'browser',
  }
  const opened = { postMessage: vi.fn(), closed: false } as unknown as Window
  vi.spyOn(window, 'open').mockReturnValue(opened)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { account, keys: [{ id: 17, key_status: 1, latest_time: 0 }] },
    },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  const message =
    'joined route response format could not be verified; existing routes and prices were preserved'
  vi.spyOn(upstreamApi, 'refreshSource').mockRejectedValue(new Error(message))
  const onConnected = vi.fn(async () => {})
  render(
    <BrowserConnection
      account={account}
      open
      onClose={vi.fn()}
      onConnected={onConnected}
      onSave={vi.fn()}
    />
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Open upstream website' })
  )
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: { type: 'hwjai-upstream-request' },
    })
  )
  const nonce = vi.mocked(opened.postMessage).mock.calls[0][0].nonce
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: {
        type: 'hwjai-upstream-authorization',
        nonce,
        discovery: {
          reader_version: 2,
          page_url: account.key_page_url,
          connector: { kind: 'newapi' },
          identity: { id: 7, username: 'owner', email: '' },
          complete: true,
          keys: [
            {
              id: 567,
              name: 'cc',
              key: 'sk-existing-authorized-secret',
              group: '',
              status: 1,
              models: null,
              expires_at: 0,
              joined_routes_issue: 'invalid_key_routes',
            },
          ],
        },
      },
    })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(onConnected).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('opening a balance page keeps wallet authorization separate from Keys and model refresh even after a same-site redirect', async () => {
  const account: UpstreamAccount = {
    id: 1,
    name: 'site',
    website: 'https://site.example',
    username: 'owner',
    key_page_url: 'https://site.example/keys',
    balance_page_url: 'https://site.example/wallet/start',
    markup: '1.1',
    revision: 3,
    last_sync: 0,
    last_error: '',
    workflow: 'browser-auto-v1',
    auth_type: 'browser',
    has_session: true,
  }
  const opened = { postMessage: vi.fn(), closed: false } as unknown as Window
  vi.spyOn(window, 'open').mockReturnValue(opened)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { account, keys: [{ id: 9, key_status: 1, latest_time: 0 }] },
    },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const refresh = vi
    .spyOn(upstreamApi, 'refreshSource')
    .mockRejectedValue(new Error('Unexpected model refresh'))
  const onConnected = vi.fn(async () => {})
  render(
    <BrowserConnection
      account={account}
      open
      onClose={vi.fn()}
      onConnected={onConnected}
      onSave={vi.fn()}
    />
  )
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Open balance page' }))
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: { type: 'hwjai-upstream-request' },
    })
  )
  const challenge = vi.mocked(opened.postMessage).mock.calls[0][0]
  expect(challenge).toMatchObject({
    money_only: true,
    balance_page_url: account.balance_page_url,
  })
  const discovery = {
    page_url: 'https://site.example/wallet/overview',
    connector: { kind: 'newapi' },
    identity: { id: 7, username: 'owner', email: '' },
    keys: [],
    complete: false,
    money_only: true,
    balance_cny: '12.00',
  }
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: {
        type: 'hwjai-upstream-authorization',
        nonce: challenge.nonce,
        discovery,
      },
    })
  )
  await waitFor(() => expect(onConnected).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledOnce()
  expect(post).toHaveBeenCalledWith(
    '/api/market/admin/upstream-accounts/1/browser-authorization',
    expect.objectContaining({ discovery }),
    expect.anything()
  )
  expect(refresh).not.toHaveBeenCalled()
})

test.each([
  [
    'https://xxapi.info/console/token?view=all#keys',
    'https://xxapi.info/console/token?view=all#keys',
  ],
  [undefined, 'https://xxapi.info/keys'],
  ['https://other.example/keys', 'https://xxapi.info/keys'],
  ['not-a-page', 'https://xxapi.info/keys'],
  ['https://owner:password@xxapi.info/keys', 'https://xxapi.info/keys'],
])(
  'opening authorization uses the saved same-site Key page or the legacy fallback for %s',
  async (page, expected) => {
    const account: UpstreamAccount = {
      id: 2,
      name: 'xxapi',
      website: 'https://xxapi.info',
      username: '',
      key_page_url: page,
      markup: '1.1',
      revision: 0,
      last_sync: 0,
      last_error: '',
      workflow: 'xxapi-existing-keys-v1',
      auth_type: 'browser',
      has_session: false,
    }
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue({ postMessage: vi.fn() } as unknown as Window)
    render(
      <BrowserConnection
        account={account}
        open
        onClose={vi.fn()}
        onConnected={vi.fn()}
        onSave={vi.fn()}
      />
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Open upstream website' })
    )
    expect(open).toHaveBeenCalledWith(
      expected,
      expect.stringContaining('hwjai-upstream-connect-')
    )
  }
)

test('reuses current authorization after the dialog closes and renews against the latest account revision', async () => {
  const account: UpstreamAccount = {
    id: 1,
    name: 'CCTQ',
    website: 'https://www.cctq.ai',
    username: 'owner',
    markup: '1.1',
    revision: 1,
    last_sync: 0,
    last_error: '',
    workflow: 'cctq-existing-keys-v1',
    auth_type: 'browser',
    has_session: true,
  }
  const opened = { postMessage: vi.fn() } as unknown as Window
  vi.spyOn(window, 'open').mockReturnValue(opened)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { account: { ...account, revision: 9 }, keys: [] },
    },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const onConnected = vi.fn().mockResolvedValue(undefined)
  const props = {
    account,
    open: true,
    onClose: vi.fn(),
    onConnected,
    onSave: vi.fn(),
  }
  const view = render(<BrowserConnection {...props} />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Open upstream website' })
  )
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: { type: 'hwjai-upstream-request' },
    })
  )
  expect(opened.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'hwjai-upstream-challenge' }),
    account.website
  )
  const nonce = vi.mocked(opened.postMessage).mock.calls[0][0].nonce as string
  view.rerender(<BrowserConnection {...props} open={false} />)
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: {
        type: 'hwjai-upstream-authorization',
        nonce,
        access_token: 'renewed-session',
        user_id: 17,
        renewal: true,
      },
    })
  )
  await waitFor(() => expect(onConnected).toHaveBeenCalled())
  expect(post).toHaveBeenCalledWith(
    '/api/market/admin/upstream-accounts/1/browser-authorization',
    { revision: 9, access_token: 'renewed-session', user_id: 17 },
    expect.anything()
  )
  expect(post.mock.calls).toHaveLength(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const onDisconnected = vi.fn()
  view.rerender(
    <BrowserConnection
      {...props}
      open={false}
      onDisconnected={onDisconnected}
    />
  )
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: { type: 'hwjai-upstream-disconnected', nonce: 'untrusted' },
    })
  )
  expect(onDisconnected).not.toHaveBeenCalled()
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: { type: 'hwjai-upstream-disconnected', nonce },
    })
  )
  expect(onDisconnected).toHaveBeenCalledOnce()
})

test('editing the website to another origin blocks both opening and saving in the combined dialog', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const onSave = vi.fn()
  render(
    <BrowserConnection
      account={{
        id: 1,
        name: 'xxapi',
        website: 'https://xxapi.info',
        username: '',
        markup: '1.1',
        revision: 1,
        last_sync: 0,
        last_error: '',
        workflow: 'xxapi-existing-keys-v1',
        auth_type: 'browser',
      }}
      open
      onClose={vi.fn()}
      onConnected={vi.fn()}
      onSave={onSave}
    />
  )
  const dialog = screen.getByRole('dialog', { name: 'Account settings' })
  expect(dialog.classList.contains('overflow-y-auto')).toBe(true)
  expect(dialog.classList.contains('max-h-[85vh]')).toBe(true)
  const user = userEvent.setup()
  const page = screen.getByLabelText('Key management page')
  await user.clear(page)
  await user.type(page, 'https://other.example/keys')
  await user.click(
    screen.getByRole('button', { name: 'Open upstream website' })
  )
  expect(page).toHaveAttribute('aria-invalid', 'true')
  expect(
    screen.getByText(
      'Add a separate upstream account to use a different website.'
    )
  ).toBeInTheDocument()
  expect(open).not.toHaveBeenCalled()
  await user.click(
    screen.getByRole('button', { name: 'Save upstream account' })
  )
  await waitFor(() => expect(page).toHaveAttribute('aria-invalid', 'true'))
  expect(onSave).not.toHaveBeenCalled()
})
test('a new-site discovery imports Keys once and a later refresh reads the authorized browser while its dialog is closed', async () => {
  const account = {
    id: 1,
    name: 'new site',
    website: 'https://new-site.example',
    key_page_url: 'https://new-site.example/keys',
    username: 'owner',
    markup: '1.1',
    revision: 4,
    last_sync: 0,
    last_error: '',
    workflow: 'browser-auto-v1',
    auth_type: 'browser' as const,
    has_session: true,
    discovery_mode: 'api' as const,
  }
  const opened = { postMessage: vi.fn(), closed: false } as unknown as Window
  vi.spyOn(window, 'open').mockReturnValue(opened)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { account, keys: [] } },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: {} } })
  const onConnected = vi.fn(async () => {})
  const props = {
    account,
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onConnected,
  }
  const view = render(<BrowserConnection {...props} />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Open upstream website' })
  )
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: { type: 'hwjai-upstream-request' },
    })
  )
  const nonce = vi.mocked(opened.postMessage).mock.calls[0][0].nonce
  const discovery = {
    page_url: account.key_page_url,
    connector: { kind: 'api' },
    identity: { id: 7, username: 'owner', email: '' },
    keys: [
      {
        id: 9,
        name: 'mine',
        key: 'sk-existing-secret',
        group: 'vip',
        status: 1,
        models: null,
        expires_at: 0,
      },
    ],
    complete: true,
  }
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: { type: 'hwjai-upstream-authorization', nonce, discovery },
    })
  )
  await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
  expect(post).toHaveBeenCalledTimes(1)
  expect(post).toHaveBeenCalledWith(
    '/api/market/admin/upstream-accounts/1/browser-authorization',
    expect.objectContaining({ discovery }),
    expect.anything()
  )
  view.rerender(<BrowserConnection {...props} open={false} />)
  const refresh = upstreamApi.refreshAccount(1)
  await waitFor(() =>
    expect(
      vi
        .mocked(opened.postMessage)
        .mock.calls.some(([message]) => message.type === 'hwjai-upstream-read')
    ).toBe(true)
  )
  const request = vi
    .mocked(opened.postMessage)
    .mock.calls.find(([message]) => message.type === 'hwjai-upstream-read')?.[0]
  expect(request).toBeDefined()
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: account.website,
      source: opened,
      data: {
        type: 'hwjai-upstream-authorization',
        nonce,
        request_id: request.request_id,
        discovery,
      },
    })
  )
  await refresh
  expect(onConnected).toHaveBeenCalledTimes(2)
  expect(post).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
