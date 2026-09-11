/**
 * AnchoredPopover.js
 * Generic small, single-purpose popover pattern anchored to a triggering
 * element (a swatch/icon button), as opposed to StudioModal.js's full-screen
 * overlay dialog. Deliberately generic — the body content is supplied by the
 * caller (color picker today, e.g. an icon picker later); this module only
 * owns positioning, chrome (Apply/Cancel footer), and dismissal semantics.
 *
 * Usage:
 *   const result = await openAnchoredPopover({
 *     anchor: swatchButtonEl,
 *     bodyHtml: `...`,
 *     initialValue: currentColor,
 *     onMount: (bodyEl, ctx) => {
 *       ...wire picker UI, call ctx.setValue(v) as it changes...
 *       return () => { ...optional: undo any window/document listeners added here... };
 *     },
 *   });
 *   if (result !== null) { ...use result (the value at the moment Apply was clicked)... }
 *
 * Dismissal: clicking Cancel, pressing Escape, or clicking outside the
 * popover all resolve with `null` and leave the caller's underlying value
 * untouched — only an explicit Apply click resolves with the picked value.
 */
export function openAnchoredPopover({
  anchor,
  bodyHtml = '',
  onMount,
  initialValue = null,
  applyLabel = 'Apply',
  cancelLabel = 'Cancel',
  className = ''
}) {
  return new Promise((resolve) => {
    let current = initialValue;

    const popover = document.createElement('div');
    popover.className = `studio-popover${className ? ` ${className}` : ''}`;
    popover.setAttribute('role', 'dialog');
    popover.innerHTML = `
      <div class="popover-body"></div>
      <div class="popover-footer">
        <button type="button" class="bar-btn" data-popover-cancel>${cancelLabel}</button>
        <button type="button" class="bar-btn primary" data-popover-apply>${applyLabel}</button>
      </div>
    `;
    document.body.appendChild(popover);

    const bodyEl = popover.querySelector('.popover-body');
    bodyEl.innerHTML = bodyHtml;

    reposition();

    let onMountCleanup;
    const cleanup = (result) => {
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('mousedown', onOutsideMouseDown, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      if (typeof onMountCleanup === 'function') onMountCleanup();
      popover.remove();
      resolve(result);
    };

    function reposition() {
      positionAnchoredPopover(popover, anchor);
    }

    const onKeydown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); cleanup(null); }
    };
    // The click that opened this popover (e.g. the swatch's own 'click'
    // handler calling openAnchoredPopover) is still bubbling to `document`
    // when this listener is attached synchronously — deferring to the next
    // tick keeps that same click from being read as an immediate
    // "click outside" and closing the popover it just opened.
    const onOutsideMouseDown = (e) => {
      if (!popover.contains(e.target) && e.target !== anchor && !anchor?.contains?.(e.target)) {
        cleanup(null);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onOutsideMouseDown, true), 0);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    popover.querySelector('[data-popover-cancel]').addEventListener('click', () => cleanup(null));
    popover.querySelector('[data-popover-apply]').addEventListener('click', () => cleanup(current));

    const ctx = {
      setValue: (v) => { current = v; },
      getValue: () => current,
      reposition,
      close: (result = null) => cleanup(result)
    };

    if (onMount) onMountCleanup = onMount(bodyEl, ctx);
  });
}

/**
 * Positions `popover` (already appended to the body, so its own rect can be
 * measured) just under `anchor`, clamped to stay fully inside the viewport —
 * flipping above the anchor if there isn't room below, and clamping
 * horizontally rather than letting it run off either edge.
 */
export function positionAnchoredPopover(popover, anchor, { margin = 6, edgePadding = 8 } = {}) {
  const anchorRect = anchor.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();

  let left = anchorRect.left;
  const maxLeft = window.innerWidth - popRect.width - edgePadding;
  left = Math.min(left, Math.max(edgePadding, maxLeft));
  left = Math.max(edgePadding, left);

  let top = anchorRect.bottom + margin;
  if (top + popRect.height > window.innerHeight - edgePadding) {
    const above = anchorRect.top - margin - popRect.height;
    top = above >= edgePadding ? above : Math.max(edgePadding, window.innerHeight - popRect.height - edgePadding);
  }

  popover.style.position = 'fixed';
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}
