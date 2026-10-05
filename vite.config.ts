import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths so the build works from any folder, e.g. GitHub Pages.
  base: './',
  plugins: [react()],
})
