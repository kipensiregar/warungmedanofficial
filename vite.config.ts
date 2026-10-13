import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative asset paths work for both GitHub Pages project sites and local preview.
export default defineConfig({ plugins: [react()], base: './' })
