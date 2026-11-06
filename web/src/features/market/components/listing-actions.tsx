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
import { ArrowDown, ArrowUp, Check, LogOut, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { formatListingId } from '../lib/market-helpers'
import type { MarketActions, MarketChannel } from '../types'
import { DisabledHint } from './disabled-hint'

export type MoveState = {
  canUp: boolean
  canDown: boolean
}

type ListingActionsProps = {
  modelName: string
  channel: MarketChannel
  /** 'model' is the collapsed model row, 'channel' a row inside an expansion */
  variant: 'model' | 'channel'
  actions: MarketActions
  /** model variant: another (non-lowest) channel of the model is joined */
  joinedElsewhere?: MarketChannel
  /** channel variant: reorder availability, only used with `actions.onMove` */
  moveState?: MoveState
  className?: string
}

export function ListingActions(props: ListingActionsProps) {
  const { t } = useTranslation()
  const { actions, channel, variant } = props
  const noKey = actions.tokenId === null
  const isModel = variant === 'model'
  const canMove = !isModel && channel.joined && actions.onMove !== undefined

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 @4xl:w-32 @4xl:shrink-0 @4xl:flex-col @4xl:items-stretch',
        props.className
      )}
    >
      {channel.joined ? (
        <>
          <Badge variant='secondary' className='justify-center'>
            <Check className='size-3' aria-hidden='true' />
            {isModel
              ? t('Joined')
              : t('Joined · slot {{position}}', { position: channel.position })}
          </Badge>
          <div className='flex items-center gap-1'>
            {canMove && (
              <>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Move up')}
                  disabled={actions.busy || !props.moveState?.canUp}
                  onClick={() =>
                    actions.onMove?.(
                      props.modelName,
                      channel.channel_id,
                      -1,
                      channel.listing_id
                    )
                  }
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Move down')}
                  disabled={actions.busy || !props.moveState?.canDown}
                  onClick={() =>
                    actions.onMove?.(
                      props.modelName,
                      channel.channel_id,
                      1,
                      channel.listing_id
                    )
                  }
                >
                  <ArrowDown />
                </Button>
              </>
            )}
            <Button
              variant='ghost'
              size='sm'
              className='flex-1'
              aria-label={t('Leave route')}
              disabled={actions.busy}
              onClick={() =>
                actions.onLeave(
                  props.modelName,
                  channel.channel_id,
                  channel.listing_id
                )
              }
            >
              <LogOut data-icon='inline-start' />
              {t('Leave route')}
            </Button>
          </div>
        </>
      ) : (
        <>
          {isModel && props.joinedElsewhere && (
            <Badge
              variant='outline'
              className='text-muted-foreground h-auto justify-center py-0.5 text-center whitespace-normal'
            >
              {t('Joined {{id}} (slot {{position}})', {
                id: formatListingId(props.joinedElsewhere.listing_id),
                position: props.joinedElsewhere.position,
              })}
            </Badge>
          )}
          <DisabledHint
            active={noKey}
            hint={t('Select or create an API key first')}
          >
            <Button
              size='sm'
              aria-label={t('Join route')}
              disabled={noKey || actions.busy}
              onClick={() =>
                actions.onJoin(
                  props.modelName,
                  channel.channel_id,
                  channel.listing_id
                )
              }
            >
              <Plus data-icon='inline-start' />
              {t('Join route')}
            </Button>
          </DisabledHint>
        </>
      )}
    </div>
  )
}
