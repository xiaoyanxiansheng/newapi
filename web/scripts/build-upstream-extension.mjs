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
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const output = resolve('../.local-tests/browser-helper/package')
mkdirSync(output, { recursive: true })
cpSync(resolve('browser-extension'), output, { recursive: true })
const args = [
  resolve('node_modules/@typescript/native-preview/bin/tsgo'),
  '--ignoreConfig',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--skipLibCheck',
  '--lib',
  'ES2022,DOM',
  '--types',
  'node',
  '--rootDir',
  'src/features/upstream-catalog/lib',
  '--outDir',
  output,
  'src/features/upstream-catalog/lib/extension-core.ts',
  'src/features/upstream-catalog/lib/browser-discovery.ts',
]
const compiled = spawnSync(process.execPath, args, { stdio: 'inherit' })
if (compiled.status !== 0) process.exit(compiled.status ?? 1)
cpSync(resolve('../LICENSE'), resolve(output, 'LICENSE'))
const manifest = JSON.parse(
  readFileSync(resolve(output, 'manifest.json'), 'utf8')
)
writeFileSync(
  resolve(output, 'build-info.json'),
  JSON.stringify(
    { version: manifest.version, source: 'new-api / QuantumNous' },
    null,
    2
  )
)
const zip = resolve('public/downloads/hwjai-upstream-helper.zip')
mkdirSync(resolve('public/downloads'), { recursive: true })
const quoted = (value) => `'${value.replaceAll("'", "''")}'`
const compressed = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path ${quoted(output + '/*')} -DestinationPath ${quoted(
      zip
    )} -Force`,
  ],
  { stdio: 'inherit' }
)
if (compressed.status !== 0) process.exit(compressed.status ?? 1)
cpSync(
  zip,
  resolve('public/downloads/hwjai-upstream-helper-' + manifest.version + '.zip')
)
console.log(`Browser helper built: ${zip}`)
