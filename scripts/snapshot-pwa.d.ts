export function snapshotPwaPlugin(): {
  name: string;
  transformIndexHtml(html: string): string;
};
