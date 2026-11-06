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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'

import { useDashboardContentVisibility } from '../hooks/use-status-data'

test('hides empty workspace panels rather than reserving blank card space', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  })
  client.setQueryData(['status'], { api_info: [], announcements: [], faq: [] })
  const wrapper = (props: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
  const { result, unmount } = renderHook(useDashboardContentVisibility, {
    wrapper,
  })
  expect(result.current).toMatchObject({
    apiInfo: false,
    announcements: false,
    faq: false,
  })
  unmount()
  await client.cancelQueries()
  client.clear()
})

test('keeps populated workspace content visible and respects its administrator switch', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  })
  client.setQueryData(['status'], {
    api_info: [{ url: 'https://hwjai.me' }],
    announcements: [{ content: 'Maintenance window' }],
    faq: [{ question: 'How to connect?' }],
    faq_enabled: false,
  })
  const wrapper = (props: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
  const { result, unmount } = renderHook(useDashboardContentVisibility, {
    wrapper,
  })
  expect(result.current).toMatchObject({
    apiInfo: true,
    announcements: true,
    faq: false,
  })
  unmount()
  await client.cancelQueries()
  client.clear()
})
