import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { JobsRepository } from './repositories/jobsRepository.js';

const config = loadConfig();
const app = createApp();
const jobsRepository = new JobsRepository();

jobsRepository
  .recoverStaleJobs(0)
  .then((count) => {
    if (count > 0) console.log(`Recovered ${count} stale bulk job(s).`);
    jobsRepository.kickWorker();
  })
  .catch((error: unknown) => console.error('Bulk job recovery failed', error));

app.listen(config.port, () => {
  console.log(`Reeco API listening on port ${config.port}`);
});
