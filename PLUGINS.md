# External Plugin Integration

External features stay outside the New API process. The frontend provides one
generic host route and loads trusted applications through the same HTTPS domain.

## Add A Plugin

1. Run the plugin as an independent local service.
2. Add an Nginx location under `/_plugins/<plugin-id>/` that proxies to it.
3. Add one entry to `web/src/plugins/manifest.ts`.
4. Run `web/scripts/verify-plugin-integration.mjs`.
5. Build the frontend and backend, then restart the `hwjai New API` task.

The manifest controls the title, icon, internal route, source URL, placement,
and optional role requirement. No feature-specific route or sidebar component
is required.

## Upgrade New API

1. Merge or rebase the next upstream release into the `hwjai` branch.
2. Resolve the two stable integration imports if upstream navigation changed:
   `use-sidebar-data.ts` and `use-top-nav-links.ts`.
3. Keep the generic route at
   `web/src/routes/_authenticated/plugins/$pluginId.tsx`.
4. Run the integration verification script, typecheck, and production build.

Plugin services, data, credentials, and Nginx proxy files are independent from
the New API source upgrade.
