# E2E tests (Playwright)

For real-browser rendering checks — Shadow DOM, `adoptedStyleSheets`, theme/fullscreen
CSS-class toggling — the things `jsdom` doesn't faithfully emulate and this codebase has
been bitten by before (see CLAUDE.md's Shadow DOM selector-boundary gotcha).

**One-time setup, before running these tests on a new machine:**

```bash
npx playwright install chromium
```

This downloads a real Chromium build (not installed by `npm install` — deliberately, since
it's a large download you only want once you actually need it). Then run
`npm run test:e2e` here, or from the repository root, where `npm run test:e2e` syncs the
shared copies first and runs both the Studio and PWA suites.

The original sixteen specs cover the Property Inspector (tabs, scroll preservation, numeric and
compound inputs, the override indicator, the multi-select shell), the color picker
popover, and the rotary component (its Inspector fields, appearance, acceleration, Pulse
bindings and write-mode defaults, plus appearance scaling, canvas thumbnail, device
preview and rendered face). They import `@playwright/test` directly and do not isolate
the page from PC Bridge. The two StudioInspector characterization specs,
`inspector-shell.spec.js` and `inspector-renderers.spec.js`, import `test`/`expect` from `fixtures/inspectorHarness.js`
instead. The harness routes every WebSocket closed, aborts every request outside the
Studio web server, blocks service workers, and provides seeding, selection,
fresh-construction and call-through recording helpers. Add a spec when a ticket's
confirmed seam needs real-browser verification rather than pure-logic testing (that
belongs in `../smoke.test.js`'s directory, run via `npm test`).
