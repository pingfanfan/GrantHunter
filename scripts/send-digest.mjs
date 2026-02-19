import { readFile, writeFile } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "docs", "data", "funding.latest.json");
const OUTBOX_LOG_FILE = path.join(ROOT, "docs", "data", "digest.outbox.json");

async function readJson(filePath, fallback = null) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function shouldSendDigest(payload) {
  if (process.env.SEND_EMPTY_DIGEST === "true") return true;
  const stats = payload?.digest?.stats;
  if (!stats) return true;
  return Number(stats.newItems || 0) + Number(stats.updatedItems || 0) > 0;
}

async function createButtondownDraft({ apiKey, subject, body, newsletterId }) {
  const bodyPayload = {
    subject,
    body,
    status: "draft"
  };

  if (newsletterId) {
    bodyPayload.newsletter = newsletterId;
  }

  const response = await fetch("https://api.buttondown.email/v1/emails", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(bodyPayload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Buttondown create draft failed (${response.status}): ${text.slice(0, 400)}`);
  }

  return response.json();
}

async function markAboutToSend({ apiKey, emailId }) {
  const response = await fetch(`https://api.buttondown.email/v1/emails/${emailId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status: "about_to_send" })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Buttondown send trigger failed (${response.status}): ${text.slice(0, 400)}`);
  }

  return response.json();
}

async function main() {
  const payload = await readJson(DATA_FILE, null);
  if (!payload) {
    throw new Error("Missing docs/data/funding.latest.json. Run npm run update:data first.");
  }

  const digest = payload.digest || {};
  const subject = digest.subject || `UK Funding Daily Brief ${new Date().toISOString().slice(0, 10)}`;
  const body = digest.markdown || "No digest body generated.";

  const apiKey = process.env.BUTTONDOWN_API_KEY || "";
  const newsletterId = process.env.BUTTONDOWN_NEWSLETTER_ID || "";
  const dryRun = process.env.BUTTONDOWN_DRY_RUN === "true";

  const outbox = {
    generatedAt: new Date().toISOString(),
    subject,
    shouldSend: shouldSendDigest(payload),
    dryRun,
    provider: "buttondown"
  };

  if (!shouldSendDigest(payload)) {
    outbox.status = "skipped_no_changes";
    await writeFile(OUTBOX_LOG_FILE, `${JSON.stringify(outbox, null, 2)}\n`, "utf8");
    console.log("Digest skipped: no new/updated opportunities.");
    return;
  }

  if (!apiKey) {
    outbox.status = "skipped_missing_api_key";
    await writeFile(OUTBOX_LOG_FILE, `${JSON.stringify(outbox, null, 2)}\n`, "utf8");
    console.log("BUTTONDOWN_API_KEY not set. Digest prepared but not sent.");
    return;
  }

  const draft = await createButtondownDraft({ apiKey, subject, body, newsletterId });
  outbox.draftId = draft?.id;
  outbox.status = "draft_created";

  if (!dryRun) {
    await markAboutToSend({ apiKey, emailId: draft.id });
    outbox.status = "queued_to_send";
  }

  await writeFile(OUTBOX_LOG_FILE, `${JSON.stringify(outbox, null, 2)}\n`, "utf8");

  console.log(`Digest ${dryRun ? "drafted" : "queued"}: ${subject}`);
  if (draft?.id) console.log(`Buttondown email id: ${draft.id}`);
}

main().catch((error) => {
  console.error("Failed to send digest:", error);
  process.exit(1);
});
