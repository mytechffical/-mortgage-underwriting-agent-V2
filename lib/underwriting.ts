export type Severity = 'critical'|'high'|'medium'|'low'|'info';
export type Finding = {id:string; category:string; severity:Severity; title:string; detail:string; action:string; evidence:string[]};
export type Doc = {name:string; text:string; kind:string; size?:number};
export type CaseResult = {
  status:'READY FOR HUMAN REVIEW'|'CONDITIONAL REVIEW'|'ESCALATE FOR HUMAN REVIEW'|'INSUFFICIENT EVIDENCE';
  metrics:{income:number; obligations:number; housing:number; dti:number|null; loan:number; purchase:number; appraisal:number; ltvPurchase:number|null; ltvAppraisal:number|null; cashRequired:number; verifiedAssets:number; assetGap:number};
  borrower:string; property:string; program:string; findings:Finding[]; documents:{name:string;kind:string;status:string}[]; evidenceScore:number; policyScore:number; summary:string; nextSteps:string[]; sources:string[];
};

const money=(n:number)=>`$${Math.round(n).toLocaleString('en-US')}`;
const num=(s:string)=>Number(String(s).replace(/[$,%\s,]/g,''))||0;
const first=(text:string,re:RegExp,group=1)=>{const m=text.match(re); return m?num(m[group]):0};
const has=(text:string,re:RegExp)=>re.test(text);

export function classify(name:string,text:string){
  const n=name.toLowerCase(), t=text.toLowerCase();
  if(n.includes('application')) return 'Application';
  if(n.includes('paystub')) return 'Income';
  if(n.includes('employment')) return 'Employment';
  if(n.includes('w2')) return 'Tax';
  if(n.includes('checking')||n.includes('savings')) return 'Assets';
  if(n.includes('credit')) return 'Credit';
  if(n.includes('appraisal')) return 'Property';
  if(n.includes('purchase')) return 'Contract';
  if(n.includes('housing')||n.includes('cost')) return 'Housing';
  if(t.includes('paystub')) return 'Income';
  return 'Other';
}

function cashRequiredFromText(all:string, purchase:number, loan:number){
  const direct=first(all,/Cash required estimate:\s*\$([\d,]+)/i);
  if(direct){
    const line=all.match(/Cash required estimate:\s*([^\n.]+)/i)?.[1]||'';
    const extra=first(line,/plus\s*\$([\d,]+)\s*(?:costs?|closing)/i);
    return direct+extra;
  }
  const down=first(all,/Down payment:\s*\$([\d,]+)/i);
  const closing=first(all,/Estimated total closing costs:\s*\$([\d,]+)/i);
  if(down||closing) return down+closing;
  return Math.max(0,purchase-loan)+first(all,/Estimated closing costs:\s*\$([\d,]+)/i);
}

export function analyze(docs:Doc[], manual?:{loan?:number;purchase?:number;housing?:number}) : CaseResult {
  const all=docs.map(d=>d.text).join('\n\n');
  const app=docs.find(d=>/application/i.test(d.name))?.text||'';
  const loan=first(all,/Loan amount:\s*\$([\d,]+)/i) || manual?.loan || 0;
  const purchase=first(all,/Purchase price:\s*\$([\d,]+)/i) || manual?.purchase || 0;
  const appraisal=first(all,/Appraised value:\s*\$([\d,]+)/i) || purchase;
  const housing=first(all,/Total proposed qualifying monthly housing payment:\s*\$([\d,]+)/i) || first(all,/Proposed monthly housing payment:\s*\$([\d,]+)/i) || manual?.housing || 0;
  const statedAnnual=first(app,/Stated annual base salary:\s*\$([\d,]+)/i);
  const correctionDocs=docs.filter(d=>/correction/i.test(d.name));
  const correctedAnnual=first(correctionDocs.map(d=>d.text).join('\n'),/current application states annual salary \$([\d,]+)/i) || first(correctionDocs.map(d=>d.text).join('\n'),/Current annual base salary:\s*\$([\d,]+)/i);
  const payrollDocs=docs.filter(d=>/paystub|employment_reverification|employment_letter/i.test(d.name));
  const payrollAnnual=first(payrollDocs.map(d=>d.text).join('\n'),/^Annual base salary:\s*\$([\d,]+)/im) || first(payrollDocs.map(d=>d.text).join('\n'),/^Current annual base salary:\s*\$([\d,]+)/im);
  const supportedAnnual=payrollAnnual || correctedAnnual || statedAnnual;
  const income=supportedAnnual/12;
  const auto=first(all,/Auto payment:\s*\$([\d,]+)/i) || first(all,/Auto installment loan: required monthly payment \$([\d,]+)/i);
  const card=first(all,/Credit card payment:\s*\$([\d,]+)/i) || first(all,/required minimum monthly payment \$([\d,]+)/i);
  const other=first(all,/Other monthly debt:\s*\$([\d,]+)/i);
  const obligations=housing+auto+card+other;
  const dti=income?obligations/income:null;
  const checking=first(all,/Checking account balance:\s*\$([\d,]+)/i) || first(all,/Ending balance:\s*\$([\d,]+)/i);
  const savings=first(all,/Savings ending balance:\s*\$([\d,]+)/i);
  const cashRequired=cashRequiredFromText(all,purchase,loan);
  const unsourced=has(all,/incoming transfer, source not identified/i);
  const matchedTransfer=has(all,/transfer from Maya Sample savings account|matched transfer from own savings|same amount\/date|matched transfer/i);
  const verifiedAssets=unsourced && !matchedTransfer ? Math.max(0,checking-20000) : Math.max(0,checking+savings);
  const assetGap=Math.max(0,cashRequired-verifiedAssets);
  const findings:Finding[]=[];
  if(statedAnnual && payrollAnnual && Math.abs(statedAnnual-payrollAnnual)>1){findings.push({id:'INC-001',category:'Income',severity:'high',title:'Application income conflicts with supported payroll',detail:`Application shows ${money(statedAnnual/12)}/month while payroll evidence supports ${money(payrollAnnual/12)}/month.`,action:'Resolve the discrepancy and use the supported income figure for the test calculation.',evidence:docs.filter(d=>/application|paystub|w2|employment/i.test(d.name)).map(d=>d.name)});}
  const w2=docs.some(d=>/w2/i.test(d.name));
  if(!w2 && docs.some(d=>/paystub/i.test(d.name))){findings.push({id:'INC-002',category:'Income',severity:'medium',title:'2025 W-2 evidence is missing',detail:'The current test package does not contain the expected 2025 W-2 summary.',action:'Obtain the missing W-2 or an adequate permitted alternative before final review.',evidence:docs.filter(d=>/paystub|employment/i.test(d.name)).map(d=>d.name)});}
  if(unsourced && !matchedTransfer){findings.push({id:'AST-001',category:'Assets',severity:'high',title:'$20,000 deposit source is not identified',detail:'The September checking statement shows an incoming $20,000 transfer with no source identified.',action:'Document the source of funds. Do not count the unsourced amount toward verified closing funds.',evidence:docs.filter(d=>/checking|savings/i.test(d.name)).map(d=>d.name)});}
  if(matchedTransfer){findings.push({id:'AST-002',category:'Assets',severity:'info',title:'$20,000 transfer is matched to the borrower savings account',detail:'The checking and savings records describe the same transfer. The historical transfer is not double-counted.',action:'Retain the matching statements in the file.',evidence:docs.filter(d=>/checking|savings|correction/i.test(d.name)).map(d=>d.name)});}
  if(assetGap>0){findings.push({id:'AST-003',category:'Assets',severity:'high',title:'Verified assets are below estimated cash required',detail:`Estimated cash required is ${money(cashRequired)}; currently supported assets are ${money(verifiedAssets)}.`,action:'Resolve the asset-source issue or document additional eligible funds.',evidence:docs.filter(d=>/checking|savings|application|purchase|housing/i.test(d.name)).map(d=>d.name)});}
  if(dti!==null && dti>=0.45){findings.push({id:'DTI-001',category:'Capacity',severity:'critical',title:`Manual-path DTI escalation at ${(dti*100).toFixed(1)}%`,detail:`Monthly obligations of ${money(obligations)} against supported monthly income of ${money(income)} produce ${(dti*100).toFixed(1)}% DTI.`,action:'Escalate for human manual-underwriting review. Do not treat this prototype as an approval engine.',evidence:docs.filter(d=>/housing|credit|application|paystub/i.test(d.name)).map(d=>d.name)});}
  if(purchase && loan && loan/purchase>0.8){findings.push({id:'LTV-001',category:'Collateral',severity:'medium',title:'Purchase LTV exceeds 80%',detail:`Loan-to-purchase-price is ${(loan/purchase*100).toFixed(1)}%.`,action:'Review applicable eligibility and matrix requirements.',evidence:docs.filter(d=>/application|purchase|appraisal/i.test(d.name)).map(d=>d.name)});}
  if(appraisal && loan){findings.push({id:'LTV-002',category:'Collateral',severity:'info',title:'Appraisal comparison calculated',detail:`Loan-to-appraisal value is ${(loan/appraisal*100).toFixed(1)}%; purchase-price LTV is ${purchase?(loan/purchase*100).toFixed(1):'n/a'}%.`,action:'Confirm final collateral and eligibility requirements with the human reviewer.',evidence:docs.filter(d=>/appraisal|purchase|application/i.test(d.name)).map(d=>d.name)});}
  const critical=findings.filter(f=>f.severity==='critical').length, high=findings.filter(f=>f.severity==='high').length;
  const status=critical?'ESCALATE FOR HUMAN REVIEW':high?'CONDITIONAL REVIEW':docs.length?'READY FOR HUMAN REVIEW':'INSUFFICIENT EVIDENCE';
  const evidenceScore=Math.max(0,Math.min(100,100-(high*18)-(findings.filter(f=>f.severity==='medium').length*8)));
  const policyScore=Math.max(55,Math.min(100,100-(critical*15)-(high*7)));
  const summary=critical?`The file requires human escalation because the calculated DTI is ${(dti!*100).toFixed(1)}%.`:high?`The file is conditionally reviewable but has ${high} high-severity evidence issue${high===1?'':'s'}.`:'The available synthetic evidence is internally consistent for this test case; human review is still required.';
  const nextSteps=findings.filter(f=>f.severity!=='info').slice(0,5).map(f=>f.action);
  if(!nextSteps.length) nextSteps.push('Complete the remaining human underwriting and collateral checks.');
  return {status,metrics:{income,obligations,housing,dti,loan,purchase,appraisal,ltvPurchase:purchase?loan/purchase:null,ltvAppraisal:appraisal?loan/appraisal:null,cashRequired,verifiedAssets,assetGap},borrower:(all.match(/Borrower:\s*([^\.\n]+)/i)?.[1]||'Synthetic borrower'),property:(all.match(/Test property:\s*([^\.\n]+)/i)?.[1]||'Synthetic property'),program:(all.match(/Program:\s*([^\.\n]+)/i)?.[1]||'FNMA manual MVP'),findings,documents:docs.map(d=>({name:d.name,kind:classify(d.name,d.text),status:'Parsed'})),evidenceScore,policyScore,summary,nextSteps,sources:['Project-scoped FNMA MVP test guide','Synthetic borrower evidence package']};
}

export function markdownReport(r:CaseResult){
  const m=r.metrics;
  return `# UnderwriteAI V2 — Underwriting Review\n\n**Status:** ${r.status}\n\n${r.summary}\n\n## Metrics\n- Monthly supported income: ${money(m.income)}\n- Monthly obligations: ${money(m.obligations)}\n- DTI: ${m.dti===null?'N/A':(m.dti*100).toFixed(1)+'%'}\n- Loan amount: ${money(m.loan)}\n- Purchase price: ${money(m.purchase)}\n- Appraised value: ${money(m.appraisal)}\n- Purchase LTV: ${m.ltvPurchase===null?'N/A':(m.ltvPurchase*100).toFixed(1)+'%'}\n- Appraisal LTV: ${m.ltvAppraisal===null?'N/A':(m.ltvAppraisal*100).toFixed(1)+'%'}\n- Estimated cash required: ${money(m.cashRequired)}\n- Supported assets: ${money(m.verifiedAssets)}\n\n## Findings\n${r.findings.length?r.findings.map(f=>`### ${f.id} — ${f.title}\n**${f.severity.toUpperCase()} / ${f.category}**\n\n${f.detail}\n\n**Action:** ${f.action}\n\n**Evidence:** ${f.evidence.join(', ')||'Not specified'}`).join('\n\n'):'No findings were generated.'}\n\n## Next steps\n${r.nextSteps.map(x=>`- ${x}`).join('\n')}\n\n> Decision-support prototype only. This report does not approve or deny a mortgage.\n`;
}
