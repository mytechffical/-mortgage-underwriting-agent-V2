/**
 * UnderwriteAI V2 — public analysis API.
 *
 * Document text extraction (deterministic regexes, ported from the verified
 * Python extractor) feeds the pure rules engine in ./engine. Nothing here
 * throws on bad input: every numeric parse goes through safeMoney.
 */
import {
  backEndDti, computeMetrics, evaluate, EngineResult,
  loanToValue, safeMoney,
} from './engine';
import type { BorrowerProfile } from './engine';

export { safeMoney } from './engine';
export type { BorrowerProfile } from './engine';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Finding = {
  id: string; category: string; severity: Severity; title: string;
  detail: string; action: string; evidence: string[];
  /** exact rule inputs — powers the audit-trail expander */
  auditInputs?: Record<string, unknown>;
};
export type Doc = { name: string; text: string; kind: string; size?: number };
export type CaseResult = {
  status: 'READY FOR HUMAN REVIEW' | 'CONDITIONAL REVIEW' | 'ESCALATE FOR HUMAN REVIEW' | 'INSUFFICIENT EVIDENCE';
  metrics: {
    income: number; obligations: number; housing: number;
    dti: number | null; frontEndDti: number | null; backEndDti: number | null;
    loan: number; purchase: number; appraisal: number;
    ltvPurchase: number | null; ltvAppraisal: number | null;
    creditScore: number | null; reservesMonths: number | null; downPayment: number | null;
    cashRequired: number; verifiedAssets: number; assetGap: number;
  };
  borrower: string; property: string; program: string;
  findings: Finding[];
  documents: { name: string; kind: string; status: string }[];
  evidenceScore: number; policyScore: number;
  summary: string; nextSteps: string[]; sources: string[];
  /** structured facts behind this result — drives the assumptions editor */
  profile: BorrowerProfile;
  /** true for built-in synthetic fixtures (no uploaded documents) */
  synthetic?: boolean;
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function classify(name: string, text: string) {
  const n = name.toLowerCase(), t = text.toLowerCase();
  if (n.includes('application')) return 'Application';
  if (n.includes('paystub')) return 'Income';
  if (n.includes('employment')) return 'Employment';
  if (n.includes('w2')) return 'Tax';
  if (n.includes('checking') || n.includes('savings')) return 'Assets';
  if (n.includes('credit')) return 'Credit';
  if (n.includes('appraisal')) return 'Property';
  if (n.includes('purchase')) return 'Contract';
  if (n.includes('housing') || n.includes('cost')) return 'Housing';
  if (t.includes('paystub')) return 'Income';
  return 'Other';
}

// ---------------------------------------------------------------------------
// Deterministic extraction (ports extraction.py)
// ---------------------------------------------------------------------------

function docKind(filename: string, text: string): string {
  const name = filename.toLowerCase();
  const decl = (text.match(/^Document:\s*(.+)$/im)?.[1] || '').toLowerCase();
  const has = (...phrases: string[]) => phrases.some(p => decl.includes(p) || name.includes(p));
  if (has('loan application summary', '01_application')) return 'application';
  if (has('paystub')) return 'paystub';
  if (has('w-2 summary', 'w2_')) return 'w2';
  if (has('employer letter', 'employment_letter')) return 'employment_letter';
  if (has('employment-reverification', 'reverification')) return 'reverification';
  if (has('three-bureau', 'credit_report')) return 'credit_report';
  if (has('bank statement', 'checking')) return 'bank_statement';
  if (has('savings statements', 'savings')) return 'savings_statement';
  if (has('housing worksheet', 'housing_and_cost')) return 'housing_worksheet';
  if (has('purchase contract', 'purchase_contract')) return 'purchase_contract';
  if (has('appraisal summary', 'appraisal')) return 'appraisal';
  if (has('borrower correction', 'correction')) return 'correction';
  if (has('borrower explanation', 'deposit_explanation')) return 'deposit_explanation';
  return 'other';
}

function moneyAfter(text: string, pattern: RegExp): number | null {
  const m = text.match(pattern);
  return m ? safeMoney(m[1]) : null;
}

function creditScores(text: string): number[] {
  const m = text.match(/Equifax\s*(\d{3})\D{0,20}?Experian\s*(\d{3})\D{0,20}?TransUnion\s*(\d{3})/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [];
}

export function extractProfile(docs: Doc[]): BorrowerProfile {
  const p: BorrowerProfile = { sources: {} };
  const grab = (field: keyof BorrowerProfile, value: number | null, filename: string) => {
    if (value !== null && (p[field] as unknown) === undefined) {
      (p as Record<string, unknown>)[field] = value;
      p.sources![field as string] = filename;
    }
  };

  for (const doc of docs) {
    const text = doc.text || '';
    const kind = docKind(doc.name, text);
    const g = (f: keyof BorrowerProfile, v: number | null) => grab(f, v, doc.name);

    if (kind === 'application') {
      p.hasApplication = true;
      const name = text.match(/Borrower:\s*([A-Za-z .'-]+)/)?.[1];
      if (name && !p.borrowerName) { p.borrowerName = name.trim().replace(/\.$/, ''); p.sources!.borrowerName = doc.name; }
      const prog = text.match(/Program:\s*([A-Z0-9_]+)/)?.[1];
      if (prog && !p.loanProgram) { p.loanProgram = prog.trim(); p.sources!.loanProgram = doc.name; }
      g('statedAnnualSalary', moneyAfter(text, /Stated annual base salary:\s*(\$[\d,]+)/i));
      g('housingPayment', moneyAfter(text, /Proposed monthly housing payment:\s*(\$[\d,]+)/i));
      g('autoPayment', moneyAfter(text, /Auto payment:\s*(\$[\d,]+)/i));
      g('creditCardPayment', moneyAfter(text, /Credit card payment:\s*(\$[\d,]+)/i));
      g('studentPayment', moneyAfter(text, /Student payment:\s*(\$[\d,]+)/i));
      g('otherMonthlyDebt', moneyAfter(text, /Other monthly debt:\s*(\$[\d,]+)/i));
      g('purchasePrice', moneyAfter(text, /Purchase price:\s*(\$[\d,]+)/i));
      g('loanAmount', moneyAfter(text, /Loan amount:\s*(\$[\d,]+)/i));
      g('downPayment', moneyAfter(text, /Down payment:\s*(\$[\d,]+)/i));
      g('estimatedClosingCosts', moneyAfter(text, /Estimated closing costs:\s*(\$[\d,]+)/i));
      g('checkingBalance', moneyAfter(text, /Checking account balance:\s*(\$[\d,]+)/i));
      g('savingsBalance', moneyAfter(text, /Savings ending balance:\s*(\$[\d,]+)/i));
      const dep = moneyAfter(text, /\$([\d,]+)\s+deposit/i);
      if (dep !== null && p.largeDepositAmount === undefined) { p.largeDepositAmount = dep; p.sources!.largeDepositAmount = doc.name; }
    } else if (kind === 'paystub') {
      p.hasPaystubs = true;
      g('payrollAnnualSalary', moneyAfter(text, /Annual base salary:\s*(\$[\d,]+)/i));
    } else if (kind === 'employment_letter') {
      p.hasEmploymentLetter = true;
      g('payrollAnnualSalary', moneyAfter(text, /Current annual base salary:\s*(\$[\d,]+)/i));
    } else if (kind === 'w2') {
      p.hasW2 = true;
      g('w2AnnualWages', moneyAfter(text, /Gross wage income[^:]*:\s*(\$[\d,]+)/i));
    } else if (kind === 'reverification') {
      p.hasEmploymentReverification = true;
    } else if (kind === 'credit_report') {
      p.hasCreditReport = true;
      const s = creditScores(text);
      if (s.length && !p.creditScores) { p.creditScores = s; p.sources!.creditScores = doc.name; }
      g('autoPayment', moneyAfter(text, /Auto installment loan:\s*required monthly payment\s*(\$[\d,]+)/i));
      g('creditCardPayment', moneyAfter(text, /required minimum monthly payment\s*(\$[\d,]+)/i));
    } else if (kind === 'bank_statement') {
      p.hasBankStatements = true;
      g('checkingBalance', moneyAfter(text, /Ending balance:\s*(\$[\d,]+)/i));
    } else if (kind === 'savings_statement') {
      const t = text.match(/transfer to .*checking account[^\$]*-\s*(\$[\d,]+)/i);
      if (t) {
        p.hasSavingsTransferEvidence = true;
        p.sources!.savingsTransferEvidence = doc.name;
        if (p.largeDepositAmount === undefined) {
          p.largeDepositAmount = safeMoney(t[1]);
          p.sources!.largeDepositAmount = doc.name;
        }
      }
    } else if (kind === 'housing_worksheet') {
      g('housingPayment', moneyAfter(text, /Total proposed qualifying monthly housing payment:\s*(\$[\d,]+)/i));
      g('loanAmount', moneyAfter(text, /Loan amount:\s*(\$[\d,]+)/i));
      g('estimatedClosingCosts', moneyAfter(text, /Estimated closing costs[^\$]*(\$[\d,]+)/i));
    } else if (kind === 'deposit_explanation') {
      p.hasDepositExplanationOnly = true;
      p.sources!.depositExplanation = doc.name;
      const dep = moneyAfter(text, /\$([\d,]+)\s+deposit/i);
      if (dep !== null && p.largeDepositAmount === undefined) { p.largeDepositAmount = dep; p.sources!.largeDepositAmount = doc.name; }
    }
  }
  return p;
}

// ---------------------------------------------------------------------------
// Engine -> CaseResult mapping
// ---------------------------------------------------------------------------

function pctToFrac(pct: number | null): number | null {
  return pct === null ? null : Math.round(pct) / 100;
}

export function analyzeProfile(
  profile: BorrowerProfile,
  ctx: { docs: Doc[]; borrower: string; property: string; program: string; appraisal: number | null; synthetic?: boolean },
): CaseResult {
  const m = computeMetrics(profile);
  const r: EngineResult = evaluate(profile, m);

  const ltvAppraisalPct = loanToValue(profile.loanAmount, ctx.appraisal);
  const findings: Finding[] = r.findings.map(f => ({
    id: f.id, category: f.category, severity: f.severity,
    title: f.title, detail: f.detail, action: f.action,
    evidence: f.evidence, auditInputs: f.auditInputs,
  }));

  // v3-only informational findings (kept from the original UI)
  if (profile.hasSavingsTransferEvidence) {
    findings.push({
      id: 'AST-002', category: 'Assets', severity: 'info',
      title: '$20,000 transfer is matched to the borrower savings account',
      detail: 'The checking and savings records describe the same transfer. The historical transfer is not double-counted.',
      action: 'Retain the matching statements in the file.',
      evidence: (profile.sources && [profile.sources.savingsTransferEvidence, profile.sources.checkingBalance].filter(Boolean)) as string[],
      auditInputs: { matchedTransfer: true },
    });
  }
  if (ctx.appraisal && profile.loanAmount && ltvAppraisalPct !== null) {
    findings.push({
      id: 'LTV-002', category: 'Collateral', severity: 'info',
      title: 'Appraisal comparison calculated',
      detail: `Loan-to-appraisal value is ${ltvAppraisalPct.toFixed(1)}%; purchase-price LTV is ${m.ltv !== null ? m.ltv.toFixed(1) : 'n/a'}%.`,
      action: 'Confirm final collateral and eligibility requirements with the human reviewer.',
      evidence: [], auditInputs: { ltvAppraisalPct, ltvPurchasePct: m.ltv },
    });
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.id < b.id ? -1 : 1));

  const critical = findings.filter(f => f.severity === 'critical').length;
  const high = findings.filter(f => f.severity === 'high').length;
  const medium = findings.filter(f => f.severity === 'medium').length;
  const status: CaseResult['status'] =
    !ctx.docs.length && !ctx.synthetic ? 'INSUFFICIENT EVIDENCE'
    : r.decision === 'ESCALATE' ? 'ESCALATE FOR HUMAN REVIEW'
    : r.decision === 'CONDITIONAL' ? 'CONDITIONAL REVIEW'
    : 'READY FOR HUMAN REVIEW';

  const evidenceScore = Math.max(0, Math.min(100, 100 - high * 18 - medium * 8));
  const policyScore = Math.max(55, Math.min(100, 100 - critical * 15 - high * 7));
  const summary =
    status === 'ESCALATE FOR HUMAN REVIEW'
      ? `The file requires human escalation because the calculated DTI is ${m.backEndDti !== null ? m.backEndDti.toFixed(1) : 'n/a'}%.`
      : status === 'CONDITIONAL REVIEW'
        ? `The file is conditionally reviewable but has ${high} high-severity evidence issue${high === 1 ? '' : 's'}.`
        : status === 'INSUFFICIENT EVIDENCE'
          ? 'No documents were supplied for analysis.'
          : 'The available synthetic evidence is internally consistent for this test case; human review is still required.';
  const nextSteps = findings.filter(f => f.severity !== 'info').slice(0, 5).map(f => f.action);
  if (!nextSteps.length) nextSteps.push('Complete the remaining human underwriting and collateral checks.');

  return {
    status,
    metrics: {
      income: m.monthlyIncome ?? 0,
      obligations: m.totalMonthlyObligations ?? 0,
      housing: m.housingPayment ?? 0,
      dti: pctToFrac(m.backEndDti),
      frontEndDti: pctToFrac(m.frontEndDti),
      backEndDti: pctToFrac(m.backEndDti),
      loan: profile.loanAmount ?? 0,
      purchase: profile.purchasePrice ?? 0,
      appraisal: ctx.appraisal ?? 0,
      ltvPurchase: m.ltv === null ? null : m.ltv / 100,
      ltvAppraisal: ltvAppraisalPct === null ? null : ltvAppraisalPct / 100,
      creditScore: m.creditScore,
      reservesMonths: m.reservesMonths,
      downPayment: m.downPayment,
      cashRequired: m.cashNeeded ?? 0,
      verifiedAssets: m.verifiedCash ?? 0,
      assetGap: Math.max(0, m.cashGap ?? 0),
    },
    borrower: ctx.borrower, property: ctx.property, program: ctx.program,
    findings,
    documents: ctx.docs.map(d => ({ name: d.name, kind: classify(d.name, d.text), status: 'Parsed' })),
    evidenceScore, policyScore, summary, nextSteps,
    sources: ['Project-scoped FNMA MVP test guide', 'Synthetic borrower evidence package'],
    profile,
  };
}

export function analyze(docs: Doc[], manual?: { loan?: number; purchase?: number; housing?: number }): CaseResult {
  const profile = extractProfile(docs);
  if (manual?.loan) profile.loanAmount = manual.loan;
  if (manual?.purchase) profile.purchasePrice = manual.purchase;
  if (manual?.housing) profile.housingPayment = manual.housing;
  const all = docs.map(d => d.text).join('\n\n');
  const appraisal = safeMoney(all.match(/Appraised value:\s*\$([\d,]+)/i)?.[1] ?? null);
  return analyzeProfile(profile, {
    docs,
    borrower: all.match(/Borrower:\s*([^\.\n]+)/i)?.[1]?.trim() || 'Synthetic borrower',
    property: all.match(/Test property:\s*([^\.\n]+)/i)?.[1]?.trim() || 'Synthetic property',
    program: all.match(/Program:\s*([^\.\n]+)/i)?.[1]?.trim() || 'FNMA manual MVP',
    appraisal,
  });
}

/** Synthetic fixture profiles — mirror the three regression fixtures exactly. */
export function demoCaseResult(s: 'missing' | 'corrected' | 'high'): CaseResult {
  const base: BorrowerProfile = {
    borrowerName: 'Maya Sample', loanProgram: 'FNMA_MANUAL_FIXED_PURCHASE_1UNIT_PRIMARY_MVP',
    statedAnnualSalary: s === 'missing' ? 132000 : 120000,
    payrollAnnualSalary: 120000,
    w2AnnualWages: s === 'missing' ? null : 120000,
    housingPayment: 2800,
    autoPayment: s === 'high' ? 1800 : 400,
    creditCardPayment: 100,
    purchasePrice: 400000, loanAmount: 320000,
    estimatedClosingCosts: 12000,
    checkingBalance: 95000,
    largeDepositAmount: 20000,
    creditScores: [748, 760, 772],
    hasApplication: true, hasPaystubs: true, hasEmploymentLetter: true,
    hasW2: s !== 'missing', hasCreditReport: true, hasBankStatements: true,
    hasSavingsTransferEvidence: s === 'corrected',
    sources: {
      statedAnnualSalary: '01_application.txt', payrollAnnualSalary: '02_paystub.txt',
      housingPayment: '10_housing_and_cost_worksheet.txt', loanAmount: '01_application.txt',
      purchasePrice: '01_application.txt', checkingBalance: '05_checking_august.txt',
      creditScores: '07_credit_report_summary.txt',
    },
  };
  const result = analyzeProfile(base, {
    docs: [],
    borrower: 'Maya Sample', property: 'TEST-HOUSE-001',
    program: 'FNMA_MANUAL_FIXED_PURCHASE_1UNIT_PRIMARY_MVP',
    appraisal: 410000,
    synthetic: true,
  });
  result.synthetic = true;
  return result;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function markdownReport(r: CaseResult) {
  const m = r.metrics;
  const pct = (v: number | null) => (v === null ? 'N/A' : (v * 100).toFixed(1) + '%');
  return `# UnderwriteAI V2 — Underwriting Review

**Status:** ${r.status}

${r.summary}

## Metrics
- Monthly supported income: ${money(m.income)}
- Monthly obligations: ${money(m.obligations)}
- Back-end DTI: ${pct(m.backEndDti)}
- Front-end DTI (housing ratio): ${pct(m.frontEndDti)}
- Representative credit score: ${m.creditScore ?? 'N/A'}
- Loan amount: ${money(m.loan)}
- Purchase price: ${money(m.purchase)}
- Appraised value: ${money(m.appraisal)}
- Purchase LTV: ${pct(m.ltvPurchase)}
- Appraisal LTV: ${pct(m.ltvAppraisal)}
- Down payment: ${m.downPayment === null ? 'N/A' : money(m.downPayment)}
- Estimated cash required: ${money(m.cashRequired)}
- Verified assets: ${money(m.verifiedAssets)}
- Reserves after closing: ${m.reservesMonths === null ? 'N/A' : m.reservesMonths.toFixed(1) + ' months'}

## Findings
${r.findings.length ? r.findings.map(f => `### ${f.id} — ${f.title}
**${f.severity.toUpperCase()} / ${f.category}**

${f.detail}

**Action:** ${f.action}

**Evidence:** ${f.evidence.join(', ') || 'Not specified'}
${f.auditInputs && Object.keys(f.auditInputs).length ? `**Audit inputs:** ${Object.entries(f.auditInputs).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}` : ''}`).join('\n\n') : 'No findings were generated.'}

## Next steps
${r.nextSteps.map(x => `- ${x}`).join('\n')}

> Decision-support prototype only. This report does not approve or deny a mortgage.
`;
}

export function jsonReport(r: CaseResult): string {
  return JSON.stringify({
    generatedUtc: new Date().toISOString(),
    status: r.status,
    borrower: r.borrower, property: r.property, program: r.program,
    summary: r.summary,
    metrics: r.metrics,
    findings: r.findings,
    nextSteps: r.nextSteps,
    sources: r.sources,
    disclaimer: 'Decision support only; not a loan approval or denial. Human underwriter review required.',
  }, null, 2);
}
