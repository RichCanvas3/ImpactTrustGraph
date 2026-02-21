import 'dotenv/config';

import { serve } from '@hono/node-server';

import app from './server.js';

const port = Number.parseInt(process.env.PORT || '3000', 10);
console.log(`[IMPACT-AGENT] Node server listening on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

