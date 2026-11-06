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
import { z } from 'zod'

export const accountSchema = z.object({
  balance_page_url: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      if (!value) return true
      try {
        const page = new URL(value)
        return (
          value.toLowerCase().startsWith('https://') &&
          page.protocol === 'https:' &&
          !!page.hostname &&
          !page.username &&
          !page.password
        )
      } catch {
        return false
      }
    })
    .optional(),
  name: z.string().trim().min(1).max(255),
  markup: z
    .string()
    .regex(/^[0-9]+(?:[.][0-9]+)?$/)
    .refine((value) => Number(value) >= 1 && Number(value) <= 100),
  key_page_url: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      try {
        const page = new URL(value)
        return (
          value.toLowerCase().startsWith('https://') &&
          page.protocol === 'https:' &&
          !!page.hostname &&
          !page.username &&
          !page.password
        )
      } catch {
        return false
      }
    })
    .optional(),
})

export type AccountForm = z.infer<typeof accountSchema>
