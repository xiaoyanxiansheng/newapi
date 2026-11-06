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
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, type SubmitErrorHandler } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { cn } from '@/lib/utils'

import { createApiKey, updateApiKey } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  getApiKeyFormDefaultValues,
  getApiKeyFormSchema,
  transformApiKeyToFormDefaults,
  transformFormDataToPayload,
  type ApiKeyFormValues,
} from '../lib'
import type { ApiKey } from '../types'

type ApiKeySettingsFormProps = {
  /** The key being edited; undefined creates a new key */
  apiKey?: ApiKey
  /** Auto route is saved from the routes section, the form only passes the live value along */
  autoRoute: boolean
  /** A single key was created; the dialog continues with that key so models can be added */
  onCreated: (apiKey: ApiKey) => void
  /** Several keys were created at once; the dialog has nothing more to edit */
  onBatchCreated: () => void
  onUpdated: () => void
}

export function ApiKeySettingsForm(props: ApiKeySettingsFormProps) {
  const { t } = useTranslation()
  const { apiKey } = props
  const isUpdate = apiKey !== undefined
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const schema = useMemo(() => getApiKeyFormSchema(t), [t])
  const form = useForm<ApiKeyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: apiKey
      ? transformApiKeyToFormDefaults(apiKey)
      : getApiKeyFormDefaultValues(),
  })

  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const unlimitedQuota = form.watch('unlimited_quota')

  const handleSetExpiry = (months: number, days: number, hours: number) => {
    if (months === 0 && days === 0 && hours === 0) {
      form.setValue('expired_time', undefined, { shouldDirty: true })
      return
    }
    const target = new Date()
    target.setMonth(target.getMonth() + months)
    target.setDate(target.getDate() + days)
    target.setHours(target.getHours() + hours)
    form.setValue('expired_time', target, { shouldDirty: true })
  }

  const update = async (data: ApiKeyFormValues) => {
    if (!apiKey) return
    const result = await updateApiKey({
      ...transformFormDataToPayload(data),
      auto_route: props.autoRoute,
      id: apiKey.id,
    })
    if (!result.success) {
      toast.error(result.message || t(ERROR_MESSAGES.UPDATE_FAILED))
      return
    }
    toast.success(t(SUCCESS_MESSAGES.API_KEY_UPDATED))
    form.reset(data)
    props.onUpdated()
  }

  const create = async (data: ApiKeyFormValues) => {
    const count = data.tokenCount || 1
    const payload = transformFormDataToPayload(data)
    let created: ApiKey | undefined
    let successCount = 0
    for (let i = 0; i < count; i++) {
      const result = await createApiKey({
        ...payload,
        name:
          i === 0 && data.name
            ? data.name
            : `${data.name || 'default'}-${Math.random().toString(36).slice(2, 8)}`,
      })
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.CREATE_FAILED))
        break
      }
      created = result.data
      successCount++
    }
    if (successCount === 0) return
    toast.success(
      t('Successfully created {{count}} API Key(s)', { count: successCount })
    )
    if (successCount === 1 && created) {
      props.onCreated(created)
      return
    }
    props.onBatchCreated()
  }

  const onSubmit = async (data: ApiKeyFormValues) => {
    setIsSubmitting(true)
    try {
      await (isUpdate ? update(data) : create(data))
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setIsSubmitting(false)
    }
  }

  const onInvalid: SubmitErrorHandler<ApiKeyFormValues> = () => {
    toast.error(t('Please fix the highlighted fields before saving'))
  }

  let submitLabel = t('Create API Key')
  if (isUpdate) submitLabel = t('Save changes')
  if (isSubmitting) submitLabel = t('Saving...')

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        inert={isSubmitting ? true : undefined}
        className='bg-muted/10 flex flex-col gap-3 rounded-xl border p-3'
      >
        <div className='grid gap-3 md:grid-cols-2'>
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Name')}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={t('Enter a name')} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {isUpdate ? (
            <FormField
              control={form.control}
              name='unlimited_quota'
              render={({ field }) => (
                <FormItem className='bg-background flex flex-row items-center justify-between gap-3 self-end rounded-lg border px-3 py-2'>
                  <div className='flex flex-col gap-0.5'>
                    <FormLabel className='text-sm'>
                      {t('Unlimited Quota')}
                    </FormLabel>
                    <FormDescription className='text-xs'>
                      {t('Enable unlimited quota for this API key')}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name='tokenCount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Quantity')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      min='1'
                      placeholder={t('Number of keys to create')}
                      onChange={(e) =>
                        field.onChange(Number.parseInt(e.target.value, 10) || 1)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <FormField
          control={form.control}
          name='expired_time'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Expiration Time')}</FormLabel>
              <div className='grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center'>
                <FormControl>
                  <DateTimePicker
                    value={field.value}
                    onChange={field.onChange}
                    placeholder={t('Never expires')}
                    className='min-w-0 [&_input[type=time]]:w-24 sm:[&_input[type=time]]:w-32'
                  />
                </FormControl>
                <div className='grid grid-cols-4 gap-2 sm:flex'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => handleSetExpiry(0, 0, 0)}
                  >
                    {t('Never')}
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => handleSetExpiry(1, 0, 0)}
                  >
                    {t('1 Month')}
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => handleSetExpiry(0, 1, 0)}
                  >
                    {t('1 Day')}
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => handleSetExpiry(0, 0, 1)}
                  >
                    {t('1 Hour')}
                  </Button>
                </div>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {!isUpdate && (
          <FormField
            control={form.control}
            name='unlimited_quota'
            render={({ field }) => (
              <FormItem className='bg-background flex flex-row items-center justify-between gap-3 rounded-lg border px-3 py-2'>
                <div className='flex flex-col gap-0.5'>
                  <FormLabel className='text-sm'>
                    {t('Unlimited Quota')}
                  </FormLabel>
                  <FormDescription className='text-xs'>
                    {t('Enable unlimited quota for this API key')}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        )}

        {!unlimitedQuota && (
          <FormField
            control={form.control}
            name='remain_quota_dollars'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('Quota ({{currency}})', { currency: currencyLabel })}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    step={tokensOnly ? 1 : 0.01}
                    placeholder={
                      tokensOnly
                        ? t('Enter quota in tokens')
                        : t('Enter quota in {{currency}}', {
                            currency: currencyLabel,
                          })
                    }
                    onChange={(e) =>
                      field.onChange(Number.parseFloat(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger
            render={
              <button
                type='button'
                className='text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors'
              />
            }
          >
            {t('Advanced Settings')}
            <ChevronDown
              className={cn(
                'size-4 transition-transform',
                advancedOpen && 'rotate-180'
              )}
              aria-hidden='true'
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FormField
              control={form.control}
              name='allow_ips'
              render={({ field }) => (
                <FormItem className='pt-3'>
                  <FormLabel>{t('IP Whitelist (supports CIDR)')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      className='min-h-20 resize-none'
                      placeholder={t(
                        'One IP per line (empty for no restriction)'
                      )}
                      rows={3}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Do not over-trust this feature. IP may be spoofed. Please use with nginx, CDN and other gateways.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CollapsibleContent>
        </Collapsible>

        <div className='flex justify-end'>
          <Button
            type='submit'
            size='sm'
            disabled={isSubmitting || (isUpdate && !form.formState.isDirty)}
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  )
}
