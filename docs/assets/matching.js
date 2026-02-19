export function normalizeInput(text) {
  return String(text || "")
    .toLowerCase()
    .trim();
}

export function tokenize(text) {
  return normalizeInput(text)
    .split(/[\s,;/|]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

export function formatDate(iso) {
  if (!iso) return "TBC";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function daysLeft(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const diff = Date.parse(`${iso}T23:59:59Z`) - nowMs;
  if (Number.isNaN(diff)) return null;
  return Math.ceil(diff / (24 * 3600 * 1000));
}

export function scoreItem(item, profile, nowMs = Date.now()) {
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

  const left = daysLeft(item.deadline, nowMs);
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

export function itemSummaryText(item) {
  return item?.summary?.en || item?.summary?.zh || "";
}

export function matchesFilters(item, filters) {
  const keyword = normalizeInput(filters.keyword || "");
  const type = filters.type || "";
  const status = filters.status || "";
  const source = filters.source || "";

  if (type && item.type !== type) return false;
  if (status && item.status !== status) return false;
  if (source && item.sourceId !== source) return false;

  if (keyword) {
    const merged = [item.title, item.description, itemSummaryText(item), ...(item.eligibility?.disciplines || [])]
      .join(" ")
      .toLowerCase();
    if (!merged.includes(keyword)) return false;
  }

  return true;
}

function dateValueForSort(item, fallback = Number.POSITIVE_INFINITY) {
  if (!item.deadline) return fallback;
  const value = Date.parse(`${item.deadline}T00:00:00Z`);
  return Number.isNaN(value) ? fallback : value;
}

export function compareBySort(a, b, sortBy = "match_desc") {
  switch (sortBy) {
    case "deadline_asc":
      return dateValueForSort(a) - dateValueForSort(b);
    case "deadline_desc":
      return dateValueForSort(b, Number.NEGATIVE_INFINITY) - dateValueForSort(a, Number.NEGATIVE_INFINITY);
    case "source_asc":
      return String(a.sourceName || "").localeCompare(String(b.sourceName || ""));
    case "title_asc":
      return String(a.title || "").localeCompare(String(b.title || ""));
    case "match_desc":
    default:
      return (b.matchScore || 0) - (a.matchScore || 0);
  }
}

export function rankItems(items, filters, profile, nowMs = Date.now()) {
  const minMatch = Number(filters.minMatch ?? 0);
  const openOnly = Boolean(filters.openOnly);
  const closingSoonOnly = Boolean(filters.closingSoonOnly);

  return items
    .filter((item) => matchesFilters(item, filters))
    .map((item) => {
      const scored = scoreItem(item, profile, nowMs);
      const left = daysLeft(item.deadline, nowMs);
      return {
        ...item,
        matchScore: scored.score,
        matchReasons: scored.reasons,
        daysLeftValue: left
      };
    })
    .filter((item) => item.matchScore >= minMatch)
    .filter((item) => (openOnly ? item.status === "open" : true))
    .filter((item) => {
      if (!closingSoonOnly) return true;
      if (typeof item.daysLeftValue !== "number") return false;
      return item.daysLeftValue >= 0 && item.daysLeftValue <= 14;
    })
    .sort((a, b) => {
      const bySort = compareBySort(a, b, filters.sortBy || "match_desc");
      if (bySort !== 0) return bySort;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
}
