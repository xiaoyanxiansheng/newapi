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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { formatRatio, sortChannelsForDisplay } from '../lib/market-helpers'
import type { MarketActions, MarketChannel, MarketModel } from '../types'
import type { MoveState } from './listing-actions'
import { MarketListingRow } from './market-listing-row'

/** A channel that is still in the key's route but no longer in the market. */
export type UnavailableChannel = {
  channel_id: number
  ratio: number
}

type MarketChannelListProps = {
  model: MarketModel
  /** Defaults to every channel of the model */
  channels?: MarketChannel[]
  unavailable?: UnavailableChannel[]
  /**
   * Channel ids in the key's route order (including unavailable ones). Used
   * to enable / disable the reorder buttons; falls back to the joined
   * channels' positions.
   */
  routeOrder?: number[]
  actions: MarketActions
}

export function UnavailableChannelRow(props: {
  modelName: string
  channel: UnavailableChannel
  actions: MarketActions
}) {
  const { t } = useTranslation()
  const { channel, actions } = props

  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 @4xl:pl-6'>
      <span className='text-sm font-semibold'>
        {t('Channel #{{id}}', { id: channel.channel_id })}
      </span>
      <span className='text-muted-foreground font-mono text-xs'>
        {formatRatio(channel.ratio)}
      </span>
      <Badge variant='destructive'>{t('Unavailable')}</Badge>
      <Button
        variant='ghost'
        size='sm'
        className='ml-auto'
        aria-label={t('Remove')}
        disabled={actions.busy}
        onClick={() => actions.onLeave(props.modelName, channel.channel_id)}
      >
        <Trash2 data-icon='inline-start' />
        {t('Remove')}
      </Button>
    </div>
  )
}

/**
 * Same-model channel list: joined channels first (by route position), then
 * the rest by ratio. Used by the plaza expansion and the key route dialog.
 */
export function MarketChannelList(props: MarketChannelListProps) {
  const { model } = props

  const sorted = useMemo(
    () => sortChannelsForDisplay(props.channels ?? model.channels ?? []),
    [props.channels, model.channels]
  )

  const order = useMemo(
    () =>
      props.routeOrder ??
      sorted.filter((channel) => channel.joined).map((c) => c.channel_id),
    [props.routeOrder, sorted]
  )

  const moveStateOf = (channel: MarketChannel): MoveState => {
    const index = order.indexOf(channel.channel_id)
    return { canUp: index > 0, canDown: index >= 0 && index < order.length - 1 }
  }

  return (
    <div className='divide-y'>
      {sorted.map((channel) => (
        <MarketListingRow
          key={channel.channel_id}
          model={model}
          channel={channel}
          variant='channel'
          actions={props.actions}
          moveState={moveStateOf(channel)}
        />
      ))}
      {(props.unavailable ?? []).map((channel) => (
        <UnavailableChannelRow
          key={channel.channel_id}
          modelName={model.model_name}
          channel={channel}
          actions={props.actions}
        />
      ))}
    </div>
  )
}
