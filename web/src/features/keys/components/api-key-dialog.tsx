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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Plus, Store, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { MARKET_MODELS_QUERY_KEY } from '@/features/market/api'
import {
  MarketChannelList,
  UnavailableChannelRow,
} from '@/features/market/components/market-channel-list'
import { useMarketModels } from '@/features/market/hooks/use-market-models'
import {
  formatRatioValue,
  formatListingId,
} from '@/features/market/lib/market-helpers'
import type { MarketActions, MarketModel } from '@/features/market/types'
import { cn } from '@/lib/utils'

import {
  addTokenRouteModel,
  getApiKey,
  getTokenRoutes,
  removeTokenRouteModel,
  reorderTokenRoute,
  setTokenAutoRoute,
} from '../api'
import { API_KEY_ROUTES_QUERY_KEY } from '../constants'
import type { ApiKey, ApiResponse, RouteModel, TokenRoutesData } from '../types'
import { ApiKeySettingsForm } from './api-key-settings-form'

const NO_ROUTES: RouteModel[] = []

type ApiKeyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The key to edit; leave empty to create a new key */
  tokenId?: number
  /** Called after any route change so the owner can refresh its own lists */
  onChanged?: () => void
  /** Hide the "Model Plaza" shortcut (e.g. when opened from the plaza) */
  hideMarketLink?: boolean
}

type RouteModelBlockProps = {
  route: RouteModel
  /** Plaza data of the model, undefined while loading or when delisted */
  marketModel?: MarketModel
  isMarketLoading: boolean
  actions: MarketActions
  /** Open on first render, used for a model that was just added */
  defaultExpanded: boolean
  onRemoveModel: (model: string) => void
}

function RouteModelBlock(props: RouteModelBlockProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(props.defaultExpanded)
  const { route, marketModel } = props

  const unavailable = route.channels.filter(
    (channel) =>
      !(marketModel?.channels ?? []).some((item) =>
        channel.listing_id
          ? item.listing_id === channel.listing_id
          : item.channel_id === channel.channel_id
      )
  )

  return (
    <div className='overflow-hidden rounded-md border'>
      <div className='hover:bg-muted/50 flex items-center transition-colors'>
        <button
          type='button'
          aria-expanded={expanded}
          aria-label={t('Toggle options')}
          onClick={() => setExpanded((value) => !value)}
          className='flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-left'
        >
          <ChevronRight
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform',
              expanded && 'rotate-90'
            )}
            aria-hidden='true'
          />
          <span className='font-mono text-sm font-medium'>{route.model}</span>
          <span className='flex flex-wrap items-center gap-1'>
            {route.channels.length === 0 && (
              <Badge variant='destructive'>{t('No option selected')}</Badge>
            )}
            {route.channels.map((channel) => {
              const listingId = marketModel?.channels.find((item) =>
                channel.listing_id
                  ? item.listing_id === channel.listing_id
                  : item.channel_id === channel.channel_id
              )?.listing_id
              const displayId = listingId ?? channel.listing_id
              return (
                <Badge
                  key={channel.listing_id ?? channel.channel_id}
                  variant={channel.available ? 'outline' : 'destructive'}
                  className='font-mono'
                >
                  {displayId ? formatListingId(displayId) : t('Unavailable ID')}{' '}
                  ×{formatRatioValue(channel.ratio)}
                </Badge>
              )
            })}
          </span>
        </button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='mr-2 shrink-0'
          aria-label={t('Remove model')}
          disabled={props.actions.busy}
          onClick={() => props.onRemoveModel(route.model)}
        >
          <Trash2 data-icon='inline-start' />
          {t('Remove model')}
        </Button>
      </div>

      {expanded && (
        <div className='bg-muted/20 border-t'>
          {marketModel ? (
            <MarketChannelList
              model={marketModel}
              unavailable={unavailable}
              routeOrder={route.channels.map((channel) => channel.channel_id)}
              listingOrder={
                route.channels.every((channel) => channel.listing_id)
                  ? route.channels.map((channel) => channel.listing_id ?? 0)
                  : undefined
              }
              actions={props.actions}
            />
          ) : (
            <div className='divide-y'>
              {props.isMarketLoading && <Skeleton className='m-3 h-20' />}
              {!props.isMarketLoading && unavailable.length === 0 && (
                <p className='text-muted-foreground p-3 text-sm'>
                  {t('No option is available for this model.')}
                </p>
              )}
              {!props.isMarketLoading &&
                unavailable.map((channel) => (
                  <UnavailableChannelRow
                    key={channel.listing_id ?? channel.channel_id}
                    modelName={route.model}
                    channel={channel}
                    actions={props.actions}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ApiKeyDialog(props: ApiKeyDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [isChanging, setIsChanging] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [justAdded, setJustAdded] = useState<string | null>(null)
  // A key created inside this dialog becomes the key being edited, so models can be added right away.
  const [createdId, setCreatedId] = useState<number | undefined>()
  const tokenId = props.tokenId ?? createdId
  const isActive = props.open && tokenId !== undefined
  const routesQueryKey = [API_KEY_ROUTES_QUERY_KEY, tokenId]

  const routesQuery = useQuery({
    queryKey: routesQueryKey,
    queryFn: () => getTokenRoutes(tokenId ?? 0),
    enabled: isActive,
    staleTime: 0,
  })
  const keyQuery = useQuery({
    queryKey: ['api-key', tokenId],
    queryFn: () => getApiKey(tokenId ?? 0),
    enabled: isActive,
    staleTime: 0,
  })
  const apiKey: ApiKey | undefined = keyQuery.data?.success
    ? keyQuery.data.data
    : undefined
  const market = useMarketModels(tokenId ?? null, {
    enabled: isActive,
    onChanged: props.onChanged,
  })

  const routes = routesQuery.data?.data?.routes ?? NO_ROUTES
  const autoRoute = routesQuery.data?.data?.auto_route ?? false

  const marketModels = useMemo(
    () => new Map(market.models.map((model) => [model.model_name, model])),
    [market.models]
  )

  const applyResult = async (result: ApiResponse<TokenRoutesData>) => {
    if (!result.success) {
      toast.error(result.message || t('Operation failed'))
      return
    }
    queryClient.setQueryData(routesQueryKey, result)
    await queryClient.invalidateQueries({ queryKey: MARKET_MODELS_QUERY_KEY })
    props.onChanged?.()
  }

  const runChange = async (change: () => Promise<void>) => {
    setIsChanging(true)
    try {
      await change()
    } finally {
      setIsChanging(false)
    }
  }

  const actions: MarketActions = {
    tokenId: tokenId ?? null,
    busy: market.isMutating || isChanging,
    onJoin: (model, channelId, listingId) => {
      if (tokenId !== undefined) {
        market.join({ tokenId, model, channelId, listingId })
      }
    },
    onLeave: (model, channelId, listingId) => {
      if (tokenId !== undefined) {
        market.leave({ tokenId, model, channelId, listingId })
      }
    },
    onMove: (model, channelId, delta, listingId) => {
      const selectedRoute = routes.find((route) => route.model === model)
      if (tokenId === undefined || !selectedRoute) return
      const channels = [...selectedRoute.channels]
      const index = channels.findIndex((channel) =>
        listingId
          ? channel.listing_id === listingId
          : channel.channel_id === channelId
      )
      const target = index + delta
      if (index < 0 || target < 0 || target >= channels.length) return
      const [moved] = channels.splice(index, 1)
      channels.splice(target, 0, moved)
      runChange(async () =>
        applyResult(
          await reorderTokenRoute(
            tokenId,
            model,
            channels.map((channel) => channel.channel_id),
            channels.every((channel) => channel.listing_id)
              ? channels.map((channel) => channel.listing_id ?? 0)
              : undefined
          )
        )
      )
    },
  }

  const handleAutoRoute = (checked: boolean) =>
    runChange(async () =>
      applyResult(await setTokenAutoRoute(tokenId ?? 0, checked))
    )

  const addableModels = useMemo(() => {
    const inRoutes = new Set(routes.map((route) => route.model))
    return market.models.filter((model) => !inRoutes.has(model.model_name))
  }, [market.models, routes])

  const handleAddModel = (modelName: string) => {
    if (tokenId === undefined) return
    setPickerOpen(false)
    runChange(async () => {
      const result = await addTokenRouteModel(tokenId, modelName)
      if (result.success) setJustAdded(modelName)
      await applyResult(result)
    })
  }

  const handleRemoveModel = (modelName: string) => {
    if (tokenId === undefined) return
    runChange(async () =>
      applyResult(await removeTokenRouteModel(tokenId, modelName))
    )
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setCreatedId(undefined)
      setJustAdded(null)
    }
    props.onOpenChange(open)
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-6xl'>
        <DialogHeader>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1 pr-8'>
            <DialogTitle>
              {tokenId === undefined
                ? t('Create API Key')
                : t('Update API Key')}
            </DialogTitle>
            {!props.hideMarketLink && tokenId !== undefined && (
              <Button
                variant='outline'
                size='sm'
                render={
                  <Link
                    to='/market'
                    search={{ key: tokenId }}
                    onClick={() => handleOpenChange(false)}
                  />
                }
              >
                <Store data-icon='inline-start' />
                {t('Model Plaza')}
              </Button>
            )}
          </div>
          <DialogDescription className='sr-only'>
            {tokenId === undefined ? t('Create API Key') : t('Update API Key')}
          </DialogDescription>
        </DialogHeader>

        {tokenId === undefined || apiKey ? (
          <ApiKeySettingsForm
            key={tokenId ?? 'new'}
            apiKey={apiKey}
            autoRoute={autoRoute}
            onCreated={(created) => {
              setCreatedId(created.id)
              props.onChanged?.()
            }}
            onBatchCreated={() => {
              props.onChanged?.()
              handleOpenChange(false)
            }}
            onUpdated={() => props.onChanged?.()}
          />
        ) : (
          <Skeleton className='h-64 w-full' />
        )}

        <section className='flex min-h-0 flex-col gap-2'>
          <div className='flex flex-col gap-0.5'>
            <h3 className='text-sm font-semibold'>{t('Routes')}</h3>
            <p className='text-muted-foreground text-xs'>
              {t('Choose models and their primary or fallback IDs.')}
            </p>
          </div>
          {tokenId === undefined ? (
            <div className='text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm'>
              {t('Create the key first, then add models and IDs here.')}
            </div>
          ) : (
            <>
              <div className='bg-muted/20 flex items-center justify-between gap-3 rounded-lg border px-3 py-2'>
                <div className='flex flex-col gap-0.5'>
                  <span className='text-sm font-medium'>{t('Auto route')}</span>
                  <span className='text-muted-foreground text-xs'>
                    {t('Use fallback IDs when a request fails.')}
                  </span>
                </div>
                <Switch
                  checked={autoRoute}
                  disabled={routesQuery.isLoading || isChanging}
                  onCheckedChange={handleAutoRoute}
                />
              </div>

              <div className='flex items-center justify-between gap-3'>
                <span className='text-sm font-medium'>
                  {t('Models ({{count}})', { count: routes.length })}
                </span>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        disabled={tokenId === undefined || isChanging}
                      />
                    }
                  >
                    <Plus data-icon='inline-start' aria-hidden='true' />
                    {t('Add model')}
                  </PopoverTrigger>
                  <PopoverContent
                    className='w-[min(24rem,calc(100vw-2rem))] p-0'
                    align='end'
                  >
                    <Command>
                      <CommandInput placeholder={t('Search models')} />
                      <CommandList>
                        <CommandEmpty>
                          {market.isLoading
                            ? t('Loading...')
                            : t('No models to add')}
                        </CommandEmpty>
                        {addableModels.map((model) => (
                          <CommandItem
                            key={model.model_name}
                            value={model.model_name}
                            onSelect={() => handleAddModel(model.model_name)}
                          >
                            <span className='min-w-0 flex-1 truncate font-mono'>
                              {model.model_name}
                            </span>
                            <span className='text-muted-foreground shrink-0 font-mono text-xs'>
                              {`×${formatRatioValue(model.min_ratio)}`}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {routesQuery.isLoading && <Skeleton className='h-24 w-full' />}
              {!routesQuery.isLoading && routes.length === 0 && (
                <div className='text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm'>
                  {t('No models yet. Click "Add model" to start.')}
                </div>
              )}

              <div className='flex flex-col gap-3'>
                {routes.map((route) => (
                  <RouteModelBlock
                    key={route.model}
                    route={route}
                    marketModel={marketModels.get(route.model)}
                    isMarketLoading={market.isLoading}
                    actions={actions}
                    defaultExpanded={route.model === justAdded}
                    onRemoveModel={handleRemoveModel}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}
