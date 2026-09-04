import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts', 'src/preload.ts'],
  outDir: 'lib',
  format: ['cjs'],
  external: ['electron'],
  outExtensions: () => ({ js: '.cjs' }),
  clean: true,
  dts: false,
  sourcemap: true,
})
