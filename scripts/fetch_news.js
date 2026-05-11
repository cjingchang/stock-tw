import { readJson, writeJson, appendLog, stableId, stripHtml, summarize, getTimeWindow, todayInTaipei } from "./lib.js";

const date = process.argv[2] || todayInTaipei();
const sources = readJson("config/sources.json", []).filter((source) => source.enabled);
const watchUrls = readJson("config/watch_urls.json", []).filter((item) => item.enabled !== false);
const timeoutMs = 12000;

const results = [];

for (const source of sources) {
  try {
    const html = await fetchSource(source);
    const items = await extractNewsItems(html, source);
    results.push(...items);
    appendLog("logs/fetch.log", `${source.name}: fetched ${items.length} candidate news items`);
  } catch (error) {
    appendLog("logs/fetch.log", `${source.name}: failed - ${error.message}`);
  }
}

for (const item of watchUrls) {
  try {
    const html = await fetchSource({ url: item.url });
    const news = extractWatchedNews(html, item, sources);
    results.push(news);
    appendLog("logs/fetch.log", `${news.source}: watched URL fetched - ${news.title}`);
  } catch (error) {
    appendLog("logs/fetch.log", `${item.url}: watched URL failed - ${error.message}`);
  }
}

writeJson(`data/raw/${date}.json`, {
  date,
  generated_at: new Date().toISOString(),
  sources: sources.map(({ name, url, type, enabled, priority }) => ({ name, url, type, enabled, priority })),
  news: dedupe(results)
});

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url || `${item.source}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractWatchedNews(html, watched, sources) {
  const now = new Date().toISOString();
  const source = resolveWatchedSource(watched, sources);
  const title = extractMeta(html, "og:title") || extractTitle(html) || watched.url;
  const description = extractMeta(html, "og:description") || extractMeta(html, "description") || title;
  const publishedAt = extractPublishedAt(html, `${title} ${watched.url}`);
  const effectiveTime = publishedAt || new Date().toISOString();
  return {
    id: stableId(source.name, watched.url, title),
    title: stripHtml(title),
    url: watched.url,
    source: source.name,
    source_type: source.type,
    source_priority: watched.priority || source.priority || 2,
    published_at: effectiveTime,
    display_published_at: publishedAt ? formatTaipeiDateTime(publishedAt) : "原站未標示",
    time_window: getTimeWindow(effectiveTime),
    summary: summarize(description),
    content: `${stripHtml(title)} ${stripHtml(description)}`,
    matched_stocks: [],
    matched_industries: [],
    category: "unclassified",
    score: 0,
    excluded: false,
    exclude_reason: "",
    user_feedback: null
  };
}

function resolveWatchedSource(watched, sources) {
  const matchedByName = sources.find((source) => source.name === watched.source);
  if (matchedByName) return matchedByName;

  try {
    const host = new URL(watched.url).hostname;
    const matchedByHost = sources.find((source) => host.includes(new URL(source.url).hostname.replace(/^www\./, "")));
    if (matchedByHost) return matchedByHost;
  } catch {
    // Fall through to generic watched source.
  }

  return {
    name: watched.source || "指定追蹤",
    type: "watched_url",
    priority: watched.priority || 2
  };
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 stock-tw-news-radar/0.1",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function extractNewsItems(html, source) {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const now = new Date().toISOString();
  const items = anchors
    .map((match) => {
      const title = stripHtml(match[2]);
      const url = normalizeUrl(match[1], source.url);
      return { title, url };
    })
    .filter((item) => item.title.length >= 6 && item.title.length <= 120 && item.url)
    .filter((item) => !/%7B|%7D|{[^}]+}/i.test(item.url))
    .filter((item) => !isNavigationTitle(item.title))
    .filter((item) => !item.url.includes("#") && !/\.(jpg|jpeg|png|gif|svg|webp|pdf)$/i.test(item.url))
    .slice(0, source.max_items || 120)
    .map((item) => {
      const publishedAt = extractPublishedAt("", `${item.title} ${item.url}`);
      const effectiveTime = publishedAt || now;
      return {
      id: stableId(source.name, item.url, item.title),
      title: item.title,
      url: item.url,
      source: source.name,
      source_type: source.type,
      source_priority: source.priority,
      published_at: effectiveTime,
      display_published_at: publishedAt ? formatTaipeiDateTime(publishedAt) : "原站未標示",
      time_window: getTimeWindow(effectiveTime),
      summary: summarize(item.title),
      content: item.title,
      matched_stocks: [],
      matched_industries: [],
      category: "unclassified",
      score: 0,
      excluded: false,
      exclude_reason: "",
      user_feedback: null
      };
    });

  if (!source.fetch_detail) return items;
  return enrichWithDetailPages(items, source);
}

async function enrichWithDetailPages(items, source) {
  const limit = source.detail_limit || 20;
  const enriched = [];
  for (const item of items.slice(0, limit)) {
    try {
      const html = await fetchSource({ url: item.url });
      const publishedAt = extractPublishedAt(html, `${item.title} ${item.url}`) || item.published_at;
      const description = extractMeta(html, "og:description") || extractMeta(html, "description");
      enriched.push({
        ...item,
        published_at: publishedAt,
        display_published_at: publishedAt === item.published_at && item.display_published_at === "原站未標示" ? "原站未標示" : formatTaipeiDateTime(publishedAt),
        time_window: getTimeWindow(publishedAt),
        summary: description ? summarize(description) : item.summary,
        content: `${item.content} ${stripHtml(description || "")}`
      });
    } catch (error) {
      appendLog("logs/fetch.log", `${source.name}: detail failed - ${item.url} - ${error.message}`);
      enriched.push(item);
    }
  }
  return [...enriched, ...items.slice(limit)];
}

function isNavigationTitle(title) {
  return /^(股市 - Master Financial Information|CMoney-create more money|更多|登入|會員|首頁)$|[{}]/i.test(title.trim());
}

function normalizeUrl(href, baseUrl) {
  try {
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) return "";
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyPattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i");
  const contentFirstPattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i");
  return stripHtml((html.match(propertyPattern) || html.match(contentFirstPattern) || [])[1] || "");
}

function extractTitle(html) {
  return stripHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
}

function extractPublishedAt(html, fallbackText = "") {
  const candidates = [
    extractMeta(html, "article:published_time"),
    extractMeta(html, "publishdate"),
    extractMeta(html, "date"),
    extractMeta(html, "pubdate"),
    extractJsonLdDate(html),
    matchDateTime(fallbackText),
    matchDateTime(html)
  ].filter(Boolean);

  for (const candidate of candidates) {
    const parsed = normalizePublishedAt(candidate);
    if (parsed) return parsed;
  }
  return "";
}

function extractJsonLdDate(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    const text = stripHtml(script[1]);
    const match = text.match(/"date(?:Published|Created|Modified)"\s*:\s*"([^"]+)"/i);
    if (match) return match[1];
  }
  return "";
}

function matchDateTime(text) {
  const source = stripHtml(String(text || ""));
  const match = source.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return "";
  const [, year, month, day, hour = "00", minute = "00"] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00+08:00`;
}

function normalizePublishedAt(value) {
  const text = stripHtml(String(value || "")).trim();
  if (!text) return "";
  const matched = matchDateTime(text);
  if (matched) return matched;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function formatTaipeiDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "原站未標示";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
