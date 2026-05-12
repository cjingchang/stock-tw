const labels = {
  pre_market: "盤前 20:00-08:30",
  market: "盤中 08:45-13:30",
  after_market: "盤後 13:30-20:00"
};

const sections = [
  ["major_positive", "今日重大利多"],
  ["hot_stocks", "今日熱門個股"],
  ["hot_industries", "今日熱門產業"],
  ["broker_view", "券商／法人觀點"],
  ["stock_news", "一般個股新聞"]
];

let dailyData = null;
let currentWindow = "pre_market";
const statusLine = document.querySelector("#statusLine");
const updateButton = document.querySelector("#updateButton");

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    currentWindow = button.dataset.window;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab === button));
    render();
  });
});

updateButton?.addEventListener("click", () => refreshNews({ manual: true }));

load();

async function load() {
  try {
    statusLine.textContent = "正在讀取上次資料...";
    await loadDailyData("上次更新");
    render();
  } catch (error) {
    statusLine.textContent = "尚未建立每日資料，請按自動更新。";
    document.querySelector("#dashboard").innerHTML = "";
  }
}

async function refreshNews({ manual = false } = {}) {
  try {
    setUpdating(true, manual ? "正在自動更新新聞..." : "正在更新新聞...");
    await updateDailyNews();
    await loadDailyData("更新");
    render();
  } catch (error) {
    statusLine.textContent = `更新失敗：${formatUpdateError(error)}`;
  } finally {
    setUpdating(false);
  }
}

async function loadDailyData(label) {
  const response = await fetch(`../data/daily/latest.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  dailyData = await response.json();
  statusLine.textContent = `${formatDateTime(dailyData.generated_at || dailyData.date)} ${label}，共 ${dailyData.visible_news_count || 0} 則上首頁`;
}

async function updateDailyNews() {
  const response = await fetch("/api/update-daily", {
    method: "POST",
    cache: "no-store"
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      // Keep HTTP status message.
    }
    throw new Error(message);
  }
}

function setUpdating(isUpdating, message = "") {
  if (updateButton) {
    updateButton.disabled = isUpdating;
    updateButton.textContent = isUpdating ? "更新中..." : "自動更新";
  }
  if (message) statusLine.textContent = message;
}

function formatUpdateError(error) {
  if (location.hostname.endsWith("github.io")) {
    return "線上版只能顯示已上傳資料；請用本機的「台股新聞.app」更新後再同步到 GitHub。";
  }
  if (location.protocol === "file:") {
    return "請用「台股新聞.app」開啟網頁，直接打開 HTML 無法更新資料。";
  }
  return error.message || "請確認台股新聞服務已啟動。";
}

function render() {
  if (!dailyData) return;
  const dashboard = document.querySelector("#dashboard");
  const windowData = dailyData.time_windows?.[currentWindow] || {};
  dashboard.innerHTML = "";

  const windowHeader = document.createElement("div");
  windowHeader.className = "window-header";
  windowHeader.textContent = labels[currentWindow];
  dashboard.append(windowHeader);

  for (const [key, title] of sections) {
    const panel = document.createElement("section");
    panel.className = "panel";
    const heading = document.createElement("h2");
    heading.textContent = title;
    panel.append(heading);

    const items = windowData[key] || [];
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "目前沒有符合條件的新聞";
      panel.append(empty);
    } else if (key === "hot_stocks" || key === "hot_industries") {
      panel.append(renderRanks(items, key, windowData));
    } else {
      const list = document.createElement("div");
      list.className = "news-list";
      items.forEach((item) => list.append(renderNews(item)));
      panel.append(list);
    }
    dashboard.append(panel);
  }
}

function renderRanks(items, key, windowData) {
  const list = document.createElement("div");
  list.className = "rank-list";
  const newsById = buildNewsLookup(windowData);
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    const name = key === "hot_stocks" ? `${item.name || "個股"} ${item.code || ""}`.trim() : item.name;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rank-toggle";
    button.innerHTML = `<strong>${escapeHtml(name)}</strong><span>${item.count} 則｜${item.score} 分</span>`;
    const details = renderRankDetails(item, newsById);
    button.addEventListener("click", () => {
      const expanded = row.classList.toggle("is-open");
      button.setAttribute("aria-expanded", String(expanded));
      details.hidden = !expanded;
    });
    button.setAttribute("aria-expanded", "false");
    row.append(button, details);
    list.append(row);
  });
  return list;
}

function buildNewsLookup(windowData) {
  const newsById = new Map();
  for (const key of ["major_positive", "broker_view", "stock_news"]) {
    for (const item of windowData[key] || []) {
      newsById.set(item.id, item);
    }
  }
  return newsById;
}

function renderRankDetails(rankItem, newsById) {
  const details = document.createElement("div");
  details.className = "rank-details";
  details.hidden = true;

  const relatedNews = (rankItem.news_ids || [])
    .map((id) => newsById.get(id))
    .filter(Boolean)
    .sort(sortByPublishedDesc);

  const count = document.createElement("div");
  count.className = "rank-count";
  count.textContent = `${relatedNews.length} 則相關新聞`;
  details.append(count);

  if (!relatedNews.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "目前沒有可展開的新聞";
    details.append(empty);
    return details;
  }

  const links = document.createElement("div");
  links.className = "rank-news-links";
  relatedNews.forEach((news) => {
    const link = document.createElement("a");
    link.href = news.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = news.title;

    const meta = document.createElement("span");
    meta.textContent = `${news.source}｜發布 ${formatPublishedAt(news)}｜${news.score} 分`;

    const item = document.createElement("div");
    item.className = "rank-news-link";
    item.append(link, meta);
    links.append(item);
  });
  details.append(links);
  return details;
}

function renderNews(item) {
  const template = document.querySelector("#newsTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  const link = node.querySelector("a");
  link.textContent = item.title;
  link.href = item.url;
  const meta = node.querySelector(".news-meta");
  meta.textContent = "";
  const text = document.createElement("span");
  text.textContent = `${item.source}｜發布 ${formatPublishedAt(item)}｜${item.score} 分｜${categoryLabel(item.category)}`;
  meta.append(text, renderVoteButtons(item));
  node.querySelector("p").textContent = item.summary || "";
  const chips = node.querySelector(".chips");
  [...(item.matched_stocks || []).map((stock) => stock.name || stock.code), ...(item.matched_industries || [])]
    .filter(Boolean)
    .slice(0, 8)
    .forEach((text) => {
      const chip = document.createElement("span");
      chip.textContent = text;
      chips.append(chip);
    });
  return node;
}

function sortByPublishedDesc(a, b) {
  return publishedTime(b) - publishedTime(a) || b.score - a.score;
}

function publishedTime(item) {
  const time = new Date(item.published_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function renderVoteButtons(item) {
  const group = document.createElement("span");
  group.className = "vote-buttons";
  group.setAttribute("aria-label", "新聞回饋");

  const options = [
    ["thumbs_up", "👍", "有用"],
    ["thumbs_down", "👎", "不喜歡，之後少推類似新聞"]
  ];
  const currentFeedback = item.user_feedback || "";
  for (const [feedback, icon, label] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = feedback === currentFeedback ? "is-selected" : "";
    button.textContent = icon;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => submitVote(group, item, feedback));
    group.append(button);
  }
  return group;
}

async function submitVote(group, item, feedback) {
  const buttons = [...group.querySelectorAll("button")];
  buttons.forEach((button) => {
    button.disabled = true;
    button.classList.toggle("is-selected", button.getAttribute("aria-label").includes(feedback === "thumbs_up" ? "有用" : "不喜歡"));
  });

  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        news_id: item.id,
        feedback,
        rating: feedback === "thumbs_up" ? 5 : 1,
        title: item.title,
        source: item.source,
        url: item.url
      })
    });
    if (!response.ok) throw new Error("failed");
    group.dataset.saved = "true";
    if (feedback === "thumbs_down") {
      removeNewsFromDailyData(item.id);
      render();
      statusLine.textContent = `${formatDateTime(dailyData.generated_at || dailyData.date)} 已移除不推薦新聞，共 ${dailyData.visible_news_count || 0} 則上首頁`;
    }
  } catch {
    group.dataset.saved = "false";
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function removeNewsFromDailyData(newsId) {
  if (!dailyData) return;
  for (const windowData of Object.values(dailyData.time_windows || {})) {
    for (const key of ["major_positive", "broker_view", "stock_news"]) {
      windowData[key] = (windowData[key] || []).filter((news) => news.id !== newsId);
    }
    recalculateRanks(windowData);
  }
  dailyData.visible_news_count = countVisibleNews(dailyData);
}

function recalculateRanks(windowData) {
  const news = [
    ...(windowData.major_positive || []),
    ...(windowData.broker_view || []),
    ...(windowData.stock_news || [])
  ];
  windowData.hot_stocks = rankBy(news, "stock");
  windowData.hot_industries = rankBy(news, "industry");
}

function rankBy(news, type) {
  const ranks = new Map();
  for (const item of news) {
    const entries = type === "stock" ? item.matched_stocks || [] : item.matched_industries || [];
    for (const entry of entries) {
      const key = type === "stock" ? entry.code || entry.name : entry;
      if (!key) continue;
      const current = ranks.get(key) || (type === "stock"
        ? { ...entry, count: 0, score: 0, news_ids: [] }
        : { name: entry, count: 0, score: 0, news_ids: [] });
      current.count += 1;
      current.score += item.score;
      current.news_ids.push(item.id);
      ranks.set(key, current);
    }
  }
  return [...ranks.values()]
    .filter((item) => type !== "stock" || item.score > 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, type === "stock" ? 20 : 12);
}

function countVisibleNews(data) {
  const ids = new Set();
  for (const windowData of Object.values(data.time_windows || {})) {
    for (const key of ["major_positive", "broker_view", "stock_news"]) {
      for (const item of windowData[key] || []) ids.add(item.id);
    }
  }
  return ids.size;
}

function categoryLabel(category) {
  return {
    major_positive: "重大利多",
    broker_view: "券商觀點",
    neutral_or_watch: "觀望追蹤",
    stock_news: "個股新聞",
    industry_news: "產業題材"
  }[category] || "新聞";
}

function formatPublishedAt(item) {
  if (item.display_published_at) return item.display_published_at;
  if (!item.published_at) return "發布時間未標示";
  return formatDateTime(item.published_at);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
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

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}
