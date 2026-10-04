import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
const out = "docs/art/grounded-realism";
await mkdir(`${out}/evidence`, { recursive: true });
const names = [
  "baseline-a",
  "baseline-c",
  "baseline-e",
  "candidate-d",
  "candidate-e",
  "candidate-final-maps",
  "baseline-cpu4",
  "candidate-cpu4",
  "baseline-foliage",
  "candidate-foliage",
  "baseline-auto4",
  "candidate-auto4",
];
const reports = {};
for (const name of names) {
  const source = ["baseline-a", "baseline-c"].includes(name)
    ? `output/playwright/performance/${name}.json`
    : `/tmp/scrapfall-realism-performance/${name}.json`;
  reports[name] = JSON.parse(await readFile(source, "utf8"));
  if (
    reports[name].cases.some(
      (c) => c.failure || c.errors.length || c.consoleErrors.length || !c.metrics,
    )
  )
    throw new Error(`Invalid run: ${name}`);
  await copyFile(source, `${out}/evidence/${name}.json`);
}
const n = (v) => (typeof v === "number" ? v.toFixed(1) : "—");
const metrics = (name, map) => reports[name].cases.find((c) => c.map === map).metrics;
const row = (label, m) =>
  `| ${label} | ${n(m.p95)} | ${n(m.p99)} | ${n(m.worst)} | ${m.over16_7}/${m.frames} | ${m.over25}/${m.over50} |`;
const head =
  "| Run | p95 ms | p99 ms | Worst ms | >16.7 ms / frames | >25 / >50 ms |\n|---|---:|---:|---:|---:|---:|\n";
let text =
  "# Performance evidence\n\nRead the method and limitations in [README](README.md). Raw reports include setup, poses, quality logs, startup tasks, shader events and frame statistics. All frame times below include the complete measured interval.\n\n## Final active-combat comparisons\n\n" +
  head;
const native = [];
for (const map of ["vice", "pier", "whiteout", "gulch"]) {
  const before = map === "vice" ? "baseline-e" : "baseline-c";
  const after = map === "vice" ? "candidate-e" : "candidate-final-maps";
  for (const [label, name] of [
    ["baseline", before],
    ["candidate", after],
  ]) {
    const m = metrics(name, map);
    text += row(`${map} ${label}`, m) + "\n";
    native.push([`${map} ${label}`, m]);
  }
}
text +=
  "\n| Run | CPU render-submit mean / p95 ms | GPU render-pass p95 ms | Draw calls mean | Triangles mean |\n|---|---:|---:|---:|---:|\n";
for (const [label, m] of native)
  text += `| ${label} | ${n(m.renderSubmitMean)} / ${n(m.renderSubmitP95)} | ${n(m.gpuRenderPassP95)} | ${n(m.callsMean)} | ${Math.round(m.trianglesMean).toLocaleString("en-US")} |\n`;
text +=
  "\n## After the first 10 measured seconds\n\nThis subset does not prove warm steady-state: new variants and other long tasks can still occur later. Whole-run hitches above remain part of the result.\n\n| Run | p95 / p99 ms | Worst ms | >16.7 ms / frames |\n|---|---:|---:|---:|\n";
for (const [label, m] of native) {
  const w = m.warmAfter10s;
  text += `| ${label} | ${n(w.p95)} / ${n(w.p99)} | ${n(w.worst)} | ${w.over16_7}/${w.frames} |\n`;
}
text +=
  "\n## Vice stress and close-foliage pairs\n\n4× CPU uses the same rain/wave 4 diagnostic for 30 seconds. Foliage uses sunny tour mode, a matched walkable start 4 m from the closest tree, camera aimed into the crown, alternating A/D movement and continuous firing for 30 seconds. It exercises near alpha coverage and its shadow pass; it is not the combat route. AUTO is a separate dynamic-resolution/tier run, not equivalent to HIGH.\n\n" +
  head;
for (const name of [
  "baseline-cpu4",
  "candidate-cpu4",
  "baseline-auto4",
  "candidate-auto4",
  "baseline-foliage",
  "candidate-foliage",
])
  text += row(name, metrics(name, "vice")) + "\n";
text +=
  "\n| Run | Average uncapped fps | CPU submit mean ms | GPU p95 ms | Final tier / DPR |\n|---|---:|---:|---:|---|\n";
for (const name of [
  "baseline-cpu4",
  "candidate-cpu4",
  "baseline-auto4",
  "candidate-auto4",
  "baseline-foliage",
  "candidate-foliage",
]) {
  const m = metrics(name, "vice");
  text += `| ${name} | ${n(m.fps)} | ${n(m.renderSubmitMean)} | ${n(m.gpuRenderPassP95)} | ${m.quality.tier} / ${m.quality.dpr} |\n`;
}
const same =
  JSON.stringify(reports["baseline-foliage"].cases[0].foliage) ===
  JSON.stringify(reports["candidate-foliage"].cases[0].foliage);
text += `\nClose-foliage start/target match: **${same ? "PASS" : "MISMATCH — inspect raw reports"}**.\n\n## Source and run order\n\n`;
for (const name of names) {
  const r = reports[name];
  text += `- [${name}](evidence/${name}.json): ${r.commit}, ${r.started}; ${r.seconds}s, CPU×${r.cpuThrottle ?? 1}.\n`;
}
text +=
  "\nThe intermediate candidate-d preceded the facade-culling optimization. Its Vice GPU p95 was 10.03 ms; candidate-e is 8.76 ms, versus paired baseline 8.38 ms. Added draw batches trade some CPU submission for less distant geometry. The initial baseline-a overlaps a unit-test run and is retained only to disclose variability; baseline-c/e are the main comparisons. No task-owned GPU job ran concurrently with the main measurements. Background system activity remains a limitation. Dirty flags on final reports reflect documentation/diagnostic edits; shipped game source matches the recorded implementation head.\n\nProgram-count changes are evidence of variant activity, not proof that every hitch is compilation. Counts also cannot detect a replacement that leaves the total unchanged. Late frame spikes are retained and need follow-up; this report does not establish sustained, hitch-free 60 fps or universal device support.\n";
await writeFile(`${out}/PERFORMANCE.md`, text);
