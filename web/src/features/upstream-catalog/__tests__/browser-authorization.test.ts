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
import { runInNewContext } from 'node:vm'

import { expect, test, vi } from 'vitest'

import {
  authorizationBookmark,
  readAuthorizationMessage,
} from '../lib/browser-authorization'

test('authorization accepts only the opened window, exact upstream origin and current nonce', () => {
  const opened = {} as Window
  const data = {
    type: 'hwjai-upstream-authorization',
    nonce: 'current',
    access_token: 'website-session',
    user_id: 17,
  }
  const good = new MessageEvent('message', {
    origin: 'https://www.cctq.ai',
    source: opened,
    data,
  })
  expect(
    readAuthorizationMessage(good, 'https://www.cctq.ai', 'current', opened)
  ).toEqual({ access_token: 'website-session', user_id: 17 })
  for (const event of [
    new MessageEvent('message', {
      origin: 'https://other.example',
      source: opened,
      data,
    }),
    new MessageEvent('message', { origin: good.origin, data }),
    new MessageEvent('message', {
      origin: good.origin,
      source: opened,
      data: { ...data, nonce: 'stale' },
    }),
    new MessageEvent('message', {
      origin: good.origin,
      source: opened,
      data: { ...data, user_id: -1 },
    }),
  ]) {
    expect(
      readAuthorizationMessage(event, good.origin, 'current', opened)
    ).toBeNull()
  }
  expect(
    readAuthorizationMessage(good, good.origin, 'current', null)
  ).toBeNull()
})
test('one authorization bookmark discovers new websites and sends results only to its selected hwjai origin', () => {
  const bookmark = decodeURIComponent(
    authorizationBookmark(
      'https://www.cctq.ai',
      'https://hwjai.me',
      'unique'
    ).slice('javascript:'.length)
  )
  expect(bookmark).toContain('/api/user/auth/refresh')
  expect(bookmark).not.toContain('https://www.cctq.ai')
  expect(bookmark).toContain('window.opener.postMessage')
  expect(bookmark).toContain('c.destination')
  expect(bookmark).toContain('/api/token/')
  expect(
    authorizationBookmark('https://other.example', 'https://hwjai.me')
  ).toBe(authorizationBookmark('https://www.cctq.ai', 'https://hwjai.me'))
})

test.each([false, true])(
  'a saved bookmark renews the current dialog challenge and keeps wallet-only mode after a page redirect: %s',
  async (moneyOnly) => {
    const listeners = new Set<(event: MessageEvent) => void>()
    const posted: Record<string, unknown>[] = []
    const opener = {
      postMessage(data: Record<string, unknown>) {
        posted.push(data)
        if (data.type === 'hwjai-upstream-request') {
          for (const listener of listeners) {
            listener({
              origin: 'https://hwjai.me',
              source: opener,
              data: {
                type: 'hwjai-upstream-challenge',
                nonce: 'current-dialog',
                upstream_origin: 'https://4router.net',
                key_page_url: 'https://4router.net/console/token',
                balance_page_url: 'https://4router.net/wallet/start',
                money_only: moneyOnly,
              },
            } as unknown as MessageEvent)
          }
        }
      },
    }
    const sandbox = {
      location: {
        origin: 'https://4router.net',
        protocol: 'https:',
        href: moneyOnly
          ? 'https://4router.net/wallet/overview'
          : 'https://4router.net/console/token',
      },
      URL,
      AbortSignal,
      localStorage: { getItem: () => '{}' },
      performance: { getEntriesByType: () => [] },
      document: { querySelectorAll: () => [] },
      requestAnimationFrame: (callback: () => void) => callback(),
      window: { opener },
      addEventListener: (
        _type: string,
        listener: (event: MessageEvent) => void
      ) => listeners.add(listener),
      removeEventListener: (
        _type: string,
        listener: (event: MessageEvent) => void
      ) => listeners.delete(listener),
      fetch: vi.fn(async (path: string) => {
        if (path === '/api/user/self') {
          return new Response(
            JSON.stringify({
              success: true,
              data: { id: 17, username: 'owner' },
            })
          )
        }
        if (path.startsWith('/api/token/')) {
          return new Response(
            JSON.stringify({ success: true, data: { items: [], total: 0 } })
          )
        }
        return new Response(JSON.stringify({ success: true, data: [] }))
      }),
      alert: vi.fn(),
      setTimeout,
      clearTimeout,
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
    }
    const code = decodeURIComponent(
      authorizationBookmark(
        'https://www.cctq.ai',
        'https://hwjai.me',
        'previous-dialog'
      ).slice('javascript:'.length)
    )
    await runInNewContext(code.replace(/^void/, ''), sandbox)
    expect(
      posted.find((value) => value.type === 'hwjai-upstream-authorization')
    ).toMatchObject({
      nonce: 'current-dialog',
      discovery: {
        identity: { id: 17 },
        complete: !moneyOnly,
        connector: { kind: 'newapi' },
      },
    })
    expect(sandbox.fetch).toHaveBeenCalledWith(
      '/api/user/self',
      expect.anything()
    )
    if (moneyOnly) {
      expect(
        sandbox.fetch.mock.calls.some(([path]) =>
          path.startsWith('/api/token/')
        )
      ).toBe(false)
      expect(
        posted.find((value) => value.type === 'hwjai-upstream-authorization')
      ).toMatchObject({
        discovery: { money_only: true, keys: [] },
      })
    }
    sandbox.fetch.mockRejectedValue(new Error('network disconnected'))
    const renew = sandbox.setInterval.mock.calls[0]?.[0] as () => void
    renew()
    if (moneyOnly) {
      await vi.waitFor(() =>
        expect(
          posted.filter(
            (value) => value.type === 'hwjai-upstream-authorization'
          )
        ).toHaveLength(2)
      )
      expect(
        posted.filter(
          (value) => value.type === 'hwjai-upstream-authorization'
        )[1]
      ).toMatchObject({
        renewal: true,
        discovery: { money_only: true, balance_issue: 'not_found', keys: [] },
      })
      return
    }
    await vi.waitFor(
      () =>
        expect(posted).toContainEqual(
          expect.objectContaining({
            type: 'hwjai-upstream-disconnected',
            nonce: 'current-dialog',
          })
        ),
      { timeout: 10000 }
    )
  }
)
