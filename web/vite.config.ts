import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The build lands in server/static/ so Flask ("/" -> static/index.html, assets under /static/)
// and `python -m http.server` from server/ both serve it with no Node process and no internet.
// AQ_SIM=1 builds the hosted simulation (Cloudflare Pages): served from the site root, replays
// public/sim_frames.json, and writes to ./dist-sim instead of server/static.
// AQ_RELEASE=1 selects the five public pages, AQ_SIM=1 the replay data source; they are independent:
//   RELEASE + SIM -> hosted demo (./dist-release, base '/');  SIM alone -> ./dist-sim, base '/';
//   RELEASE alone -> field build into server/static (live /api/state);  neither -> evaluator build.
const RELEASE = process.env.AQ_RELEASE === '1'
const SIM = process.env.AQ_SIM === '1'

export default defineConfig({
  base: SIM ? '/' : '/static/',
  define: {
    ...(SIM ? { 'import.meta.env.VITE_AQ_SIM': JSON.stringify('1') } : {}),
    ...(RELEASE ? { 'import.meta.env.VITE_AQ_RELEASE': JSON.stringify('1') } : {}),
  },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: { outDir: SIM ? (RELEASE ? './dist-release' : './dist-sim') : '../server/static', emptyOutDir: SIM, assetsDir: 'assets', chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:5050', '/static/mock_state.json': 'http://127.0.0.1:5050' } },
})