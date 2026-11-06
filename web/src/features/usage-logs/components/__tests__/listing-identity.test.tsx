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
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { usageLogSchema, type UsageLog } from '../../data/schema'
import { useCommonLogsColumns } from '../columns/common-logs-columns'
import { DetailsDialog } from '../dialogs/details-dialog'
import { UsageLogsProvider } from '../usage-logs-provider'

vi.mock('@lobehub/icons', () => ({ Gemini: { Color: () => null } }))

function ChannelCell(props: {
  log: UsageLog
  isAdmin?: boolean
  modelCell?: boolean
}) {
  const columns = useCommonLogsColumns(props.isAdmin ?? true).filter((column) =>
    props.modelCell
      ? 'accessorKey' in column && column.accessorKey === 'model_name'
      : column.id === 'channel'
  )
  const table = useReactTable({
    data: [props.log],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  const cell = table.getRowModel().rows[0].getVisibleCells()[0]
  return <>{flexRender(cell.column.columnDef.cell, cell.getContext())}</>
}

function renderIdentity(listingId?: number, other = '') {
  const log = Object.assign(
    usageLogSchema.parse({
      id: 1,
      user_id: 1,
      created_at: 1,
      type: 2,
      content: '',
      channel: 22,
      model_name: 'gemini-4-argon',
      other,
    }),
    { market_listing_id: listingId }
  )
  return render(
    <UsageLogsProvider>
      <ChannelCell log={log} />
    </UsageLogsProvider>
  )
}

describe('usage log model identity', () => {
  test('shows the listing ID beside the model for ordinary users', () => {
    const log = usageLogSchema.parse({
      id: 1,
      user_id: 1,
      created_at: 1,
      type: 2,
      content: '',
      channel: 22,
      model_name: 'gemini-4-argon',
      market_listing_id: 102,
    })
    render(
      <UsageLogsProvider>
        <ChannelCell log={log} isAdmin={false} modelCell />
      </UsageLogsProvider>
    )
    expect(screen.getByText('ID00102')).toBeInTheDocument()
    expect(screen.queryByText('ID00022')).not.toBeInTheDocument()
  })
  test('preserves the listing ID when parsing the server response', () => {
    const log = usageLogSchema.parse({
      id: 1,
      user_id: 1,
      created_at: 1,
      type: 2,
      content: '',
      channel: 22,
      market_listing_id: 102,
    })
    expect(log.market_listing_id).toBe(102)
  })
  test('shows the API Key listing ID rather than the internal channel ID', () => {
    renderIdentity(102)
    expect(screen.getByText('ID00102')).toBeInTheDocument()
    expect(screen.queryByText('ID00022')).not.toBeInTheDocument()
  })

  test('does not invent a listing ID when a historical route cannot be resolved', () => {
    renderIdentity()
    expect(screen.queryByText('ID00022')).not.toBeInTheDocument()
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  test('shows API Key listing IDs in the retry chain', async () => {
    renderIdentity(
      101,
      JSON.stringify({
        admin_info: { use_channel: [22, 14], use_market_listings: [102, 101] },
      })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Retry Chain' }))
    expect(screen.getByText('ID00102 → ID00101')).toBeInTheDocument()
    expect(screen.queryByText('ID00022 → ID00014')).not.toBeInTheDocument()
  })

  test('shows the same ID in details and hides channel names from ordinary users', () => {
    const log = usageLogSchema.parse({
      id: 1,
      user_id: 1,
      created_at: 1,
      type: 2,
      content: '',
      channel: 22,
      channel_name: 'private-upstream',
      market_listing_id: 102,
    })
    render(
      <DetailsDialog log={log} isAdmin={false} open onOpenChange={() => {}} />
    )
    expect(screen.getByText('ID00102')).toBeInTheDocument()
    expect(screen.queryByText(/private-upstream/)).not.toBeInTheDocument()
  })
})
