(() => {
  const nativeDispatchEvent = window.dispatchEvent;

  window.dispatchEvent = function dispatchEventWithEventsStability(event) {
    if (event?.type === 'bh:languagechange') {
      const eventsActive = document.querySelector('.tabs button[data-tab="events"].active');
      if (eventsActive) {
        // i18n translates the current DOM before dispatching bh:languagechange.
        // Suppress the redundant Events full rerender that clears #content and
        // re-enters the legacy shell initializer with a stale null shell reference.
        return true;
      }
    }
    return nativeDispatchEvent.call(this, event);
  };

  window.__BH_EVENTS_LANGUAGECHANGE_STABILITY__ = 'dom-translated-before-event-v1';
})();
