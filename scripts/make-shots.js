// Erzeugt Screenshots der laufenden App via Chrome DevTools Protocol → docs/*.png
// Aufruf: App mit --remote-debugging-port=9226 starten, dann `node scripts/make-shots.js`
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 9226;
const DOCS = path.resolve(__dirname, '..', 'docs');
fs.mkdirSync(DOCS, { recursive: true });

const getJSON = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

async function main() {
  // WS-Endpunkt der Seite finden
  let target;
  for (let i = 0; i < 30; i++) {
    try { const list = await getJSON(`http://127.0.0.1:${PORT}/json`); target = list.find((t) => t.type === 'page' && t.url.includes('index.html')); if (target) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!target) throw new Error('Kein DevTools-Target gefunden — App mit --remote-debugging-port=' + PORT + ' starten');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  await send('Page.enable');

  const evalP = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r && r.result ? r.result.value : null;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(DOCS, name), Buffer.from(r.data, 'base64'));
    console.log('geschrieben:', name);
  };

  // 1) Startseite (Werkzeugraster)
  await evalP(`(async()=>{ if(!document.querySelector('#home').classList.contains('hidden')){} else { window.nova && window.nova.onMenu; showViewHome && showViewHome(); } document.querySelector('#home').scrollTop=0; return 1; })()`);
  await new Promise((r) => setTimeout(r, 500));
  await shot('home.png');

  // 2) Editor mit Checkliste + grünen Haken + Markierungsrahmen
  await evalP(`(async()=>{
    window.requestAnimationFrame = (cb)=>setTimeout(()=>cb(performance.now()),16);
    const {PDFDocument,rgb,StandardFonts}=window.PDFLib;
    const d=await PDFDocument.create();
    const font=await d.embedFont(StandardFonts.Helvetica), bold=await d.embedFont(StandardFonts.HelveticaBold);
    const p=d.addPage([595,842]);
    p.drawText('Checkliste Werkplanung',{x:60,y:790,size:20,font:bold});
    p.drawText('Grundriss M 1:50   Schwarz Architekturbuero Nuernberg',{x:60,y:766,size:9,font,color:rgb(.4,.4,.45)});
    const rows=[['Tragende Waende',1],['Material',0],['Dicke',0],['Bemassung',0],['Klinker / Vormauerschale',1],['Fugenbild',0],['Nichttragende Waende',1],['GK-Staender / Typ',0],['Dicke',0],['Unterzuege / Ueberzuege',1],['Stuetzen / Pfeiler',1],['Decken - Roh',1],['Konstruktion',0],['Rohdeckenhoehe',0]];
    let y=710; for(const [t,head] of rows){ p.drawRectangle({x:60,y:y-2,width:11,height:11,borderColor:rgb(.2,.2,.25),borderWidth:1}); p.drawText(t,{x:head?82:82,y:y,size:head?11:10,font:head?bold:font,color:head?rgb(0,0,0):rgb(.3,.3,.35)}); y-=26; }
    const dt=new DataTransfer(); dt.items.add(new File([await d.save()],'Werkplan_Checkliste.pdf',{type:'application/pdf'}));
    window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
    return 1;
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  // Ein paar Haken setzen + Marquee zeigen
  await evalP(`(async()=>{
    const anno=document.querySelector('.page-wrap[data-page="0"] canvas.anno'); const r=anno.getBoundingClientRect();
    document.querySelector('[data-tool="check"]').click();
    for(const y of [712,634,530,504]){ anno.dispatchEvent(new MouseEvent('click',{clientX:r.left+66,clientY:r.top+(842-y-4),bubbles:true})); await new Promise(s=>setTimeout(s,60)); }
    return 1;
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  await shot('editor.png');

  ws.close();
  console.log('fertig →', DOCS);
  process.exit(0);
}
main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
