import fs from 'node:fs';
import { createHash } from 'node:crypto';

export function snapshotPwaPlugin() {
  return {
    name: 'snapshot-pwa-metadata',
    generateBundle(_options, bundle) {
      const urls = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
        ...Object.keys(bundle).filter(name => /\.(js|css|woff2?|svg|png)$/.test(name)).map(name => `/${name}`)].sort();
      const revision = createHash('sha256').update(JSON.stringify(urls)).digest('hex').slice(0, 12);
      const source = fs.readFileSync(new URL('../snapshot-public/service-worker.js', import.meta.url), 'utf8')
        .replace("const PRECACHE_URLS = ['/'];", `const PRECACHE_URLS = ${JSON.stringify(urls)};`)
        .replace('aerolab-snapshot-shell-v2', `aerolab-snapshot-shell-v2-${revision}`);
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
    transformIndexHtml(html) {
      const installMetadata = [
        '<meta name="theme-color" content="#0b1020" />',
        '<link rel="manifest" href="/manifest.webmanifest" />',
        '<link rel="apple-touch-icon" href="/icons/icon-192.png" />',
        '<script>if ("serviceWorker" in navigator) { window.addEventListener("load", () => { void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(error => console.error("Snapshot service worker registration failed:", error)); }); }</script>'
      ].join('\n    ');
      return html.replace('</head>', `    ${installMetadata}\n  </head>`);
    }
  };
}
