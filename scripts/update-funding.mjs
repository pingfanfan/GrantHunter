import { createHash } from "crypto";
import { mkdir, readFile, writeFile, access } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const SOURCES_FILE = path.join(ROOT, "config", "sources.json");
const OUTPUT_DIR = path.join(ROOT, "docs", "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "funding.latest.json");
const HISTORY_DIR = path.join(OUTPUT_DIR, "history");
const SITE_CONFIG_FILE = path.join(OUTPUT_DIR, "site-config.json");

const DEFAULT_MAX_PER_SOURCE = Number(process.env.MAX_ITEMS_PER_SOURCE || 18);
const MAX_DETAIL_FETCH = Number(process.env.MAX_DETAIL_FETCH || 260);
const MAX_AI_ITEMS = Number(process.env.MAX_AI_ITEMS || 120);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 22000);
const URL_CHECK_TIMEOUT_MS = Number(process.env.URL_CHECK_TIMEOUT_MS || 15000);
const URL_CHECK_CONCURRENCY = Math.max(1, Number(process.env.URL_CHECK_CONCURRENCY || 8));
const MAX_URL_CHECK_ITEMS = Number(process.env.MAX_URL_CHECK_ITEMS || 320);
const STRICT_URL_VALIDATION = process.env.STRICT_URL_VALIDATION === "true";
const DEFAULT_OPENROUTER_MODELS = [
  "openrouter/free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "google/gemma-2-9b-it:free"
];

const FUNDING_KEYWORDS = [
  "grant",
  "funding",
  "fund",
  "fellowship",
  "studentship",
  "scholarship",
  "bursary",
  "award",
  "stipend",
  "call",
  "apply",
  "application",
  "research support",
  "phd",
  "postdoctoral"
];

const NEGATIVE_KEYWORDS = [
  "privacy",
  "cookie",
  "terms",
  "accessibility",
  "press release",
  "newsroom",
  "contact us",
  "vacancies",
  "job",
  "event",
  "webinar",
  "podcast",
  "annual report"
];

const DISCIPLINE_PATTERNS = {
  "life sciences": ["biolog", "biomedical", "life science", "genetic", "molecular", "neuroscience"],
  "medicine and health": ["health", "clinical", "medical", "public health", "cancer", "heart"],
  engineering: ["engineering", "materials", "mechanical", "electrical", "civil"],
  "computer science and ai": ["computer", "ai", "artificial intelligence", "machine learning", "data science"],
  "physical sciences": ["physics", "chemistry", "mathematics", "astronomy"],
  "environment and earth": ["climate", "environment", "ecology", "geology", "sustainability"],
  "social sciences": ["social", "economics", "politics", "policy", "education", "psychology"],
  humanities: ["history", "philosophy", "linguistics", "literature", "arts", "culture"],
  business: ["entrepreneur", "business", "innovation", "commercialisation", "startup"]
};

const MONTHS = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12
};

const now = new Date();

function sha1(input) {
  return createHash("sha1").update(String(input)).digest("hex");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const map = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    const next = args[i + 1];
    if (key.startsWith("--")) {
      if (!next || next.startsWith("--")) {
        map.set(key, true);
      } else {
        map.set(key, next);
        i += 1;
      }
    }
  }
  return map;
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtml(html) {
  return normalizeWhitespace(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
  );
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; UKFundingHubBot/1.0; +https://github.com/)"
      },
      redirect: "follow"
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) {
    return normalizeWhitespace(decodeHtmlEntities(stripHtml(h1[1])));
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title?.[1] ? normalizeWhitespace(decodeHtmlEntities(stripHtml(title[1]))) : "";
}

function extractMetaDescription(html) {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
  if (!match?.[1]) return "";
  return normalizeWhitespace(decodeHtmlEntities(match[1]));
}

function canonicalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function extractLinks(html, baseUrl) {
  const links = [];
  const regex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1]?.trim();
    if (!href) continue;
    if (href.startsWith("mailto:") || href.startsWith("tel:")) continue;

    let absolute;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    const text = normalizeWhitespace(decodeHtmlEntities(stripHtml(match[2] || "")));
    if (!text || text.length < 2) continue;

    links.push({
      url: canonicalizeUrl(absolute),
      text
    });
  }

  return links;
}

function includesAny(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function getHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isHttpUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function hostMatchesAllowed(host, allowedHosts = []) {
  if (!host) return false;
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) return true;
  return allowedHosts.some((entry) => host.endsWith(String(entry).toLowerCase()));
}

function resolveAllowedHosts(source) {
  const include = Array.isArray(source?.includeHosts) ? source.includeHosts : [];
  if (include.length > 0) return include.map((x) => String(x).toLowerCase());

  const homepageHost = getHost(source?.homepage || "");
  return homepageHost ? [homepageHost.toLowerCase()] : [];
}

function isLikelyNetworkError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("network") ||
    text.includes("enotfound") ||
    text.includes("econnreset") ||
    text.includes("econnrefused") ||
    text.includes("timed out") ||
    text.includes("abort")
  );
}

async function fetchUrlMetadata(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);
  const requestHeaders = {
    "user-agent":
      "Mozilla/5.0 (compatible; UKFundingHubBot/1.0; +https://github.com/)"
  };

  let headResp = null;
  try {
    headResp = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: requestHeaders,
      redirect: "follow"
    });

    // Some websites block HEAD; fallback to GET in those cases.
    if ([403, 405, 429, 500, 501].includes(headResp.status)) {
      try {
        headResp.body?.cancel();
      } catch {
        // ignore
      }

      const getResp = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: requestHeaders,
        redirect: "follow"
      });

      const metadata = {
        ok: getResp.ok,
        status: getResp.status,
        finalUrl: canonicalizeUrl(getResp.url || url),
        redirected: canonicalizeUrl(getResp.url || url) !== canonicalizeUrl(url),
        contentType: (getResp.headers.get("content-type") || "").toLowerCase()
      };

      try {
        getResp.body?.cancel();
      } catch {
        // ignore
      }

      return metadata;
    }

    return {
      ok: headResp.ok,
      status: headResp.status,
      finalUrl: canonicalizeUrl(headResp.url || url),
      redirected: canonicalizeUrl(headResp.url || url) !== canonicalizeUrl(url),
      contentType: (headResp.headers.get("content-type") || "").toLowerCase()
    };
  } finally {
    clearTimeout(timeout);
    try {
      headResp?.body?.cancel();
    } catch {
      // ignore
    }
  }
}

async function checkOpportunityUrl(item, source) {
  const originalUrl = canonicalizeUrl(item.url);
  const checkedAt = new Date().toISOString();
  const allowedHosts = resolveAllowedHosts(source);

  if (!isHttpUrl(originalUrl)) {
    return {
      status: "invalid_url",
      originalUrl,
      finalUrl: null,
      httpStatus: null,
      allowedHost: false,
      redirected: false,
      checkedAt,
      error: "URL is not a valid http/https address"
    };
  }

  const originalHost = getHost(originalUrl);
  if (!hostMatchesAllowed(originalHost, allowedHosts)) {
    return {
      status: "bad_host",
      originalUrl,
      finalUrl: originalUrl,
      httpStatus: null,
      allowedHost: false,
      redirected: false,
      checkedAt,
      error: "URL host is not allowed for this source"
    };
  }

  try {
    const meta = await fetchUrlMetadata(originalUrl);
    const finalHost = getHost(meta.finalUrl);
    const allowedHost = hostMatchesAllowed(finalHost, allowedHosts);

    if (!meta.ok) {
      if ([401, 403, 429].includes(meta.status) && allowedHost) {
        return {
          status: "reachable_restricted",
          originalUrl,
          finalUrl: meta.finalUrl,
          httpStatus: meta.status,
          allowedHost: true,
          redirected: meta.redirected,
          checkedAt,
          contentType: meta.contentType,
          error: `Restricted response (HTTP ${meta.status}) from source host`
        };
      }

      return {
        status: "http_error",
        originalUrl,
        finalUrl: meta.finalUrl,
        httpStatus: meta.status,
        allowedHost,
        redirected: meta.redirected,
        checkedAt,
        contentType: meta.contentType,
        error: `HTTP ${meta.status}`
      };
    }

    if (!allowedHost) {
      return {
        status: "bad_host",
        originalUrl,
        finalUrl: meta.finalUrl,
        httpStatus: meta.status,
        allowedHost: false,
        redirected: meta.redirected,
        checkedAt,
        contentType: meta.contentType,
        error: "Redirected to a host outside allowed domains"
      };
    }

    return {
      status: meta.redirected ? "reachable_with_redirect" : "reachable",
      originalUrl,
      finalUrl: meta.finalUrl,
      httpStatus: meta.status,
      allowedHost: true,
      redirected: meta.redirected,
      checkedAt,
      contentType: meta.contentType
    };
  } catch (error) {
    return {
      status: isLikelyNetworkError(error.message) ? "network_error" : "check_error",
      originalUrl,
      finalUrl: null,
      httpStatus: null,
      allowedHost: true,
      redirected: false,
      checkedAt,
      error: String(error.message || error)
    };
  }
}

async function verifyOpportunityUrls(items, sources) {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const inputItems = items.slice(0, MAX_URL_CHECK_ITEMS);
  const uncheckedTail = items.slice(MAX_URL_CHECK_ITEMS);
  const checks = new Array(inputItems.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= inputItems.length) return;

      const item = inputItems[index];
      const source = sourceMap.get(item.sourceId) || {
        id: item.sourceId,
        homepage: item.sourceHomepage || item.url,
        includeHosts: [getHost(item.url)]
      };
      checks[index] = await checkOpportunityUrl(item, source);
    }
  }

  if (inputItems.length > 0) {
    const workers = Array.from({ length: Math.min(URL_CHECK_CONCURRENCY, inputItems.length) }, () => worker());
    await Promise.all(workers);
  }

  let checked = 0;
  let reachable = 0;
  let reachableWithRedirect = 0;
  let reachableRestricted = 0;
  let networkErrors = 0;
  let dropped = 0;

  const keepItems = [];
  const droppedItems = [];

  for (let i = 0; i < inputItems.length; i += 1) {
    const item = inputItems[i];
    const check = checks[i] || {
      status: "check_error",
      originalUrl: item.url,
      finalUrl: null,
      checkedAt: new Date().toISOString(),
      error: "No check result generated"
    };
    checked += 1;

    item.urlCheck = check;
    if (
      check.finalUrl &&
      (check.status === "reachable" ||
        check.status === "reachable_with_redirect" ||
        check.status === "reachable_restricted")
    ) {
      item.url = canonicalizeUrl(check.finalUrl);
    }

    if (check.status === "network_error") networkErrors += 1;
    if (check.status === "reachable") reachable += 1;
    if (check.status === "reachable_with_redirect") reachableWithRedirect += 1;
    if (check.status === "reachable_restricted") reachableRestricted += 1;

    const pass =
      check.status === "reachable" ||
      check.status === "reachable_with_redirect" ||
      check.status === "reachable_restricted";
    if (pass) {
      keepItems.push(item);
    } else {
      dropped += 1;
      droppedItems.push({
        id: item.id,
        title: item.title,
        url: item.url,
        sourceId: item.sourceId,
        reason: check.status,
        detail: check.error || `HTTP ${check.httpStatus || "unknown"}`
      });
    }
  }

  const networkUnavailable = checked > 0 && networkErrors === checked;
  if (networkUnavailable && !STRICT_URL_VALIDATION) {
    const preserved = inputItems.map((item) => ({
      ...item,
      urlCheck: {
        status: "unchecked_network_unavailable",
        originalUrl: item.url,
        finalUrl: item.url,
        httpStatus: null,
        allowedHost: true,
        redirected: false,
        checkedAt: new Date().toISOString(),
        error: "Skipped strict filtering because network was unavailable during URL checks"
      }
    }));

    return {
      items: [...preserved, ...uncheckedTail.map((item) => ({
        ...item,
        urlCheck: {
          status: "unchecked_limit",
          originalUrl: item.url,
          finalUrl: item.url,
          httpStatus: null,
          allowedHost: true,
          redirected: false,
          checkedAt: new Date().toISOString(),
          error: `Skipped URL check due to MAX_URL_CHECK_ITEMS=${MAX_URL_CHECK_ITEMS}`
        }
      }))],
      droppedItems: [],
      summary: {
        checked,
        reachable: 0,
        reachableWithRedirect: 0,
        reachableRestricted: 0,
        dropped: 0,
        networkErrors,
        networkUnavailable,
        strictMode: STRICT_URL_VALIDATION
      }
    };
  }

  if (networkUnavailable && STRICT_URL_VALIDATION) {
    throw new Error("URL validation failed: network unavailable and STRICT_URL_VALIDATION=true");
  }

  return {
    items: [
      ...keepItems,
      ...uncheckedTail.map((item) => ({
        ...item,
        urlCheck: {
          status: "unchecked_limit",
          originalUrl: item.url,
          finalUrl: item.url,
          httpStatus: null,
          allowedHost: true,
          redirected: false,
          checkedAt: new Date().toISOString(),
          error: `Skipped URL check due to MAX_URL_CHECK_ITEMS=${MAX_URL_CHECK_ITEMS}`
        }
      }))
    ],
    droppedItems,
    summary: {
      checked,
      reachable,
      reachableWithRedirect,
      reachableRestricted,
      dropped,
      networkErrors,
      networkUnavailable: false,
      strictMode: STRICT_URL_VALIDATION
    }
  };
}

function scoreCandidate(link, source) {
  const text = `${link.text} ${link.url}`.toLowerCase();
  let score = 0;

  if (includesAny(text, FUNDING_KEYWORDS)) score += 4;
  if (text.includes("deadline") || text.includes("closing")) score += 3;
  if (text.includes("open") || text.includes("now open")) score += 2;
  if (text.includes("apply")) score += 2;
  if (includesAny(text, NEGATIVE_KEYWORDS)) score -= 5;

  const allowedHosts = source.includeHosts || [];
  if (allowedHosts.length > 0) {
    const host = getHost(link.url);
    if (allowedHosts.some((h) => host.endsWith(h))) score += 1;
    else score -= 2;
  }

  return score;
}

function pickCandidateLinks(links, source, maxPerSource) {
  const dedup = new Map();
  for (const link of links) {
    if (!link.url.startsWith("http")) continue;
    const key = link.url;
    const prev = dedup.get(key);
    if (!prev || link.text.length > prev.text.length) {
      dedup.set(key, link);
    }
  }

  const ranked = [...dedup.values()]
    .map((link) => ({
      ...link,
      score: scoreCandidate(link, source)
    }))
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, maxPerSource).map(({ score, ...rest }) => rest);
}

function parseDateFromText(text) {
  if (!text) return null;
  const normalized = text.replace(/,/g, " ").replace(/\s+/g, " ").trim();

  const directIso = normalized.match(/\b(20\d{2})[-\/](0?[1-9]|1[0-2])[-\/](0?[1-9]|[12]\d|3[01])\b/);
  if (directIso) {
    const year = Number(directIso[1]);
    const month = Number(directIso[2]);
    const day = Number(directIso[3]);
    return toIsoDate(year, month, day);
  }

  const dmyNumeric = normalized.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-.](0?[1-9]|1[0-2])[\/\-.](20\d{2})\b/);
  if (dmyNumeric) {
    const day = Number(dmyNumeric[1]);
    const month = Number(dmyNumeric[2]);
    const year = Number(dmyNumeric[3]);
    return toIsoDate(year, month, day);
  }

  const monthNamePatterns = [
    /\b(0?[1-9]|[12]\d|3[01])\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(20\d{2})\b/i,
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(0?[1-9]|[12]\d|3[01])\s+(20\d{2})\b/i
  ];

  for (const pattern of monthNamePatterns) {
    const m = normalized.match(pattern);
    if (!m) continue;

    let day;
    let monthName;
    let year;

    if (pattern === monthNamePatterns[0]) {
      day = Number(m[1]);
      monthName = m[2];
      year = Number(m[3]);
    } else {
      monthName = m[1];
      day = Number(m[2]);
      year = Number(m[3]);
    }

    const month = MONTHS[monthName.toLowerCase()];
    if (month) return toIsoDate(year, month, day);
  }

  return null;
}

function toIsoDate(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function extractDeadline(text) {
  if (!text) return null;

  const targeted = text.match(
    /(deadline|closing date|applications? close(?:s|d)?|closes?|closing)\s*[:\-]?\s*([^\.\n;]{4,80})/i
  );
  if (targeted?.[2]) {
    const parsed = parseDateFromText(targeted[2]);
    if (parsed) return parsed;
  }

  return parseDateFromText(text);
}

function extractAmount(text) {
  if (!text) return null;

  const match = text.match(
    /(£\s?\d[\d,]*(?:\.\d+)?\s?(?:m|k|million|billion|thousand)?(?:\s*(?:per year|a year|total))?)/i
  );
  if (!match?.[1]) return null;
  return normalizeWhitespace(match[1]);
}

function classifyType(raw) {
  const text = raw.toLowerCase();
  if (text.includes("fellowship")) return "fellowship";
  if (text.includes("scholarship") || text.includes("studentship") || text.includes("bursary")) return "scholarship";
  if (text.includes("award")) return "award";
  if (text.includes("call") || text.includes("competition")) return "call";
  return "grant";
}

function inferStatus(text, deadlineIso) {
  const lower = text.toLowerCase();
  if (lower.includes("closed") || lower.includes("applications closed") || lower.includes("this call is closed")) {
    return "closed";
  }

  if (lower.includes("open") || lower.includes("applications open") || lower.includes("now open")) {
    if (deadlineIso) {
      const deadline = Date.parse(`${deadlineIso}T23:59:59Z`);
      if (!Number.isNaN(deadline) && deadline < Date.now()) return "closed";
    }
    return "open";
  }

  if (deadlineIso) {
    const deadline = Date.parse(`${deadlineIso}T23:59:59Z`);
    if (!Number.isNaN(deadline) && deadline < Date.now()) return "closed";
    return "open";
  }

  return "unknown";
}

function inferLevels(text) {
  const lower = text.toLowerCase();
  const levels = [];
  if (lower.includes("undergraduate") || lower.includes("bachelor")) levels.push("undergraduate");
  if (lower.includes("masters") || lower.includes("master's") || lower.includes("postgraduate taught")) {
    levels.push("masters");
  }
  if (lower.includes("phd") || lower.includes("doctoral") || lower.includes("doctorate")) levels.push("phd");
  if (lower.includes("postdoc") || lower.includes("postdoctoral")) levels.push("postdoc");
  if (lower.includes("fellow") || lower.includes("principal investigator") || lower.includes("investigator")) {
    levels.push("academic");
  }
  return [...new Set(levels)];
}

function inferCareerStage(text) {
  const lower = text.toLowerCase();
  const stages = [];
  if (lower.includes("early career") || lower.includes("new investigator") || lower.includes("starting")) {
    stages.push("early");
  }
  if (lower.includes("mid-career") || lower.includes("mid career")) stages.push("mid");
  if (lower.includes("senior") || lower.includes("established investigator")) stages.push("senior");
  if (stages.length === 0 && (lower.includes("postdoc") || lower.includes("phd"))) stages.push("early");
  return [...new Set(stages)];
}

function inferNationalities(text) {
  const lower = text.toLowerCase();
  const tags = [];

  if (lower.includes("uk only") || lower.includes("uk-based") || lower.includes("uk institutions") || lower.includes("united kingdom")) {
    tags.push("uk");
  }
  if (lower.includes("international") || lower.includes("all nationalities") || lower.includes("worldwide")) {
    tags.push("international");
  }
  if (lower.includes("eu") || lower.includes("european")) tags.push("eu");

  if (tags.length === 0) tags.push("any");
  return [...new Set(tags)];
}

function inferDisciplines(text) {
  const lower = text.toLowerCase();
  const hits = [];

  for (const [discipline, patterns] of Object.entries(DISCIPLINE_PATTERNS)) {
    if (patterns.some((p) => lower.includes(p))) {
      hits.push(discipline);
    }
  }

  return hits.length > 0 ? hits : ["all disciplines"];
}

function heuristicSummary(item, contextText) {
  const levelText = item.eligibility.levels.length > 0 ? item.eligibility.levels.join("/") : "no explicit level restriction";
  const nationalityText = item.eligibility.nationalities.includes("any")
    ? "nationality rules appear flexible"
    : `targeted at ${item.eligibility.nationalities.join("/")}`;

  const deadlineText = item.deadline ? `deadline: ${item.deadline}` : "deadline must be confirmed on the official page";
  const typeLabel = {
    grant: "Grant opportunity",
    fellowship: "Fellowship",
    scholarship: "Scholarship",
    call: "Funding call",
    award: "Award scheme"
  }[item.type] || "Funding opportunity";

  const titleHint = item.title.slice(0, 80);
  const summary = `${typeLabel}. ${deadlineText}. Best suited for ${levelText}; ${nationalityText}.`;

  const bestFor = [];
  if (item.eligibility.levels.includes("phd")) bestFor.push("Applicants preparing for or currently in a PhD");
  if (item.eligibility.levels.includes("postdoc")) bestFor.push("Postdoctoral or early-career researchers");
  if (item.eligibility.levels.includes("masters")) bestFor.push("Master's applicants");
  if (item.eligibility.careerStages.includes("early")) bestFor.push("Early-career stage");
  if (item.eligibility.disciplines[0] !== "all disciplines") {
    bestFor.push(`Research focus includes ${item.eligibility.disciplines.slice(0, 2).join("/")}`);
  }
  if (bestFor.length === 0) bestFor.push("Anyone aligned with this theme and meeting official eligibility");

  const watchOut = [];
  if (item.status === "closed") watchOut.push("Status may be closed; verify the latest official notice");
  if (!item.deadline) watchOut.push("No explicit deadline was detected; verify before applying");
  if (item.eligibility.nationalities.includes("uk") && !item.eligibility.nationalities.includes("international")) {
    watchOut.push("May require UK institution affiliation or UK-specific eligibility");
  }
  if (watchOut.length === 0) watchOut.push("Check max budget, partnership rules, and required documents");

  return {
    en: summary,
    fit: bestFor,
    watchOut,
    model: "heuristic",
    reasoning: `Generated from title/content keyword heuristics: ${titleHint}`
  };
}

function extractJsonFromText(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenceMatch?.[1] || text;
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;
  try {
    return JSON.parse(objMatch[0]);
  } catch {
    return null;
  }
}

function getOpenRouterModelCandidates() {
  const fromList = (process.env.OPENROUTER_MODELS || "")
    .split(",")
    .map((x) => normalizeWhitespace(x))
    .filter(Boolean);

  if (fromList.length > 0) return [...new Set(fromList)];

  const single = normalizeWhitespace(process.env.OPENROUTER_MODEL || "");
  if (single) return [single];

  return DEFAULT_OPENROUTER_MODELS;
}

function extractChatContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((entry) => (typeof entry?.text === "string" ? entry.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

async function summarizeWithAI(item, contextText) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return heuristicSummary(item, contextText);
  }

  const models = getOpenRouterModelCandidates();
  const prompt = [
    "You are a UK academic funding advisor.",
    "Based on the opportunity information below, output JSON only (no extra text).",
    "JSON schema:",
    "{",
    '  "summary_en": "One-sentence English summary (<=35 words)",',
    '  "fit": ["Who this is good for #1", "Who this is good for #2"],',
    '  "watch_out": ["Risk or mismatch #1", "Risk or mismatch #2"],',
    '  "eligibility": {',
    '    "levels": ["undergraduate|masters|phd|postdoc|academic"],',
    '    "career_stages": ["early|mid|senior"],',
    '    "nationalities": ["uk|eu|international|any"],',
    '    "disciplines": ["discipline name"]',
    "  }",
    "}",
    "Rules:",
    "1) Be conservative when unsure; use nationality 'any'.",
    "2) fit and watch_out must each contain at least 2 entries.",
    "3) If info is incomplete, explicitly say to verify on the official page.",
    "4) Output must be valid JSON.",
    "Input:",
    JSON.stringify(
      {
        title: item.title,
        source: item.sourceName,
        url: item.url,
        deadline: item.deadline,
        amount: item.amount,
        type: item.type,
        status: item.status,
        content: contextText.slice(0, 6000)
      },
      null,
      2
    )
  ].join("\n");

  for (const model of models) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://github.com/pingfanfan/GrantHunter",
          "X-Title": process.env.OPENROUTER_SITE_NAME || "GrantHunter"
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: "You are a precise funding opportunity summarizer. Always return valid JSON only."
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter HTTP ${response.status}`);
      }

      const data = await response.json();
      const text = extractChatContent(data);
      const parsed = extractJsonFromText(text);

      if (!parsed || typeof parsed !== "object") {
        throw new Error("AI summary JSON parse failed");
      }

      const summaryEn = normalizeWhitespace(parsed.summary_en || parsed.summary || parsed.summary_zh || "");
      const fit = Array.isArray(parsed.fit) ? parsed.fit.map((x) => normalizeWhitespace(String(x))).filter(Boolean) : [];
      const watchOut = Array.isArray(parsed.watch_out)
        ? parsed.watch_out.map((x) => normalizeWhitespace(String(x))).filter(Boolean)
        : [];

      const eligibility = parsed.eligibility && typeof parsed.eligibility === "object" ? parsed.eligibility : {};

      return {
        en: summaryEn || heuristicSummary(item, contextText).en,
        fit: fit.length > 0 ? fit.slice(0, 4) : heuristicSummary(item, contextText).fit,
        watchOut: watchOut.length > 0 ? watchOut.slice(0, 4) : heuristicSummary(item, contextText).watchOut,
        eligibility,
        model,
        reasoning: "AI generated via OpenRouter"
      };
    } catch (error) {
      console.warn(`[AI] ${model} failed for ${item.url}: ${error.message}`);
    }
  }

  return heuristicSummary(item, contextText);
}

function shouldKeepOpportunity(candidate) {
  const merged = `${candidate.title} ${candidate.description} ${candidate.url}`.toLowerCase();
  if (!includesAny(merged, FUNDING_KEYWORDS)) return false;
  if (includesAny(merged, NEGATIVE_KEYWORDS)) return false;
  if (candidate.title.length < 8) return false;
  return true;
}

function buildFingerprint(item) {
  return sha1(
    [
      item.title,
      item.url,
      item.deadline || "",
      item.amount || "",
      item.status,
      item.description?.slice(0, 320) || ""
    ].join("|")
  );
}

function createDigest(items, previousMap) {
  const newItems = [];
  const updatedItems = [];

  for (const item of items) {
    const prev = previousMap.get(item.id);
    if (!prev) {
      newItems.push(item);
      continue;
    }
    if (prev.fingerprint !== item.fingerprint) {
      updatedItems.push(item);
    }
  }

  const closingSoon = items
    .filter((item) => item.deadline && item.status === "open")
    .map((item) => ({
      ...item,
      daysLeft: daysUntil(item.deadline)
    }))
    .filter((item) => item.daysLeft >= 0 && item.daysLeft <= 14)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const subject = `UK Funding Daily Brief | ${new Date().toISOString().slice(0, 10)} | ${newItems.length} new`;

  const lines = [];
  lines.push(`# UK Academic Funding Daily Brief (${new Date().toISOString().slice(0, 10)})`);
  lines.push("");
  lines.push(`- New opportunities: **${newItems.length}**`);
  lines.push(`- Updated opportunities: **${updatedItems.length}**`);
  lines.push(`- Closing within 14 days: **${closingSoon.length}**`);
  lines.push("");

  lines.push("## New Opportunities (Top 12)");
  if (newItems.length === 0) {
    lines.push("- No new items were detected today (source updates may be limited or blocked).");
  } else {
    for (const item of newItems.slice(0, 12)) {
      lines.push(
        `- [${escapeMd(item.title)}](${item.url}) | ${item.sourceName} | Deadline: ${item.deadline || "TBC"} | ${escapeMd(
          item.summary?.en || item.summary?.zh || ""
        )}`
      );
    }
  }

  lines.push("");
  lines.push("## Closing Soon (Within 14 Days)");
  if (closingSoon.length === 0) {
    lines.push("- No opportunities close within the next 14 days.\n");
  } else {
    for (const item of closingSoon.slice(0, 12)) {
      lines.push(`- [${escapeMd(item.title)}](${item.url}) | ${item.sourceName} | D-${item.daysLeft}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("This brief is auto-generated by GitHub Actions. Always verify details on the official source page.\n");

  return {
    subject,
    markdown: lines.join("\n"),
    stats: {
      newItems: newItems.length,
      updatedItems: updatedItems.length,
      closingSoon: closingSoon.length
    }
  };
}

function escapeMd(text) {
  return String(text || "").replace(/[\[\]()]/g, " ").replace(/\s+/g, " ").trim();
}

function daysUntil(isoDate) {
  const target = Date.parse(`${isoDate}T23:59:59Z`);
  if (Number.isNaN(target)) return 9999;
  return Math.ceil((target - Date.now()) / (24 * 3600 * 1000));
}

function buildFallbackItems(sources) {
  const staticExamples = [
    {
      title: "UKRI Responsive Mode Research Grants",
      sourceId: "ukri",
      summary: "Suitable for UK university research teams, typically supporting multi-disciplinary projects.",
      level: ["academic", "postdoc"],
      type: "grant",
      url: "https://www.ukri.org/opportunity/",
      deadline: null
    },
    {
      title: "Royal Society University Research Fellowship",
      sourceId: "royal-society",
      summary: "Suitable for early independent researchers with strong long-term potential and host support.",
      level: ["postdoc", "academic"],
      type: "fellowship",
      url: "https://royalsociety.org/grants/",
      deadline: null
    },
    {
      title: "Commonwealth Master's Scholarships",
      sourceId: "commonwealth",
      summary: "Suitable for applicants from Commonwealth countries pursuing a UK master's degree.",
      level: ["masters"],
      type: "scholarship",
      url: "https://cscuk.fcdo.gov.uk/scholarships/commonwealth-masters-scholarships/",
      deadline: null
    },
    {
      title: "Chevening Scholarships",
      sourceId: "chevening",
      summary: "Suitable for international master's applicants with leadership potential.",
      level: ["masters"],
      type: "scholarship",
      url: "https://www.chevening.org/scholarships/",
      deadline: null
    },
    {
      title: "Wellcome Early-Career Researcher Schemes",
      sourceId: "wellcome",
      summary: "Suitable for early-career researchers in health and life sciences.",
      level: ["postdoc", "academic"],
      type: "grant",
      url: "https://wellcome.org/grant-funding",
      deadline: null
    }
  ];

  return staticExamples.map((it, idx) => {
    const source = sources.find((s) => s.id === it.sourceId);
    const item = {
      id: sha1(`${it.url}|${it.title}`),
      title: it.title,
      url: it.url,
      sourceId: it.sourceId,
      sourceName: source?.name || it.sourceId,
      sourceHomepage: source?.homepage || it.url,
      type: it.type,
      status: "unknown",
      deadline: it.deadline,
      amount: null,
      description: it.summary,
      eligibility: {
        levels: it.level,
        careerStages: ["early"],
        nationalities: ["any"],
        disciplines: ["all disciplines"]
      },
      summary: {
        en: `${it.summary} (Fallback sample item: check the official link for current opening status.)`,
        fit: ["Your profile aligns with the scheme focus", "You can prepare required documents per official guidance"],
        watchOut: ["Always verify current dates and eligibility on the official page"],
        model: "fallback",
        reasoning: "No live source fetched"
      },
      matchedTags: [],
      rawSignals: {
        extractedAt: now.toISOString(),
        sourceType: "fallback"
      }
    };

    item.fingerprint = buildFingerprint(item) + String(idx);
    return item;
  });
}

function pickFirstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return normalizeWhitespace(v.trim());
  }
  return "";
}

function parseRssItems(xml, source) {
  const out = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  for (const block of itemMatches.slice(0, DEFAULT_MAX_PER_SOURCE)) {
    const title = pickFirstNonEmpty((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    const link = pickFirstNonEmpty((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
    const description = pickFirstNonEmpty(
      (block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1],
      (block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i) || [])[1]
    );

    if (!title || !link) continue;
    const cleanDesc = stripHtml(description).slice(0, 900);
    const merged = `${title} ${cleanDesc}`;

    const deadline = extractDeadline(merged);
    const amount = extractAmount(merged);
    const type = classifyType(merged);
    const eligibility = {
      levels: inferLevels(merged),
      careerStages: inferCareerStage(merged),
      nationalities: inferNationalities(merged),
      disciplines: inferDisciplines(merged)
    };

    const item = {
      id: sha1(`${source.id}|${link}|${title}`),
      title,
      url: canonicalizeUrl(link),
      sourceId: source.id,
      sourceName: source.name,
      sourceHomepage: source.homepage,
      type,
      status: inferStatus(merged, deadline),
      deadline,
      amount,
      description: cleanDesc,
      eligibility,
      summary: null,
      matchedTags: [],
      rawSignals: {
        extractedAt: now.toISOString(),
        sourceType: "rss"
      }
    };

    if (shouldKeepOpportunity(item)) out.push(item);
  }

  return out;
}

async function parseSource(source, maxPerSource) {
  const candidates = [];
  const errors = [];

  for (const seedUrl of source.seedUrls || []) {
    try {
      const html = await fetchText(seedUrl);
      if (/<rss[\s>]/i.test(html) || /<feed[\s>]/i.test(html)) {
        const rssItems = parseRssItems(html, source);
        candidates.push(...rssItems);
        continue;
      }

      const links = extractLinks(html, seedUrl);
      const picks = pickCandidateLinks(links, source, maxPerSource);

      for (const link of picks) {
        candidates.push({
          seedUrl,
          source,
          url: link.url,
          anchorText: link.text,
          sourceType: "detail"
        });
      }

      // Add seed page itself as a potential summary record.
      candidates.push({
        seedUrl,
        source,
        url: canonicalizeUrl(seedUrl),
        anchorText: source.name,
        sourceType: "seed_page"
      });
    } catch (error) {
      errors.push({ seedUrl, error: error.message });
    }
  }

  const result = [];
  const detailCandidates = [];

  for (const item of candidates) {
    if (item.id) {
      result.push(item);
      continue;
    }
    detailCandidates.push(item);
  }

  const seenDetail = new Set();
  for (const candidate of detailCandidates) {
    if (result.length >= MAX_DETAIL_FETCH) break;
    if (seenDetail.has(candidate.url)) continue;
    seenDetail.add(candidate.url);

    try {
      const html = await fetchText(candidate.url);
      const text = stripHtml(html);
      const title = pickFirstNonEmpty(extractTitle(html), candidate.anchorText);
      const description = pickFirstNonEmpty(extractMetaDescription(html), text.slice(0, 860));
      const merged = `${title} ${description} ${text.slice(0, 4000)}`;

      const deadline = extractDeadline(merged);
      const amount = extractAmount(merged);
      const type = classifyType(`${title} ${candidate.url} ${description}`);
      const eligibility = {
        levels: inferLevels(merged),
        careerStages: inferCareerStage(merged),
        nationalities: inferNationalities(merged),
        disciplines: inferDisciplines(merged)
      };

      const item = {
        id: sha1(`${candidate.source.id}|${candidate.url}|${title}`),
        title,
        url: canonicalizeUrl(candidate.url),
        sourceId: candidate.source.id,
        sourceName: candidate.source.name,
        sourceHomepage: candidate.source.homepage,
        type,
        status: inferStatus(merged, deadline),
        deadline,
        amount,
        description: description.slice(0, 920),
        eligibility,
        summary: null,
        matchedTags: [],
        rawSignals: {
          extractedAt: now.toISOString(),
          sourceType: candidate.sourceType,
          textSample: text.slice(0, 1600)
        }
      };

      if (shouldKeepOpportunity(item)) {
        result.push(item);
      }
    } catch (error) {
      errors.push({ seedUrl: candidate.seedUrl, detailUrl: candidate.url, error: error.message });
    }
  }

  return { items: result, errors };
}

function mergeAndDedupe(items) {
  const byUrl = new Map();

  for (const item of items) {
    const key = canonicalizeUrl(item.url);
    if (!byUrl.has(key)) {
      byUrl.set(key, item);
      continue;
    }

    const prev = byUrl.get(key);
    const prevScore = (prev.description?.length || 0) + (prev.deadline ? 30 : 0);
    const nextScore = (item.description?.length || 0) + (item.deadline ? 30 : 0);
    if (nextScore > prevScore) byUrl.set(key, item);
  }

  return [...byUrl.values()];
}

function normalizeEligibility(eligibility) {
  const levels = Array.isArray(eligibility?.levels) ? eligibility.levels : [];
  const careerStages = Array.isArray(eligibility?.careerStages)
    ? eligibility.careerStages
    : Array.isArray(eligibility?.career_stages)
    ? eligibility.career_stages
    : [];
  const nationalities = Array.isArray(eligibility?.nationalities) ? eligibility.nationalities : [];
  const disciplines = Array.isArray(eligibility?.disciplines) ? eligibility.disciplines : [];

  return {
    levels: [...new Set(levels.map((x) => String(x).toLowerCase()).filter(Boolean))],
    careerStages: [...new Set(careerStages.map((x) => String(x).toLowerCase()).filter(Boolean))],
    nationalities: [...new Set(nationalities.map((x) => String(x).toLowerCase()).filter(Boolean))],
    disciplines: [...new Set(disciplines.map((x) => normalizeWhitespace(String(x).toLowerCase())).filter(Boolean))]
  };
}

async function enrichWithSummaries(items, previousMap) {
  const queue = [];

  for (const item of items) {
    const prev = previousMap.get(item.id);
    const shouldReuse = prev && prev.fingerprint === item.fingerprint && prev.summary;

    if (shouldReuse) {
      item.summary = prev.summary;
      item.eligibility = normalizeEligibility({ ...item.eligibility, ...(prev.eligibility || {}) });
      continue;
    }

    queue.push(item);
  }

  const trimmedQueue = queue.slice(0, MAX_AI_ITEMS);
  for (const item of trimmedQueue) {
    const context = `${item.title}\n${item.description || ""}\n${item.rawSignals?.textSample || ""}`;
    const aiSummary = await summarizeWithAI(item, context);

    item.summary = {
      en: aiSummary.en || aiSummary.zh || "",
      fit: Array.isArray(aiSummary.fit) ? aiSummary.fit.slice(0, 4) : [],
      watchOut: Array.isArray(aiSummary.watchOut) ? aiSummary.watchOut.slice(0, 4) : [],
      model: aiSummary.model,
      reasoning: aiSummary.reasoning
    };

    if (aiSummary.eligibility && typeof aiSummary.eligibility === "object") {
      item.eligibility = normalizeEligibility({ ...item.eligibility, ...aiSummary.eligibility });
    } else {
      item.eligibility = normalizeEligibility(item.eligibility);
    }
  }

  for (const item of items) {
    item.eligibility = normalizeEligibility(item.eligibility);
    if (!item.summary) {
      item.summary = heuristicSummary(item, `${item.title}\n${item.description || ""}`);
    }
  }
}

function sortItems(items) {
  return items.sort((a, b) => {
    const statusRank = { open: 0, unknown: 1, closed: 2 };
    const sa = statusRank[a.status] ?? 3;
    const sb = statusRank[b.status] ?? 3;
    if (sa !== sb) return sa - sb;

    const da = a.deadline ? Date.parse(`${a.deadline}T00:00:00Z`) : Infinity;
    const db = b.deadline ? Date.parse(`${b.deadline}T00:00:00Z`) : Infinity;
    if (da !== db) return da - db;

    return a.title.localeCompare(b.title);
  });
}

async function ensureDirs() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(HISTORY_DIR, { recursive: true });
}

function buildSiteConfig() {
  const username = process.env.BUTTONDOWN_USERNAME || "";
  const subscriptionAction = username
    ? `https://buttondown.email/api/emails/embed-subscribe/${username}`
    : "https://buttondown.email/api/emails/embed-subscribe/your-buttondown-username";

  return {
    appName: "UK Academic Funding Hub",
    subscriptionAction,
    buttondownUsername: username || "your-buttondown-username",
    note:
      "Set BUTTONDOWN_USERNAME in GitHub Actions secrets/vars so the subscribe form points to your newsletter."
  };
}

async function main() {
  const args = parseArgs();
  const maxPerSource = Number(args.get("--max-per-source") || DEFAULT_MAX_PER_SOURCE);

  await ensureDirs();

  const sources = await readJson(SOURCES_FILE, []);
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("config/sources.json is empty or invalid");
  }

  const previousData = await readJson(OUTPUT_FILE, { items: [] });
  const previousItems = Array.isArray(previousData?.items) ? previousData.items : [];
  const previousMap = new Map(previousItems.map((item) => [item.id, item]));

  const allItems = [];
  const allErrors = [];

  for (const source of sources) {
    const { items, errors } = await parseSource(source, maxPerSource);
    allItems.push(...items);
    allErrors.push(...errors);
  }

  let deduped = mergeAndDedupe(allItems);

  if (deduped.length === 0) {
    const disableCarryForward = process.env.DISABLE_CARRY_FORWARD === "true";
    if (previousItems.length > 0 && !disableCarryForward) {
      const sourceById = new Map(sources.map((source) => [source.id, source]));
      deduped = previousItems.map((item) => ({
        ...(() => {
          const source = sourceById.get(item.sourceId);
          const previousSourceHomepage = item.sourceHomepage || source?.homepage || item.url;
          const nextSourceHomepage = source?.homepage || previousSourceHomepage;
          const previousSourceType = item?.rawSignals?.sourceType || "";
          const shouldRefreshUrlFromSource =
            (previousSourceType === "fallback" || previousSourceType === "carried_forward") &&
            typeof nextSourceHomepage === "string" &&
            nextSourceHomepage.trim().length > 0;

          return {
            ...item,
            url: shouldRefreshUrlFromSource ? canonicalizeUrl(nextSourceHomepage) : item.url,
            sourceHomepage: nextSourceHomepage,
            rawSignals: {
              ...(item.rawSignals || {}),
              extractedAt: now.toISOString(),
              sourceType: "carried_forward"
            }
          };
        })()
      }));
    } else {
      deduped = buildFallbackItems(sources);
    }
  }

  const urlVerification = await verifyOpportunityUrls(deduped, sources);
  deduped = mergeAndDedupe(urlVerification.items);
  allErrors.push(
    ...urlVerification.droppedItems.map((entry) => ({
      seedUrl: entry.url,
      error: `URL dropped (${entry.reason}): ${entry.detail}`
    }))
  );

  if (deduped.length === 0 && STRICT_URL_VALIDATION) {
    throw new Error("URL validation removed all opportunities. No verified links remain.");
  }

  deduped = deduped.slice(0, Number(process.env.MAX_TOTAL_ITEMS || 320));

  for (const item of deduped) {
    item.fingerprint = buildFingerprint(item);
  }

  await enrichWithSummaries(deduped, previousMap);

  for (const item of deduped) {
    item.lastSeenAt = now.toISOString();
  }

  const sortedItems = sortItems(deduped);
  const finalItems = sortedItems.map((item) => {
    const prev = previousMap.get(item.id);
    const isNew = !prev;
    const isUpdated = Boolean(prev && prev.fingerprint !== item.fingerprint);

    return {
      ...item,
      isNew,
      isUpdated
    };
  });

  const finalMap = new Map(finalItems.map((item) => [item.id, item]));
  const digest = createDigest(finalItems, previousMap);

  const stats = {
    total: finalItems.length,
    open: finalItems.filter((item) => item.status === "open").length,
    unknown: finalItems.filter((item) => item.status === "unknown").length,
    closed: finalItems.filter((item) => item.status === "closed").length,
    withDeadline: finalItems.filter((item) => Boolean(item.deadline)).length,
    newToday: finalItems.filter((item) => item.isNew).length,
    updatedToday: finalItems.filter((item) => item.isUpdated).length,
    sourcesConfigured: sources.length
  };

  const output = {
    generatedAt: now.toISOString(),
    generatedDate: now.toISOString().slice(0, 10),
    stats,
    digest,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      homepage: s.homepage
    })),
    items: finalItems,
    diagnostics: {
      errors: allErrors.slice(0, 120),
      previousItemCount: previousItems.length,
      currentItemCount: finalItems.length,
      aiEnabled: Boolean(process.env.OPENROUTER_API_KEY),
      aiModelCandidates: getOpenRouterModelCandidates(),
      urlVerification: urlVerification.summary
    }
  };

  await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  const historyFile = path.join(HISTORY_DIR, `${output.generatedDate}.json`);
  await writeFile(historyFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  await writeFile(path.join(OUTPUT_DIR, "digest.latest.md"), `${output.digest.markdown}\n`, "utf8");

  const indexSlim = {
    generatedAt: output.generatedAt,
    stats,
    items: output.items.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      sourceName: item.sourceName,
      type: item.type,
      status: item.status,
      deadline: item.deadline,
      amount: item.amount,
      summary: item.summary?.en || item.summary?.zh || "",
      levels: item.eligibility?.levels || [],
      disciplines: item.eligibility?.disciplines || [],
      nationalities: item.eligibility?.nationalities || []
    }))
  };

  await writeFile(path.join(OUTPUT_DIR, "funding.index.json"), `${JSON.stringify(indexSlim, null, 2)}\n`, "utf8");

  const siteConfig = buildSiteConfig();
  await writeFile(SITE_CONFIG_FILE, `${JSON.stringify(siteConfig, null, 2)}\n`, "utf8");

  const latestDigestSummary = {
    generatedAt: output.generatedAt,
    subject: digest.subject,
    stats: digest.stats,
    markdownPath: "./digest.latest.md"
  };
  await writeFile(path.join(OUTPUT_DIR, "digest.meta.json"), `${JSON.stringify(latestDigestSummary, null, 2)}\n`, "utf8");

  // Ensure stale items from previous data are not accidentally considered current when fetch is partially blocked.
  if (previousItems.length > 0 && finalItems.length < Math.ceil(previousItems.length * 0.25)) {
    console.warn(
      `[warn] Current item count (${finalItems.length}) is far below previous (${previousItems.length}). Check source availability.`
    );
  }

  console.log(`Generated ${finalItems.length} opportunities from ${sources.length} sources.`);
  console.log(`Open opportunities: ${stats.open}, new today: ${stats.newToday}, updated today: ${stats.updatedToday}`);
  console.log(`Digest subject: ${digest.subject}`);
  if (allErrors.length > 0) {
    console.log(`Source warnings: ${allErrors.length} (showing first 5)`);
    for (const err of allErrors.slice(0, 5)) {
      console.log(`- ${err.seedUrl || err.detailUrl}: ${err.error}`);
    }
  }
}

main().catch((error) => {
  console.error("Failed to update funding data:", error);
  process.exit(1);
});
