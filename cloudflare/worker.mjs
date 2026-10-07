import next from '../.open-next/worker.js';
import { createWorker } from './router.mjs';
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from '../.open-next/worker.js';
export default createWorker(next);
