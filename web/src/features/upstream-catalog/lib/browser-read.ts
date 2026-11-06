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
export type BrowserReadOptions = { moneyOnly?: boolean }

const readers = new Map<
  number,
  (options?: BrowserReadOptions) => Promise<void>
>()
const helperReaders = new Map<
  number,
  (options?: BrowserReadOptions) => Promise<void>
>()

export function registerBrowserReader(
  accountId: number,
  read: (options?: BrowserReadOptions) => Promise<void>,
  helper = false
): () => void {
  const registry = helper ? helperReaders : readers
  registry.set(accountId, read)
  return () => {
    if (registry.get(accountId) === read) registry.delete(accountId)
  }
}

export async function refreshThroughBrowser(
  accountId: number,
  options?: BrowserReadOptions
): Promise<void> {
  const read = helperReaders.get(accountId) ?? readers.get(accountId)
  if (!read) {
    throw new Error(
      options?.moneyOnly
        ? 'Open the upstream website and click the authorization bookmark to refresh its balance.'
        : 'Open the upstream website and click the authorization bookmark to refresh its Keys.'
    )
  }
  await read(options)
}
