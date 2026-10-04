// Regression expectations for the supplied synthetic FNMA fixtures.
// Run the same three packages through the deployed UI/API and verify these targets.
export const regressionCases = {
  missing: { monthlyIncome: 10000, obligations: 3300, dti: 0.33, cashRequired: 92000, verifiedAssets: 75000, assetGap: 17000, status: 'CONDITIONAL REVIEW', requiredFindings: ['INC-001','INC-002','AST-001','AST-003'] },
  corrected: { monthlyIncome: 10000, obligations: 3300, dti: 0.33, cashRequired: 92000, verifiedAssets: 95000, assetGap: 0, status: 'READY FOR HUMAN REVIEW', requiredFindings: ['AST-002'] },
  high: { monthlyIncome: 10000, obligations: 4700, dti: 0.47, cashRequired: 92000, verifiedAssets: 95000, assetGap: 0, status: 'ESCALATE FOR HUMAN REVIEW', requiredFindings: ['DTI-001'] }
};
