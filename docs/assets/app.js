const state = {
  raw: null,
  items: [],
  sources: [],
  filters: {
    keyword: "",
    type: "",
    status: "",
    source: ""
  },
  profile: {
    level: "",
    careerStage: "",
    nationality: "",
    discipline: ""
  }
};

const el = {
  stats: document.getElementById("stats"),
  lastUpdated: document.getElementById("lastUpdated"),
  cards: document.getElementById("cards"),
  resultMeta: document.getElementById("resultMeta"),
  sourceFilter: document.getElementById("sourceFilter"),
  sourceList: document.getElementById("sourceList"),
  digestMeta: document.getElementById("digestMeta"),
  digestLink: document.getElementById("digestLink"),
  subscribeForm: document.getElementById("subscribeForm"),
  subscribeHint: document.getElementById("subscribeHint")
};

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function formatDate(iso) {
  if (!iso) return "待确认";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function daysLeft(iso) {
  if (!iso) return null;
  const diff = Date.parse(`${iso}T23:59:59Z`) - Date.now();
  if (Number.isNaN(diff)) return null;
  return Math.ceil(diff / (24 * 3600 * 1000));
}

function normalizeInput(text) {
  return String(text || "")
    .toLowerCase()
    .trim();
}

function tokenize(text) {
  return normalizeInput(text)
    .split(/[\s,;/|]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

function scoreItem(item, profile) {
  let score = 45;
  const reasons = [];

  const levels = item?.eligibility?.levels || [];
  const stages = item?.eligibility?.careerStages || [];
  const nationalities = item?.eligibility?.nationalities || [];
  const disciplines = item?.eligibility?.disciplines || [];

  if (profile.level) {
    if (levels.length === 0 || levels.includes(profile.level)) {
      score += 22;
      reasons.push(`阶段匹配: ${profile.level}`);
    } else {
      score -= 24;
      reasons.push(`阶段可能不匹配: 目标 ${levels.join("/")}`);
    }
  }

  if (profile.careerStage) {
    if (stages.length === 0 || stages.includes(profile.careerStage)) {
      score += 14;
      reasons.push(`职业阶段匹配: ${profile.careerStage}`);
    } else {
      score -= 12;
      reasons.push(`职业阶段偏差: 目标 ${stages.join("/")}`);
    }
  }

  if (profile.nationality) {
    if (nationalities.includes("any") || nationalities.length === 0 || nationalities.includes(profile.nationality)) {
      score += 14;
      reasons.push(`国籍/身份兼容: ${profile.nationality}`);
    } else {
      score -= 18;
      reasons.push(`国籍限制: ${nationalities.join("/")}`);
    }
  }

  if (profile.discipline) {
    const userTokens = tokenize(profile.discipline);
    const targetTokens = tokenize(disciplines.join(" "));
    const intersects = userTokens.filter((token) =>
      targetTokens.some((target) => target.includes(token) || token.includes(target))
    );

    if (intersects.length > 0 || disciplines.includes("all disciplines")) {
      score += Math.min(22, 9 + intersects.length * 5);
      reasons.push(
        disciplines.includes("all disciplines")
          ? "学科开放范围较广"
          : `学科关键词匹配: ${intersects.slice(0, 3).join("/")}`
      );
    } else {
      score -= 14;
      reasons.push(`学科不明显匹配: ${disciplines.slice(0, 2).join("/") || "待确认"}`);
    }
  }

  if (item.status === "open") score += 6;
  if (item.status === "closed") score -= 24;

  const left = daysLeft(item.deadline);
  if (typeof left === "number") {
    if (left < 0) {
      score -= 20;
      reasons.push("已过截止日期");
    } else if (left <= 7) {
      reasons.push(`截止很近: D-${left}`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    reasons: reasons.slice(0, 3)
  };
}

function statusLabel(status) {
  if (status === "open") return "Open";
  if (status === "closed") return "Closed";
  return "Unknown";
}

function renderStats(stats) {
  const cards = [
    { label: "总机会", value: stats.total ?? 0 },
    { label: "Open", value: stats.open ?? 0 },
    { label: "有截止日期", value: stats.withDeadline ?? 0 },
    { label: "今日新增", value: stats.newToday ?? 0 },
    { label: "今日更新", value: stats.updatedToday ?? 0 },
    { label: "数据源", value: stats.sourcesConfigured ?? 0 }
  ];

  el.stats.innerHTML = cards
    .map(
      (card) => `
        <div class="stat-card">
          <b>${card.value}</b>
          <span>${card.label}</span>
        </div>
      `
    )
    .join("");
}

function renderSources() {
  const sourceFilterOptions = state.sources
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`)
    .join("");
  el.sourceFilter.insertAdjacentHTML("beforeend", sourceFilterOptions);

  el.sourceList.innerHTML = state.sources
    .map(
      (s) =>
        `<li><a href="${escapeHtml(s.homepage)}" target="_blank" rel="noreferrer">${escapeHtml(
          s.name
        )}</a></li>`
    )
    .join("");
}

function renderDigestMeta(digest) {
  const stats = digest?.stats || {};
  el.digestMeta.textContent = `新增 ${stats.newItems || 0} 条，更新 ${stats.updatedItems || 0} 条，即将截止 ${
    stats.closingSoon || 0
  } 条`;

  if (digest?.subject) {
    el.digestLink.textContent = `查看：${digest.subject}`;
  }
}

function matchesFilters(item) {
  const keyword = state.filters.keyword;
  const type = state.filters.type;
  const status = state.filters.status;
  const source = state.filters.source;

  if (type && item.type !== type) return false;
  if (status && item.status !== status) return false;
  if (source && item.sourceId !== source) return false;

  if (keyword) {
    const merged = [item.title, item.description, item.summary?.zh, ...(item.eligibility?.disciplines || [])]
      .join(" ")
      .toLowerCase();
    if (!merged.includes(keyword)) return false;
  }

  return true;
}

function renderCards() {
  const filtered = state.items
    .filter(matchesFilters)
    .map((item) => {
      const scored = scoreItem(item, state.profile);
      return {
        ...item,
        matchScore: scored.score,
        matchReasons: scored.reasons
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore || (a.deadline || "").localeCompare(b.deadline || ""));

  if (filtered.length === 0) {
    el.cards.innerHTML = `<div class="empty-state">没有符合当前筛选条件的机会，尝试放宽筛选或清空关键词。</div>`;
    el.resultMeta.textContent = "0 条结果";
    return;
  }

  el.resultMeta.textContent = `${filtered.length} 条结果，按匹配度排序（最高 ${filtered[0].matchScore}）`;

  el.cards.innerHTML = filtered
    .slice(0, 180)
    .map((item) => {
      const dl = daysLeft(item.deadline);
      const deadlineText = item.deadline
        ? `${formatDate(item.deadline)}${typeof dl === "number" ? ` (D${dl >= 0 ? `-${dl}` : `+${Math.abs(dl)}`})` : ""}`
        : "待确认";
      const fit = (item.summary?.fit || []).slice(0, 2).map(escapeHtml).join("；");
      const warn = (item.summary?.watchOut || []).slice(0, 2).map(escapeHtml).join("；");
      const tags = [
        ...(item.eligibility?.levels || []).slice(0, 2),
        ...(item.eligibility?.disciplines || []).slice(0, 2)
      ]
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");

      return `
        <article class="card">
          <div class="card-head">
            <h3>
              <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
            </h3>
            <span class="badge ${escapeHtml(item.status)}">${statusLabel(item.status)}</span>
          </div>

          <div class="meta-line">
            <span>${escapeHtml(item.sourceName)}</span>
            <span>·</span>
            <span>${escapeHtml(item.type)}</span>
            <span>·</span>
            <span>截止 ${escapeHtml(deadlineText)}</span>
          </div>

          <div class="match-pill">匹配度 ${item.matchScore}/100</div>
          <p class="summary">${escapeHtml(item.summary?.zh || "暂无摘要")}</p>

          <div class="hints">
            <p><strong>适合谁:</strong> ${fit || "请查看官网 eligibility"}</p>
            <p><strong>注意:</strong> ${warn || "申请前确认官方条件"}</p>
            <p><strong>匹配理由:</strong> ${escapeHtml(item.matchReasons.join("；") || "基础规则评分")}</p>
          </div>

          <div class="tags">${tags}</div>
        </article>
      `;
    })
    .join("");
}

function bindInputs() {
  const keyword = document.getElementById("keyword");
  const typeFilter = document.getElementById("typeFilter");
  const statusFilter = document.getElementById("statusFilter");
  const sourceFilter = document.getElementById("sourceFilter");

  const profileLevel = document.getElementById("profileLevel");
  const profileCareer = document.getElementById("profileCareer");
  const profileNationality = document.getElementById("profileNationality");
  const profileDiscipline = document.getElementById("profileDiscipline");

  const onChange = () => {
    state.filters.keyword = normalizeInput(keyword.value);
    state.filters.type = typeFilter.value;
    state.filters.status = statusFilter.value;
    state.filters.source = sourceFilter.value;

    state.profile.level = profileLevel.value;
    state.profile.careerStage = profileCareer.value;
    state.profile.nationality = profileNationality.value;
    state.profile.discipline = profileDiscipline.value;

    renderCards();
  };

  [
    keyword,
    typeFilter,
    statusFilter,
    sourceFilter,
    profileLevel,
    profileCareer,
    profileNationality,
    profileDiscipline
  ].forEach((node) => {
    node.addEventListener("input", onChange);
    node.addEventListener("change", onChange);
  });
}

async function setupSubscription() {
  try {
    const config = await fetchJson("./data/site-config.json");
    if (config?.subscriptionAction) {
      el.subscribeForm.setAttribute("action", config.subscriptionAction);
      el.subscribeHint.textContent = "订阅服务已启用，提交后将跳转到确认页面。";
    } else {
      el.subscribeHint.textContent = "未配置订阅服务，请先设置 BUTTONDOWN_USERNAME。";
    }
  } catch {
    el.subscribeHint.textContent = "未加载到订阅配置，请检查 data/site-config.json。";
  }
}

async function init() {
  try {
    const data = await fetchJson("./data/funding.latest.json");

    state.raw = data;
    state.items = Array.isArray(data.items) ? data.items : [];
    state.sources = Array.isArray(data.sources) ? data.sources : [];

    renderStats(data.stats || {});
    renderSources();
    renderDigestMeta(data.digest || {});

    if (data.generatedAt) {
      el.lastUpdated.textContent = `最近更新: ${new Date(data.generatedAt).toISOString().slice(0, 19).replace("T", " ")} UTC`;
    } else {
      el.lastUpdated.textContent = "最近更新时间未知";
    }

    bindInputs();
    renderCards();
    await setupSubscription();
  } catch (error) {
    console.error(error);
    el.cards.innerHTML = `<div class="empty-state">加载数据失败：${escapeHtml(error.message)}</div>`;
    el.resultMeta.textContent = "数据加载失败";
    el.lastUpdated.textContent = "请先运行数据更新脚本生成 data 文件";
  }
}

init();
