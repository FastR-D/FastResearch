import { defineConfig, presetUno } from 'unocss'
import { fastUIContent, presetFastUI } from '@fastrd/ui-foundation/uno'

export default defineConfig({
  content: fastUIContent,
  presets: [presetUno(), presetFastUI()],
})
