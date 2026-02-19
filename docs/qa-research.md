# QA Research Baseline

This document translates external standards into practical acceptance criteria for **GrantHunter**.

## Research Sources

- [WCAG 2.2 (W3C)](https://www.w3.org/TR/WCAG22/)
- [GOV.UK Service Standard](https://www.gov.uk/service-manual/service-standard)
- [Accessibility requirements for public sector websites and apps (GOV.UK)](https://www.gov.uk/guidance/accessibility-requirements-for-public-sector-websites-and-apps)
- [Guide to PECR: Direct marketing by electronic mail (ICO)](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/direct-marketing-by-electronic-mail/)
- [Core Web Vitals (web.dev)](https://web.dev/articles/vitals)
- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## User Requirement Categories

1. Discoverability
- Users can quickly find relevant opportunities by keyword, source, status, type, and deadline urgency.

2. Relevance
- Users can input profile details and get transparent fit scoring with reasons.

3. Trust
- Every item links to source pages and highlights uncertainty (e.g., unknown deadlines).

4. Accessibility
- Core interactions are keyboard-operable and status updates are announced to assistive tech.

5. Privacy and consent
- Email subscription flow must support consent-driven opt-in and avoid hidden marketing assumptions.

6. Reliability
- Daily pipeline should detect malformed data before publishing.

7. Performance
- Frontend should keep interaction responsive with realistic list sizes.

## Acceptance Criteria (Mapped)

1. Accessibility
- Results summary uses an `aria-live` region.
- Form controls are labeled and keyboard accessible.

2. Filtering and user control
- Supports sorting by fit/deadline/source/title.
- Supports min-fit threshold and quick toggles: open-only, closing-soon.
- Reset action returns to default state.

3. Persistence and shareability
- Filter/profile state is saved locally.
- URL query parameters preserve state for sharing.

4. Data integrity
- `docs/data/funding.latest.json` passes schema/contract checks.
- Duplicate IDs fail validation.

5. Automated quality gate
- Unit tests and dataset validation run on each push/PR.

## Test Strategy

1. Unit tests (`tests/matching.test.mjs`)
- Scoring behavior for matches and mismatches.
- Filter logic correctness.
- Ranking and sorting behavior.

2. Contract tests (`tests/validate-data.test.mjs`)
- Valid dataset passes.
- Missing fields and duplicate IDs are flagged.

3. CI checks (`.github/workflows/quality-check.yml`)
- Runs `npm run test` and `npm run validate:data`.

4. Production pipeline guard (`.github/workflows/daily-refresh.yml`)
- Generates data, validates contract, then sends digest and commits.

## Known Gaps / Next Hardening Steps

1. Add Lighthouse CI budget checks for performance/accessibility regression.
2. Add synthetic monitoring for source availability and alerting.
3. Add anti-regression tests for digest email provider errors and retries.
4. Add end-to-end browser tests for keyboard-only flows.
