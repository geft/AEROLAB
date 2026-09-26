export function snapshotPwaPlugin() {
  return {
    name: 'snapshot-pwa-metadata',
    transformIndexHtml(html) {
      const installMetadata = [
        '<meta name="theme-color" content="#0b1020" />',
        '<link rel="manifest" href="/manifest.webmanifest" />',
        '<link rel="apple-touch-icon" href="/icons/icon-192.png" />'
      ].join('\n    ');
      return html.replace('</head>', `    ${installMetadata}\n  </head>`);
    }
  };
}
