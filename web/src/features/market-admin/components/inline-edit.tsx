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
import { useEffect, useState, type KeyboardEvent } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type InlineNumberInputProps = {
  value: number
  onCommit: (value: number) => Promise<boolean>
  label: string
  integer?: boolean
  min?: number
  className?: string
}

type InlineTextInputProps = {
  value: string
  onCommit: (value: string) => Promise<boolean>
  label: string
  className?: string
}

export function InlineNumberInput(props: InlineNumberInputProps) {
  const [draft, setDraft] = useState(String(props.value))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(String(props.value))
  }, [props.value])

  const commit = async () => {
    const parsed = Number(draft)
    const min = props.min ?? 0
    const invalid =
      draft.trim() === '' ||
      !Number.isFinite(parsed) ||
      parsed < min ||
      (props.integer === true && !Number.isInteger(parsed))
    if (invalid || parsed === props.value) {
      setDraft(String(props.value))
      return
    }
    setSaving(true)
    const ok = await props.onCommit(parsed)
    setSaving(false)
    if (!ok) setDraft(String(props.value))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') {
      setDraft(String(props.value))
      event.currentTarget.blur()
    }
  }

  return (
    <Input
      type='number'
      inputMode='decimal'
      min={props.min ?? 0}
      step={props.integer ? 1 : 'any'}
      aria-label={props.label}
      value={draft}
      disabled={saving}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className={cn('h-8 w-24', props.className)}
    />
  )
}

export function InlineTextInput(props: InlineTextInputProps) {
  const [draft, setDraft] = useState(props.value)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(props.value)
  }, [props.value])

  const commit = async () => {
    if (draft === props.value) return
    setSaving(true)
    const ok = await props.onCommit(draft)
    setSaving(false)
    if (!ok) setDraft(props.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') {
      setDraft(props.value)
      event.currentTarget.blur()
    }
  }

  return (
    <Input
      aria-label={props.label}
      value={draft}
      disabled={saving}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className={cn('h-8 min-w-40', props.className)}
    />
  )
}
