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
if (
  [
    'https://hwjai.me',
    'http://127.0.0.1:3001',
    'http://localhost:3001',
  ].includes(location.origin) &&
  window === window.top
) {
  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== 'hwjai-helper-request'
    ) {
      return
    }
    const request = event.data
    if (
      !['ping', 'open', 'read'].includes(request.operation) ||
      typeof request.request_id !== 'string' ||
      request.request_id.length > 100
    ) {
      return
    }
    if (JSON.stringify(request).length > 128000) return
    chrome.runtime
      .sendMessage(request)
      .then((reply) => {
        if (reply?.result?.pending) return
        window.postMessage(
          {
            type: 'hwjai-helper-response',
            request_id: request.request_id,
            ...reply,
          },
          location.origin
        )
      })
      .catch(() =>
        window.postMessage(
          {
            type: 'hwjai-helper-response',
            request_id: request.request_id,
            error: 'Browser helper is not installed.',
          },
          location.origin
        )
      )
  })
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (
      message.type === 'hwjai-helper-response' &&
      message.client_origin === location.origin
    ) {
      window.postMessage(message, location.origin)
      respond({ accepted: true })
    }
  })
}
