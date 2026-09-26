export function snapshotPwaPlugin() {
  return {
    name: 'snapshot-pwa-metadata',
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
