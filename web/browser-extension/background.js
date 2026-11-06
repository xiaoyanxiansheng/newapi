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
import { discoverUpstreamPage } from './browser-discovery.js'
import { createExtensionHelper } from './extension-core.js'

const helper = createExtensionHelper(chrome, discoverUpstreamPage)
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  helper
    .handle(request, sender)
    .then((result) => respond({ result }))
    .catch((error) =>
      respond({
        error:
          error instanceof Error
            ? error.message
            : 'The browser helper could not complete this request.',
      })
    )
  return true
})
