/* Recommendation simulation worker. The engine stays isolated from the UI event loop. */
importScripts('packing-engine.js');

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type !== 'simulate') return;

  try {
    const simulation = self.PackingEngine.simulateContainerOptions(
      message.items || [],
      message.candidates || [],
      message.options || {}
    );
    self.postMessage({ type: 'result', requestId: message.requestId, simulation });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: error && error.message ? error.message : String(error)
    });
  }
});
