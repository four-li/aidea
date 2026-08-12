import { defineConfig, type Plugin } from 'vite';

const healthCheck: Plugin = {
  name: 'aidea-health-check',
  configureServer(server) {
    server.middlewares.use('/health', (request, response) => {
      if (request.method !== 'GET') {
        response.statusCode = 405;
        response.end();
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ status: 'ok' }));
    });
  },
};

export default defineConfig({ plugins: [healthCheck] });
