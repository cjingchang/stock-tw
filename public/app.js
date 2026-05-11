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
  try {
    const response = await fetch("/data/daily/latest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dailyData = await response.json();
    status.textContent = `${dailyData.date} 更新，共 ${dailyData.visible_news_count || 0} 則上首頁`;
    render();
  } catch (error) {
    status.textContent = "尚未建立每日資料，請先執行 npm run update-daily。";
    document.querySelector("#dashboard").innerHTML = "";
  }
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
      panel.append(renderRanks(items, key));
    } else {
      const list = document.createElement("div");
      list.className = "news-list";
      items.forEach((item) => list.append(renderNews(item)));
      panel.append(list);
    }
    dashboard.append(panel);
  }
}

function renderRanks(items, key) {
  const list = document.createElement("div");
  list.className = "rank-list";
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    const name = key === "hot_stocks" ? `${item.name || "個股"} ${item.code || ""}`.trim() : item.name;
    row.innerHTML = `<strong>${escapeHtml(name)}</strong><span>${item.count} 則｜${item.score} 分</span>`;
    list.append(row);
  });
  return list;
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
  text.textContent = `${item.source}｜${item.score} 分｜${categoryLabel(item.category)}`;
  meta.append(text, renderStars(item));
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

function renderStars(item) {
  const group = document.createElement("span");
  group.className = "star-rating";
  group.setAttribute("aria-label", "新聞評分");

  const currentRating = Number(item.user_rating || 0);
  for (let rating = 1; rating <= 5; rating += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = rating <= currentRating ? "is-selected" : "";
    button.textContent = rating <= currentRating ? "★" : "☆";
    button.title = `${rating} 顆星`;
    button.setAttribute("aria-label", `評 ${rating} 顆星`);
    button.addEventListener("click", () => submitRating(group, item, rating));
    group.append(button);
  }
  return group;
}

async function submitRating(group, item, rating) {
  const buttons = [...group.querySelectorAll("button")];
  buttons.forEach((button, index) => {
    button.disabled = true;
    button.textContent = index < rating ? "★" : "☆";
    button.classList.toggle("is-selected", index < rating);
  });

  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        news_id: item.id,
        feedback: rating < 3 ? "low_rating" : "star_rating",
        rating,
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

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}
