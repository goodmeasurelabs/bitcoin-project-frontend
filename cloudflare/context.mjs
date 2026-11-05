import { AsyncLocalStorage } from 'node:async_hooks';
import { createD1Store } from './d1-store.mjs';
const requests = new AsyncLocalStorage();
export const withStorage = (database, namespace, callback) => requests.run(createD1Store(database, namespace), callback);
export function currentStore() {
  const store = requests.getStore();
  if (!store) throw new Error('Storage must be used inside a Worker request');
  return store;
}
