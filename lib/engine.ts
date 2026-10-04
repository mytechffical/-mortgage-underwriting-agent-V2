/**
 * Deterministic underwriting engine — TypeScript port of the verified
 * Python engine (Streamlit v2: src/calculations.py + src/rules.py + src/models.py).
 *
 * Every function is pure and total: it never throws on bad input.
 * Gaps become `null` metrics and explanatory notes instead of exceptions.
 *
 * Rule-ID mapping (Python R-xx -> this engine's v3 vocabulary):
 *   R-INC-01 -> INC-001 (high)      R-INC-02 -> INC-002 (medium)
 *   R-INC-03 -> INC-003 (high)      R-EMP-01 -> EMP-001 (medium)
 *   R-DTI-01 -> DTI-001 (critical)  R-DTI-02 -> DTI-002 (medium)
 *   R-DTI-03 -> DTI-003 (medium)    R-CR-01  -> CR-001  (high)
 *   R-CR-02  -> CR-002  (high)      R-LTV-01 -> LTV-001 (medium)
 *   R-LTV-02 -> LTV-003 (medium)    R-DEP-01 -> AST-001 (high)
 *   R-CASH-01-> AST-003 (high)      R-CASH-02-> AST-004 (medium)
 */

// ---------------------------------------------------------------------------
// Sanitization (mirrors parsing.safe_money)
// ---------------------------------------------------------------------------

const MONEY_RE = /-?\$?\s*[\d,]+(?:\.\d{1,2})?/;

export function safeMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value).trim();
  if (!text || ['n/a', 'na', 'none', 'null', '-', '--'].includes(text.toLowerCase())) return null;
  const negative = text.startsWith('(') && text.endsWith(')');
  const match = MONEY_RE.exec(text);
  if (!match) return null;
  const num = Number(match[0].replace(/\$/g, '').replace(/,/g, '').trim());
  if (!Number.isFinite(num)) return null;
  return negative ? -num : num;
}

function num(value: unknown): number | null {
  return safeMoney(value);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Benchmarks (manual-underwriting)
// ---------------------------------------------------------------------------

export const DTI_BACK_END_MAX = 45.0;
export const DTI_BACK_END_WATCH = 43.0;
export const DTI_FRONT_END_WATCH = 28.0;
export const CREDIT_SCORE_MIN = 620;
export const RESERVES_MONTHS_MIN = 2.0;
const SALARY_TOLERANCE = 1.0;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export type EngineSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type EngineDecision = 'ESCALATE' | 'CONDITIONAL' | 'READY';

export interface BorrowerProfile {
  borrowerName?: string | null;
  loanProgram?: string | null;
  statedAnnualSalary?: number | null;
  payrollAnnualSalary?: number | null;
  w2AnnualWages?: number | null;
  housingPayment?: number | null;
  autoPayment?: number | null;
  creditCardPayment?: number | null;
  studentPayment?: number | null;
  otherMonthlyDebt?: number | null;
  purchasePrice?: number | null;
  loanAmount?: number | null;
  downPayment?: number | null;
  estimatedClosingCosts?: number | null;
  checkingBalance?: number | null;
  savingsBalance?: number | null;
  largeDepositAmount?: number | null;
  creditScores?: number[];
  hasApplication?: boolean;
  hasPaystubs?: boolean;
  hasEmploymentLetter?: boolean;
  hasEmploymentReverification?: boolean;
  hasW2?: boolean;
  hasCreditReport?: boolean;
  hasBankStatements?: boolean;
  hasSavingsTransferEvidence?: boolean;
  hasDepositExplanationOnly?: boolean;
  /** field -> source document filename (extraction audit trail) */
  sources?: Record<string, string>;
}

export interface Metrics {
  monthlyIncome: number | null;
  incomeSource: string | null;
  housingPayment: number | null;
  otherMonthlyDebts: number | null;
  totalMonthlyObligations: number | null;
  frontEndDti: number | null; // percent, e.g. 28.0
  backEndDti: number | null; // percent, e.g. 33.0
  ltv: number | null; // percent
  creditScore: number | null;
  downPayment: number | null;
  cashNeeded: number | null;
  verifiedCash: number | null;
  cashGap: number | null; // positive => shortfall
  reservesMonths: number | null;
  notes: string[];
}

export interface EngineFinding {
  id: string;
  severity: EngineSeverity;
  category: string;
  title: string;
  detail: string;
  action: string;
  evidence: string[];
  /** exact rule inputs, for the audit-trail expander */
  auditInputs: Record<string, unknown>;
}

export interface EngineResult {
  decision: EngineDecision;
  metrics: Metrics;
  findings: EngineFinding[];
  strengths: string[];
  conditions: string[];
}

// ---------------------------------------------------------------------------
// Calculations (mirror calculations.py exactly)
// ---------------------------------------------------------------------------

export function monthlyIncomeFromAnnual(annual: unknown): number | null {
  const a = num(annual);
  if (a === null || a <= 0) return null;
  return round2(a / 12);
}

export function frontEndDti(housing: unknown, monthlyIncome: unknown): number | null {
  const h = num(housing);
  const i = num(monthlyIncome);
  if (h === null || i === null || i <= 0) return null;
  return round2((h / i) * 100);
}

export function backEndDti(housing: unknown, otherDebts: unknown, monthlyIncome: unknown): number | null {
  const h = num(housing);
  const d = num(otherDebts);
  const i = num(monthlyIncome);
  if (i === null || i <= 0) return null;
  if (h === null) return null; // housing anchors the ratio; never invent it
  const obligations = h + (d || 0);
  return round2((obligations / i) * 100);
}

export function loanToValue(loanAmount: unknown, propertyValue: unknown): number | null {
  const loan = num(loanAmount);
  const value = num(propertyValue);
  if (loan === null || value === null || value <= 0) return null;
  if (loan < 0) return null;
  return round2((loan / value) * 100);
}

/** Representative score = middle of bureau scores (standard practice). */
export function selectCreditScore(scores: unknown): number | null {
  if (!Array.isArray(scores)) return null;
  const clean = (scores as unknown[])
    .filter((s): s is number => typeof s === 'number' && Number.isInteger(s) && s >= 300 && s <= 850)
    .sort((a, b) => a - b);
  if (!clean.length) return null;
  return clean[Math.floor(clean.length / 2)];
}

export function computeMetrics(p: BorrowerProfile): Metrics {
  const m: Metrics = {
    monthlyIncome: null, incomeSource: null, housingPayment: null,
    otherMonthlyDebts: null, totalMonthlyObligations: null,
    frontEndDti: null, backEndDti: null, ltv: null, creditScore: null,
    downPayment: null, cashNeeded: null, verifiedCash: null,
    cashGap: null, reservesMonths: null, notes: [],
  };
  const notes = m.notes;

  // --- Income: prefer verified evidence, fall back to stated -------------
  let salary: number | null = null;
  let source: string | null = null;
  if (p.w2AnnualWages && p.w2AnnualWages > 0) { salary = p.w2AnnualWages; source = '2025 W-2 wages'; }
  else if (p.payrollAnnualSalary && p.payrollAnnualSalary > 0) { salary = p.payrollAnnualSalary; source = 'payroll / employer letter'; }
  else if (p.statedAnnualSalary && p.statedAnnualSalary > 0) { salary = p.statedAnnualSalary; source = 'stated on application (unverified)'; }
  else notes.push('No usable income figure found in the documents.');

  m.monthlyIncome = monthlyIncomeFromAnnual(salary);
  m.incomeSource = source;
  if (salary !== null && salary <= 0) notes.push(`Income figure is non-positive (${salary}); DTI unavailable.`);

  // --- Obligations -------------------------------------------------------
  const debts = [p.autoPayment, p.creditCardPayment, p.studentPayment, p.otherMonthlyDebt]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .reduce((a, b) => a + b, 0);
  m.housingPayment = num(p.housingPayment);
  m.otherMonthlyDebts = round2(debts);
  if (m.housingPayment !== null && m.otherMonthlyDebts !== null) {
    m.totalMonthlyObligations = round2(m.housingPayment + m.otherMonthlyDebts);
  }
  m.frontEndDti = frontEndDti(m.housingPayment, m.monthlyIncome);
  m.backEndDti = backEndDti(m.housingPayment, m.otherMonthlyDebts, m.monthlyIncome);
  if (m.backEndDti === null && m.monthlyIncome === null) {
    notes.push('DTI unavailable: qualifying monthly income could not be verified.');
  }

  // --- Collateral --------------------------------------------------------
  m.ltv = loanToValue(p.loanAmount, p.purchasePrice);
  if (m.ltv === null) {
    if (p.loanAmount == null || p.purchasePrice == null) notes.push('LTV unavailable: loan amount or purchase price missing.');
    else notes.push('LTV unavailable: invalid loan amount or property value.');
  }

  // --- Credit ------------------------------------------------------------
  m.creditScore = selectCreditScore(p.creditScores);
  if (m.creditScore === null && !p.hasCreditReport) notes.push('No credit report found; credit score unavailable.');

  // --- Cash to close ------------------------------------------------------
  const loan = num(p.loanAmount);
  const price = num(p.purchasePrice);
  const closing = num(p.estimatedClosingCosts) || 0;
  if (loan !== null && price !== null && price > 0 && loan >= 0) {
    m.downPayment = round2(Math.max(price - loan, 0));
    m.cashNeeded = round2(m.downPayment + closing);
  } else {
    notes.push('Cash needed unavailable: loan amount or purchase price missing/invalid (no number is invented).');
  }

  // Verified cash excludes unsourced large deposits.
  const checking = num(p.checkingBalance);
  const unsourced = (!p.hasSavingsTransferEvidence ? num(p.largeDepositAmount) : 0) || 0;
  if (checking !== null) {
    m.verifiedCash = round2(checking - unsourced);
    if (unsourced) notes.push(`$${Math.round(unsourced).toLocaleString('en-US')} large deposit lacks source evidence and is excluded from verified cash.`);
  }
  if (m.cashNeeded !== null && m.verifiedCash !== null) {
    m.cashGap = round2(m.cashNeeded - m.verifiedCash);
    if (m.housingPayment && m.housingPayment > 0) {
      const remaining = m.verifiedCash - m.cashNeeded;
      m.reservesMonths = round2(Math.max(remaining, 0) / m.housingPayment);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Rules engine (mirror rules.py)
// ---------------------------------------------------------------------------

function srcOf(p: BorrowerProfile, ...fields: string[]): string[] {
  const s = p.sources || {};
  return fields.filter(f => s[f]).map(f => s[f] as string);
}

export function evaluate(p: BorrowerProfile, m: Metrics): EngineResult {
  const findings: EngineFinding[] = [];
  const strengths: string[] = [];
  const conditions: string[] = [];

  const add = (id: string, severity: EngineSeverity, category: string, title: string,
               detail: string, action: string, evidence: string[] = [],
               auditInputs: Record<string, unknown> = {}) => {
    findings.push({ id, severity, category, title, detail, action, evidence, auditInputs });
  };

  // --------------------------------------------------------------- income
  let verifiedSalary: number | null = null;
  if (p.w2AnnualWages && p.w2AnnualWages > 0) verifiedSalary = p.w2AnnualWages;
  else if (p.payrollAnnualSalary && p.payrollAnnualSalary > 0) verifiedSalary = p.payrollAnnualSalary;

  if (p.statedAnnualSalary && verifiedSalary &&
      Math.abs(p.statedAnnualSalary - verifiedSalary) > SALARY_TOLERANCE) {
    add('INC-001', 'high', 'Income',
      'Stated income conflicts with verified payroll evidence',
      `Application states $${Math.round(p.statedAnnualSalary).toLocaleString('en-US')} annual salary, but payroll evidence shows $${Math.round(verifiedSalary).toLocaleString('en-US')}. Income must be reconciled before qualifying income can be established.`,
      'Resolve the discrepancy and use the supported income figure for the test calculation.',
      srcOf(p, 'statedAnnualSalary', 'payrollAnnualSalary', 'w2AnnualWages'),
      { stated: p.statedAnnualSalary, verified: verifiedSalary });
    conditions.push('Reconcile the stated-vs-verified income conflict.');
  } else if (verifiedSalary) {
    strengths.push(`Income verified at $${Math.round(verifiedSalary).toLocaleString('en-US')}/yr (${m.incomeSource}).`);
  }

  if (!p.hasW2) {
    add('INC-002', 'medium', 'Income',
      'Latest W-2 (or adequate alternative) not supplied',
      'No 2025 W-2 summary was found in the package. Base salary cannot be fully verified for the most recent tax year.',
      'Obtain the latest W-2 or an adequate permitted alternative before final review.',
      srcOf(p, 'statedAnnualSalary'), { hasW2: false });
    conditions.push('Obtain the latest W-2 or an adequate alternative.');
  } else {
    strengths.push('2025 W-2 supplied and consistent with payroll.');
  }

  if (m.monthlyIncome === null) {
    add('INC-003', 'high', 'Income',
      'No qualifying income could be established',
      'DTI and affordability cannot be calculated without a positive, documented monthly income.',
      'Establish qualifying income with documentation.',
      [], { stated: p.statedAnnualSalary ?? null, payroll: p.payrollAnnualSalary ?? null, w2: p.w2AnnualWages ?? null });
    conditions.push('Establish qualifying income with documentation.');
  }

  // ----------------------------------------------------------- employment
  if (!(p.hasEmploymentLetter || p.hasEmploymentReverification)) {
    add('EMP-001', 'medium', 'Employment',
      'No employment verification document found',
      'Neither an employer letter nor a reverification record was found. Verbal/written VOE is expected before closing.',
      'Complete employment verification.',
      [], { hasLetter: !!p.hasEmploymentLetter, hasReverification: !!p.hasEmploymentReverification });
    conditions.push('Complete employment verification.');
  } else {
    strengths.push('Employment verified (letter and/or reverification).');
  }

  // ------------------------------------------------------------------ DTI
  const dti = m.backEndDti;
  if (dti !== null) {
    if (dti > DTI_BACK_END_MAX) {
      add('DTI-001', 'critical', 'Capacity',
        `Manual-path DTI escalation at ${dti.toFixed(1)}%`,
        `Monthly obligations of $${Math.round(m.totalMonthlyObligations || 0).toLocaleString('en-US')} against supported monthly income of $${Math.round(m.monthlyIncome || 0).toLocaleString('en-US')} produce ${dti.toFixed(1)}% DTI, above the ${DTI_BACK_END_MAX.toFixed(0)}% manual-path maximum.`,
        'Escalate for human manual-underwriting review. Do not treat this prototype as an approval engine.',
        srcOf(p, 'housingPayment', 'autoPayment', 'creditCardPayment', 'statedAnnualSalary', 'payrollAnnualSalary'),
        { backEndDti: dti, threshold: DTI_BACK_END_MAX, monthlyIncome: m.monthlyIncome, obligations: m.totalMonthlyObligations });
      conditions.push('Escalate for DTI exception or reduce obligations/increase income.');
    } else if (dti >= DTI_BACK_END_WATCH) {
      add('DTI-002', 'medium', 'Capacity',
        `Back-end DTI ${dti.toFixed(1)}% is approaching the manual-path limit`,
        `DTI is within the ${DTI_BACK_END_WATCH.toFixed(0)}-${DTI_BACK_END_MAX.toFixed(0)}% watch band. Document compensating factors.`,
        'Document compensating factors for the elevated DTI.',
        srcOf(p, 'housingPayment', 'autoPayment', 'creditCardPayment'),
        { backEndDti: dti });
    }
  }
  if (m.frontEndDti !== null && m.frontEndDti > DTI_FRONT_END_WATCH) {
    add('DTI-003', 'medium', 'Capacity',
      `Housing ratio ${m.frontEndDti.toFixed(1)}% exceeds the ${DTI_FRONT_END_WATCH.toFixed(0)}% benchmark`,
      'The housing expense ratio is above the conventional benchmark. Consider with the back-end DTI and reserves.',
      'Review housing affordability against compensating factors.',
      srcOf(p, 'housingPayment'), { frontEndDti: m.frontEndDti });
  }

  // --------------------------------------------------------------- credit
  if (!p.hasCreditReport || m.creditScore === null) {
    add('CR-001', 'high', 'Credit',
      'No usable credit report found',
      'A three-bureau merged credit report is required to establish the representative credit score.',
      'Obtain a merged credit report.',
      [], { hasCreditReport: !!p.hasCreditReport });
    conditions.push('Obtain a merged credit report.');
  } else if (m.creditScore < CREDIT_SCORE_MIN) {
    add('CR-002', 'high', 'Credit',
      `Representative score ${m.creditScore} below ${CREDIT_SCORE_MIN} minimum`,
      'The middle-of-three bureau score does not meet the conventional conforming minimum used by this review.',
      'Address the credit score requirement before proceeding.',
      srcOf(p, 'creditScores'), { score: m.creditScore, minimum: CREDIT_SCORE_MIN });
    conditions.push('Address credit score requirement.');
  } else {
    strengths.push(`Representative credit score ${m.creditScore} (middle of ${(p.creditScores || []).slice().sort((a, b) => a - b).join(', ')}) meets the minimum.`);
  }

  // ------------------------------------------------------------------ LTV
  if (m.ltv !== null) {
    if (m.ltv > 80) {
      add('LTV-001', 'medium', 'Collateral',
        `LTV ${m.ltv.toFixed(1)}% exceeds 80%`,
        'Mortgage insurance or other credit enhancement is typically required above 80% LTV on conventional loans.',
        'Review applicable eligibility and matrix requirements.',
        srcOf(p, 'loanAmount', 'purchasePrice'), { ltv: m.ltv });
    } else {
      strengths.push(`LTV ${m.ltv.toFixed(1)}% — 20% down payment from own funds.`);
    }
  } else {
    add('LTV-003', 'medium', 'Collateral',
      'LTV could not be calculated',
      'Loan amount or purchase price is missing or invalid.',
      'Supply the missing loan or property figures.',
      srcOf(p, 'loanAmount', 'purchasePrice'), {});
  }

  // ------------------------------------------------------- funds to close
  if (p.largeDepositAmount && p.largeDepositAmount > 0 && !p.hasSavingsTransferEvidence) {
    add('AST-001', 'high', 'Assets',
      `$${Math.round(p.largeDepositAmount).toLocaleString('en-US')} large deposit lacks source evidence`,
      'A large deposit is referenced but no matching bank/transfer evidence was supplied. Unsourced funds are excluded from verified cash available for closing.',
      'Document the source of funds. Do not count the unsourced amount toward verified closing funds.',
      srcOf(p, 'largeDepositAmount', 'depositExplanation'),
      { deposit: p.largeDepositAmount, hasSourceEvidence: false });
    conditions.push('Source the large deposit with bank evidence.');
  } else if (p.hasSavingsTransferEvidence) {
    strengths.push("Large deposit sourced to borrower's own savings (matched transfer, not double-counted).");
  }

  if (m.cashGap !== null) {
    if (m.cashGap > 0) {
      add('AST-003', 'high', 'Assets',
        `Cash shortfall of $${Math.round(m.cashGap).toLocaleString('en-US')}`,
        `Estimated cash needed is $${Math.round(m.cashNeeded || 0).toLocaleString('en-US')} but only $${Math.round(m.verifiedCash || 0).toLocaleString('en-US')} is verified, leaving a $${Math.round(m.cashGap).toLocaleString('en-US')} gap.`,
        'Resolve the asset-source issue or document additional eligible funds.',
        srcOf(p, 'checkingBalance', 'largeDepositAmount', 'estimatedClosingCosts'),
        { cashNeeded: m.cashNeeded, verifiedCash: m.verifiedCash, gap: m.cashGap });
      conditions.push('Cure the cash-to-close shortfall with verified funds.');
    } else {
      strengths.push(`Verified cash covers the estimated $${Math.round(m.cashNeeded || 0).toLocaleString('en-US')} needed to close.`);
    }
    if (m.reservesMonths !== null && m.reservesMonths < RESERVES_MONTHS_MIN) {
      add('AST-004', 'medium', 'Assets',
        `Reserves of ${m.reservesMonths.toFixed(1)} months below the ${RESERVES_MONTHS_MIN.toFixed(0)}-month benchmark`,
        'Remaining verified funds after closing cover less than two monthly housing payments. Thin reserves are a layer of risk on manual underwrites.',
        'Note the thin reserve position for the human reviewer.',
        srcOf(p, 'checkingBalance'), { reservesMonths: m.reservesMonths });
    }
  }

  // ------------------------------------------------------------- decision
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => (order[a.severity] - order[b.severity]) || (a.id < b.id ? -1 : 1));
  const escalate = findings.some(f => f.id === 'DTI-001');
  const decision: EngineDecision =
    escalate ? 'ESCALATE' : findings.some(f => f.severity === 'high') ? 'CONDITIONAL' : 'READY';

  return { decision, metrics: m, findings, strengths, conditions };
}
