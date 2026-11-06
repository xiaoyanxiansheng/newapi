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
import type { BrowserDiscovery, DiscoveryRecipe } from './browser-discovery'

export type HelperAccount = {
  id: number
  name: string
  url: string
  balance_page_url?: string
  recipe?: DiscoveryRecipe
}
export type HelperRequest = {
  operation: 'ping' | 'open' | 'read' | 'job' | 'approve'
  request_id: string
  accounts?: HelperAccount[]
  money_only?: boolean
  job_id?: string
}
export type HelperReply = {
  ready?: boolean
  version?: number
  pending?: boolean
  opened?: number[]
  origins?: string[]
  accounts?: HelperAccount[]
  results?: Array<{ id: number; discovery?: BrowserDiscovery; error?: string }>
}
