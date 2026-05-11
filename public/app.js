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

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    currentWindow = button.dataset.window;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab === button));
    render();
  });
});

load();

async function load() {
  const status = document.querySelector("#statusLine");
  let usedFallback = false;
  try {
    status.textContent = "正在更新新聞...";
    try {
      await updateDailyNews();
    } catch {
      usedFallback = true;
      status.textContent = "自動更新失敗，改用上次資料...";
    }
    const response = await fetch("../data/daily/latest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dailyData = await response.json();
    status.textContent = `${formatDateTime(dailyData.generated_at || dailyData.date)} ${usedFallback ? "上次更新" : "更新"}，共 ${dailyData.visible_news_count || 0} 則上首頁`;
    render();
  } catch (error) {
    status.textContent = "尚未建立每日資料，請先執行 npm run update-daily。";
    document.querySelector("#dashboard").innerHTML = "";
  }
}

async function updateDailyNews() {
  const response = await fetch("/api/update-daily", {
    method: "POST",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
    .sort((a, b) => b.score - a.score);

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
  } catch {
    group.dataset.saved = "false";
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
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
