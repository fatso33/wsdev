/**
 * StudioModal.js
 * Generic modal dialog helper — replaces the studio's old pattern of chained
 * native prompt()/confirm() calls (free-typed enum values, no autocomplete,
 * no way to review/edit an entry without restarting the whole flow) with a
 * real form: dropdowns for enums, inline validation, and a single visible
 * form the user can review before submitting.
 *
 * Usage:
 *   const result = await openModal({
 *     title: 'Add Interaction',
 *     bodyHtml: `...`,
 *     onMount: (card) => { ...wire dynamic field behavior... },
 *     onSubmit: (card) => ({ value: {...} })      // success
 *     onSubmit: (card) => ({ error: 'message' })  // validation failure, modal stays open
 *   });
 *   if (result) { ...use result... }  // null if the user cancelled
 */
export function openModal({ title, bodyHtml, submitLabel = 'OK', cancelLabel = 'Cancel', wide = false, onMount, onSubmit }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'studio-modal-overlay';

    const card = document.createElement('div');
    card.className = `studio-modal-box${wide ? ' wide' : ''}`;
    card.innerHTML = `
      <div class="modal-hdr">
        <div class="modal-title-group"><span class="modal-title">${title}</span></div>
        <button type="button" class="btn-mini-close" data-modal-close>✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-error hidden" data-modal-error></div>
      <div class="modal-footer">
        <button type="button" class="bar-btn" data-modal-cancel>${cancelLabel}</button>
        <button type="button" class="bar-btn primary" data-modal-submit>${submitLabel}</button>
      </div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(result);
    };

    const onKeydown = (e) => { if (e.key === 'Escape') cleanup(null); };
    document.addEventListener('keydown', onKeydown);

    card.querySelector('[data-modal-close]').addEventListener('click', () => cleanup(null));
    card.querySelector('[data-modal-cancel]').addEventListener('click', () => cleanup(null));
    // Deliberately no overlay-click-to-close: a stray click just outside the
    // card (easy to trigger on a wide form with lots of fields) used to
    // silently discard an in-progress edit with no confirmation — reported
    // live while editing an interaction trigger. Close via the ✕/Cancel
    // buttons or Escape only.

    card.querySelector('[data-modal-submit]').addEventListener('click', () => {
      const errEl = card.querySelector('[data-modal-error]');
      if (!onSubmit) { cleanup(true); return; }
      const outcome = onSubmit(card) || {};
      if (outcome.error) {
        errEl.textContent = outcome.error;
        errEl.classList.remove('hidden');
        return;
      }
      cleanup(outcome.value !== undefined ? outcome.value : true);
    });

    if (onMount) onMount(card, cleanup);
  });
}

/** Small confirm() replacement styled consistently with the rest of the app. */
export function confirmModal(message, { title = 'Confirm', danger = false } = {}) {
  return openModal({
    title,
    bodyHtml: `<p class="modal-confirm-text">${message}</p>`,
    submitLabel: danger ? 'Delete' : 'OK'
  }).then((r) => r === true);
}

/** Shared toast (single reused DOM node) — same element every panel writes to, so a
 * second toast fired while one is showing replaces rather than queues behind it. */
export function showToast(message) {
  let toast = document.querySelector('.studio-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'studio-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}
