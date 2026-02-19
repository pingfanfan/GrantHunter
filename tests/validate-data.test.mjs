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
        urlCheck: {
          status: "reachable",
          originalUrl: "https://example.org/opportunity",
          finalUrl: "https://example.org/opportunity",
          httpStatus: 200,
          allowedHost: true,
          redirected: false,
          checkedAt: "2026-02-19T12:00:00Z"
        },
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

test("validateDataset strict URL mode fails unverified links", () => {
  const row = {
    ...makeDataset().items[0],
    urlCheck: {
      status: "network_error",
      originalUrl: "https://example.org/opportunity",
      finalUrl: null,
      allowedHost: true
    }
  };

  const result = validateDataset(makeDataset({ items: [row] }), { strictUrls: true });
  assert.ok(result.errors.some((entry) => entry.message.includes("urlCheck.status")));
});

test("validateDataset fails generic non-specific titles", () => {
  const row = {
    ...makeDataset().items[0],
    title: "Apply for and manage your funding",
    url: "https://example.org/for-researchers/apply-for-and-manage-your-funding"
  };

  const result = validateDataset(makeDataset({ items: [row] }));
  assert.ok(result.errors.some((entry) => entry.message.includes("generic and not a specific grant")));
  assert.ok(result.errors.some((entry) => entry.message.includes("generic apply/manage page")));
});

test("validateDataset fails funding-journey style guidance pages", () => {
  const row = {
    ...makeDataset().items[0],
    title: "Starting a funding journey",
    url: "https://example.org/research-funding/starting-a-funding-journey"
  };

  const result = validateDataset(makeDataset({ items: [row] }));
  assert.ok(result.errors.some((entry) => entry.message.includes("generic and not a specific grant")));
  assert.ok(result.errors.some((entry) => entry.message.includes("generic apply/manage page")));
});
