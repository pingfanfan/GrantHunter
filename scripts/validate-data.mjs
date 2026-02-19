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

const VERIFIED_URL_STATUSES = new Set(["reachable", "reachable_with_redirect"]);

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
