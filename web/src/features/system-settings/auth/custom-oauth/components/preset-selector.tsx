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
import { useId, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { SettingsControlGroup } from '../../../components/settings-form-layout'
import { OAUTH_PRESETS, type CustomOAuthFormValues } from '../types'

type PresetSelectorProps = {
  form: UseFormReturn<CustomOAuthFormValues>
}

export function PresetSelector(props: PresetSelectorProps) {
  const { t } = useTranslation()
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [baseUrl, setBaseUrl] = useState<string>('')
  const presetInputId = useId()
  const baseUrlInputId = useId()
  const preset = OAUTH_PRESETS.find((p) => p.key === selectedPreset)

  const applyEndpoints = (
    selected: (typeof OAUTH_PRESETS)[number],
    url: string
  ) => {
    const cleanUrl = url.trim().replace(/\/+$/, '')
    const hasEndpoints = !selected.needsBaseUrl || !!cleanUrl
    const prefix = selected.needsBaseUrl ? cleanUrl : ''
    props.form.setValue(
      'authorization_endpoint',
      hasEndpoints ? prefix + selected.authorization_endpoint : '',
      { shouldDirty: true }
    )
    props.form.setValue(
      'token_endpoint',
      hasEndpoints ? prefix + selected.token_endpoint : '',
      { shouldDirty: true }
    )
    props.form.setValue(
      'user_info_endpoint',
      hasEndpoints ? prefix + selected.user_info_endpoint : '',
      { shouldDirty: true }
    )
  }

  const handlePresetChange = (presetKey: string) => {
    setSelectedPreset(presetKey)
    const selected = OAUTH_PRESETS.find((p) => p.key === presetKey)
    if (!selected) return

    // Only public protocol settings belong to presets, never credentials.
    props.form.setValue('name', selected.name, { shouldDirty: true })
    props.form.setValue(
      'slug',
      presetKey.toLowerCase().replaceAll(/\s+/g, '-'),
      { shouldDirty: true }
    )
    props.form.setValue('icon', selected.icon, { shouldDirty: true })
    props.form.setValue('scopes', selected.scopes, { shouldDirty: true })
    props.form.setValue('user_id_field', selected.user_id_field, {
      shouldDirty: true,
    })
    props.form.setValue('username_field', selected.username_field, {
      shouldDirty: true,
    })
    props.form.setValue('display_name_field', selected.display_name_field, {
      shouldDirty: true,
    })
    props.form.setValue('email_field', selected.email_field, {
      shouldDirty: true,
    })
    props.form.setValue('well_known', selected.well_known ?? '', {
      shouldDirty: true,
    })
    props.form.setValue('auth_style', selected.auth_style ?? 0, {
      shouldDirty: true,
    })
    props.form.setValue('access_policy', selected.access_policy ?? '', {
      shouldDirty: true,
    })
    props.form.setValue('access_denied_message', '', { shouldDirty: true })
    props.form.setValue('enabled', selected.enabled ?? true, {
      shouldDirty: true,
    })
    applyEndpoints(selected, baseUrl)
  }

  const handleBaseUrlChange = (url: string) => {
    setBaseUrl(url)
    if (!preset) return
    applyEndpoints(preset, url)
  }

  return (
    <SettingsControlGroup className='space-y-3 border-dashed'>
      <p className='text-sm font-medium'>{t('Quick Setup from Preset')}</p>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <div className='space-y-1.5'>
          <Label htmlFor={presetInputId}>{t('Preset Template')}</Label>
          <Select
            items={OAUTH_PRESETS.map((item) => ({
              value: item.key,
              label: item.name,
            }))}
            value={selectedPreset}
            onValueChange={(v) => v !== null && handlePresetChange(v)}
          >
            <SelectTrigger id={presetInputId} className='w-full'>
              <SelectValue placeholder={t('Select a preset...')} />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {OAUTH_PRESETS.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {preset?.needsBaseUrl !== false ? (
          <div className='space-y-1.5'>
            <Label htmlFor={baseUrlInputId}>{t('Base URL')}</Label>
            <Input
              id={baseUrlInputId}
              placeholder={t('https://your-server.example.com')}
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
            />
          </div>
        ) : (
          <p className='text-muted-foreground self-center text-sm'>
            {t('Google uses fixed endpoints; no base URL is needed.')}
          </p>
        )}
      </div>
      {selectedPreset === 'google' && (
        <p className='text-muted-foreground text-sm'>
          {t(
            'Google login stays disabled until you explicitly enable it. Enter your OAuth client credentials in this secure admin form, not in chat. A Gemini API key cannot be used for Google login.'
          )}
        </p>
      )}
    </SettingsControlGroup>
  )
}
