import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
export const taskSignal = () => context.getStore();
export const withCancellation = (signal, action) => context.run(signal, action);
export function cancellationError() { const error = new Error('Cancelled by you.'); error.name = 'AbortError'; error.code = 'PROJECT_CANCELLED'; return error; }
export function throwIfCancelled() { taskSignal()?.throwIfAborted(); }
export function requestSignal(timeout) { return taskSignal() ? AbortSignal.any([taskSignal(), AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout); }
