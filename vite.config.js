import { defineConfig } from 'vite';

/**
 * The proxy target is derived from the same PORT the server reads.
 *
 * `scripts/dev.js` spawns both processes with a shared `env`, so in the normal
 * `npm run dev` flow they already agree. This keeps them agreeing when the
 * server is started on its own with a non-default PORT, which would otherwise
 * proxy every /api call and the socket to a dead port.
 */
const PORT = process.env.PORT || '3000';
const TARGET = `http://localhost:${PORT}`;

export default defineConfig({
  root: './src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: TARGET,
        changeOrigin: true,
        // A dead backend must surface as a clear 503 from the proxy rather
        // than a silently aborted socket, which the client could only report
        // as the generic "Cannot reach the server".
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error(`[vite-proxy] /api -> ${TARGET} failed: ${err.message}`);
            if (res && !res.headersSent && res.writeHead) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'Backend unreachable',
                message: `The API server is not responding on ${TARGET}. `
                  + `Start it with "npm run server" (PORT=${PORT}).`,
              }));
            }
          });
        },
      },
      '/socket.io': {
        target: TARGET,
        ws: true,
      },
    },
  },
});
