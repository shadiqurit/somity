import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [vue(), tailwindcss()], server: { proxy: { '/api': process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:4000' } } });
