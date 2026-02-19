import test from "node:test";
import assert from "node:assert/strict";

import { validateDataset } from "../scripts/validate-data.mjs";

function makeDataset(overrides = {}) {
  return {
    generatedAt: "2026-02-19T12:00:00Z",
    stats: { total: 1 },
    sources: [{ id: "src", name: "Source", category: "test", homepage: "https://example.org" }],
    items: [
      {
        id: "id-1",
        title: "Funding Opportunity",
        url: "https://example.org/opportunity",
        sourceId: "src",
        sourceName: "Source",
        type: "grant",
        status: "open",
        deadline: "2026-03-01",
        summary: { en: "Good for early-career applicants" },
        eligibility: {
          levels: ["postdoc"],
          careerStages: ["early"],
          nationalities: ["international"],
          disciplines: ["computer science and ai"]
        }
      }
    ],
    ...overrides
  };
}

test("validateDataset returns no errors for valid payload", () => {
  const result = validateDataset(makeDataset());
  assert.equal(result.errors.length, 0);
});

test("validateDataset catches missing required fields", () => {
  const bad = makeDataset({
    items: [
      {
        id: "",
        title: "",
        url: "not-a-url",
        sourceId: "",
        sourceName: "",
        status: "broken",
        type: "grant"
      }
    ]
  });

  const result = validateDataset(bad);
  assert.ok(result.errors.length >= 5, `expected many errors, got ${result.errors.length}`);
});

test("validateDataset catches duplicate item ids", () => {
  const row = makeDataset().items[0];
  const dup = makeDataset({
    stats: { total: 2 },
    items: [row, { ...row }]
  });

  const result = validateDataset(dup);
  assert.ok(result.errors.some((entry) => entry.message.includes("duplicated")));
});
