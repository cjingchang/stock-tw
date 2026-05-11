import { readJson, writeJson, appendLog, stableId, stripHtml, summarize, getTimeWindow, todayInTaipei } from "./lib.js";

const date = process.argv[2] || todayInTaipei();
const sources = readJson("config/sources.json", []).filter((source) => source.enabled);
const watchUrls = readJson("config/watch_urls.json", []).filter((item) => item.enabled !== false);
const timeoutMs = 12000;

const results = [];

for (const source of sources) {
  try {
    const html = await fetchSource(source);
    const items = extractNewsItems(html, source);
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
  return {
    id: stableId(source.name, watched.url, title),
    title: stripHtml(title),
    url: watched.url,
    source: source.name,
    source_type: source.type,
    source_priority: watched.priority || source.priority || 2,
    published_at: now,
    time_window: getTimeWindow(now),
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

function extractNewsItems(html, source) {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const now = new Date().toISOString();
  return anchors
    .map((match) => {
      const title = stripHtml(match[2]);
      const url = normalizeUrl(match[1], source.url);
      return { title, url };
    })
    .filter((item) => item.title.length >= 6 && item.title.length <= 120 && item.url)
    .filter((item) => !item.url.includes("#") && !/\.(jpg|jpeg|png|gif|svg|webp|pdf)$/i.test(item.url))
    .slice(0, source.max_items || 120)
    .map((item) => ({
      id: stableId(source.name, item.url, item.title),
      title: item.title,
      url: item.url,
      source: source.name,
      source_type: source.type,
      source_priority: source.priority,
      published_at: now,
      time_window: getTimeWindow(now),
      summary: summarize(item.title),
      content: item.title,
      matched_stocks: [],
      matched_industries: [],
      category: "unclassified",
      score: 0,
      excluded: false,
      exclude_reason: "",
      user_feedback: null
    }));
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
