// HTTP server entry point
import 'dotenv/config';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 3001);

const app = createApp();

app.listen(port, () => {
  console.log(`[server] employ-me listening on http://localhost:${port}`);
});
