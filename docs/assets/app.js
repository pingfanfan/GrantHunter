import { daysLeft, formatDate, itemSummaryText, normalizeInput, rankItems } from "./matching.js";

const STORAGE_KEY = "granthunter:ui-state:v2";

const state = {
  raw: null,
  items: [],
  sources: [],
  filters: {
    keyword: "",
    type: "",
    status: "",
    source: "",
    sortBy: "match_desc",
    minMatch: 0,
    openOnly: false,
    closingSoonOnly: false
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
  subscribeHint: document.getElementById("subscribeHint"),
  minMatchValue: document.getElementById("minMatchValue")
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

function readBool(value) {
  return value === "1" || value === "true";
}

function mergeState(partial) {
  if (!partial || typeof partial !== "object") return;

  if (partial.filters && typeof partial.filters === "object") {
    state.filters = {
      ...state.filters,
      ...partial.filters,
      minMatch: Number(partial.filters.minMatch ?? state.filters.minMatch) || 0,
      openOnly: Boolean(partial.filters.openOnly),
      closingSoonOnly: Boolean(partial.filters.closingSoonOnly)
    };
  }

  if (partial.profile && typeof partial.profile === "object") {
    state.profile = {
      ...state.profile,
      ...partial.profile
    };
  }
}

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    mergeState(JSON.parse(raw));
  } catch {
    // ignore storage parse failures
  }
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if ([...params.keys()].length === 0) return;

  mergeState({
    filters: {
      keyword: params.get("q") || state.filters.keyword,
      type: params.get("type") || state.filters.type,
      status: params.get("status") || state.filters.status,
      source: params.get("source") || state.filters.source,
      sortBy: params.get("sort") || state.filters.sortBy,
      minMatch: Number(params.get("min") || state.filters.minMatch),
      openOnly: readBool(params.get("open")),
      closingSoonOnly: readBool(params.get("closing"))
    },
    profile: {
      level: params.get("level") || state.profile.level,
      careerStage: params.get("career") || state.profile.careerStage,
      nationality: params.get("nat") || state.profile.nationality,
      discipline: params.get("disc") || state.profile.discipline
    }
  });
}

function persistState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        filters: state.filters,
        profile: state.profile
      })
    );
  } catch {
    // ignore storage write failures
  }

  const params = new URLSearchParams();
  if (state.filters.keyword) params.set("q", state.filters.keyword);
  if (state.filters.type) params.set("type", state.filters.type);
  if (state.filters.status) params.set("status", state.filters.status);
  if (state.filters.source) params.set("source", state.filters.source);
  if (state.filters.sortBy && state.filters.sortBy !== "match_desc") params.set("sort", state.filters.sortBy);
  if (state.filters.minMatch > 0) params.set("min", String(state.filters.minMatch));
  if (state.filters.openOnly) params.set("open", "1");
  if (state.filters.closingSoonOnly) params.set("closing", "1");

  if (state.profile.level) params.set("level", state.profile.level);
  if (state.profile.careerStage) params.set("career", state.profile.careerStage);
  if (state.profile.nationality) params.set("nat", state.profile.nationality);
  if (state.profile.discipline) params.set("disc", state.profile.discipline);

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

function applyStateToInputs() {
  const map = {
    keyword: state.filters.keyword,
    typeFilter: state.filters.type,
    statusFilter: state.filters.status,
    sourceFilter: state.filters.source,
    sortBy: state.filters.sortBy,
    minMatch: String(state.filters.minMatch),
    profileLevel: state.profile.level,
    profileCareer: state.profile.careerStage,
    profileNationality: state.profile.nationality,
    profileDiscipline: state.profile.discipline
  };

  for (const [id, value] of Object.entries(map)) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.value = value;
  }

  const openOnly = document.getElementById("openOnly");
  const closingSoonOnly = document.getElementById("closingSoonOnly");
  if (openOnly) openOnly.checked = state.filters.openOnly;
  if (closingSoonOnly) closingSoonOnly.checked = state.filters.closingSoonOnly;
  if (el.minMatchValue) el.minMatchValue.textContent = String(state.filters.minMatch);
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

function renderCards() {
  const ranked = rankItems(state.items, state.filters, state.profile, Date.now());

  if (ranked.length === 0) {
    el.cards.innerHTML =
      '<div class="empty-state">No opportunities match current filters. Try loosening filters or clearing keyword search.</div>';
    el.resultMeta.textContent = "0 results";
    return;
  }

  const top = ranked[0];
  el.resultMeta.textContent = `${ranked.length} results, sorted by ${state.filters.sortBy.replace("_", " ")} (top fit ${
    top.matchScore
  })`;

  el.cards.innerHTML = ranked
    .slice(0, 180)
    .map((item) => {
      const dl = daysLeft(item.deadline);
      const deadlineText = item.deadline
        ? `${formatDate(item.deadline)}${typeof dl === "number" ? ` (D${dl >= 0 ? `-${dl}` : `+${Math.abs(dl)}`})` : ""}`
        : "TBC";
      const fit = (item.summary?.fit || []).slice(0, 2).map(escapeHtml).join("; ");
      const warn = (item.summary?.watchOut || []).slice(0, 2).map(escapeHtml).join("; ");
      const urlCheckStatus = String(item?.urlCheck?.status || "");
      const linkHealth =
        urlCheckStatus === "reachable"
          ? "Verified"
          : urlCheckStatus === "reachable_with_redirect"
          ? "Verified (redirected)"
          : urlCheckStatus
          ? `Unverified (${urlCheckStatus})`
          : "Unverified";
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
            <span class="badge ${escapeHtml(item.status)}">${escapeHtml(
        item.status.charAt(0).toUpperCase() + item.status.slice(1)
      )}</span>
          </div>

          <div class="meta-line">
            <span>${escapeHtml(item.sourceName)}</span>
            <span>·</span>
            <span>${escapeHtml(item.type)}</span>
            <span>·</span>
            <span>Deadline ${escapeHtml(deadlineText)}</span>
            <span>·</span>
            <span>Link ${escapeHtml(linkHealth)}</span>
          </div>

          <div class="match-pill">Fit Score ${item.matchScore}/100</div>
          <p class="summary">${escapeHtml(itemSummaryText(item) || "No summary")}</p>

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
  const nodes = {
    keyword: document.getElementById("keyword"),
    typeFilter: document.getElementById("typeFilter"),
    statusFilter: document.getElementById("statusFilter"),
    sourceFilter: document.getElementById("sourceFilter"),
    sortBy: document.getElementById("sortBy"),
    minMatch: document.getElementById("minMatch"),
    openOnly: document.getElementById("openOnly"),
    closingSoonOnly: document.getElementById("closingSoonOnly"),
    profileLevel: document.getElementById("profileLevel"),
    profileCareer: document.getElementById("profileCareer"),
    profileNationality: document.getElementById("profileNationality"),
    profileDiscipline: document.getElementById("profileDiscipline"),
    clearFilters: document.getElementById("clearFilters")
  };

  const syncStateFromInputs = () => {
    state.filters.keyword = normalizeInput(nodes.keyword.value);
    state.filters.type = nodes.typeFilter.value;
    state.filters.status = nodes.statusFilter.value;
    state.filters.source = nodes.sourceFilter.value;
    state.filters.sortBy = nodes.sortBy.value;
    state.filters.minMatch = Number(nodes.minMatch.value) || 0;
    state.filters.openOnly = Boolean(nodes.openOnly.checked);
    state.filters.closingSoonOnly = Boolean(nodes.closingSoonOnly.checked);

    state.profile.level = nodes.profileLevel.value;
    state.profile.careerStage = nodes.profileCareer.value;
    state.profile.nationality = nodes.profileNationality.value;
    state.profile.discipline = nodes.profileDiscipline.value;

    if (el.minMatchValue) el.minMatchValue.textContent = String(state.filters.minMatch);

    persistState();
    renderCards();
  };

  const listenTargets = [
    nodes.keyword,
    nodes.typeFilter,
    nodes.statusFilter,
    nodes.sourceFilter,
    nodes.sortBy,
    nodes.minMatch,
    nodes.openOnly,
    nodes.closingSoonOnly,
    nodes.profileLevel,
    nodes.profileCareer,
    nodes.profileNationality,
    nodes.profileDiscipline
  ];

  listenTargets.forEach((node) => {
    node.addEventListener("input", syncStateFromInputs);
    node.addEventListener("change", syncStateFromInputs);
  });

  nodes.clearFilters.addEventListener("click", () => {
    state.filters = {
      keyword: "",
      type: "",
      status: "",
      source: "",
      sortBy: "match_desc",
      minMatch: 0,
      openOnly: false,
      closingSoonOnly: false
    };
    state.profile = {
      level: "",
      careerStage: "",
      nationality: "",
      discipline: ""
    };
    applyStateToInputs();
    persistState();
    renderCards();
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
    loadStateFromStorage();
    loadStateFromUrl();

    const data = await fetchJson("./data/funding.latest.json");

    state.raw = data;
    state.items = Array.isArray(data.items) ? data.items : [];
    state.sources = Array.isArray(data.sources) ? data.sources : [];

    renderStats(data.stats || {});
    renderSources();
    applyStateToInputs();
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
    persistState();
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
