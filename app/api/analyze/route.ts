import {NextRequest, NextResponse} from 'next/server';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import pdf from 'pdf-parse';
import {analyze, Doc} from '@/lib/underwriting';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const MAX_FILE_BYTES=12*1024*1024;
const MAX_TOTAL_TEXT=180000;
const ALLOWED=/\.(txt|md|csv|json|pdf|docx|zip)$/i;

async function readFile(file:File):Promise<Doc[]> {
  if(file.size>MAX_FILE_BYTES) throw new Error(`${file.name} is larger than the 12 MB per-file limit.`);
  if(!ALLOWED.test(file.name)) throw new Error(`${file.name} is not a supported file type.`);
  const name=file.name;
  const buf=Buffer.from(await file.arrayBuffer());
  if(name.toLowerCase().endsWith('.zip')){
    const zip=await JSZip.loadAsync(buf);
    const out:Doc[]=[];
    let extractedChars=0;
    let entryCount=0;
    for(const [path,entry] of Object.entries(zip.files)){
      entryCount++;
      if(entryCount>200) throw new Error('ZIP contains too many entries for this demo.');
      if(entry.dir || !/\.(txt|md|csv|json)$/i.test(path)) continue;
      const text=await entry.async('text');
      extractedChars+=text.length;
      if(extractedChars>MAX_TOTAL_TEXT) throw new Error('The ZIP contains more than 180,000 characters of extracted text.');
      if(text.trim()) out.push({name:path.split('/').pop()||path,text,kind:'text'});
    }
    return out;
  }
  if(name.toLowerCase().endsWith('.pdf')){
    const data=await pdf(buf);
    return [{name,text:data.text,kind:'pdf'}];
  }
  if(name.toLowerCase().endsWith('.docx')){
    const data=await mammoth.extractRawText({buffer:buf});
    return [{name,text:data.value,kind:'docx'}];
  }
  return [{name,text:buf.toString('utf8'),kind:'text'}];
}

export async function POST(req:NextRequest){
  try{
    const form=await req.formData();
    const files=form.getAll('files').filter((x):x is File=>x instanceof File);
    if(!files.length) return NextResponse.json({error:'Upload at least one TXT, PDF, DOCX, or ZIP file.'},{status:400});
    const totalBytes=files.reduce((n,f)=>n+f.size,0);
    if(totalBytes>30*1024*1024) return NextResponse.json({error:'Combined upload size is limited to 30 MB for this demo.'},{status:413});
    const docs=(await Promise.all(files.map(readFile))).flat().filter(d=>d.text.trim());
    const totalText=docs.reduce((n,d)=>n+d.text.length,0);
    if(!docs.length) return NextResponse.json({error:'No readable text was found in the uploaded files.'},{status:400});
    if(totalText>MAX_TOTAL_TEXT) return NextResponse.json({error:'The extracted text exceeds the 180,000 character demo limit.'},{status:413});
    return NextResponse.json({result:analyze(docs)});
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:'Analysis failed.'},{status:500});
  }
}
