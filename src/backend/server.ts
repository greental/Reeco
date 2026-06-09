import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(`Reeco API listening on port ${config.port}`);
});
