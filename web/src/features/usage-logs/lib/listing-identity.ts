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
import { formatListingId } from '@/features/market/lib/market-helpers'

export function formatLogListingId(id?: number): string {
  return id !== undefined && Number.isSafeInteger(id) && id > 0
    ? formatListingId(id)
    : '-'
}

export function formatLogListingChain(ids?: number[]): string | undefined {
  return ids && ids.length > 1
    ? ids.map(formatLogListingId).join(' → ')
    : undefined
}
