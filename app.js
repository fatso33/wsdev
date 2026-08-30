/**
 * app.js
 * Flight Deck Widget Studio v1.2 - Application Entry Point
 */

import { StudioApp } from './js/StudioApp.js';

function startStudio() {
  const root = document.getElementById('app');
  if (root && !window.__studioApp) {
    const studio = new StudioApp(root);
    studio.init();
    window.__studioApp = studio;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startStudio);
} else {
  startStudio();
}

