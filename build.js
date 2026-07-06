import esbuild from 'esbuild';
import { glob } from 'glob'; // Lo perlu install: npm i -D glob

async function build() {
  // Ambil semua file .ts di folder src
  const entryPoints = await glob('src/**/*.ts');

  await esbuild.build({
    entryPoints,
    outdir: 'dist', // Pakai outdir bukan outfile
    platform: 'node',
    format: 'esm',
    bundle: false, // MATIIN BUNDLE biar struktur folder tetep ada
    minify: true,
    sourcemap: true,
    packages: 'external', // Biar node_modules gak ikutan dicompile
  });
}

build().catch(() => process.exit(1));
