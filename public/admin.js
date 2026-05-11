const feedbackLabels = [
  ["useful", "有用"],
  ["normal", "普通"],
  ["irrelevant", "不相關"],
  ["block_similar", "不要再推薦類似"]
];

loadAdmin();

async function loadAdmin() {
  const status = document.querySelector("#adminStatus");
  try {
    const response = await fetch("../data/daily/latest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dailyData = await response.json();
    const news = flattenNews(dailyData);
    status.textContent = `${formatDateTime(dailyData.generated_at || dailyData.date)} 可回饋 ${news.length} 則新聞`;
    renderFeedback(news);
  } catch {
    status.textContent = "尚未建立每日資料，請先執行 npm run update-daily。";
  }
}

function flattenNews(dailyData) {
  const map = new Map();
  for (const windowData of Object.values(dailyData.time_windows || {})) {
    for (const key of ["major_positive", "broker_view", "stock_news"]) {
      for (const item of windowData[key] || []) map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

function renderFeedback(news) {
  const list = document.querySelector("#feedbackList");
  list.innerHTML = "";
  for (const item of news) {
    const article = document.createElement("article");
    article.className = "feedback-item";
    article.innerHTML = `
      <div class="news-meta">${escapeHtml(item.source)}｜發布 ${escapeHtml(formatPublishedAt(item))}｜${item.score} 分</div>
      <h2><a href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></h2>
      <p>${escapeHtml(item.summary || "")}</p>
      <div class="feedback-actions"></div>
    `;
    const actions = article.querySelector(".feedback-actions");
    feedbackLabels.forEach(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => submitFeedback(button, item, value));
      actions.append(button);
    });
    list.append(article);
  }
}

async function submitFeedback(button, item, feedback) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "已送出";
  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        news_id: item.id,
        feedback,
        rating: "",
        title: item.title,
        source: item.source,
        url: item.url
      })
    });
    if (!response.ok) throw new Error("failed");
  } catch {
    button.textContent = "寫入失敗";
    setTimeout(() => {
      button.disabled = false;
      button.textContent = original;
    }, 1500);
  }
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

function escapeAttr(text) {
  return escapeHtml(text).replace(/`/g, "&#96;");
}
