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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import type { ApiResult, ChannelOption } from '../types'

type GenerateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  channels: ChannelOption[]
  defaultChannelId: number | null
  generating: boolean
  onGenerate: (channelId: number) => Promise<ApiResult<{ created: number }>>
}

export function GenerateDialog(props: GenerateDialogProps) {
  const { t } = useTranslation()
  const [channelId, setChannelId] = useState('')
  const selected =
    channelId || (props.defaultChannelId ? String(props.defaultChannelId) : '')

  const handleGenerate = async () => {
    if (!selected) return
    try {
      const result = await props.onGenerate(Number(selected))
      if (!result.success) return
      toast.success(
        t('Created {{count}} listings', { count: result.data?.created ?? 0 })
      )
      props.onOpenChange(false)
    } catch {
      // Request errors are surfaced by the global error handler.
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('Generate from channel')}</DialogTitle>
          <DialogDescription>
            {t(
              'Creates a disabled listing with ratio 0 for every model of the channel that has none yet.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='market-generate-channel'>{t('Channel')}</Label>
          <NativeSelect
            id='market-generate-channel'
            className='w-full'
            value={selected}
            onChange={(event) => setChannelId(event.target.value)}
          >
            <NativeSelectOption value=''>
              {t('Select a channel')}
            </NativeSelectOption>
            {props.channels.map((channel) => (
              <NativeSelectOption key={channel.id} value={String(channel.id)}>
                #{channel.id} {channel.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!selected || props.generating}
          >
            {props.generating ? t('Generating...') : t('Generate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
