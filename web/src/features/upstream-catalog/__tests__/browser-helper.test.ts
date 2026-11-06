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
import { expect, test, vi, afterEach } from 'vitest'

import { api } from '@/lib/api'

import type { BrowserDiscovery } from '../lib/browser-discovery'
import {
  requestBrowserHelper,
  saveHelperDiscovery,
} from '../lib/browser-helper'

afterEach(() => vi.restoreAllMocks())
test('parallel balance refreshes are queued and each accepts only its own exact-origin reply', async () => {
  const messages: Array<{ request_id: string }> = []
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    messages.push(message)
  })
  const first = requestBrowserHelper(
    'read',
    [{ id: 1, name: 'A', url: 'https://a.example/keys' }],
    true
  )
  const second = requestBrowserHelper(
    'read',
    [{ id: 2, name: 'B', url: 'https://b.example/keys' }],
    true
  )
  await Promise.resolve()
  expect(messages).toHaveLength(1)
  const reply = (id: string, origin: string, result: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin,
        data: { type: 'hwjai-helper-response', request_id: id, result },
      })
    )
  reply(messages[0].request_id, 'https://other.example', { opened: [999] })
  reply('stale-id', location.origin, { opened: [999] })
  reply(messages[0].request_id, location.origin, { opened: [1] })
  expect(await first).toEqual({ opened: [1] })
  await Promise.resolve()
  expect(messages).toHaveLength(2)
  reply(messages[1].request_id, location.origin, { opened: [2] })
  expect(await second).toEqual({ opened: [2] })
})
test('a wrong-origin snapshot or a full Key result cannot be saved as a balance refresh', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        account: { website: 'https://a.example', revision: 2 },
        keys: [],
      },
    },
  })
  const post = vi.spyOn(api, 'post')
  const discovery: BrowserDiscovery = {
    page_url: 'https://other.example/keys',
    connector: { kind: 'newapi' },
    identity: { id: 1, username: 'owner', email: '' },
    keys: [],
    complete: true,
  }
  await expect(saveHelperDiscovery(1, discovery, true)).rejects.toThrow(
    'Invalid website reading result'
  )
  await expect(
    saveHelperDiscovery(
      1,
      { ...discovery, page_url: 'https://a.example/keys' },
      true
    )
  ).rejects.toThrow('balance-only')
  expect(post).not.toHaveBeenCalled()
})
