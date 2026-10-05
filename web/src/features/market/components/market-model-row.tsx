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
import { memo, useState } from 'react'

import type { MarketActions, MarketModel, MarketVendor } from '../types'
import { MarketChannelList } from './market-channel-list'
import { MarketListingRow } from './market-listing-row'

type MarketModelRowProps = {
  model: MarketModel
  vendor?: MarketVendor
  actions: MarketActions
}

export const MarketModelRow = memo(function MarketModelRow(
  props: MarketModelRowProps
) {
  const [expanded, setExpanded] = useState(false)

  const { model } = props
  const channels = model.channels ?? []
  const lowest = channels[0]
  if (!lowest) return null

  const joinedElsewhere = lowest.joined
    ? undefined
    : channels.find((channel) => channel.joined)

  return (
    <div className='bg-card overflow-hidden rounded-xl border'>
      <MarketListingRow
        model={model}
        channel={lowest}
        variant='model'
        vendor={props.vendor}
        actions={props.actions}
        channelCount={channels.length}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        joinedElsewhere={joinedElsewhere}
      />
      {expanded && (
        <div className='bg-muted/20 border-t'>
          <MarketChannelList model={model} actions={props.actions} />
        </div>
      )}
    </div>
  )
})
