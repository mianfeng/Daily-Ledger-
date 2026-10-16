const fs = require("node:fs");
const assert = require("node:assert/strict");
const css = fs.readFileSync("index.css", "utf8").replace(/\s+/g, "");
const block = (selector) => {
  const from = css.indexOf(selector);
  const content = css.slice(css.indexOf("{", from) + 1, css.indexOf("}", from));
  return Object.fromEntries(
    [...content.matchAll(/--([\w-]+):([^;]+);/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
};
const base = block(":root,.warm-ui");
const business = block(".module-business,");
const dark = block(".theme-dark{");
const darkBusiness = block(".theme-dark.module-business");
const color = (value, backdrop = [255, 255, 255]) => {
  if (value.startsWith("#")) {
    const hex =
      value.length === 4
        ? [...value.slice(1)].map((c) => c + c).join("")
        : value.slice(1);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  assert.ok(match, `Unsupported color ${value}`);
  const values = match[1].split(",").map(Number);
  const alpha = values[3] ?? 1;
  return values
    .slice(0, 3)
    .map((v, i) => v * alpha + backdrop[i] * (1 - alpha));
};
const luminance = (channels) =>
  channels
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (fg, bg) => {
  const [lo, hi] = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
  return (hi + 0.05) / (lo + 0.05);
};
const pairs = [
  ["text", "bg"],
  ["text", "card"],
  ["text", "accent-soft"],
  ["muted", "bg"],
  ["muted", "card"],
  ["muted", "accent-soft"],
  ["muted", "warn-soft"],
  ["accent", "card"],
  ["accent", "accent-soft"],
  ["warn", "card"],
  ["warn", "warn-soft"],
  ["neg", "card"],
  ["neg", "warn-soft"],
  ["pos", "card"],
  ["pos", "accent-soft"],
  ["on-accent", "accent"],
  ["on-accent", "accent-hi"],
];
const themes = {
  "亮色·生活": base,
  "亮色·铜钱": { ...base, ...business },
  "暗色·生活": { ...base, ...dark },
  "暗色·铜钱": { ...base, ...dark, ...darkBusiness },
};
const rows = [];
let report =
  "# UI contrast verification\n\nAll text pairs require 4.5:1, including gradient endpoints.\n\n| Theme | Foreground / Background | Ratio | Pass |\n| --- | --- | --- | --- |\n";
for (const [theme, tokens] of Object.entries(themes)) {
  for (const [fg, bg] of pairs) {
    const backdrops = tokens[bg].startsWith("rgba") ? ["card", "bg"] : ["card"];
    for (const backdrop of backdrops) {
      const surface = color(tokens[bg], color(tokens[backdrop]));
      const value = ratio(color(tokens[fg], surface), surface);
      rows.push({ theme, fg, bg, backdrop, ratio: value });
      report += `| ${theme} | ${fg} ${tokens[fg]} / ${bg} ${tokens[bg]} over ${backdrop} | ${value.toFixed(2)} | ${value >= 4.5 ? "yes" : "FAIL"} |\n`;
    }
  }
}
const taskRoot = fs.existsSync(".trellis/tasks/10-16-kyoto-ui-interactions")
  ? ".trellis/tasks/10-16-kyoto-ui-interactions"
  : ".trellis/tasks/archive/2026-10/10-16-kyoto-ui-interactions";
const out = process.env.UI_QA_OUTPUT || `${taskRoot}/research`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(`${out}/contrast.md`, report);
const failures = rows.filter((row) => row.ratio < 4.5);
assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
console.log(
  `PASS ${rows.length} text/background pairs; minimum ${Math.min(...rows.map((row) => row.ratio)).toFixed(2)}:1`,
);
