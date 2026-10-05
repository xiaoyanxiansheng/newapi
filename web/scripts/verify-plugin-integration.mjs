import fs from 'node:fs'

const requiredChecks = [
  ['src/plugins/manifest.ts', 'externalPlugins'],
  ['src/hooks/use-sidebar-data.ts', 'getPluginSidebarItems'],
  ['src/hooks/use-top-nav-links.ts', 'getPluginTopNavLinks'],
  ['src/routes/_authenticated/plugins/$pluginId.tsx', 'getExternalPlugin'],
]

const missing = requiredChecks.filter(([file, marker]) => {
  return !fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes(marker)
})

if (missing.length > 0) {
  for (const [file, marker] of missing) {
    console.error(`Missing plugin integration marker ${marker} in ${file}`)
  }
  process.exit(1)
}

console.log('Plugin integration points verified')
