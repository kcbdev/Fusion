---
title: "xterm OptionsService no-op reassignment silently skips post-load remeasure"
date: 2026-07-04
category: ui-bugs
module: packages/dashboard/app/components/TerminalModal
problem_type: ui_bug
component: frontend_terminal
applies_when: "Code reapplies an xterm.js Terminal option (fontFamily, fontSize, etc.) to a value that may already equal the terminal's current option value, expecting that reassignment to force an internal recompute (character measurement, renderer dimensions, letter-spacing compensation)."
symptoms:
  - "Mobile terminal text still renders with excessive inter-character spacing on the very first layout even after text-size-adjust is disabled and a document.fonts settle/remeasure step was already added"
  - "The spacing only 'repairs itself' after an unrelated event: toggling the virtual keyboard, rotating the device, reconnecting the session, or manually changing the font size and changing it back"
  - "Existing --keyboard-overlap/--vv-height/--vv-width/text-size-adjust: none assertions and a mocked resize(80, 24) all pass while the real-device symptom persists"
root_cause: xterm_optionsservice_setter_is_a_strict_noop_on_identical_values_so_reassigning_the_same_resolved_font_after_an_async_settle_never_fires_onoptionchange_and_never_forces_charsizeservice_domrenderer_remeasure
resolution_type: code_fix
severity: high
related_components:
  - packages/dashboard/app/components/TerminalModal.tsx
  - packages/dashboard/app/components/SessionTerminal.tsx
  - packages/dashboard/app/utils/terminalPreferences.ts
  - packages/dashboard/app/components/__tests__/TerminalModal.test.tsx
  - packages/dashboard/app/components/__tests__/SessionTerminal.test.tsx
  - packages/dashboard/app/utils/__tests__/terminalPreferences.test.ts
  - FN-7456
  - FN-7460
  - FN-7561
tags:
  - xterm
  - font-loading
  - options-service
  - mobile-safari
  - remeasure
---

# xterm OptionsService no-op reassignment silently skips post-load remeasure

## Problem

FN-7561 is the third recurrence of "mobile terminal renders with excessive inter-character spacing" after this exact subsystem was touched twice before:

- FN-7456 added the iOS keyboard/viewport baseline and a symbols-free measured font stack (see `xterm-symbols-nerd-font-unicode-range.md`).
- FN-7460 added `-webkit-text-size-adjust: none` / `text-size-adjust: none` on `.terminal-xterm, .terminal-xterm *` after a real iPhone Safari report showed spacing surviving FN-7456, plus 10px/12px coverage.

Despite both fixes, the real-device symptom persisted. Both prior fixes treated the browser's DOM text-size-adjust/font-boosting behavior as the entire mechanism. It was not.

### The actual mechanism

xterm.js measures character/cell metrics via `CharSizeService`, then `DomRenderer._setDefaultSpacing()` bakes a compensating `letter-spacing` onto `.xterm-rows`:

```ts
// @xterm/xterm src/browser/renderer/dom/DomRenderer.ts
private _setDefaultSpacing(): void {
  // measure same char as in CharSizeService to get the base deviation
  const spacing = this.dimensions.css.cell.width - this._widthCache.get('W', false, false);
  this._rowContainer.style.letterSpacing = `${spacing}px`;
  this._rowFactory.defaultSpacing = spacing;
}
```

This recompute only runs from `_handleOptionsChanged()` (wired to `optionsService.onOptionChange`) or from `handleCharSizeChanged()`. Both app terminal surfaces (`TerminalModal.tsx`, `SessionTerminal.tsx`) reapply xterm font options after `waitForTerminalFontMetrics()` (added by FN-7456) settles, expecting that reassignment to force this recompute against the font that only just finished loading. But real xterm's `OptionsService` setter is a strict no-op on an unchanged value:

```ts
// @xterm/xterm src/common/services/OptionsService.ts
const setter = (propName: string, value: any): void => {
  value = this._sanitizeAndValidateOption(propName, value);
  // Don't fire an option change event if they didn't change
  if (this.rawOptions[propName] !== value) {
    this.rawOptions[propName] = value;
    this._onOptionChange.fire(propName);
  }
};
```

In the common case (the user never touched terminal preferences), the resolved `fontFamily`/`fontSize` after settle are *identical* to what was already applied a few lines earlier at xterm construction/effect setup. Reassigning the same value is therefore a total no-op: no `onOptionChange` fires, `CharSizeService` never remeasures, and `DomRenderer._setDefaultSpacing()` never recomputes the letter-spacing compensation against the now-loaded web font. The stale pre-load cell metrics (measured against a fallback system font before the custom font finished loading) persist as visible excess gaps on the very first mobile layout — exactly matching the report that the terminal "only repairs itself after keyboard toggle/orientation/reconnect": those events happen to force a genuine value change elsewhere in the pipeline (e.g. `handleResize`/`handleDevicePixelRatioChange`), incidentally triggering the missing remeasure.

Both `TerminalModal.tsx` and `SessionTerminal.tsx` had this bug in **two** places each: the initial xterm-init settle path and the live-preferences-apply settle path.

## Why FN-7456/FN-7460 missed this

Both fixes (and their regression tests) only ever asserted the *final* font/size value and CSS text-size-adjust state, never whether a genuine value *transition* occurred inside xterm's internal option pipeline. A plain mock `options: { fontSize: 14 }` object cannot model xterm's no-op-on-unchanged-value contract, so no test could distinguish "the code reassigned the resolved value" (looks correct) from "xterm's internal measurement pipeline actually recomputed" (the real requirement).

## Solution

Force a genuine (distinct-value) transition through xterm's option setter every time font metrics settle, regardless of whether the resolved value already equals the terminal's current option value:

```ts
// packages/dashboard/app/utils/terminalPreferences.ts
const TERMINAL_FONT_REMEASURE_SENTINEL_FONT_FAMILY = "monospace";

export function forceTerminalFontRemeasure(
  terminal: { options: { fontFamily?: string } },
  fontFamily: string,
): void {
  const sentinel =
    fontFamily === TERMINAL_FONT_REMEASURE_SENTINEL_FONT_FAMILY
      ? `${TERMINAL_FONT_REMEASURE_SENTINEL_FONT_FAMILY}, monospace`
      : TERMINAL_FONT_REMEASURE_SENTINEL_FONT_FAMILY;
  terminal.options.fontFamily = sentinel;
  terminal.options.fontFamily = fontFamily;
}
```

Both assignments run synchronously with no yield in between, so no intermediate frame paints — the terminal never visibly flashes the sentinel font. Both `TerminalModal.tsx` and `SessionTerminal.tsx` now call `forceTerminalFontRemeasure(terminal, resolvedFontFamily)` (instead of a plain `terminal.options.fontFamily = resolvedFontFamily`) at every post-settle site, immediately before reapplying `fontSize` and refitting/resizing/refreshing.

Do not:

- Add a hardcoded `letterSpacing`, fixed cell width, or fixed column count to mask the symptom.
- Skip the reassignment when the resolved value already matches the current option value — that equality is exactly what causes the bug.
- Remove or weaken the FN-7456/FN-7460 `text-size-adjust`/font-stack/keyboard-overlap coverage; this fix is additive to those invariants, not a replacement.

## Regression coverage

jsdom cannot exercise real xterm.js internals, so the regression coverage models xterm's documented no-op-on-unchanged-value contract directly on the test double, and asserts the *transition*, not just the final value:

- Wrap the mocked `Terminal.options` object in a real getter/setter pair with the same equality check as `@xterm/xterm`'s `OptionsService` setter, and track a counter that only increments on a genuine (distinct-value) `fontFamily`/`fontSize` transition.
- Simulate the real recurrence: xterm opens before `document.fonts.load()`/`document.fonts.ready` resolve (deferred promises), the resolved font/size are already applied and unchanged once they settle.
- Assert the transition counter goes from 0 to a positive count once `waitForTerminalFontMetrics()` settles — this fails pre-fix (a plain reassignment to the same value is a no-op) and passes post-fix (`forceTerminalFontRemeasure` always forces at least one genuine transition).
- Add a focused unit test for `forceTerminalFontRemeasure()` itself in `terminalPreferences.test.ts`, covering both "resolved value unchanged" and "resolved value genuinely different" cases.
- Cover both `TerminalModal` (mobile viewport, keyboard-open and keyboard-closed initial render) and `SessionTerminal` (embedded attach surface) — both surfaces independently reapply font options after settle and both had the bug.
- Run: `pnpm --filter @fusion/dashboard exec vitest run app/components/__tests__/TerminalModal.test.tsx app/components/__tests__/SessionTerminal.test.tsx app/components/__tests__/SessionTerminal.mobile.test.tsx app/__tests__/terminal-input.test.ts app/utils/__tests__/terminalPreferences.test.ts --silent=passed-only --reporter=dot`.
- Real mobile Safari/Chrome verification remains the strongest signal for this class of bug; if unavailable, record that as an explicit gap rather than treating desktop WebKit/jsdom as proof (see `docs/ios-acceptance.md`).
