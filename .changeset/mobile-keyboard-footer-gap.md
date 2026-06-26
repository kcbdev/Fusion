---
"@runfusion/fusion": patch
---

summary: Mobile: hide the executor footer and remove the empty gap above the keyboard while typing.
category: fix
dev: computeMobileBarKeyboardFlags no longer iOS-gates footerHidden, so Android keyboard-open now hides ExecutorStatusBar and drops the reserved footer+nav padding-bottom (composer sits flush above the keyboard). footerKeyboardOpen stays iOS-only. Supersedes FN-5707's Android gate.
