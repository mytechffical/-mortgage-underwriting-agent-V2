/**
 * Automated tests for UnderwriteAI V2 (advanced).
 * Mirrors the verified Python suite (47 pytest cases): calculation math,
 * the three fixture scenarios end-to-end, edge cases, and report generation.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  backEndDti, computeMetrics, evaluate, frontEndDti, loanToValue,
  monthlyIncomeFromAnnual, safeMoney, selectCreditScore,
  type BorrowerProfile,
} from '@/lib/engine';
import { analyze, demoCaseResult, extractProfile, jsonReport, markdownReport, type Doc } from '@/lib/underwriting';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

function loadDocs(scenario: 'missing' | 'corrected' | 'high'): Doc[] {
  const dir = path.join(FIXTURES, scenario);
  return readdirSync(dir)
    .filter(f => f.endsWith('.txt'))
    .sort()
    .map(f => ({ name: f, text: readFileSync(path.join(dir, f), 'utf8'), kind: 'text' }));
}

function ids(r: ReturnType<typeof analyze>): Set<string> {
  return new Set(r.findings.map(f => f.id));
}

// ---------------------------------------------------------------------------
// safeMoney — the "$8,500" class of bugs must be impossible
// ---------------------------------------------------------------------------
describe('safeMoney', () => {
  it('parses $8,500', () => expect(safeMoney('$8,500')).toBe(8500));
  it('parses padded decimals', () => expect(safeMoney('  $120,000.50 ')).toBe(120000.5));
  it('passes numbers through', () => expect(safeMoney(4200)).toBe(4200));
  it('returns null for null/empty/N/A/garbage', () => {
    expect(safeMoney(null)).toBeNull();
    expect(safeMoney('N/A')).toBeNull();
    expect(safeMoney('')).toBeNull();
    expect(safeMoney('no number here')).toBeNull();
  });
  it('rejects booleans', () => expect(safeMoney(true)).toBeNull());
  it('handles parenthesized negatives', () => expect(safeMoney('($500)')).toBe(-500));
});

// ---------------------------------------------------------------------------
// Calculation math (must match the Python engine exactly)
// ---------------------------------------------------------------------------
describe('calculations', () => {
  it('front-end DTI', () => expect(frontEndDti(2800, 10000)).toBe(28.0));
  it('back-end DTI', () => expect(backEndDti(2800, 500, 10000)).toBe(33.0));
  it('back-end DTI high', () => expect(backEndDti(2800, 1900, 10000)).toBe(47.0));
  it('DTI with zero income returns null', () => {
    expect(backEndDti(2800, 500, 0)).toBeNull();
    expect(frontEndDti(2800, 0)).toBeNull();
  });
  it('DTI with negative income returns null', () => expect(backEndDti(2800, 500, -1000)).toBeNull());
  it('DTI with missing inputs returns null', () => {
    expect(backEndDti(null, 500, 10000)).toBeNull();
    expect(backEndDti(2800, 500, null)).toBeNull();
  });
  it('LTV', () => expect(loanToValue(320000, 400000)).toBe(80.0));
  it('LTV with zero value returns null', () => expect(loanToValue(320000, 0)).toBeNull());
  it('LTV with missing inputs returns null', () => {
    expect(loanToValue(null, 400000)).toBeNull();
    expect(loanToValue(320000, null)).toBeNull();
  });
  it('monthly income', () => expect(monthlyIncomeFromAnnual(120000)).toBe(10000));
  it('monthly income zero/negative/missing returns null', () => {
    expect(monthlyIncomeFromAnnual(0)).toBeNull();
    expect(monthlyIncomeFromAnnual(-50000)).toBeNull();
    expect(monthlyIncomeFromAnnual(null)).toBeNull();
  });
  it('selects middle of three credit scores', () => {
    expect(selectCreditScore([748, 760, 772])).toBe(760);
    expect(selectCreditScore([772, 748, 760])).toBe(760);
  });
  it('ignores garbage scores', () => {
    expect(selectCreditScore([])).toBeNull();
    expect(selectCreditScore([99, 9999])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fixture scenarios (expected values from the FNMA MVP input guide)
// ---------------------------------------------------------------------------
describe('corrected scenario', () => {
  const r = analyze(loadDocs('corrected'));
  it('is READY FOR HUMAN REVIEW', () => expect(r.status).toBe('READY FOR HUMAN REVIEW'));
  it('has no critical findings', () =>
    expect(r.findings.filter(f => f.severity === 'critical')).toHaveLength(0));
  it('DTI is 33% / housing ratio 28%', () => {
    expect(r.metrics.backEndDti).toBe(0.33);
    expect(r.metrics.frontEndDti).toBe(0.28);
    expect(r.metrics.income).toBe(10000);
    expect(r.metrics.obligations).toBe(3300);
  });
  it('LTV is 80%', () => expect(r.metrics.ltvPurchase).toBe(0.8));
  it('credit score is the middle bureau score', () => expect(r.metrics.creditScore).toBe(760));
  it('cash position covers closing', () => {
    expect(r.metrics.cashRequired).toBe(92000);
    expect(r.metrics.verifiedAssets).toBe(95000);
    expect(r.metrics.assetGap).toBe(0);
  });
  it('has no income conflict but notes the matched transfer', () => {
    expect(ids(r).has('INC-001')).toBe(false);
    expect(ids(r).has('AST-002')).toBe(true);
  });
});

describe('missing-evidence scenario', () => {
  const r = analyze(loadDocs('missing'));
  it('is CONDITIONAL REVIEW', () => expect(r.status).toBe('CONDITIONAL REVIEW'));
  it('flags the salary conflict', () => expect(ids(r).has('INC-001')).toBe(true));
  it('flags the missing W-2', () => expect(ids(r).has('INC-002')).toBe(true));
  it('flags the unsourced deposit', () => expect(ids(r).has('AST-001')).toBe(true));
  it('reports the $17k cash shortfall with unsourced funds excluded', () => {
    expect(ids(r).has('AST-003')).toBe(true);
    expect(r.metrics.verifiedAssets).toBe(75000);
    expect(r.metrics.assetGap).toBe(17000);
  });
  it('DTI uses verified income, not stated', () => {
    expect(r.metrics.income).toBe(10000);
    expect(r.metrics.backEndDti).toBe(0.33);
  });
});

describe('high-DTI scenario', () => {
  const r = analyze(loadDocs('high'));
  it('escalates', () => expect(r.status).toBe('ESCALATE FOR HUMAN REVIEW'));
  it('DTI is 47%', () => {
    expect(r.metrics.backEndDti).toBe(0.47);
    expect(r.metrics.obligations).toBe(4700);
  });
  it('fires the DTI escalation rule', () => expect(ids(r).has('DTI-001')).toBe(true));
  it('has no income conflict', () => expect(ids(r).has('INC-001')).toBe(false));
});

// ---------------------------------------------------------------------------
// Built-in demo scenarios (power the UI's scenario picker + Compare tab)
// ---------------------------------------------------------------------------
describe('demo scenarios', () => {
  it('missing -> CONDITIONAL REVIEW at 33% DTI', () => {
    const r = demoCaseResult('missing');
    expect(r.status).toBe('CONDITIONAL REVIEW');
    expect(r.metrics.backEndDti).toBe(0.33);
    const s = ids(r);
    expect(s.has('INC-001')).toBe(true);
    expect(s.has('AST-003')).toBe(true);
  });
  it('corrected -> READY FOR HUMAN REVIEW', () => {
    const r = demoCaseResult('corrected');
    expect(r.status).toBe('READY FOR HUMAN REVIEW');
    expect(r.metrics.backEndDti).toBe(0.33);
  });
  it('high -> ESCALATE FOR HUMAN REVIEW at 47% DTI', () => {
    const r = demoCaseResult('high');
    expect(r.status).toBe('ESCALATE FOR HUMAN REVIEW');
    expect(r.metrics.backEndDti).toBe(0.47);
    expect(ids(r).has('DTI-001')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — the engine must never throw
// ---------------------------------------------------------------------------
describe('edge cases', () => {
  it('zero income yields nulls, not a crash', () => {
    const m = computeMetrics({ statedAnnualSalary: 0 });
    expect(m.backEndDti).toBeNull();
    expect(m.monthlyIncome).toBeNull();
  });
  it('empty documents produce INSUFFICIENT EVIDENCE', () => {
    const r = analyze([]);
    expect(r.status).toBe('INSUFFICIENT EVIDENCE');
  });
  it('negative income is handled', () => {
    const m = computeMetrics({ statedAnnualSalary: -60000 });
    expect(m.monthlyIncome).toBeNull();
    expect(m.backEndDti).toBeNull();
  });
  it('low credit score fires CR-002', () => {
    const p: BorrowerProfile = {
      statedAnnualSalary: 120000, hasW2: true, w2AnnualWages: 120000,
      housingPayment: 2800, autoPayment: 400, creditCardPayment: 100,
      purchasePrice: 400000, loanAmount: 320000,
      estimatedClosingCosts: 12000, checkingBalance: 95000,
      hasCreditReport: true, creditScores: [590, 600, 610],
      hasEmploymentLetter: true,
    };
    const r = evaluate(p, computeMetrics(p));
    expect(computeMetrics(p).creditScore).toBe(600);
    expect(new Set(r.findings.map(f => f.id)).has('CR-002')).toBe(true);
  });
  it('malformed money text extracts as null', () => {
    const p = extractProfile([{
      name: '01_application.txt',
      text: 'Document: Fictional loan application summary.\nStated annual base salary: not a number\nProposed monthly housing payment: $2,800\n',
      kind: 'text',
    }]);
    expect(p.statedAnnualSalary).toBeUndefined();
    expect(p.housingPayment).toBe(2800);
  });
  it('every finding carries an audit trail', () => {
    for (const s of ['missing', 'corrected', 'high'] as const) {
      const r = analyze(loadDocs(s));
      for (const f of r.findings) {
        expect(f.id).toBeTruthy();
        expect(['critical', 'high', 'medium', 'low', 'info']).toContain(f.severity);
        expect(f.detail.length).toBeGreaterThan(0);
        expect(f.auditInputs).toBeDefined();
        expect(f.action.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
describe('reports', () => {
  it('markdown contains key sections', () => {
    const md = markdownReport(analyze(loadDocs('corrected')));
    expect(md).toContain('READY FOR HUMAN REVIEW');
    expect(md).toContain('Back-end DTI');
    expect(md).toContain('AST-004');
    expect(md).toContain('Decision-support prototype only');
  });
  it('JSON export parses with expected values', () => {
    const payload = JSON.parse(jsonReport(analyze(loadDocs('high'))));
    expect(payload.status).toBe('ESCALATE FOR HUMAN REVIEW');
    expect(payload.metrics.backEndDti).toBe(0.47);
    expect(payload.findings.some((f: { id: string }) => f.id === 'DTI-001')).toBe(true);
  });
});
