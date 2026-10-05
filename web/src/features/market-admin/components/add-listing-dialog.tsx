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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'

import type {
  ApiResult,
  ChannelOption,
  CreateListingPayload,
  MarketListing,
} from '../types'

type AddListingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  channels: ChannelOption[]
  defaultChannelId: number | null
  saving: boolean
  onCreate: (payload: CreateListingPayload) => Promise<ApiResult<MarketListing>>
}

export function AddListingDialog(props: AddListingDialogProps) {
  const { t } = useTranslation()
  const [channelId, setChannelId] = useState('')
  const [modelName, setModelName] = useState('')
  const [ratio, setRatio] = useState('0')
  const [enabled, setEnabled] = useState(false)
  const [description, setDescription] = useState('')

  const selectedChannel =
    channelId || (props.defaultChannelId ? String(props.defaultChannelId) : '')
  const channel = props.channels.find(
    (option) => String(option.id) === selectedChannel
  )
  const ratioValue = Number(ratio)
  const ratioValid = ratio.trim() !== '' && ratioValue >= 0
  const canSubmit = Boolean(channel) && modelName.trim() !== '' && ratioValid

  const handleSubmit = async () => {
    if (!channel || !canSubmit) return
    try {
      const result = await props.onCreate({
        channel_id: channel.id,
        model_name: modelName.trim(),
        ratio: ratioValue,
        enabled,
        description,
        sort_order: 0,
      })
      if (!result.success) return
      toast.success(t('Listing created'))
      setModelName('')
      setRatio('0')
      setEnabled(false)
      setDescription('')
      props.onOpenChange(false)
    } catch {
      // Request errors are surfaced by the global error handler.
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('Add listing')}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='market-add-channel'>{t('Channel')}</Label>
            <NativeSelect
              id='market-add-channel'
              className='w-full'
              value={selectedChannel}
              onChange={(event) => setChannelId(event.target.value)}
            >
              <NativeSelectOption value=''>
                {t('Select a channel')}
              </NativeSelectOption>
              {props.channels.map((option) => (
                <NativeSelectOption key={option.id} value={String(option.id)}>
                  #{option.id} {option.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='market-add-model'>{t('Model')}</Label>
            <Input
              id='market-add-model'
              list='market-add-models'
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
            />
            <datalist id='market-add-models'>
              {(channel?.models ?? []).map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='market-add-ratio'>{t('Ratio')}</Label>
            <Input
              id='market-add-ratio'
              type='number'
              min={0}
              step='any'
              value={ratio}
              onChange={(event) => setRatio(event.target.value)}
            />
          </div>
          <div className='flex items-center justify-between'>
            <Label htmlFor='market-add-enabled'>{t('Enabled')}</Label>
            <Switch
              id='market-add-enabled'
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='market-add-description'>{t('Description')}</Label>
            <Input
              id='market-add-description'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || props.saving}>
            {props.saving ? t('Saving...') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
