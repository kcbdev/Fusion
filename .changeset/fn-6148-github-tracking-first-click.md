---
"@fusion/dashboard": patch
---

Fix first tap of GitHub tracking icon in quick task entry on mobile (FN-6148).

The delegated touch handler on `.quick-entry-actions` now uses `closest("button")` to resolve taps that land on child SVG elements, so the GitHub tracking toggle responds correctly on the first touch — identical root-cause fix as FN-6145.
