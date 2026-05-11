import { readJson, writeJson, todayInTaipei } from "./lib.js";

const date = process.argv[2] || todayInTaipei();
const processed = readJson(`data/processed/${date}.json`, { date, news: [] });
const visibleNews = processed.news
  .filter((item) => item.score >= 60 && item.excluded === false)
  .filter((item) => item.matched_stocks?.length || item.matched_industries?.length || item.category === "broker_view")
  .sort((a, b) => b.score - a.score);

const windows = {
  pre_market: buildWindow(visibleNews, "pre_market"),
  market: buildWindow(visibleNews, "market"),
  after_market: buildWindow(visibleNews, "after_market")
};

const daily = {
  date,
  generated_at: new Date().toISOString(),
  time_windows: windows,
  all_news_count: processed.news.length,
  visible_news_count: visibleNews.length
};

writeJson(`data/daily/${date}.json`, daily);
writeJson("data/daily/latest.json", daily);

function buildWindow(news, timeWindow) {
  const items = news.filter((item) => item.time_window === timeWindow);
  return {
    major_positive: items.filter((item) => item.category === "major_positive"),
    hot_stocks: rankStocks(items),
    hot_industries: rankIndustries(items),
    broker_view: items.filter((item) => item.category === "broker_view"),
    stock_news: items.filter((item) => ["stock_news", "neutral_or_watch", "industry_news"].includes(item.category))
  };
}

function rankStocks(items) {
  const ranks = new Map();
  for (const item of items) {
    for (const stock of item.matched_stocks || []) {
      const key = stock.code || stock.name;
      if (!key) continue;
      const current = ranks.get(key) || { ...stock, count: 0, score: 0, news_ids: [] };
      current.count += 1;
      current.score += item.score;
      current.news_ids.push(item.id);
      ranks.set(key, current);
    }
  }
  return [...ranks.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}

function rankIndustries(items) {
  const ranks = new Map();
  for (const item of items) {
    for (const industry of item.matched_industries || []) {
      const current = ranks.get(industry) || { name: industry, count: 0, score: 0, news_ids: [] };
      current.count += 1;
      current.score += item.score;
      current.news_ids.push(item.id);
      ranks.set(industry, current);
    }
  }
  return [...ranks.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}
