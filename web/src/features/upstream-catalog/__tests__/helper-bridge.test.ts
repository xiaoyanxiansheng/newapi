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
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { expect, test, vi } from 'vitest'
const source = readFileSync('browser-extension/bridge.js', 'utf8')
function installBridge() {
  const win: {
    top?: unknown
    addEventListener: ReturnType<typeof vi.fn>
    postMessage: ReturnType<typeof vi.fn>
  } = { addEventListener: vi.fn(), postMessage: vi.fn() }
  win.top = win
  const listener = vi.fn()
  runInNewContext(source, {
    window: win,
    location: { origin: 'https://hwjai.me' },
    chrome: { runtime: { onMessage: { addListener: listener } } },
  })
  return {
    win,
    receive: listener.mock.calls[0][0] as (
      message: unknown,
      sender: unknown,
      respond: (value: unknown) => void
    ) => void,
  }
}
test('the approved batch reply is delivered to its hwjai origin and acknowledged so Chrome can finish the authorization', () => {
  const bridge = installBridge()
  const respond = vi.fn()
  const message = {
    type: 'hwjai-helper-response',
    client_origin: 'https://hwjai.me',
    request_id: 'current',
    result: { results: [] },
  }
  bridge.receive(message, {}, respond)
  expect(bridge.win.postMessage).toHaveBeenCalledWith(
    message,
    'https://hwjai.me'
  )
  expect(respond).toHaveBeenCalledWith({ accepted: true })
})
test('a batch reply for a different hwjai origin is never delivered to the current page', () => {
  const bridge = installBridge()
  const respond = vi.fn()
  bridge.receive(
    {
      type: 'hwjai-helper-response',
      client_origin: 'http://localhost:3001',
      request_id: 'other',
    },
    {},
    respond
  )
  expect(bridge.win.postMessage).not.toHaveBeenCalled()
  expect(respond).not.toHaveBeenCalled()
})
