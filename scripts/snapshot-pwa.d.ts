export function snapshotPwaPlugin(): import('vite').Plugin & {
  transformIndexHtml(html: string): string;
};
