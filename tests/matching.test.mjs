import test from "node:test";
import assert from "node:assert/strict";

import { daysLeft, matchesFilters, rankItems, scoreItem } from "../docs/assets/matching.js";

const NOW = Date.parse("2026-02-19T12:00:00Z");

function makeItem(overrides = {}) {
  return {
    id: "id-1",
    title: "AI Research Fellowship",
    description: "Funding for postdoctoral AI and data science projects.",
    url: "https://example.org/opportunity",
    sourceId: "source-a",
    sourceName: "Source A",
    type: "fellowship",
    status: "open",
    deadline: "2026-03-01",
    eligibility: {
      levels: ["postdoc"],
      careerStages: ["early"],
      nationalities: ["international"],
      disciplines: ["computer science and ai"]
    },
    summary: {
      en: "Suitable for early-career postdoctoral AI researchers.",
      fit: ["Postdoc in AI"],
      watchOut: ["Check host institution requirements"]
    },
    ...overrides
  };
}

test("daysLeft returns null for missing date", () => {
  assert.equal(daysLeft(null, NOW), null);
});

test("daysLeft calculates deterministic remaining days", () => {
  assert.equal(daysLeft("2026-02-20", NOW), 2);
});

test("scoreItem rewards matching profile", () => {
  const item = makeItem();
  const profile = {
    level: "postdoc",
    careerStage: "early",
    nationality: "international",
    discipline: "ai"
  };

  const result = scoreItem(item, profile, NOW);
  assert.ok(result.score >= 80, `expected high score, got ${result.score}`);
});

test("scoreItem penalizes hard mismatch", () => {
  const item = makeItem({
    status: "closed",
    deadline: "2026-01-01",
    eligibility: {
      levels: ["masters"],
      careerStages: ["senior"],
      nationalities: ["uk"],
      disciplines: ["humanities"]
    }
  });
  const profile = {
    level: "postdoc",
    careerStage: "early",
    nationality: "international",
    discipline: "ai"
  };

  const result = scoreItem(item, profile, NOW);
  assert.ok(result.score <= 35, `expected low score, got ${result.score}`);
});

test("matchesFilters applies keyword/type/status/source", () => {
  const item = makeItem({ sourceId: "abc", type: "grant", status: "open" });
  const filters = {
    keyword: "ai",
    type: "grant",
    status: "open",
    source: "abc"
  };
  assert.equal(matchesFilters(item, filters), true);

  assert.equal(matchesFilters(item, { ...filters, keyword: "history" }), false);
  assert.equal(matchesFilters(item, { ...filters, type: "award" }), false);
  assert.equal(matchesFilters(item, { ...filters, status: "closed" }), false);
  assert.equal(matchesFilters(item, { ...filters, source: "other" }), false);
});

test("rankItems sorts by match score by default", () => {
  const strong = makeItem({ id: "strong" });
  const weak = makeItem({
    id: "weak",
    status: "closed",
    deadline: "2026-01-01",
    eligibility: {
      levels: ["undergraduate"],
      careerStages: ["senior"],
      nationalities: ["uk"],
      disciplines: ["humanities"]
    }
  });

  const filters = {
    keyword: "",
    type: "",
    status: "",
    source: "",
    sortBy: "match_desc",
    minMatch: 0,
    openOnly: false,
    closingSoonOnly: false
  };
  const profile = {
    level: "postdoc",
    careerStage: "early",
    nationality: "international",
    discipline: "ai"
  };

  const ranked = rankItems([weak, strong], filters, profile, NOW);
  assert.equal(ranked[0].id, "strong");
  assert.equal(ranked[1].id, "weak");
});

test("rankItems supports open-only and min-match filters", () => {
  const open = makeItem({ id: "open", status: "open" });
  const closed = makeItem({ id: "closed", status: "closed" });

  const profile = {
    level: "postdoc",
    careerStage: "early",
    nationality: "international",
    discipline: "ai"
  };

  const filtered = rankItems(
    [open, closed],
    {
      keyword: "",
      type: "",
      status: "",
      source: "",
      sortBy: "match_desc",
      minMatch: 60,
      openOnly: true,
      closingSoonOnly: false
    },
    profile,
    NOW
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "open");
});
