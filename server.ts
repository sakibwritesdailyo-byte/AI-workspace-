import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createApiRouter, type ChatRouterDependencies } from './server/chatRoutes.ts';

export function createApp(deps?: ChatRouterDependencies) {
  const app = express();
  app.disable('x-powered-by');

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/api', createApiRouter(deps));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error.';
    if (!res.headersSent) {
      res.status(500).json({
        ok: false,
        code: 'internal_error',
        message,
      });
    }
  });

  return app;
}

async function startServer(): Promise<void> {
  const app = createApp();
  const httpServer = http.createServer(app);
  const port = Number(process.env.PORT) || 3000;
  const host = '0.0.0.0';
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
        ws: { server: httpServer },
        watch: disableHmr ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtml = path.join(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Production build not found. Run npm run build first.');
      }
    });
  }

  httpServer.listen(port, host, () => {
    console.log(`Personal AI Studio server listening on http://${host}:${port}`);
  });
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isEntrypoint) {
  void startServer().catch((err) => {
    console.error('Failed to start Personal AI Studio server:', err);
    process.exit(1);
  });
}
