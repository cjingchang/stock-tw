import { spawnSync } from "node:child_process";

const date = process.argv[2] || "";
const steps = [
  ["fetch-news", "scripts/fetch_news.js"],
  ["classify-news", "scripts/classify_news.js"],
  ["build-daily", "scripts/build_daily_data.js"]
];

for (const [name, script] of steps) {
  const result = spawnSync(process.execPath, [script, date].filter(Boolean), {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`${name} failed`);
  }
}
