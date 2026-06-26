export interface MobileBarKeyboardFlagsInput {
  isMobile: boolean;
  keyboardOpen: boolean;
  anyModalOpen: boolean;
  /** True when a fullscreen mobile overlay owns keyboard/viewport layout. */
  overlayOpen: boolean;
  isIOS: boolean;
}

export interface MobileBarKeyboardFlags {
  footerHidden: boolean;
  navKeyboardOpen: boolean;
  footerKeyboardOpen: boolean;
}

/*
FNXC:MobileChatKeyboardLayout 2026-06-26-09:04:
While the soft keyboard is up on mobile, the dashboard must NOT show the executor footer (task counts / Running indicator) and must NOT leave dead space above the keyboard. `footerHidden` drives both: it returns the ExecutorStatusBar null AND drops `.project-content`'s reserved footer+nav padding-bottom, letting the composer sit directly above the keyboard.

This now applies to BOTH iOS and Android. Previously `footerHidden` was iOS-only (FN-5707): on Android `interactive-widget=resizes-content` shrinks the layout viewport, so the footer's stacked bottom position was technically "correct" — but with the nav bar slid off-screen (`translateY(100%)`) on keyboard-open, its reserved ~80px (footer-height + nav-height) padding rendered as an empty gap between the footer and the keyboard, with the footer still visible. Matching iOS removes both the footer and the gap on Android.

FN-5707's original Android concern (stripping nav padding mid-focus could make Android Chrome treat the focused input as moving and dismiss the keyboard) is mitigated because the strip is keyed off `keyboardOpen`, which only flips true AFTER the visualViewport has settled into its keyboard-open size — not during the focus transition.

`footerKeyboardOpen` (the footer `bottom: 0` collapse class) stays iOS-only: it is only meaningful when the footer is still rendered (e.g. over a modal), and Android's resizes-content keeps the stacked position correct in that case.

Fullscreen mobile overlays (for example Quick Chat's sheet) own their own visual viewport handling. Treat them like modals for board-layout padding so overlay-local keyboards never shift the underlying board.
*/
export function computeMobileBarKeyboardFlags({
  isMobile,
  keyboardOpen,
  anyModalOpen,
  overlayOpen,
  isIOS,
}: MobileBarKeyboardFlagsInput): MobileBarKeyboardFlags {
  const boardLayoutSuppressed = anyModalOpen || overlayOpen;
  const footerHidden = isMobile && keyboardOpen && !boardLayoutSuppressed;
  const navKeyboardOpen = isMobile && keyboardOpen;
  const footerKeyboardOpen = navKeyboardOpen && isIOS;

  return {
    footerHidden,
    navKeyboardOpen,
    footerKeyboardOpen,
  };
}
