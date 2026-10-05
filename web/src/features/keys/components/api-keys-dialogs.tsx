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
import { ApiKeyDialog } from './api-key-dialog'
import { ApiKeysDeleteDialog } from './api-keys-delete-dialog'
import { useApiKeys } from './api-keys-provider'
import { CCSwitchDialog } from './dialogs/cc-switch-dialog'

export function ApiKeysDialogs() {
  const { open, setOpen, currentRow, resolvedKey, triggerRefresh } =
    useApiKeys()

  return (
    <>
      <ApiKeysDeleteDialog />
      <ApiKeyDialog
        open={open === 'create' || (open === 'routes' && currentRow !== null)}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        tokenId={open === 'routes' ? currentRow?.id : undefined}
        onChanged={triggerRefresh}
      />
      <CCSwitchDialog
        open={open === 'cc-switch'}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        tokenKey={resolvedKey}
      />
    </>
  )
}
