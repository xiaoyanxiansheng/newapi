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
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type CreateKeyFormProps = {
  isCreating: boolean
  onCreate: (name: string) => void
}

export function CreateKeyForm(props: CreateKeyFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    props.onCreate(trimmed)
    setName('')
  }

  return (
    <form onSubmit={handleSubmit} className='flex items-center gap-2'>
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t('Key name')}
        aria-label={t('Key name')}
        maxLength={50}
        className='min-w-0 flex-1'
      />
      <Button type='submit' disabled={props.isCreating || !name.trim()}>
        <Plus data-icon='inline-start' />
        {t('Create key')}
      </Button>
    </form>
  )
}
