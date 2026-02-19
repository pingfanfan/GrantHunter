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
  if (!iso) return "TBC";
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
      reasons.push(`Level match: ${profile.level}`);
    } else {
      score -= 24;
      reasons.push(`Possible level mismatch: target ${levels.join("/")}`);
    }
  }

  if (profile.careerStage) {
    if (stages.length === 0 || stages.includes(profile.careerStage)) {
      score += 14;
      reasons.push(`Career stage match: ${profile.careerStage}`);
    } else {
      score -= 12;
      reasons.push(`Career stage mismatch: target ${stages.join("/")}`);
    }
  }

  if (profile.nationality) {
    if (nationalities.includes("any") || nationalities.length === 0 || nationalities.includes(profile.nationality)) {
      score += 14;
      reasons.push(`Nationality/status compatible: ${profile.nationality}`);
    } else {
      score -= 18;
      reasons.push(`Nationality restrictions: ${nationalities.join("/")}`);
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
          ? "Broad discipline coverage"
          : `Discipline keyword match: ${intersects.slice(0, 3).join("/")}`
      );
    } else {
      reasons.push(`Discipline unclear/mismatch: ${disciplines.slice(0, 2).join("/") || "TBC"}`);
      score -= 14;
    }
  }

  if (item.status === "open") score += 6;
  if (item.status === "closed") score -= 24;

  const left = daysLeft(item.deadline);
  if (typeof left === "number") {
    if (left < 0) {
      score -= 20;
      reasons.push("Deadline has passed");
    } else if (left <= 7) {
      reasons.push(`Deadline is close: D-${left}`);
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
    { label: "Total", value: stats.total ?? 0 },
    { label: "Open", value: stats.open ?? 0 },
    { label: "With Deadline", value: stats.withDeadline ?? 0 },
    { label: "New Today", value: stats.newToday ?? 0 },
    { label: "Updated Today", value: stats.updatedToday ?? 0 },
    { label: "Sources", value: stats.sourcesConfigured ?? 0 }
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
  el.digestMeta.textContent = `${stats.newItems || 0} new, ${stats.updatedItems || 0} updated, ${
    stats.closingSoon || 0
  } closing soon`;

  if (digest?.subject) {
    el.digestLink.textContent = `View: ${digest.subject}`;
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
    const merged = [
      item.title,
      item.description,
      item.summary?.en || item.summary?.zh || "",
      ...(item.eligibility?.disciplines || [])
    ]
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
    el.cards.innerHTML =
      '<div class="empty-state">No opportunities match current filters. Try loosening filters or clearing keyword search.</div>';
    el.resultMeta.textContent = "0 results";
    return;
  }

  el.resultMeta.textContent = `${filtered.length} results, sorted by fit score (top ${filtered[0].matchScore})`;

  el.cards.innerHTML = filtered
    .slice(0, 180)
    .map((item) => {
      const dl = daysLeft(item.deadline);
      const deadlineText = item.deadline
        ? `${formatDate(item.deadline)}${typeof dl === "number" ? ` (D${dl >= 0 ? `-${dl}` : `+${Math.abs(dl)}`})` : ""}`
        : "TBC";
      const fit = (item.summary?.fit || []).slice(0, 2).map(escapeHtml).join("; ");
      const warn = (item.summary?.watchOut || []).slice(0, 2).map(escapeHtml).join("; ");
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
            <span>Deadline ${escapeHtml(deadlineText)}</span>
          </div>

          <div class="match-pill">Fit Score ${item.matchScore}/100</div>
          <p class="summary">${escapeHtml(item.summary?.en || item.summary?.zh || "No summary")}</p>

          <div class="hints">
            <p><strong>Best for:</strong> ${fit || "Check official eligibility"}</p>
            <p><strong>Watch out:</strong> ${warn || "Verify requirements before applying"}</p>
            <p><strong>Scoring notes:</strong> ${escapeHtml(item.matchReasons.join("; ") || "Baseline rules applied")}</p>
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
      el.subscribeHint.textContent = "Subscription is enabled. Submitting the form opens the confirmation page.";
    } else {
      el.subscribeHint.textContent = "Subscription is not configured yet. Set BUTTONDOWN_USERNAME first.";
    }
  } catch {
    el.subscribeHint.textContent = "Subscription config not found. Check data/site-config.json.";
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
      el.lastUpdated.textContent = `Last updated: ${new Date(data.generatedAt)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ")} UTC`;
    } else {
      el.lastUpdated.textContent = "Last update time unknown";
    }

    bindInputs();
    renderCards();
    await setupSubscription();
  } catch (error) {
    console.error(error);
    el.cards.innerHTML = `<div class="empty-state">Data load failed: ${escapeHtml(error.message)}</div>`;
    el.resultMeta.textContent = "Data load failed";
    el.lastUpdated.textContent = "Run the data update script to generate docs/data files first.";
  }
}

init();
