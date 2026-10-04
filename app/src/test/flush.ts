/** Lets every pending answer land: one macrotask, after the microtasks queued so far. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
