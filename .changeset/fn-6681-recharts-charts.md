---
"@runfusion/fusion": minor
---

Add `recharts` and shared Command Center PieChart/LineChart wrappers for downstream graphical chart migrations. The wrappers are token-themed, responsive, reduced-motion aware, and safe for empty, zero, negative, NaN, and Infinity inputs; the current production build shows no observable Command Center chunk-size increase yet because no Command Center surface imports the new wrappers until the dependent migration tasks land (CommandCenter chunk remains 74.68 kB / 16.46 kB gzip in this task's build output).
