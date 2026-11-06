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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { ManualKeyInput, Source } from '../types'

const schema = z.object({
  name: z.string().trim().max(255),
  base_url: z.url().refine((value) => value.startsWith('https://')),
  key: z.string().trim().max(16384),
  markup: z
    .string()
    .regex(/^[0-9]+(?:[.][0-9]+)?$/)
    .refine((value) => Number(value) >= 1 && Number(value) <= 100),
})

export function ManualKeyEditor(props: {
  source?: Source
  busy: boolean
  onSave: (input: ManualKeyInput) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: props.source?.name ?? '',
      base_url: props.source?.base_url ?? '',
      key: '',
      markup: props.source?.markup ?? '1.1',
    },
  })
  const fields = [
    ['name', 'Key name'],
    ['base_url', 'API address'],
    ['key', 'API Key'],
    ['markup', 'Default markup multiplier'],
  ] as const
  return (
    <form
      className='space-y-5'
      onSubmit={form.handleSubmit((input) => {
        if (!props.source && !input.key) {
          form.setError('key', { message: 'required' })
          return
        }
        const saved: ManualKeyInput = {
          name: input.name,
          base_url: input.base_url,
          markup: input.markup,
        }
        if (input.key) saved.key = input.key
        if (props.source) saved.revision = props.source.revision
        props.onSave(saved)
      })}
    >
      <p className='bg-primary/5 text-muted-foreground rounded-xl p-3 text-sm'>
        {t(
          'Enter an existing API Key and its OpenAI-compatible API address. Website login is not required.'
        )}
      </p>
      <div className='grid gap-4 sm:grid-cols-2'>
        {fields.map(([name, label]) => (
          <div className='space-y-2' key={name}>
            <Label htmlFor={`manual-${name}`}>{t(label)}</Label>
            <Input
              id={`manual-${name}`}
              type={name === 'key' ? 'password' : 'text'}
              autoComplete={name === 'key' ? 'new-password' : 'off'}
              disabled={props.busy}
              readOnly={name === 'base_url' && !!props.source}
              {...form.register(name)}
              aria-invalid={!!form.formState.errors[name]}
            />
            {form.formState.errors[name] && (
              <p className='text-destructive text-xs'>
                {t('Enter a valid value')}
              </p>
            )}
            {name === 'base_url' && (
              <p className='text-muted-foreground text-xs'>
                {t('Use the API base address, with or without /v1.')}
              </p>
            )}
            {name === 'key' && props.source && (
              <p className='text-muted-foreground text-xs'>
                {t('Leave blank to keep the saved Key.')}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={props.busy}
          onClick={props.onCancel}
        >
          {t('Cancel')}
        </Button>
        <Button type='submit' disabled={props.busy}>
          {t('Save Key')}
        </Button>
      </div>
    </form>
  )
}
