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
import { ChevronRight, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampRelative } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import { formatListingId, formatRatio } from '../lib/market-helpers'
import type {
  MarketActions,
  MarketChannel,
  MarketModel,
  MarketVendor,
} from '../types'
import { ListingActions, type MoveState } from './listing-actions'
import { PriceGrid } from './price-grid'
import { ScoreBadge } from './score-badge'
import { SuccessStripes } from './success-stripes'

type MarketListingRowProps = {
  model: MarketModel
  channel: MarketChannel
  /** 'model' shows the model block, 'channel' is headed by the channel id */
  variant: 'model' | 'channel'
  actions: MarketActions
  vendor?: MarketVendor
  /** model variant: total channels of the model (toggle shown when > 1) */
  channelCount?: number
  expanded?: boolean
  onToggle?: () => void
  /** model variant: another (non-lowest) channel of the model is joined */
  joinedElsewhere?: MarketChannel
  /** channel variant: reorder availability */
  moveState?: MoveState
}

function LastSuccess(props: { channel: MarketChannel }) {
  const { t, i18n } = useTranslation()
  const stats = props.channel.stats

  let text: string
  if (!stats) {
    text = t('Not enough data')
  } else if (stats.last_success_at > 0) {
    text = t('Last success {{time}}', {
      time: formatTimestampRelative(
        stats.last_success_at,
        'seconds',
        toIntlLocale(i18n.resolvedLanguage || i18n.language)
      ),
    })
  } else {
    text = t('No successful requests yet')
  }

  return <span className='text-muted-foreground text-[11px]'>{text}</span>
}

function Identity(props: MarketListingRowProps) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const { model, channel } = props
  const iconKey = model.icon || props.vendor?.icon

  return (
    <div className='flex min-w-0 items-start gap-2.5 @4xl:min-w-48 @4xl:flex-1'>
      {props.variant === 'model' && (
        <div className='bg-muted/40 flex size-9 shrink-0 items-center justify-center rounded-lg'>
          {getLobeIcon(iconKey, 24)}
        </div>
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1'>
          {props.variant === 'model' ? (
            <>
              <h3
                className='truncate font-mono text-[15px] font-bold'
                title={model.model_name}
              >
                {model.model_name}
              </h3>
              <button
                type='button'
                aria-label={t('Copy name')}
                title={t('Copy name')}
                onClick={() => copyToClipboard(model.model_name)}
                className='text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded-md p-1 transition-colors'
              >
                <Copy className='size-3.5' />
              </button>
            </>
          ) : (
            <h4 className='text-sm font-semibold'>
              {t('Channel #{{id}}', { id: channel.channel_id })}
            </h4>
          )}
        </div>
        <div className='mt-1 flex flex-wrap items-center gap-1.5'>
          <Badge variant='outline' className='font-mono text-[11px]'>
            {formatListingId(channel.listing_id)}
          </Badge>
        </div>
        {channel.description && (
          <p className='text-muted-foreground mt-1 line-clamp-2 text-xs'>
            {channel.description}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * One listing row: identity, ratio, success stripes, score and prices, with
 * join / leave actions on the right. Shared by the plaza (collapsed and
 * expanded rows) and the key route dialog. It lays itself out from its own
 * width (container queries), so it also works inside a dialog.
 */
export function MarketListingRow(props: MarketListingRowProps) {
  const { t } = useTranslation()
  const { model, channel } = props
  const showToggle =
    props.variant === 'model' &&
    (props.channelCount ?? 0) > 1 &&
    props.onToggle !== undefined

  return (
    <div
      className={cn(
        '@container',
        props.variant === 'channel' && channel.joined && 'bg-primary/5'
      )}
    >
      <div
        className={cn(
          'flex flex-col gap-3 p-3 @4xl:flex-row @4xl:items-center @4xl:gap-4',
          props.variant === 'channel' && '@4xl:pl-6'
        )}
      >
        <Identity {...props} />

        <div className='flex flex-col gap-1.5 @4xl:w-44 @4xl:shrink-0'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <span className='bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap'>
              <span className='font-mono'>{formatRatio(channel.ratio)}</span>
              {t('Ratio')}
            </span>
            {channel.abnormal && (
              <Badge variant='destructive'>{t('Abnormal')}</Badge>
            )}
          </div>
          <SuccessStripes stats={channel.stats} />
          <LastSuccess channel={channel} />
        </div>

        <ScoreBadge score={channel.score} className='@4xl:w-36 @4xl:shrink-0' />

        <PriceGrid
          model={model}
          ratio={channel.ratio}
          className='@4xl:w-44 @4xl:shrink-0'
        />

        <ListingActions
          modelName={model.model_name}
          channel={channel}
          variant={props.variant}
          actions={props.actions}
          joinedElsewhere={props.joinedElsewhere}
          moveState={props.moveState}
        />
      </div>

      {showToggle && (
        <button
          type='button'
          aria-expanded={props.expanded}
          aria-label={t('Toggle channels')}
          onClick={props.onToggle}
          className='text-muted-foreground hover:text-foreground hover:bg-muted/50 flex w-full items-center gap-1 border-t px-3 py-1.5 text-xs transition-colors'
        >
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform',
              props.expanded && 'rotate-90'
            )}
            aria-hidden='true'
          />
          {t('{{count}} channels in total', { count: props.channelCount })}
        </button>
      )}
    </div>
  )
}
