# Regression checklist

The three supplied synthetic borrower packages are the canonical demo fixtures.

| Case | Income | Obligations | DTI | Cash required | Verified assets | Expected status |
|---|---:|---:|---:|---:|---:|---|
| Missing evidence | $10,000 | $3,300 | 33% | $92,000 | $75,000 | CONDITIONAL REVIEW |
| Corrected | $10,000 | $3,300 | 33% | $92,000 | $95,000 | READY FOR HUMAN REVIEW |
| High DTI | $10,000 | $4,700 | 47% | $92,000 | $95,000 | ESCALATE FOR HUMAN REVIEW |

Required findings:
- Missing: INC-001, INC-002, AST-001, AST-003
- Corrected: AST-002
- High DTI: DTI-001

These are project test targets, not a complete statement of FNMA eligibility.
