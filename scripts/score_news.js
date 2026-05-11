import { includesAny, normalizePriority, readFeedback, readJson, writeJson, todayInTaipei } from "./lib.js";

export function scoreNewsItem(item, keywords = readJson("config/keywords.json", {}), feedbackRows = readFeedback()) {
  const text = `${item.title || ""} ${item.summary || ""} ${item.content || ""}`;
  const excludeMatches = includesAny(text, keywords.exclude_keywords);
  if (excludeMatches.length) {
    return {
      ...item,
      score: 0,
      excluded: true,
      exclude_reason: item.exclude_reason || `命中排除關鍵字：${excludeMatches.join("、")}`
    };
  }

  let score = 0;
  const stocks = item.matched_stocks || [];
  const hasNamedStock = stocks.some((stock) => stock.name);
  const hasStockCode = stocks.some((stock) => stock.code);
  const industryMatches = item.matched_industries?.length ? item.matched_industries : includesAny(text, keywords.industry_keywords);
  const positiveMatches = item.keyword_matches?.positive?.length ? item.keyword_matches.positive : includesAny(text, keywords.positive_event_keywords);
  const brokerTargetMatches = includesAny(text, ["券商調升", "目標價", "目標價調升", "調升"]);
  const macroMatches = includesAny(text, keywords.macro_keywords);

  if (hasNamedStock) score += 20;
  if (hasStockCode) score += 20;
  if (industryMatches.length) score += 15;
  if (positiveMatches.length) score += 25;
  if (industryMatches.length && positiveMatches.length) score += 10;
  if (brokerTargetMatches.length) score += 20;
  score += normalizePriority(item.source_priority);

  if (macroMatches.length && !stocks.length && !industryMatches.length) score -= 40;
  const matchingFeedback = findMatchingFeedback(item, feedbackRows);
  score += feedbackAdjustment(matchingFeedback);

  return {
    ...item,
    score: Math.max(0, score),
    excluded: false,
    exclude_reason: "",
    user_feedback: matchingFeedback.at(-1)?.feedback || item.user_feedback || null,
    user_rating: matchingFeedback.at(-1)?.rating || item.user_rating || null
  };
}

function findMatchingFeedback(item, feedbackRows) {
  return feedbackRows.filter((row) => {
    if (row.news_id === item.id) return true;
    if (row.source && row.source === item.source && row.title && similar(row.title, item.title)) return true;
    return false;
  });
}

function feedbackAdjustment(relevantRows) {
  let adjustment = 0;
  for (const row of relevantRows) {
    if (Number(row.rating) > 0 && Number(row.rating) < 3) adjustment -= 70;
    if (Number(row.rating) >= 4) adjustment += 8;
    if (row.feedback === "useful") adjustment += 8;
    if (row.feedback === "normal") adjustment += 0;
    if (row.feedback === "irrelevant") adjustment -= 25;
    if (row.feedback === "block_similar") adjustment -= 45;
    if (row.feedback === "low_rating") adjustment -= 70;
    if (row.feedback === "thumbs_up") adjustment += 8;
    if (row.feedback === "thumbs_down") adjustment -= 70;
  }
  return adjustment;
}

function similar(a, b) {
  const left = keywordSet(a);
  const right = keywordSet(b);
  if (!left.size || !right.size) return false;
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / Math.min(left.size, right.size) >= 0.5;
}

function keywordSet(text) {
  return new Set(String(text || "").replace(/[^\p{Script=Han}A-Za-z0-9]/gu, " ").split(/\s+/).filter((word) => word.length >= 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] || todayInTaipei();
  const processed = readJson(`data/processed/${date}.json`, { date, news: [] });
  const keywords = readJson("config/keywords.json", {});
  const feedbackRows = readFeedback();
  writeJson(`data/processed/${date}.json`, {
    ...processed,
    generated_at: new Date().toISOString(),
    news: processed.news.map((item) => scoreNewsItem(item, keywords, feedbackRows))
  });
}
