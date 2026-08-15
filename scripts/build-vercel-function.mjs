// Bundles src/vercelHandler.ts into a single flat api/index.cjs — the artifact
// Vercel actually deploys as the serverless function. See the comment at the top of
// src/vercelHandler.ts for why this exists (Vercel's zero-config Node builder
// mis-resolved cross-directory `api/` -> `src/` relative imports in production).
//
// Run via `npm run vercel-build` — Vercel auto-detects and runs that script name in
// place of any dashboard-configured Build Command, so no extra Vercel config needed.
import { build } from 'esbuild';
import { existsSync, mkdirSync, rmSync } from 'node:fs';

const outdir = 'api';

if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir);

await build({
  entryPoints: ['src/vercelHandler.ts'],
  outfile: `${outdir}/index.cjs`,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Only first-party src/** code is bundled. Every node_modules package — express,
  // mongoose, jsonwebtoken, and critically @node-rs/argon2 (native .node binary) —
  // stays a normal require() resolved from node_modules at runtime. Bundling a
  // native addon would break it outright; this also keeps the output small.
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});

console.log('Built api/index.cjs from src/vercelHandler.ts');
