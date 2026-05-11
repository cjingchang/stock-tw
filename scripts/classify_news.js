import { readJson, writeJson, includesAny, todayInTaipei } from "./lib.js";
import { scoreNewsItem } from "./score_news.js";

const date = process.argv[2] || todayInTaipei();
const raw = readJson(`data/raw/${date}.json`, { date, news: [] });
const keywords = readJson("config/keywords.json", {});

const processed = raw.news.map((item) => classifyNews(item, keywords));

writeJson(`data/processed/${date}.json`, {
  date,
  generated_at: new Date().toISOString(),
  news: processed.map((item) => scoreNewsItem(item, keywords))
});

export function classifyNews(item, keywords) {
  const text = `${item.title || ""} ${item.summary || ""} ${item.content || ""}`;
  const excludedMatches = includesAny(text, keywords.exclude_keywords);
  const matched_stocks = findStocks(text, keywords.stock_aliases || []);
  const matched_industries = includesAny(text, keywords.industry_keywords);
  const positiveMatches = includesAny(text, keywords.positive_event_keywords);
  const brokerMatches = includesAny(text, keywords.broker_keywords);
  const neutralMatches = includesAny(text, keywords.neutral_keywords);

  const excluded = excludedMatches.length > 0;
  let category = "irrelevant";

  if (matched_stocks.length && positiveMatches.length) {
    category = "major_positive";
  } else if (matched_industries.length && positiveMatches.length) {
    category = "major_positive";
  } else if (brokerMatches.length) {
    category = "broker_view";
  } else if (neutralMatches.length) {
    category = "neutral_or_watch";
  } else if (matched_stocks.length) {
    category = "stock_news";
  } else if (matched_industries.length) {
    category = "industry_news";
  }

  return {
    ...item,
    matched_stocks,
    matched_industries,
    category,
    excluded,
    exclude_reason: excluded ? `命中排除關鍵字：${excludedMatches.join("、")}` : "",
    keyword_matches: {
      positive: positiveMatches,
      broker: brokerMatches,
      neutral: neutralMatches,
      exclude: excludedMatches
    }
  };
}

function findStocks(text, stockAliases) {
  const found = new Map();
  for (const stock of stockAliases) {
    const names = [stock.name, ...(stock.aliases || [])].filter(Boolean);
    const hasName = names.some((name) => text.includes(name));
    const hasCode = stock.code && new RegExp(`(^|[^0-9])${escapeRegExp(stock.code)}([^0-9]|$)`).test(text);
    if (hasName || hasCode) {
      found.set(stock.code, {
        code: stock.code,
        name: stock.name,
        matched_by_code: Boolean(hasCode)
      });
    }
  }

  const codeMatches = text.match(/(?:^|[^0-9])([1-9][0-9]{3})(?:[^0-9]|$)/g) || [];
  for (const match of codeMatches) {
    const code = match.replace(/\D/g, "");
    if (/^(19|20)\d{2}$/.test(code)) continue;
    if (!found.has(code)) {
      found.set(code, { code, name: "" });
    }
  }

  return cleanupPrefixMatches([...found.values()], stockAliases, text).map(({ matched_by_code, ...stock }) => stock);
}

function cleanupPrefixMatches(stocks, stockAliases, text) {
  const names = stockAliases.map((stock) => stock.name).filter(Boolean);
  return stocks.filter((stock) => {
    if (stock.matched_by_code || !stock.name) return true;
    const hasLongerPrefixMatch = names.some((name) => name !== stock.name && name.startsWith(stock.name) && text.includes(name));
    if (!hasLongerPrefixMatch) return true;
    return new RegExp(`${escapeRegExp(stock.name)}([^\\p{Script=Han}0-9A-Za-z]|$)`, "iu").test(text);
  });
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
