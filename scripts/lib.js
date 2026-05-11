import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export function pathFromRoot(...parts) {
  return join(rootDir, ...parts);
}

export function todayInTaipei() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function readJson(relativePath, fallback = null) {
  const file = pathFromRoot(relativePath);
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJson(relativePath, data) {
  const file = pathFromRoot(relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function appendLog(relativePath, message) {
  const file = pathFromRoot(relativePath);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

export function stableId(...parts) {
  return createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
}

export function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarize(text, length = 130) {
  const clean = stripHtml(String(text || ""));
  if (clean.length <= length) return clean;
  return `${clean.slice(0, length).trim()}...`;
}

export function includesAny(text, keywords = []) {
  const haystack = String(text || "").toLowerCase();
  return keywords.filter((keyword) => haystack.includes(String(keyword).toLowerCase()));
}

export function getTimeWindow(dateLike = new Date()) {
  const date = new Date(dateLike);
  const taipeiTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  const [hour, minute] = taipeiTime.split(":").map(Number);
  const minutes = hour * 60 + minute;

  if (minutes >= 20 * 60 || minutes < 8 * 60 + 30) return "pre_market";
  if (minutes >= 8 * 60 + 45 && minutes < 13 * 60 + 30) return "market";
  if (minutes >= 13 * 60 + 30 && minutes < 20 * 60) return "after_market";
  return "pre_market";
}

export function normalizePriority(priority) {
  const value = Number(priority) || 1;
  if (value >= 3) return 15;
  if (value === 2) return 10;
  return 5;
}

export function readFeedback() {
  const file = pathFromRoot("data/feedback/news_feedback.csv");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => parseCsvLine(line))
    .filter((row) => row.length >= 6)
    .map((row) => {
      if (row.length >= 7) {
        const [created_at, news_id, feedback, rating, title, source, url] = row;
        return {
          created_at,
          news_id,
          feedback,
          rating: Number(rating) || null,
          title,
          source,
          url
        };
      }
      const [created_at, news_id, feedback, title, source, url] = row;
      return {
        created_at,
        news_id,
        feedback,
        rating: null,
        title,
        source,
        url
      };
    });
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
