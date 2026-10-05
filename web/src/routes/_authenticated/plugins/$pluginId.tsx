import { createFileRoute, notFound } from '@tanstack/react-router'

import { ROLE } from '@/lib/roles'
import { getExternalPlugin } from '@/plugins/manifest'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/plugins/$pluginId')({
  component: PluginHostPage,
})

function PluginHostPage() {
  const { pluginId } = Route.useParams()
  const plugin = getExternalPlugin(pluginId)
  const role = useAuthStore((state) => state.auth.user?.role ?? ROLE.GUEST)

  if (!plugin) {
    throw notFound()
  }

  const source = new URL(plugin.source, window.location.origin)
  if (role >= ROLE.ADMIN) {
    source.searchParams.set('admin', '1')
  }

  return (
    <iframe
      src={`${source.pathname}${source.search}`}
      title={plugin.titleKey}
      className='h-[calc(100svh-4rem)] w-full border-0'
      referrerPolicy='same-origin'
      sandbox='allow-forms allow-scripts'
    />
  )
}
