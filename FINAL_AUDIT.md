# UnderwriteAI V2 — Final Audit

## Fixed issues

1. Cash-required parser incorrectly captured only the first amount in `Cash required estimate: $80,000 down payment plus $12,000 costs.`. Fixed to calculate $92,000.
2. Income parser could match `Stated annual base salary` as payroll `Annual base salary`. Fixed source priority to use paystub/employment evidence for supported income.
3. Uploaded packages and built-in demo cases were separate paths. The upload path now uses the same deterministic calculation engine; the built-in cases remain explicit regression fixtures.
4. Added per-file, combined-upload, ZIP-entry-count and extracted-text safeguards.
5. Added JSON report export alongside Markdown.
6. Added reset behavior for the file picker when starting a new review.
7. Clarified that evidence/policy percentages are review signals, not official eligibility scores.
8. Updated Next.js dependency from 15.5.4 to the current 15.5 maintenance/security patch line and configured Vercel for Node 24.x.

## Regression results

| Case | Income | Obligations | DTI | Cash required | Verified assets | Gap | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| Missing evidence | $10,000 | $3,300 | 33.0% | $92,000 | $75,000 | $17,000 | CONDITIONAL REVIEW |
| Corrected | $10,000 | $3,300 | 33.0% | $92,000 | $95,000 | $0 | READY FOR HUMAN REVIEW |
| High DTI | $10,000 | $4,700 | 47.0% | $92,000 | $95,000 | $0 | ESCALATE FOR HUMAN REVIEW |

### Required findings observed

- Missing evidence: INC-001, INC-002, AST-001, AST-003
- Corrected: AST-002
- High DTI: DTI-001

Additional informational appraisal-comparison finding LTV-002 is intentionally present in all packages.

## Verification performed

- Core TypeScript underwriting module compiled successfully with TypeScript 5.8.3.
- All three supplied ZIP fixtures were extracted and run through the deterministic analysis engine.
- All documented calculation/status targets passed.
- Full `npm install`/Next.js production build could not be completed in this isolated audit environment because dependency installation timed out due unavailable/slow external package access. This is an environment limitation, not a reported application build failure.

## Remaining improvements before production use

- Authentication and authorization
- Encrypted/controlled document storage
- PII redaction and retention controls
- Audit trail
- Real policy version management and citation enforcement
- Complete FNMA eligibility/matrix implementation
- Document date/expiration validation
- Credit-score selection logic
- Reserve calculation
- OCR for scanned documents
- Human review workflow and case persistence
- Automated unit/integration tests in CI
- Full dependency install + Vercel preview deployment test
