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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { ApiKeyProjectCard } from '../components/api-key-project-card'
import { ApiKeysProvider, useApiKeys } from '../components/api-keys-provider'
import type { ApiKey } from '../types'

const key: ApiKey = {
  id: 3,
  name: 'Application integration',
  key: 'masked',
  status: 1,
  remain_quota: 1000,
  used_quota: 0,
  unlimited_quota: false,
  expired_time: -1,
  created_time: 0,
  accessed_time: 0,
  auto_route: true,
  routes: [{ model: 'test-model', channels: [7] }],
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
}
function Project() {
  const table = useReactTable({
    data: [key],
    columns: [{ accessorKey: 'name' }],
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  })
  const state = useApiKeys()
  const row = table.getRowModel().rows[0]
  return (
    <>
      <ApiKeyProjectCard row={row} now={0} isSelected={row.getIsSelected()} />
      <output>
        {state.open === 'routes' && state.currentRow
          ? 'Configuring ' + state.currentRow.name
          : ''}
      </output>
    </>
  )
}
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
})
afterEach(async () => {
  cleanup()
  await client.cancelQueries()
  client.clear()
  localStorage.clear()
})

test('opens model routing from a project card and preserves row selection', async () => {
  client.setQueryData(['status'], {})
  render(
    <QueryClientProvider client={client}>
      <ApiKeysProvider>
        <Project />
      </ApiKeysProvider>
    </QueryClientProvider>
  )
  expect(screen.getByText('test-model')).toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Select Application integration' })
  )
  expect(
    screen.getByRole('checkbox', { name: 'Select Application integration' })
  ).toBeChecked()
  await userEvent.click(
    screen.getByRole('button', { name: 'Configure models' })
  )
  expect(
    screen.getByText('Configuring Application integration')
  ).toBeInTheDocument()
})
