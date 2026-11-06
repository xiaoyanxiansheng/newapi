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
import { memo } from 'react'

import type { MarketActions, MarketModel, MarketVendor } from '../types'
import { MarketListingRow } from './market-listing-row'

export const MarketModelRow = memo(function MarketModelRow(props: {
  model: MarketModel
  vendor?: MarketVendor
  actions: MarketActions
}) {
  return (
    <>
      {props.model.channels.map((channel) => (
        <article
          key={channel.listing_id}
          className='hwjai-market-row @container rounded-2xl'
          onPointerMove={(event) => {
            if (event.pointerType !== 'mouse') return
            const rect = event.currentTarget.getBoundingClientRect()
            event.currentTarget.style.setProperty(
              '--pointer-x',
              `${event.clientX - rect.left}px`
            )
            event.currentTarget.style.setProperty(
              '--pointer-y',
              `${event.clientY - rect.top}px`
            )
          }}
        >
          <MarketListingRow
            model={props.model}
            channel={channel}
            variant='model'
            vendor={props.vendor}
            actions={props.actions}
          />
        </article>
      ))}
    </>
  )
})
