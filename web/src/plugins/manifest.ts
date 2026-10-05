import type { NavItem, TopNavLink } from '@/components/layout/types'

export type ExternalPlugin = {
  id: string
  titleKey: string
  route: string
  source: string
  icon: React.ElementType
  placements: Array<'header' | 'sidebar'>
  requiresAuth?: boolean
  requiredRole?: number
}

export const externalPlugins: ExternalPlugin[] = []

export function getExternalPlugin(pluginId: string): ExternalPlugin | undefined {
  return externalPlugins.find((plugin) => plugin.id === pluginId)
}

export function getPluginTopNavLinks(
  translate: (key: string) => string,
  isAuthed: boolean
): TopNavLink[] {
  return externalPlugins
    .filter((plugin) => plugin.placements.includes('header'))
    .map((plugin) => ({
      title: translate(plugin.titleKey),
      href: plugin.route,
      requiresAuth: Boolean(plugin.requiresAuth && !isAuthed),
    }))
}

export function getPluginSidebarItems(
  translate: (key: string) => string
): NavItem[] {
  return externalPlugins
    .filter((plugin) => plugin.placements.includes('sidebar'))
    .map((plugin) => ({
      title: translate(plugin.titleKey),
      url: plugin.route,
      icon: plugin.icon,
      requiredRole: plugin.requiredRole,
    }))
}
