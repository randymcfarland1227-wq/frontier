/** Only enabled in the review build. Blocks outgoing mutations and live source bridges. */
if (import.meta.env.VITE_LOCAL_PREVIEW === 'true') {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return Promise.reject(new Error('Local preview: live writes are disabled'));
    return original(input, init);
  };
}
