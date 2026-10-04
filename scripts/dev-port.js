import net from 'node:net';

/** Keep development traffic separate from an already-running desktop engine. */
export async function findAvailableApiPort(startPort = 3001) {
  if (!Number.isInteger(startPort) || startPort < 1 || startPort > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  for (let port = startPort; port <= 65535; port++) {
    const available = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', error => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
        else reject(error);
      });
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No available local API port.');
}
