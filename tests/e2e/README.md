# E2E tests (Playwright)

For real-browser rendering checks — Shadow DOM, `adoptedStyleSheets`, theme/fullscreen
CSS-class toggling — the things `jsdom` doesn't faithfully emulate and this codebase has
been bitten by before (see CLAUDE.md's Shadow DOM selector-boundary gotcha).

**One-time setup, before writing or running the first test here:**

```bash
npx playwright install chromium
```

This downloads a real Chromium build (not installed by `npm install` — deliberately, since
it's a large download you only want once you actually need it). Not run yet as part of the
initial test-runner setup.

No tests exist here yet. Add one when a ticket's confirmed seam needs real-browser
verification rather than pure-logic testing (that belongs in `../smoke.test.js`'s
directory, run via `npm test`).
