import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function addError(errors, message) {
  errors.push({ level: "error", message });
}

function addWarning(warnings, message) {
  warnings.push({ level: "warning", message });
}

const VERIFIED_URL_STATUSES = new Set(["reachable", "reachable_with_redirect", "reachable_restricted"]);
const NON_SPECIFIC_TITLE_PATTERNS = [
  /\bapply for and manage your funding\b/i,
  /\bapply for and manage funding\b/i,
  /\bapply for funding\b/i,
  /\bmanage your award\b/i,
  /\bbefore you apply\b/i,
  /\bdevelop your application\b/i,
  /\bhow we make decisions\b/i,
  /\bfunding opportunities\b/i,
  /\bfunding for research\b/i,
  /^scholarships and fellowships$/i,
  /^about us$/i,
  /^(frequently asked questions|faq|faqs)$/i,
  /^code of conduct$/i,
  /^policy and procedure$/i,
  /^template application form$/i,
  /^selection criteria$/i,
  /^host organisations?$/i,
  /^partners?$/i,
  /^evaluation$/i,
  /^filter search$/i,
  /\bstarting a funding journey\b/i,
  /\bplanning a funding application\b/i,
  /\bresponsibilities after funding\b/i,
  /\beligibility guide for applicants\b/i,
  /\bapplication guidance\b/i,
  /\bguidance for applicants\b/i,
  /\bguidance for teachers\b/i,
  /\binformation for advisors\b/i,
  /\binformation for institutions and universities\b/i,
  /\binformation sessions?\b/i,
  /\bapply to imperial\b/i,
  /\bapply undergraduate\b/i,
  /\bapplication process\b/i,
  /\baccepted qualifications\b/i,
  /\bchoose a course\b/i,
  /\bentry requirements\b/i,
  /\bdo your own fundraising\b/i,
  /^eligibility$/i,
  /^how to apply$/i,
  /^how we select$/i,
  /^criteria$/i,
  /^timeline$/i,
  /^resources?$/i,
  /\bfunding\s*&\s*tenders\b/i,
  /^find a scholarship$/i,
  /^our funding schemes$/i,
  /\bwho can apply for\b/i,
  /^scholarship timeline$/i,
  /^guide for applicants$/i,
  /^resources$/i,
  /^funded grants$/i,
  /^funding guidance$/i,
  /^funding policies and grant conditions$/i,
  /^funding portfolio(: funded people and projects)?$/i,
  /^prepare to apply$/i,
  /^scholarships$/i
];

const NON_SPECIFIC_URL_SEGMENTS = [
  "/apply-for-and-manage-your-funding",
  "/apply-for-funding",
  "/manage-your-award",
  "/before-you-apply",
  "/develop-your-application",
  "/how-we-make-decisions",
  "/starting-a-funding-journey",
  "/application-support",
  "/responsibilities-after-funding",
  "/resource-hub/guidance",
  "/information-for-advisors",
  "/information-for-institutions-and-universities",
  "/information-sessions",
  "/study/apply",
  "/do-your-own-fundraising",
  "/apply/eligibility",
  "/how-to-apply",
  "/how-we-select",
  "/find-a-scholarship",
  "/our-funding-schemes",
  "/apply/criteria",
  "/apply/timeline",
  "/information-for-applicants/timeline",
  "/scholarships/who-can-apply",
  "/fellowships/who-can-apply",
  "/who-can-apply-for-a-chevening",
  "/funding-tenders/opportunities/data/topic-list.html",
  "/funding-for-research/resources",
  "/research-funding/guidance",
  "/research-funding/funding-portfolio",
  "/guidance/prepare-to-apply"
];

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonSpecificTitle(title) {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;
  return NON_SPECIFIC_TITLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasNonSpecificUrlSegment(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return NON_SPECIFIC_URL_SEGMENTS.some((segment) => path.includes(segment));
  } catch {
    return false;
  }
}

export function validateDataset(dataset, options = {}) {
  const strictUrls = Boolean(options.strictUrls);
  const errors = [];
  const warnings = [];

  if (!dataset || typeof dataset !== "object") {
    addError(errors, "Dataset is not a JSON object");
    return { errors, warnings };
  }

  if (!isNonEmptyString(dataset.generatedAt) || Number.isNaN(Date.parse(dataset.generatedAt))) {
    addError(errors, "generatedAt is missing or invalid ISO datetime");
  }

  if (!Array.isArray(dataset.items)) {
    addError(errors, "items must be an array");
    return { errors, warnings };
  }

  if (!Array.isArray(dataset.sources) || dataset.sources.length === 0) {
    addWarning(warnings, "sources is empty; source directory UI will be blank");
  }

  const ids = new Set();
  const urls = new Set();
  const validStatuses = new Set(["open", "closed", "unknown"]);
  const validTypes = new Set(["grant", "fellowship", "scholarship", "call", "award"]);

  dataset.items.forEach((item, index) => {
    const prefix = `items[${index}]`;

    if (!isNonEmptyString(item.id)) addError(errors, `${prefix}.id is required`);
    if (!isNonEmptyString(item.title)) addError(errors, `${prefix}.title is required`);
    if (!isValidUrl(item.url)) addError(errors, `${prefix}.url must be a valid http/https URL`);
    if (!isNonEmptyString(item.sourceId)) addError(errors, `${prefix}.sourceId is required`);
    if (!isNonEmptyString(item.sourceName)) addError(errors, `${prefix}.sourceName is required`);
    if (isNonSpecificTitle(item.title)) {
      addError(errors, `${prefix}.title is generic and not a specific grant (${item.title})`);
    }
    if (hasNonSpecificUrlSegment(item.url)) {
      addError(errors, `${prefix}.url points to a generic apply/manage page (${item.url})`);
    }

    if (!validStatuses.has(item.status)) {
      addError(errors, `${prefix}.status must be one of open/closed/unknown`);
    }

    if (!validTypes.has(item.type)) {
      addWarning(warnings, `${prefix}.type is non-standard (${item.type})`);
    }

    if (item.deadline && !isIsoDate(item.deadline)) {
      addWarning(warnings, `${prefix}.deadline should be YYYY-MM-DD`);
    }

    const summaryText = item?.summary?.en || item?.summary?.zh || "";
    if (!isNonEmptyString(summaryText)) {
      addWarning(warnings, `${prefix}.summary is empty`);
    }

    if (!item.eligibility || typeof item.eligibility !== "object") {
      addWarning(warnings, `${prefix}.eligibility is missing`);
    } else {
      ["levels", "careerStages", "nationalities", "disciplines"].forEach((field) => {
        if (!Array.isArray(item.eligibility[field])) {
          addWarning(warnings, `${prefix}.eligibility.${field} should be an array`);
        }
      });
    }

    if (!item.urlCheck || typeof item.urlCheck !== "object") {
      if (strictUrls) addError(errors, `${prefix}.urlCheck is required in strict URL mode`);
      else addWarning(warnings, `${prefix}.urlCheck is missing`);
    } else {
      const status = String(item.urlCheck.status || "");
      const finalUrl = item.urlCheck.finalUrl;
      const allowedHost =
        typeof item.urlCheck.allowedHost === "boolean" ? item.urlCheck.allowedHost : undefined;

      if (!status) {
        if (strictUrls) addError(errors, `${prefix}.urlCheck.status is required in strict URL mode`);
        else addWarning(warnings, `${prefix}.urlCheck.status is missing`);
      } else if (strictUrls && !VERIFIED_URL_STATUSES.has(status)) {
        addError(errors, `${prefix}.urlCheck.status must be verified (got: ${status})`);
      } else if (!strictUrls && !VERIFIED_URL_STATUSES.has(status)) {
        addWarning(warnings, `${prefix}.urlCheck.status is not verified (${status})`);
      }

      if (finalUrl && !isValidUrl(finalUrl)) {
        if (strictUrls) addError(errors, `${prefix}.urlCheck.finalUrl must be valid http/https`);
        else addWarning(warnings, `${prefix}.urlCheck.finalUrl is not a valid URL`);
      }

      if (strictUrls && allowedHost === false) {
        addError(errors, `${prefix}.urlCheck.allowedHost is false`);
      } else if (!strictUrls && allowedHost === false) {
        addWarning(warnings, `${prefix}.urlCheck.allowedHost is false`);
      }
    }

    if (item.id) {
      if (ids.has(item.id)) addError(errors, `${prefix}.id is duplicated (${item.id})`);
      ids.add(item.id);
    }

    if (item.url) {
      if (urls.has(item.url)) addWarning(warnings, `${prefix}.url appears duplicated (${item.url})`);
      urls.add(item.url);
    }
  });

  const statsTotal = Number(dataset?.stats?.total ?? -1);
  if (statsTotal !== dataset.items.length) {
    addWarning(warnings, `stats.total (${statsTotal}) does not equal items.length (${dataset.items.length})`);
  }

  return { errors, warnings };
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const fileArg = process.argv[2] || path.join(process.cwd(), "docs", "data", "funding.latest.json");
  const dataset = await readJson(fileArg);
  const strictUrls = process.env.VALIDATE_STRICT_URLS === "true";
  const { errors, warnings } = validateDataset(dataset, { strictUrls });

  for (const warning of warnings) {
    console.log(`[warn] ${warning.message}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[error] ${error.message}`);
    }
    process.exit(1);
  }

  console.log(
    `Dataset validation passed: ${dataset.items.length} items, ${warnings.length} warning(s), 0 error(s). strictUrls=${strictUrls}`
  );
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main().catch((error) => {
    console.error("validate-data failed:", error);
    process.exit(1);
  });
}
