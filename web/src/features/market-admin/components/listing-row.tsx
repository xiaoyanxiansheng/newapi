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
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { TableCell, TableRow } from '@/components/ui/table'

import type { MarketListing, UpdateListingPayload } from '../types'
import { ChannelCell } from './channel-cell'
import { InlineNumberInput, InlineTextInput } from './inline-edit'
import { MonitorCell } from './monitor-cell'
import { SellableBadge } from './sellable-badge'

type ListingRowProps = {
  listing: MarketListing
  selected: boolean
  onSelectedChange: (id: number, selected: boolean) => void
  onUpdate: (id: number, payload: UpdateListingPayload) => Promise<boolean>
  onDelete: (id: number) => void
}

export function ListingRow(props: ListingRowProps) {
  const { t } = useTranslation()
  const [toggling, setToggling] = useState(false)
  const listing = props.listing

  const toggleEnabled = async (enabled: boolean) => {
    setToggling(true)
    await props.onUpdate(listing.id, { enabled })
    setToggling(false)
  }

  return (
    <TableRow data-state={props.selected ? 'selected' : undefined}>
      <TableCell>
        <Checkbox
          aria-label={t('Select row')}
          checked={props.selected}
          onCheckedChange={(checked) =>
            props.onSelectedChange(listing.id, checked === true)
          }
        />
      </TableCell>
      <TableCell>
        <ChannelCell
          channelId={listing.channel_id}
          channelName={listing.channel_name}
          channelStatus={listing.channel_status}
        />
      </TableCell>
      <TableCell className='font-mono text-sm'>{listing.model_name}</TableCell>
      <TableCell>
        <InlineNumberInput
          label={t('Ratio')}
          value={listing.ratio}
          onCommit={(ratio) => props.onUpdate(listing.id, { ratio })}
        />
      </TableCell>
      <TableCell>
        <Switch
          aria-label={t('Enabled')}
          checked={listing.enabled}
          disabled={toggling}
          onCheckedChange={toggleEnabled}
        />
      </TableCell>
      <TableCell>
        <SellableBadge listing={listing} />
      </TableCell>
      <TableCell>
        <MonitorCell listing={listing} />
      </TableCell>
      <TableCell>
        <InlineTextInput
          label={t('Description')}
          value={listing.description}
          onCommit={(description) =>
            props.onUpdate(listing.id, { description })
          }
        />
      </TableCell>
      <TableCell>
        <InlineNumberInput
          label={t('Sort order')}
          value={listing.sort_order}
          integer
          min={-1000000}
          className='w-20'
          onCommit={(sort_order) => props.onUpdate(listing.id, { sort_order })}
        />
      </TableCell>
      <TableCell className='text-right'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={t('Delete')}
          onClick={() => props.onDelete(listing.id)}
        >
          <Trash2 className='text-destructive' aria-hidden='true' />
        </Button>
      </TableCell>
    </TableRow>
  )
}
