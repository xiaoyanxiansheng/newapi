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
import type { CatalogRow } from '../types'

export function getListingStatus(
  row: CatalogRow
): 'listed' | 'paused' | 'other' {
  if (!row.listing) return 'other'
  return row.listing.enabled ? 'listed' : 'paused'
}

export const LISTING_STATUS_ORDER = { listed: 0, paused: 1, other: 2 }
export const LISTING_STATUS_LABEL = {
  listed: 'Listed',
  paused: 'Listing paused',
  other: 'Not listed',
}
export const LISTING_STATUS_COLOR = {
  listed:
    'inline-flex rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300',
  paused:
    'inline-flex rounded-md bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300',
  other:
    'bg-muted text-muted-foreground inline-flex rounded-md px-2 py-1 text-xs',
}
