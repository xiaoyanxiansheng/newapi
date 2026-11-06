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
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { DynamicPricingBreakdown } from '@/features/pricing/components/dynamic-pricing-breakdown'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  formatListingId,
  formatRatio,
  getMarketBaseModelName,
} from '../lib/market-helpers'
import type {
  MarketActions,
  MarketChannel,
  MarketModel,
  MarketVendor,
} from '../types'
import { LastSuccess } from './last-success'
import { ListingActions, type MoveState } from './listing-actions'
import { PriceGrid } from './price-grid'
import { ScoreBadge } from './score-badge'
import { SuccessStripes } from './success-stripes'
import { TokenConsumption } from './token-consumption'
import { VendorMark } from './vendor-mark'

type MarketListingRowProps = {
  model: MarketModel
  channel: MarketChannel
  /** 'model' shows the model block, 'channel' is headed by the channel id */
  variant: 'model' | 'channel'
  actions: MarketActions
  vendor?: MarketVendor
  /** channel variant: reorder availability */
  moveState?: MoveState
}

function Identity(props: MarketListingRowProps) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const { model, channel } = props
  const displayName = getMarketBaseModelName(model.model_name)
  const iconKey = model.icon || props.vendor?.icon
  const isAdmin = useAuthStore(
    (state) =>
      !!state.auth.user?.id &&
      (state.auth.user.role ?? ROLE.GUEST) >= ROLE.ADMIN
  )
  const listingId = formatListingId(channel.listing_id)
  const channelLabel =
    isAdmin && channel.channel_name
      ? [channel.website_name, channel.channel_name, listingId]
          .filter(Boolean)
          .join(' / ')
      : listingId

  return (
    <div className='flex min-w-0 items-start gap-2.5'>
      {props.variant === 'model' && (
        <div className='bg-muted/40 flex size-9 shrink-0 items-center justify-center rounded-lg'>
          <VendorMark
            icon={iconKey}
            name={props.vendor?.name || model.vendor_name}
          />
        </div>
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1'>
          {props.variant === 'model' ? (
            <>
              <h3
                className='truncate text-sm font-semibold tracking-tight'
                title={displayName}
              >
                {displayName}
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
            <h4 className='text-sm font-semibold'>{channelLabel}</h4>
          )}
        </div>
        <div className='mt-1 flex flex-wrap items-center gap-1.5'>
          {props.variant === 'model' ? (
            <>
              <span className='text-muted-foreground text-xs'>
                {props.vendor?.name || model.vendor_name || t('AI model')}
              </span>
              <Badge
                variant='outline'
                className='bg-primary/5 text-primary border-primary/15 max-w-full text-[10px] break-words whitespace-normal'
                title={channelLabel}
              >
                {channelLabel}
              </Badge>
            </>
          ) : null}
        </div>
        {props.variant === 'channel' && channel.description && (
          <p className='text-muted-foreground mt-1 line-clamp-2 text-xs'>
            {channel.description}
          </p>
        )}
      </div>
    </div>
  )
}

/** Compact model listing in the plaza, or channel controls inside a key route dialog. */
export function MarketListingRow(props: MarketListingRowProps) {
  const { t } = useTranslation()
  const { model, channel } = props
  const hideMonitoring =
    channel.monitoring_available === false ||
    model.quota_type === 1 ||
    channel.billing_mode === 'fixed_request'
  let billingLabel: string | null = null
  if (channel.billing_mode === 'tiered_expr') {
    billingLabel = t('Dynamic Pricing')
  } else if (channel.billing_mode?.startsWith('fixed_')) {
    billingLabel = t('Fixed pricing')
  }

  if (props.variant === 'model') {
    return (
      <div className='hwjai-market-row-content'>
        <div className='min-w-0'>
          <Identity {...props} />
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            <span className='rounded-md bg-blue-500/10 px-2 py-1 font-mono text-xs font-bold text-blue-700 dark:text-blue-300'>
              {formatRatio(channel.price_ratio ?? channel.ratio)}{' '}
              {t('Selling multiplier')}
            </span>
            {billingLabel && (
              <span className='text-muted-foreground text-[10px]'>
                {billingLabel}
              </span>
            )}
            {channel.billing_mode === 'tiered_expr' && (
              <span className='text-muted-foreground text-[10px]'>
                {t(
                  'Reference multiplier; final price follows the tier and request rules.'
                )}
              </span>
            )}
            {!hideMonitoring && channel.abnormal && (
              <Badge variant='destructive'>{t('Abnormal')}</Badge>
            )}
          </div>
        </div>
        <div className='hwjai-market-description min-w-0 rounded-lg px-3 py-2'>
          <p className='text-foreground/80 line-clamp-3 text-xs font-medium'>
            {channel.description || model.description || '—'}
          </p>
        </div>
        <div
          className='min-w-0 space-y-1.5'
          aria-label={
            hideMonitoring ? t('Monitoring not displayed') : undefined
          }
        >
          {hideMonitoring ? (
            <span className='text-muted-foreground text-xs'>{t('—')}</span>
          ) : (
            <>
              <SuccessStripes
                stats={channel.stats}
                defaultEmptySuccess={channel.default_success}
              />
              <LastSuccess stats={channel.stats} />
            </>
          )}
        </div>
        <div className='bg-muted/25 flex justify-center rounded-xl px-2 py-1'>
          {hideMonitoring ? (
            <span
              aria-label={t('Score not displayed')}
              className='text-muted-foreground font-mono text-2xl'
            >
              {t('—')}
            </span>
          ) : (
            <ScoreBadge score={channel.score} compact />
          )}
        </div>
        <TokenConsumption
          usage={hideMonitoring ? null : channel.stats?.probe_usage}
        />
        <div className='hwjai-market-row-pricing min-w-0'>
          <PriceGrid
            model={model}
            channel={channel}
            ratio={channel.ratio}
            plaza
          />
          {channel.billing_mode === 'tiered_expr' && (
            <details className='mt-2 text-xs'>
              <summary className='text-primary cursor-pointer'>
                {t('Dynamic pricing rules')}
              </summary>
              <DynamicPricingBreakdown
                billingExpr={channel.billing_expr}
                compact
              />
            </details>
          )}
          <div className='mt-2 flex justify-end'>
            <ListingActions
              modelName={model.model_name}
              channel={channel}
              variant='model'
              actions={props.actions}
              className='@4xl:w-auto @4xl:flex-row @4xl:items-center'
            />
          </div>
        </div>
      </div>
    )
  }

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
            <span className='inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-xs font-bold whitespace-nowrap text-blue-700 dark:text-blue-300'>
              <span className='font-mono'>
                {formatRatio(channel.price_ratio ?? channel.ratio)}
              </span>{' '}
              {t('Selling multiplier')}
            </span>
            {billingLabel && (
              <span className='text-muted-foreground text-[10px]'>
                {billingLabel}
              </span>
            )}
            {!hideMonitoring && channel.abnormal && (
              <Badge variant='destructive'>{t('Abnormal')}</Badge>
            )}
          </div>
          {hideMonitoring ? (
            <span
              aria-label={t('Monitoring not displayed')}
              className='text-muted-foreground text-xs'
            >
              {t('—')}
            </span>
          ) : (
            <>
              <SuccessStripes
                stats={channel.stats}
                defaultEmptySuccess={channel.default_success}
              />
              <LastSuccess stats={channel.stats} />
            </>
          )}
        </div>

        {hideMonitoring ? (
          <span
            aria-label={t('Score not displayed')}
            className='text-muted-foreground font-mono text-xl'
          >
            {t('—')}
          </span>
        ) : (
          <ScoreBadge
            score={channel.score}
            className='@4xl:w-36 @4xl:shrink-0'
          />
        )}

        <TokenConsumption
          usage={hideMonitoring ? null : channel.stats?.probe_usage}
        />
        <PriceGrid
          model={model}
          channel={channel}
          ratio={channel.ratio}
          className='@4xl:w-44 @4xl:shrink-0'
        />

        <ListingActions
          modelName={model.model_name}
          channel={channel}
          variant={props.variant}
          actions={props.actions}
          moveState={props.moveState}
        />
      </div>
    </div>
  )
}
