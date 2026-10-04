# UnderwriteAI V2 — Mortgage Underwriting Workbench

Vercel-native rebuild of the original Streamlit mortgage underwriting prototype, with deterministic underwriting calculations and evidence-first review.

## What changed
- Modern responsive underwriting dashboard
- Structured findings instead of raw agent Markdown
- Deterministic income, DTI, LTV and asset calculations
- ZIP/TXT/PDF/DOCX ingestion
- Missing-evidence / corrected / high-DTI regression scenarios
- Evidence inventory and traceability
- Policy review boundary and human-in-the-loop safeguards
- Markdown report export
- No API key required for deterministic test mode
- No FAISS or unstable Python `hash()` dependency in the Vercel runtime

## Deploy
1. Upload this folder to a GitHub repository.
2. Import the repository into Vercel.
3. Framework: Next.js. Root: repository root.
4. No environment variables are required for the built-in regression tests.
5. Use Node.js 24.x on Vercel. Next.js 15.5.27 is pinned to the current Maintenance LTS security patch line.
6. Optional `GROQ_API_KEY` can be added later when an AI explanation layer is wired in.

Vercel supports Next.js and Python/FastAPI deployments, but this version uses a single Next.js runtime to keep the demo simpler and avoid a second service. The project-scoped synthetic FNMA fixture is not a complete lender eligibility engine.

## Test plan
- Missing Evidence: should show income conflict, missing W-2 and unsourced $20k deposit.
- Corrected File: should show matched $20k own-account transfer and no double-counting.
- High DTI: should calculate 47.0% and escalate for human review.
- Upload each supplied ZIP to test server-side parsing.

## Safety
Decision-support prototype only. It does not approve or deny a mortgage. Do not use real borrower data until authentication, authorization, secure storage, retention, audit logging, PII controls, source licensing and a full compliance/security review are implemented.

## Final audit notes

- Fixed cash-required parsing for fixtures that express `$80,000 down payment plus $12,000 costs` (now $92,000).
- Fixed income-source priority so `Stated annual base salary` cannot be mistaken for payroll `Annual base salary`.
- Added upload size, extracted-text, entry-count and file-type safeguards.
- Added JSON export in addition to Markdown.
- Added regression expectations for all three supplied synthetic cases.
- Demo mode remains deterministic and does not require an API key.
- Production hardening still requires authentication, authorization, secure storage, retention policy, audit logging and full compliance/security review.

## Advanced engine (v2.1)

- `lib/engine.ts`: deterministic rules engine ported from a verified Python
  engine — front- and back-end DTI, middle-of-three credit-score selection,
  unsourced-deposit exclusion, cash-required vs verified-assets gap, reserves
  in months, and 16 audited rules. Every function is total: bad input can
  never throw.
- `npm test`: 47 vitest cases covering calculation math, the three fixture
  scenarios end-to-end, edge cases (zero/negative/missing income, malformed
  input), and report generation.
- UI additions: scenario **Compare** tab, per-finding **audit-trail**
  expander (rule inputs + evidence), editable **assumptions panel** with
  sanitized inputs, and JSON + Markdown export.
