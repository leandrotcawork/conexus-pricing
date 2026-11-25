import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/banco/tabelas.ts',
  out: './migrations',
  schemaFilter: ['precos'],
})
