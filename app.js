const KEY='netamemo.notes.v1',OLD_KEY='manzai.scripts.v1',DAY=864e5,TRASH_DAYS=30;
const COLORS=['#e8590c','#1971c2','#2f9e44','#9c36b5','#c2255c','#0c8599','#e67700','#5c7cfa'];
const $=s=>document.querySelector(s);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
// ピンチ・ダブルタップでの拡大縮小を止める
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('gesturechange',e=>e.preventDefault());
document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault()},{passive:false});
const $notes=$('#notes'),$q=$('#q'),$memo=$('#memo'),$shead=$('#shead'),$script=$('#script'),$dlg=$('#dlg');

/* ---------- 保存 ---------- */
let notes={},saveTimer=null;
function load(){try{notes=JSON.parse(localStorage.getItem(KEY))||{}}catch{notes={}}}
function persistNow(){
  clearTimeout(saveTimer);saveTimer=null;
  try{localStorage.setItem(KEY,JSON.stringify(notes))}catch{toast('保存できませんでした（容量不足かもしれません）')}
}
function schedule(){clearTimeout(saveTimer);saveTimer=setTimeout(persistNow,300)}
function touch(n){n.updated=Date.now();notes[n.id]=n;schedule()}
const flush=()=>{if(saveTimer)persistNow()};
addEventListener('pagehide',flush);
document.addEventListener('visibilitychange',()=>{if(document.hidden)flush()});
addEventListener('storage',e=>{if(e.key!==KEY)return;load();if(cur&&!isEmpty(cur))notes[cur.id]=cur;if(!$('#vList').hidden)renderList()});
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});

function newNote(text='',mode='memo'){const t=Date.now();return{id:uid(),text,mode,spk:[],pinned:false,created:t,updated:t}}
const isEmpty=n=>!n.text.trim()&&!(n.imgs&&n.imgs.length);
const live=()=>Object.values(notes).filter(n=>!n.deleted);
function titleOf(n){
  const ls=n.text.split('\n').map(s=>s.trim()).filter(Boolean),ni=(n.imgs||[]).length;
  return{title:ls[0]||(ni?'写真':'新規メモ'),preview:ls[1]||(ni?`写真 ${ni}枚`:'追加テキストなし')};
}
const fileBase=n=>titleOf(n).title.replace(/[\\/:*?"<>|]/g,'_').slice(0,40)||'メモ';

/* ---------- 台本 ⇄ テキスト ---------- */
// 「名前：セリフ」。名前は12文字まで。URL（https://）は除外。字下げ行は前のセリフの続き。
const RE=/^([^：:\s　][^：:\n]{0,11}?)[ \t　]*[：:](?!\/\/)[ 　]?(.*)$/;
const cw=c=>/[\u0000-ÿ｡-ﾟ]/.test(c)?1:2;
const sw=s=>[...s].reduce((a,c)=>a+cw(c),0);
function padTo(s,w){const d=w-sw(s);return s+'　'.repeat(Math.max(0,Math.floor(d/2)))+(d>0&&d%2?' ':'')}
const cleanName=s=>String(s).replace(/[：:\n]/g,'').trim();

// 「A ああああ」のように半角スペースで区切った台本。
// 自動判定（取り込み時）：2回以上出てくる名前か、A・B のような英字1〜2文字の名前を話者とみなす。
// loose（「台本」に切り替えたとき）：4文字以内の名前なら1回だけでも話者とみなす。
const SP_RE=/^([^\s：:]{1,8}) +(\S.*)$/;
function spaceNames(lines,loose){
  const ls=lines.filter(s=>s.trim()),cnt={};
  for(const s of ls){const m=s.match(SP_RE);if(m)cnt[m[1]]=(cnt[m[1]]||0)+1}
  const names=Object.keys(cnt).filter(k=>cnt[k]>=2||/^[A-Za-zＡ-Ｚａ-ｚ]{1,2}$/.test(k)||loose&&[...k].length<=4);
  if(!names.length||names.length>8)return null;
  const hit=names.reduce((a,k)=>a+cnt[k],0);
  return loose||hit>=2&&hit>=ls.length*.5?new Set(names):null;
}
function matchLine(raw,spNames){
  const m=raw.match(RE);if(m)return m;
  if(!spNames)return null;
  const s=raw.match(SP_RE);return s&&spNames.has(s[1])?s:null;
}

function parseScript(text,meta=[]){
  const sc={head:'',speakers:[],lines:[]},by={},head=[];
  const rows=text.split(/\r?\n/),spNames=rows.some(s=>RE.test(s))?null:spaceNames(rows,true);
  const add=(name,color)=>{
    if(!by[name]){const p={id:uid(),name,color:color||COLORS.find(c=>!sc.speakers.some(s=>s.color===c))||COLORS[sc.speakers.length%COLORS.length]};by[name]=p;sc.speakers.push(p)}
    return by[name].id;
  };
  (meta||[]).forEach(m=>m&&m.name&&add(m.name,m.color));
  for(const raw of rows){
    const last=sc.lines[sc.lines.length-1];
    if(last&&/^[ \t　]/.test(raw)&&raw.trim()){last.text+='\n'+raw.replace(/^[ \t　]+/,'');continue}
    const m=matchLine(raw,spNames);
    if(m){sc.lines.push({id:uid(),sp:add(m[1]),text:m[2]});continue}
    if(!last){head.push(raw);continue}
    if(raw.trim())last.text+='\n'+raw.trim();
  }
  sc.head=head.join('\n').replace(/\s+$/,'');
  if(!sc.speakers.length){add('A');add('B')}
  if(!sc.lines.length)sc.lines.push({id:uid(),sp:sc.speakers[0].id,text:''});
  return sc;
}
function serialize(sc){
  const name=id=>(sc.speakers.find(s=>s.id===id)||sc.speakers[0]).name;
  const max=Math.max(1,...sc.lines.map(l=>sw(name(l.sp))));
  const indent=padTo('',max+2),out=[];
  if(sc.head)out.push(sc.head,'');
  for(const l of sc.lines){
    const parts=l.text.split('\n');
    out.push(padTo(name(l.sp),max)+'：'+parts[0]);
    for(const p of parts.slice(1))out.push(indent+p);
  }
  return out.join('\n');
}
function looksLikeScript(text){
  const rows=text.split(/\r?\n/),ls=rows.filter(s=>s.trim());
  const hit=ls.filter(s=>RE.test(s)).length;
  return hit>=3&&hit>=ls.length*.5||!hit&&!!spaceNames(rows);
}
// 旧「漫才台本エディタ」形式からの変換
function fromScript(s){
  if(!s||!Array.isArray(s.speakers)||!Array.isArray(s.lines)||!s.speakers.length)return null;
  const sp=s.speakers.map((p,i)=>({id:p.id||uid(),name:cleanName(p.name??'?')||'?',color:p.color||COLORS[i%COLORS.length]}));
  const lines=s.lines.filter(Boolean).map(l=>({sp:sp.some(p=>p.id===l.sp)?l.sp:sp[0].id,text:String(l.text??'')}));
  const t=s.updated||Date.now();
  return{id:s.id||uid(),text:serialize({head:s.title||'',speakers:sp,lines}),mode:'script',spk:sp.map(({name,color})=>({name,color})),pinned:false,created:t,updated:t};
}
function validNote(n){
  if(!n||typeof n.text!=='string')return null;
  const t=Date.now();
  return{id:String(n.id||uid()),text:n.text,mode:n.mode==='script'?'script':'memo',spk:Array.isArray(n.spk)?n.spk:[],pinned:!!n.pinned,created:n.created||n.updated||t,updated:n.updated||t,...(typeof n.html==='string'?{html:n.html}:{}),...(Array.isArray(n.sh)?{sh:n.sh}:{}),...(Array.isArray(n.imgs)&&n.imgs.length?{imgs:n.imgs.filter(x=>typeof x==='string')}:{}),...(n.deleted?{deleted:n.deleted}:{})};
}

/* ---------- 画面遷移 ---------- */
let cur=null,sc=null,fromList=false,listY=0;
function show(view){
  $('#vList').hidden=view!=='list';$('#vNote').hidden=view!=='note';document.documentElement.dataset.view=view;
  if(view!=='note')closePanel();
  $('meta[name=theme-color]').content=getComputedStyle(document.body).backgroundColor;
}
function route(){
  const m=location.hash.match(/^#\/n\/(.+)$/),n=m&&notes[m[1]];
  if(n&&!n.deleted)openNote(n);else{leaveNote();showList()}
}
addEventListener('popstate',route);
function leaveNote(){
  if(!cur)return;
  if(isEmpty(cur)){if(notes[cur.id]){delete notes[cur.id];persistNow()}}
  else flush();
  if(document.activeElement)document.activeElement.blur();
  if(!$('#viewer').hidden)closeViewer();
  cur=null;sc=null;
}
function showList(){fromList=false;show('list');renderList();scrollTo(0,listY)}
function goNote(n,focus){
  if(!$('#vList').hidden)listY=scrollY;
  history.pushState(null,'','#/n/'+n.id);fromList=true;openNote(n);
  if(focus){if(sc)focusLine(sc.lines[0].id,0);else caretEnd($memo)}
}
function goList(){
  if(fromList)history.back();
  else{history.replaceState(null,'','#/');leaveNote();showList()}
}
function openNote(n){
  if(cur&&cur!==n)leaveNote();
  cur=n;show('note');
  $('#ndate').textContent=fmtLong(n.updated);
  setMode(n.mode||'memo');
  renderImgs();
  scrollTo(0,0);
}
function setMode(m){
  cur.mode=m;document.documentElement.dataset.mode=m;closePanel();
  $('#seg').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===m));
  const script=m==='script';
  $memo.hidden=script;$('#scriptWrap').hidden=!script;$('#speakers').hidden=!script;
  if(script){sc=parseScript(cur.text,cur.spk);applySh(sc,cur.sh);renderScript()}
  else{
    if(cur.html==null&&cur.sh&&sc)cur.html=scriptHtml(sc);
    sc=null;renderRich();
  }
}
$('#seg').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||b.dataset.m===cur.mode)return;
  setMode(b.dataset.m);
  if(notes[cur.id])schedule();
});
$('#btnBack').addEventListener('click',goList);

/* ---------- 一覧 ---------- */
const p2=n=>String(n).padStart(2,'0');
const sod=()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime()};
function fmtShort(t){
  const d=new Date(t),s=sod();
  if(t>=s)return`${d.getHours()}:${p2(d.getMinutes())}`;
  if(t>=s-DAY)return'昨日';
  if(t>=s-6*DAY)return'日月火水木金土'[d.getDay()]+'曜日';
  return`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
}
const fmtLong=t=>{const d=new Date(t);return`${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${d.getHours()}:${p2(d.getMinutes())}`};
function bucket(t){
  const s=sod(),d=new Date(t);
  if(t>=s)return'今日';
  if(t>=s-DAY)return'昨日';
  if(t>=s-7*DAY)return'過去7日間';
  if(t>=s-30*DAY)return'過去30日間';
  return d.getFullYear()===new Date().getFullYear()?`${d.getMonth()+1}月`:`${d.getFullYear()}年${d.getMonth()+1}月`;
}
function renderList(){
  openRow=null;swp=null;
  const q=$q.value.trim().toLowerCase();
  const all=live(),arr=all.filter(n=>!q||n.text.toLowerCase().includes(q)).sort((a,b)=>b.updated-a.updated);
  const groups=[],at={};
  const put=(label,n)=>{if(!at[label]){at[label]=[];groups.push([label,at[label]])}at[label].push(n)};
  arr.filter(n=>n.pinned).forEach(n=>put('📌 ピン留め',n));
  arr.filter(n=>!n.pinned).forEach(n=>put(q?'検索結果':bucket(n.updated),n));
  $notes.replaceChildren(...groups.map(([label,list])=>{
    const g=document.createElement('div');g.className='grp';
    const h=document.createElement('h2');h.textContent=label;
    const c=document.createElement('div');c.className='card';
    c.append(...list.map(rowEl));g.append(h,c);return g;
  }));
  if(!arr.length){const e=document.createElement('div');e.className='empty';e.textContent=q?`「${$q.value.trim()}」を含むメモはありません`:'メモはありません\n右下のボタンで作成';e.style.whiteSpace='pre-line';$notes.append(e)}
  $('#count').textContent=all.length?`${all.length}件のメモ`:'';
}
function rowEl(n){
  const{title,preview}=titleOf(n);
  const b=document.createElement('button');b.className='row';b.dataset.id=n.id;
  const t=document.createElement('div');t.className='rt';
  if(n.mode==='script'){const g=document.createElement('span');g.className='tag';g.textContent='台本';t.append(g)}
  t.append(title);
  const s=document.createElement('div');s.className='rs';
  const d=document.createElement('span');d.className='rd';d.textContent=fmtShort(n.updated);
  s.append(d,preview);b.append(t,s);
  const w=document.createElement('div');w.className='sw';
  const actsL=document.createElement('div');actsL.className='acts l';
  actsL.innerHTML=`<button class="act" data-act="pin" style="--c:#f59f00"><i>${n.pinned?ICON.unpin:ICON.pin}</i>${n.pinned?'解除':'ピン'}</button>`;
  const acts=document.createElement('div');acts.className='acts r';
  acts.innerHTML=
    `<button class="act" data-act="share" style="--c:#3b82f6"><i>${ICON.share}</i>共有</button>`+
    `<button class="act" data-act="del" style="--c:#ef4444"><i>${ICON.del}</i>削除</button>`;
  w.append(actsL,acts,b);return w;
}
const svg=p=>`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON={
  pin:svg('<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v6"/>'),
  unpin:svg('<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v6M3 3l18 18"/>'),
  share:svg('<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/>'),
  del:svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')
};
$q.addEventListener('input',renderList);
$('#btnNew').addEventListener('click',()=>goNote(newNote(),true));

// 長押し / 右クリックで行メニュー
let lp=null,lpFired=false;
$notes.addEventListener('pointerdown',e=>{
  const r=e.target.closest('.row');if(!r)return;
  lpFired=false;const x=e.clientX,y=e.clientY;
  lp={x,y,t:setTimeout(()=>{lpFired=true;rowMenu(r.dataset.id)},500)};
});
const lpCancel=()=>{if(lp){clearTimeout(lp.t);lp=null}};
$notes.addEventListener('pointermove',e=>{if(lp&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>8)lpCancel()});
['pointerup','pointercancel','pointerleave'].forEach(ev=>$notes.addEventListener(ev,lpCancel));
$notes.addEventListener('click',e=>{
  const a=e.target.closest('.act');
  if(a){
    const n=notes[a.closest('.sw').querySelector('.row').dataset.id];closeSwipe(true);if(!n)return;
    if(a.dataset.act==='pin'){n.pinned=!n.pinned;persistNow();renderList();toast(n.pinned?'ピン留めしました':'ピン留めを解除しました')}
    else if(a.dataset.act==='share')shareText(n);
    else{trash(n);renderList()}
    return;
  }
  const r=e.target.closest('.row');if(!r)return;
  if(lpFired){lpFired=false;return}
  if(swiped){swiped=false;return}
  if(openRow){closeSwipe();return}
  const n=notes[r.dataset.id];if(n)goNote(n);
});

// 左にスワイプで 共有・削除、右にスワイプで ピン留め
let swp=null,openRow=null,swiped=false;
const actW=(r,side)=>r.parentElement.querySelector('.acts.'+side).offsetWidth;
function setX(r,x,anim){r.style.transition=anim?'transform .22s ease-out':'none';r.style.transform=x?`translateX(${x}px)`:'';r.classList.toggle('open-r',x<0);r.classList.toggle('open-l',x>0);r.dataset.x=x}
function closeSwipe(now){if(openRow){setX(openRow,0,!now);openRow=null}}
$notes.addEventListener('pointerdown',e=>{
  const r=e.target.closest('.row');swiped=false;
  if(openRow&&openRow!==r&&!e.target.closest('.act')){closeSwipe();swiped=!!r}
  swp=r&&e.isPrimary?{r,x:e.clientX,y:e.clientY,base:r===openRow?+r.dataset.x||0:0,dx:0,on:false}:null;
});
$notes.addEventListener('pointermove',e=>{
  if(!swp)return;
  const dx=e.clientX-swp.x,dy=e.clientY-swp.y;
  if(!swp.on){
    if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){swp=null;return}
    if(Math.abs(dx)<10)return;
    swp.on=true;lpCancel();try{swp.r.setPointerCapture(e.pointerId)}catch{}
  }
  const wr=actW(swp.r,'r'),wl=actW(swp.r,'l'),x=swp.base+dx;
  swp.dx=dx;setX(swp.r,x<-wr?-wr+(x+wr)/3:x>wl?wl+(x-wl)/3:x,false);
});
function swipeEnd(cancel){
  if(!swp)return;const s=swp;swp=null;if(!s.on)return;
  swiped=true;setTimeout(()=>swiped=false,350);
  const wr=actW(s.r,'r'),wl=actW(s.r,'l'),x=s.base+s.dx;
  const to=cancel?0:x<-wr/2?-wr:x>wl/2?wl:0;
  if(to){if(openRow&&openRow!==s.r)closeSwipe();openRow=s.r;setX(s.r,to,true)}
  else{setX(s.r,0,true);if(openRow===s.r)openRow=null}
}
$notes.addEventListener('pointerup',()=>swipeEnd(false));
$notes.addEventListener('pointercancel',()=>swipeEnd(true));
addEventListener('scroll',()=>{if(openRow&&!swp)closeSwipe()},{passive:true});
function rowMenu(id){
  const n=notes[id];if(!n)return;
  sheet(titleOf(n).title,[
    item(n.pinned?'ピン留めを解除':'ピン留め',()=>{n.pinned=!n.pinned;persistNow();renderList()}),
    item('iPhoneの「メモ」へ送る',()=>shareText(n)),
    item('複製',()=>{const c={...structuredClone(n),id:uid(),pinned:false,created:Date.now()};touch(c);persistNow();renderList();toast('複製しました')}),
    item('削除',()=>{trash(n);renderList()},{cls:'danger'})
  ]);
}

/* ---------- メモ編集 ---------- */
function autosize(t){
  if(t.tagName!=='TEXTAREA'||CSS.supports('field-sizing','content'))return;
  const y=scrollY;t.style.height='auto';t.style.height=t.scrollHeight+'px';scrollTo(0,y);
}
addEventListener('resize',()=>document.querySelectorAll('#vNote textarea').forEach(autosize));

/* ---------- 台本エディタ ---------- */
// セリフは書式つきで編集できる。テキスト（n.text）は今まで通り「名前：セリフ」、書式は n.sh に行ごとに持つ
let lastId=null,lastPos=0;
function sync(){
  delete cur.html;cur.text=serialize(sc);cur.spk=sc.speakers.map(({name,color})=>({name,color}));
  const sh=sc.lines.map(l=>l.h?{t:l.text,h:l.h}:0);
  if(sh.some(Boolean))cur.sh=sh;else delete cur.sh;
  touch(cur);
}
function applySh(sc,sh){
  if(!Array.isArray(sh))return;
  sc.lines.forEach((l,i)=>{const x=sh[i];if(x&&typeof x.h==='string'&&x.t===l.text)l.h=clean(x.h)});
}
// 台本→メモに切り替えたとき、セリフの書式をメモにも引き継ぐ
function scriptHtml(sc){
  const name=id=>(sc.speakers.find(s=>s.id===id)||sc.speakers[0]).name;
  const max=Math.max(1,...sc.lines.map(l=>sw(name(l.sp))));
  const indent=padTo('',max+2),out=[];
  if(sc.head)out.push(textToHtml(sc.head),'<div><br></div>');
  for(const l of sc.lines){
    const parts=(l.h||lineHtml(l.text)).split(/<br\s*\/?>/);
    parts.forEach((p,i)=>out.push(`<div>${esc(i?indent:padTo(name(l.sp),max)+'：')}${p}</div>`));
  }
  return out.join('');
}
const lineHtml=t=>esc(t).replace(/\n/g,'<br>');
const hasFmt=el=>!!el.querySelector('b,strong,i,em,u,s,strike,del,span,font,sub,sup');
const spk=id=>sc.speakers.find(s=>s.id===id)||sc.speakers[0];
const idx=id=>sc.lines.findIndex(l=>l.id===id);
function nextSpeaker(id){const i=sc.speakers.findIndex(s=>s.id===id);return sc.speakers[(i+1)%sc.speakers.length].id}
function freeName(){for(const c of'ABCDEFGHIJKLMNOPQRSTUVWXYZ')if(!sc.speakers.some(s=>s.name===c))return c;return'新'}
function freeColor(){return COLORS.find(c=>!sc.speakers.some(s=>s.color===c))||COLORS[sc.speakers.length%COLORS.length]}

function rowEls(ln){
  const s=spk(ln.sp);
  const b=document.createElement('button');b.className='name';b.dataset.id=ln.id;b.style.color=s.color;
  const n=document.createElement('span');n.className='n';n.textContent=s.name;
  const c=document.createElement('span');c.textContent='：';
  b.append(n,c);
  const t=document.createElement('div');t.className='text rich';t.contentEditable='true';t.dataset.id=ln.id;
  t.setAttribute('enterkeyhint','next');t.setAttribute('role','textbox');t.setAttribute('autocapitalize','off');
  t.innerHTML=ln.h||lineHtml(ln.text);
  return[b,t];
}
function renderScript(){
  lastId=null;lastPos=0;
  $shead.value=sc.head;autosize($shead);
  renderChips();
  $script.replaceChildren(...sc.lines.flatMap(rowEls));
}
function renderChips(){
  const box=$('#speakers');box.replaceChildren();
  for(const s of sc.speakers){const b=document.createElement('button');b.className='chip';b.textContent=s.name;b.style.color=s.color;b.dataset.sp=s.id;box.append(b)}
  const e=document.createElement('button');e.className='chip plain';e.textContent='✎ 話者';e.dataset.edit='1';box.append(e);
}
function refreshNames(){
  $script.querySelectorAll('.name').forEach(b=>{const ln=sc.lines[idx(b.dataset.id)];if(!ln)return;const s=spk(ln.sp);b.style.color=s.color;b.querySelector('.n').textContent=s.name});
  renderChips();
}
const taOf=id=>$script.querySelector(`.text[data-id="${id}"]`);
const nameOf=id=>$script.querySelector(`.name[data-id="${id}"]`);
// 文字数で数えたカーソル位置（改行も1文字）
function caretOffset(el){
  const s=getSelection();if(!s.rangeCount||!el.contains(s.anchorNode))return 0;
  const r=document.createRange();r.selectNodeContents(el);r.setEnd(s.anchorNode,s.anchorOffset);
  let n=0;const f=r.cloneContents();
  (function walk(x){for(const c of x.childNodes){if(c.nodeType===3)n+=c.length;else if(c.nodeName==='BR')n++;else walk(c)}})(f);
  return n;
}
function textLen(el){let n=0;(function walk(x){for(const c of x.childNodes){if(c.nodeType===3)n+=c.length;else if(c.nodeName==='BR')n++;else walk(c)}})(el);return n}
function setCaret(el,pos){
  const r=document.createRange();let left=pos,done=false;
  (function walk(x){for(const c of x.childNodes){if(done)return;
    if(c.nodeType===3){if(c.length>=left){r.setStart(c,left);done=true;return}left-=c.length}
    else if(c.nodeName==='BR'){if(left===0){r.setStartBefore(c);done=true;return}left--}
    else walk(c)}})(el);
  if(!done){r.selectNodeContents(el);r.collapse(false)}else r.collapse(true);
  const s=getSelection();s.removeAllRanges();s.addRange(r);
}
function focusLine(id,pos){const t=taOf(id);if(!t)return;t.focus({preventScroll:false});setCaret(t,pos==null?1e9:pos)}
function insertAfter(prevId,ln){const t=taOf(prevId);const els=rowEls(ln);if(t)t.after(...els);else $script.append(...els)}
function removeRow(id){taOf(id)?.remove();nameOf(id)?.remove()}
// 行の中身（HTML）から、テキストと書式を読み直す
function updateLine(t){
  const ln=sc.lines[idx(t.dataset.id)];if(!ln)return;
  fixFormat(t);
  ln.text=toText(t);ln.h=hasFmt(t)?t.innerHTML:null;
}

$shead.addEventListener('input',()=>{sc.head=$shead.value;autosize($shead);sync()});
$script.addEventListener('input',e=>{
  const t=e.target.closest&&e.target.closest('.text');if(!t)return;
  updateLine(t);lastPos=caretOffset(t);sync();
});
$script.addEventListener('paste',e=>{
  if(!e.target.closest||!e.target.closest('.text'))return;
  const d=e.clipboardData,txt=d&&d.getData('text/plain');if(txt==null)return;
  e.preventDefault();document.execCommand('insertText',false,txt);
});
$script.addEventListener('focusin',e=>{
  const t=e.target.closest&&e.target.closest('.text');if(!t)return;
  lastId=t.dataset.id;
  $script.querySelectorAll('.name.active').forEach(n=>n.classList.remove('active'));
  nameOf(lastId)?.classList.add('active');
});
['keyup','click'].forEach(ev=>$script.addEventListener(ev,e=>{const t=e.target.closest&&e.target.closest('.text');if(t)lastPos=caretOffset(t)}));
$script.addEventListener('keydown',e=>{
  const t=e.target.closest&&e.target.closest('.text');if(!t)return;
  if(e.isComposing||e.keyCode===229)return;
  const id=t.dataset.id,i=idx(id),ln=sc.lines[i],sel=getSelection();
  if(e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    // カーソルから後ろを次の行へ（書式ごと）
    const r=sel.getRangeAt(0);r.deleteContents();
    const tail=document.createRange();tail.setStart(r.startContainer,r.startOffset);tail.setEnd(t,t.childNodes.length);
    const d=document.createElement('div');d.append(tail.extractContents());
    if(!t.textContent&&!t.querySelector('br'))t.innerHTML='';
    updateLine(t);fixFormat(d);
    const nl={id:uid(),sp:nextSpeaker(ln.sp),text:toText(d),h:hasFmt(d)?d.innerHTML:null};
    sc.lines.splice(i+1,0,nl);insertAfter(id,nl);focusLine(nl.id,0);sync();
  }else if(e.key==='Backspace'&&sel.isCollapsed&&caretOffset(t)===0&&i>0){
    e.preventDefault();
    const prev=sc.lines[i-1],pt=taOf(prev.id),p=toText(pt).length;
    if(pt.lastChild&&pt.lastChild.nodeName==='BR')pt.lastChild.remove();
    pt.append(...t.childNodes);sc.lines.splice(i,1);removeRow(id);
    updateLine(pt);focusLine(prev.id,p);sync();
  }else if(e.key==='ArrowUp'&&caretOffset(t)===0&&i>0){e.preventDefault();focusLine(sc.lines[i-1].id)}
  else if(e.key==='ArrowDown'&&caretOffset(t)>=textLen(t)&&i<sc.lines.length-1){e.preventDefault();focusLine(sc.lines[i+1].id,0)}
});
$script.addEventListener('click',e=>{const b=e.target.closest('.name');if(b)openLine(b.dataset.id)});

let wasEditing=false;
$('#speakers').addEventListener('pointerdown',e=>{wasEditing=!!document.activeElement&&!!document.activeElement.closest('#script .text');if(e.target.closest('.chip'))e.preventDefault()});
$('#speakers').addEventListener('click',e=>{
  const c=e.target.closest('.chip');if(!c)return;
  if(c.dataset.edit){openSpk();return}
  const ln=lastId&&sc.lines[idx(lastId)];
  if(ln){ln.sp=c.dataset.sp;refreshNames();sync();if(wasEditing)focusLine(ln.id,lastPos)}
  else addLine(c.dataset.sp);
});
function addLine(sp){
  const last=sc.lines[sc.lines.length-1];
  const nl={id:uid(),sp:sp||(last?nextSpeaker(last.sp):sc.speakers[0].id),text:''};
  sc.lines.push(nl);last?insertAfter(last.id,nl):renderScript();focusLine(nl.id,0);sync();
}
$('#btnAdd').addEventListener('click',()=>{
  const last=sc.lines[sc.lines.length-1];
  if(last&&last.text===''){focusLine(last.id,0);return}
  addLine();
});
function openLine(id){
  const i=idx(id),ln=sc.lines[i];
  const pick=document.createElement('div');pick.className='pick';
  for(const s of sc.speakers){
    const c=document.createElement('button');c.className='chip';c.textContent=s.name;c.style.color=s.color;
    if(s.id===ln.sp){c.style.background=s.color;c.style.color='#fff';c.style.borderColor=s.color}
    c.addEventListener('click',()=>{ln.sp=s.id;refreshNames();sync();$dlg.close()});pick.append(c);
  }
  const ins=off=>()=>{const nl={id:uid(),sp:off?nextSpeaker(ln.sp):ln.sp,text:''};sc.lines.splice(i+off,0,nl);renderScript();focusLine(nl.id,0);sync()};
  const mv=dir=>()=>{const j=i+dir;if(j<0||j>=sc.lines.length)return;[sc.lines[i],sc.lines[j]]=[sc.lines[j],sc.lines[i]];renderScript();sync()};
  sheet('この行',[pick,
    item('↑ 上に行を挿入',ins(0)),item('↓ 下に行を挿入',ins(1)),
    item('上へ移動',mv(-1)),item('下へ移動',mv(1)),
    item('この行を削除',()=>{sc.lines.splice(i,1);if(!sc.lines.length)sc.lines.push({id:uid(),sp:sc.speakers[0].id,text:''});renderScript();sync()},{cls:'danger'})
  ]);
}
function openSpk(){
  const rows=sc.speakers.map(s=>{
    const row=document.createElement('div');row.className='sprow';
    const dot=document.createElement('button');dot.className='dot';dot.style.background=s.color;dot.setAttribute('aria-label','色を変更');
    dot.addEventListener('click',()=>{s.color=COLORS[(COLORS.indexOf(s.color)+1)%COLORS.length];dot.style.background=s.color;refreshNames();sync()});
    const inp=document.createElement('input');inp.value=s.name;inp.placeholder='名前';
    inp.addEventListener('input',()=>{s.name=cleanName(inp.value)||'?';refreshNames();sync()});
    const del=document.createElement('button');del.className='tbtn';del.textContent='削除';
    del.addEventListener('click',()=>{
      if(sc.speakers.length<=1){toast('話者は1人以上必要です');return}
      const used=sc.lines.filter(l=>l.sp===s.id).length,rest=sc.speakers.filter(x=>x.id!==s.id);
      if(used&&!confirm(`「${s.name}」の${used}行は「${rest[0].name}」に変更されます。削除しますか？`))return;
      sc.speakers=rest;sc.lines.forEach(l=>{if(l.sp===s.id)l.sp=rest[0].id});renderScript();sync();openSpk();
    });
    row.append(dot,inp,del);return row;
  });
  sheet('話者の編集',[...rows,item('＋ 話者を追加',()=>{
    sc.speakers.push({id:uid(),name:freeName(),color:freeColor()});refreshNames();sync();openSpk();
    const ins=$('#dlgList').querySelectorAll('input');ins[ins.length-1].select();
  },{keep:true})]);
}

/* ---------- シート ---------- */
$dlg.addEventListener('click',e=>{if(e.target===$dlg||e.target.closest('[data-close]'))$dlg.close()});
function sheet(title,nodes){$('#dlgTitle').textContent=title;$('#dlgList').replaceChildren(...nodes);if(!$dlg.open)$dlg.showModal()}
function item(label,fn,opt={}){
  const b=document.createElement('button');b.className='item'+(opt.cls?' '+opt.cls:'');
  const s=document.createElement('span');s.textContent=label;b.append(s);
  if(opt.small){const m=document.createElement('small');m.textContent=opt.small;b.append(m)}
  b.addEventListener('click',()=>{if(!opt.keep)$dlg.close();fn()});return b;
}
function noteEl(text){const d=document.createElement('div');d.className='note';d.textContent=text;return d}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),2200)}

/* ---------- メニュー ---------- */
$('#btnListMenu').addEventListener('click',()=>{
  const nTrash=Object.values(notes).filter(n=>n.deleted).length;
  sheet('メニュー',[
    item('新規メモ',()=>goNote(newNote(),true)),
    item('新規台本',()=>goNote(newNote('','script'),true)),
    item('クリップボードから新規メモ',async()=>{const t=await readClip();if(t==null)return;const n=newNote(t,looksLikeScript(t)?'script':'memo');touch(n);persistNow();goNote(n)}),
    item('ファイルを読み込む（.txt / .json）',()=>$('#file').click()),
    item('すべて .txt で書き出し',exportAllTxt,{small:'ファイルAppへ'}),
    item('バックアップを書き出し（.json）',exportBackup),
    item('最近削除した項目',openTrash,{small:nTrash?nTrash+'件':''}),
    item('最新版に更新',forceUpdate,{small:'メモは消えません'}),
    noteEl('iPhoneの「メモ」へは、各メモの共有ボタン →「メモ」で送れます。「メモ」から取り込むときは、全文をコピーして「クリップボードから新規メモ」を使ってください。')
  ]);
});
$('#btnShare').addEventListener('click',()=>shareText(cur));
$('#btnNoteMenu').addEventListener('click',()=>{
  const n=cur;
  sheet(titleOf(n).title,[
    item(n.pinned?'ピン留めを解除':'ピン留め',()=>{n.pinned=!n.pinned;notes[n.id]=n;schedule();toast(n.pinned?'ピン留めしました':'ピン留めを解除しました')}),
    item('iPhoneの「メモ」へ送る',()=>shareText(n)),
    item(n.html?'コピー（書式つき）':'テキストをコピー',async()=>{
      try{
        if(n.html&&window.ClipboardItem&&navigator.clipboard.write)await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([exportHtml(n.html)],{type:'text/html'}),'text/plain':new Blob([n.text],{type:'text/plain'})})]);
        else await navigator.clipboard.writeText(n.text);
        toast('コピーしました');
      }catch{try{await navigator.clipboard.writeText(n.text);toast('コピーしました')}catch{toast('コピーできませんでした')}}
    }),
    item('クリップボードの内容で置き換え',async()=>{
      const t=await readClip();if(t==null)return;
      if(n.text.trim()&&!confirm('このメモの内容を、クリップボードの内容で置き換えますか？'))return;
      n.text=t;delete n.html;touch(n);persistNow();setMode(n.mode);toast('置き換えました');
    }),
    item('.txt ファイルで保存',()=>saveFiles([new File([n.text],fileBase(n)+'.txt',{type:'text/plain'})])),
    item('複製',()=>{const c={...structuredClone(n),id:uid(),pinned:false,created:Date.now()};touch(c);persistNow();history.replaceState(null,'','#/n/'+c.id);openNote(c);toast('複製しました')}),
    item('削除',()=>{if(isEmpty(n)){goList();return}trash(n);goList()},{cls:'danger'})
  ]);
});

function trash(n){n.deleted=Date.now();n.pinned=false;notes[n.id]=n;persistNow();toast('「最近削除した項目」に移動しました')}
function openTrash(){
  const arr=Object.values(notes).filter(n=>n.deleted).sort((a,b)=>b.deleted-a.deleted);
  const left=n=>Math.max(0,TRASH_DAYS-Math.floor((Date.now()-n.deleted)/DAY));
  sheet('最近削除した項目',[
    noteEl(`削除したメモは${TRASH_DAYS}日後に完全に削除されます。タップで復元できます。`),
    ...arr.map(n=>item(titleOf(n).title,()=>sheet(titleOf(n).title,[
      item('復元',()=>{delete n.deleted;persistNow();renderList();toast('復元しました')}),
      item('完全に削除',()=>{if(!confirm('完全に削除しますか？元に戻せません。'))return;delete notes[n.id];persistNow();gcImgs()},{cls:'danger'})
    ]),{small:`あと${left(n)}日`,keep:true})),
    ...(arr.length?[item('すべて完全に削除',()=>{if(!confirm(`${arr.length}件を完全に削除しますか？元に戻せません。`))return;arr.forEach(n=>delete notes[n.id]);persistNow();gcImgs()},{cls:'danger'})]:[noteEl('ありません')])
  ]);
}

// アプリのファイルだけを取り直す（メモは localStorage にあるので消えない）
async function forceUpdate(){
  flush();toast('更新しています…');
  try{const r=await fetch('sw.js',{cache:'no-store'});if(!r.ok)throw 0}
  catch{toast('通信できないため更新できません');return}
  try{
    const reg=navigator.serviceWorker&&await navigator.serviceWorker.getRegistration();
    if(reg)await reg.update().catch(()=>{});
    if(window.caches)for(const k of await caches.keys())await caches.delete(k);
    // ブラウザ側の古いコピーも取り直しておく
    await Promise.all(['./','index.html','style.css','app.js','manifest.json'].map(u=>fetch(u,{cache:'reload'}).catch(()=>{})));
  }catch{}
  location.reload();
}

/* ---------- iPhoneの「メモ」連携・ファイル ---------- */
async function shareText(n){
  if(isEmpty(n)){toast('メモが空です');return}
  flush();
  if(navigator.share){
    const data=n.text.trim()?{text:n.text}:{};
    const files=await noteFiles(n);
    if(files.length&&navigator.canShare&&navigator.canShare({files}))data.files=files;
    try{await navigator.share(data);return}
    catch(e){if(e.name==='AbortError')return;if(e.name==='NotAllowedError'&&data.files){shareLater(data);return}}
  }
  if(!n.text.trim()){toast('共有できませんでした');return}
  try{await navigator.clipboard.writeText(n.text);toast('共有できないためコピーしました。「メモ」に貼り付けてください')}catch{toast('共有できませんでした')}
}
async function readClip(){
  try{const t=await navigator.clipboard.readText();if(!t||!t.trim()){toast('クリップボードが空です');return null}return t.replace(/\r\n?/g,'\n')}
  catch{toast('クリップボードを読み取れませんでした');return null}
}
async function saveFiles(files){
  // 共有シート →「ファイルに保存」でファイルAppへ
  if(!(navigator.canShare&&navigator.canShare({files}))){toast('この端末ではファイルを書き出せません');return}
  try{await navigator.share({files})}
  catch(e){if(e.name==='NotAllowedError')shareLater({files});else if(e.name!=='AbortError')toast('書き出せませんでした')}
}
// 準備に時間がかかると共有シートを開けないので、ボタンをもう一度押してもらう
function shareLater(data){
  sheet('準備ができました',[item('共有・保存する',()=>navigator.share(data).catch(e=>{if(e.name!=='AbortError')toast('共有できませんでした')}))]);
}
const stamp=()=>{const d=new Date();return`${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}`};
function exportAllTxt(){
  const arr=live().filter(n=>n.text.trim());if(!arr.length){toast('メモがありません');return}
  const used={};
  saveFiles(arr.map(n=>{let b=fileBase(n),name=b,i=2;while(used[name])name=`${b} (${i++})`;used[name]=1;return new File([n.text],name+'.txt',{type:'text/plain'})}));
}
async function exportBackup(){
  const arr=live();if(!arr.length){toast('メモがありません');return}
  const images={};
  for(const id of new Set(arr.flatMap(n=>n.imgs||[]))){try{const b=await imgBlob(id);if(b)images[id]=await toDataURL(b)}catch{}}
  saveFiles([new File([JSON.stringify({app:'netamemo',version:1,notes:arr,images},null,1)],`ネタメモ_バックアップ_${stamp()}.json`,{type:'application/json'})]);
}
$('#file').addEventListener('change',async e=>{
  const files=[...e.target.files];e.target.value='';if(!files.length)return;
  const added=[];let bad=0;
  for(const f of files){
    const txt=(await f.text()).replace(/^﻿/,'').replace(/\r\n?/g,'\n');
    try{
      if(/\.json$/i.test(f.name)){
        const o=JSON.parse(txt);
        if(o&&o.app==='netamemo'&&o.images&&typeof o.images==='object')
          for(const[id,u]of Object.entries(o.images))if(typeof u==='string'&&u.startsWith('data:image/'))await imgPut(id,await(await fetch(u)).blob());
        const list=o&&o.app==='netamemo'&&Array.isArray(o.notes)?o.notes.map(validNote):(Array.isArray(o)?o:o.scripts?o.scripts:[o]).map(fromScript);
        const ok=list.filter(Boolean);if(!ok.length)throw 0;
        for(const n of ok)if(!notes[n.id]||notes[n.id].updated<n.updated){notes[n.id]=n;added.push(n)}
      }else{
        if(!txt.trim())throw 0;
        const n=newNote(txt,looksLikeScript(txt)?'script':'memo');notes[n.id]=n;added.push(n);
      }
    }catch{bad++}
  }
  persistNow();
  if(bad)toast(`${bad}件のファイルは読み込めませんでした`);
  else toast(added.length?`${added.length}件読み込みました`:'新しいメモはありませんでした');
  if(added.length===1&&!added[0].deleted)goNote(added[0]);else renderList();
});

/* ---------- 写真（容量が大きいので IndexedDB に保存） ---------- */
let dbp=null;
function idb(){
  return dbp||(dbp=new Promise((ok,ng)=>{const r=indexedDB.open('netamemo',1);r.onupgradeneeded=()=>r.result.createObjectStore('img');r.onsuccess=()=>ok(r.result);r.onerror=()=>{dbp=null;ng(r.error)}}));
}
async function store(mode,fn){
  const db=await idb();
  return new Promise((ok,ng)=>{const t=db.transaction('img',mode),r=fn(t.objectStore('img'));t.oncomplete=()=>ok(r.result);t.onerror=t.onabort=()=>ng(t.error)});
}
const blobs={},urls={};
async function imgBlob(id){if(!blobs[id]){const b=await store('readonly',s=>s.get(id));if(b)blobs[id]=b}return blobs[id]||null}
async function imgURL(id){if(!urls[id]){const b=await imgBlob(id);if(b)urls[id]=URL.createObjectURL(b)}return urls[id]||null}
const imgPut=(id,b)=>store('readwrite',s=>s.put(b,id)).then(()=>{blobs[id]=b});
const toDataURL=b=>new Promise((ok,ng)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>ng(r.error);r.readAsDataURL(b)});
async function noteFiles(n){
  const out=[];
  for(const[i,id]of(n.imgs||[]).entries()){try{const b=await imgBlob(id);if(b)out.push(new File([b],`${fileBase(n)}_${i+1}.jpg`,{type:b.type||'image/jpeg'}))}catch{}}
  return out;
}
// どのメモからも使われなくなった写真を消す（複製したメモは写真を共有している）
async function gcImgs(){
  try{
    const used=new Set(Object.values(notes).flatMap(n=>n.imgs||[]));
    const keys=await store('readonly',s=>s.getAllKeys());
    const gone=keys.filter(k=>!used.has(k));if(!gone.length)return;
    await store('readwrite',s=>{gone.forEach(k=>s.delete(k));return{}});
    gone.forEach(k=>{if(urls[k])URL.revokeObjectURL(urls[k]);delete urls[k];delete blobs[k]});
  }catch{}
}
// 長辺2048pxまで縮めてJPEGにする
async function shrink(file,max=2048){
  const u=URL.createObjectURL(file);
  try{
    const img=new Image();img.src=u;await img.decode();
    const w=img.naturalWidth,h=img.naturalHeight,k=Math.min(1,max/Math.max(w,h));
    if(k===1&&file.type==='image/jpeg'&&file.size<1.5e6)return file;
    const c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);
    const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);
    const b=await new Promise(ok=>c.toBlob(ok,'image/jpeg',.85));if(!b)throw 0;return b;
  }finally{URL.revokeObjectURL(u)}
}
function renderImgs(){
  const ids=(cur&&cur.imgs)||[],box=$('#imgs');
  box.hidden=!ids.length;$('#vNote').classList.toggle('has-imgs',!!ids.length);
  box.replaceChildren(...ids.map(id=>{
    const b=document.createElement('button');b.className='ph';b.dataset.id=id;b.setAttribute('aria-label','写真');
    const i=document.createElement('img');i.alt='';b.append(i);
    imgURL(id).then(u=>{if(u)i.src=u}).catch(()=>{});
    return b;
  }));
}
$('#btnPhoto').addEventListener('click',()=>{if(document.activeElement)document.activeElement.blur();$('#photo').click()});
$('#photo').addEventListener('change',async e=>{
  const files=[...e.target.files];e.target.value='';const n=cur;if(!files.length||!n)return;
  toast('写真を追加しています…');
  let ok=0,bad=0;
  for(const f of files){
    try{const b=await shrink(f),id=uid();await imgPut(id,b);(n.imgs||(n.imgs=[])).push(id);ok++}catch{bad++}
  }
  if(ok){touch(n);persistNow();if(cur===n)renderImgs()}
  toast(bad?`${bad}枚の写真を追加できませんでした`:`写真を${ok}枚追加しました`);
});
$('#imgs').addEventListener('click',e=>{const b=e.target.closest('.ph');if(b)openViewer(b.dataset.id)});
let vId=null;
async function openViewer(id){
  vId=id;const v=$('#viewer');v.querySelector('img').src=await imgURL(id).catch(()=>null)||'';v.hidden=false;
}
function closeViewer(){$('#viewer').hidden=true;$('#viewer img').removeAttribute('src');vId=null}
$('#viewer').addEventListener('click',async e=>{
  const b=e.target.closest('[data-v]');if(!b||!vId)return;
  const act=b.dataset.v,id=vId,n=cur;
  if(act==='close')closeViewer();
  else if(act==='share'){
    const blob=blobs[id];if(!blob)return;
    saveFiles([new File([blob],`${n?fileBase(n):'写真'}.jpg`,{type:blob.type||'image/jpeg'})]);
  }else if(act==='del'){
    if(!n||!confirm('この写真を削除しますか？元に戻せません。'))return;
    n.imgs=(n.imgs||[]).filter(x=>x!==id);if(!n.imgs.length)delete n.imgs;
    touch(n);persistNow();closeViewer();renderImgs();gcImgs();
  }
});
// 写真の下の余白をタップしたら本文の最後にカーソル
$('.foot').addEventListener('click',()=>{if(cur&&cur.mode==='memo')caretEnd($memo)});

/* ---------- 書式つきメモ ---------- */
// 本文はHTML（n.html）で保存し、台本・共有・検索用にテキスト（n.text）も一緒に持つ
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const textToHtml=t=>t?t.split('\n').map(l=>`<div>${l?esc(l):'<br>'}</div>`).join(''):'';
const OK_TAGS=new Set('DIV P BR H1 H2 H3 PRE B STRONG I EM U S STRIKE DEL SPAN FONT UL OL LI TABLE TBODY THEAD TR TD TH HR BLOCKQUOTE CODE SUB SUP'.split(' '));
const DROP_TAGS=/^(SCRIPT|STYLE|TEMPLATE|IFRAME|OBJECT|EMBED|NOSCRIPT|TITLE|META|LINK|HEAD|SVG|MATH|IMG|VIDEO|AUDIO|CANVAS|INPUT|BUTTON|SELECT|TEXTAREA)$/i;
const OK_STYLE=['color','background-color','text-align','font-weight','font-style','text-decoration-line'];
// 保存・貼り付けのときに、許可したタグと書式だけを残す
function clean(html,paste){
  const t=document.createElement('template');t.innerHTML=html;
  (function walk(el){
    for(const c of[...el.childNodes]){
      if(c.nodeType===3)continue;
      if(c.nodeType!==1||DROP_TAGS.test(c.tagName)){c.remove();continue}
      walk(c);
      if(!OK_TAGS.has(c.tagName)){c.replaceWith(...c.childNodes);continue}
      const st=OK_STYLE.filter(k=>!(paste&&/color/.test(k))).map(k=>[k,c.style.getPropertyValue(k)]).filter(([,v])=>v&&!/url|expression|\\/i.test(v));
      const cls=[...c.classList].filter(x=>x==='chk'||x==='done');
      const keep={};
      if(c.tagName==='FONT'){if(!paste&&c.getAttribute('color'))keep.color=c.getAttribute('color');if(!paste&&/^[1-7]$/.test(c.getAttribute('size')||''))keep.size=c.getAttribute('size')}
      if(/^(TD|TH)$/.test(c.tagName)){for(const k of['colspan','rowspan'])if(/^\d{1,2}$/.test(c.getAttribute(k)||''))keep[k]=c.getAttribute(k)}
      for(const a of[...c.attributes])c.removeAttribute(a.name);
      for(const[k,v]of st)c.style.setProperty(k,v);
      cls.forEach(x=>c.classList.add(x));
      for(const k in keep)c.setAttribute(k,keep[k]);
      if((c.tagName==='SPAN'||c.tagName==='FONT')&&!c.attributes.length)c.replaceWith(...c.childNodes);
    }
  })(t.content);
  return t.innerHTML;
}
// 共有・コピー用（var(--fg) は外のアプリでは使えないので外す）
const exportHtml=h=>h.replace(/color:\s*var\(--fg\);?/g,'');
function toText(root){
  const out=[];let line='';
  const flush=()=>{out.push(line);line=''};
  const BLOCK=/^(DIV|P|H1|H2|H3|PRE|BLOCKQUOTE|LI|TR|UL|OL|TABLE|TBODY|THEAD)$/;
  (function walk(n,depth){
    for(const c of n.childNodes){
      if(c.nodeType===3){const v=c.nodeValue.replace(/ /g,' ').split('\n');v.forEach((x,i)=>{if(i)flush();line+=x});continue}
      if(c.nodeType!==1)continue;
      const t=c.tagName;
      if(t==='BR'){flush();continue}
      if(t==='HR'){if(line)flush();out.push('――――――');continue}
      const block=BLOCK.test(t);
      if(block&&line)flush();
      const start=out.length;
      if(t==='LI'){
        const p=c.parentElement,i=[...p.children].filter(x=>x.tagName==='LI').indexOf(c);
        line='　'.repeat(Math.max(0,depth-1))+(p.classList.contains('chk')?(c.classList.contains('done')?'☑ ':'☐ '):p.tagName==='OL'?`${i+1}. `:'・');
      }
      if((t==='TD'||t==='TH')&&c.previousElementSibling)line+=' | ';
      walk(c,depth+(t==='UL'||t==='OL'?1:0));
      if(block){
        if(line){if(out.length>start&&/^[　]*(・|☐ |☑ |\d+\. )$/.test(line))line='';else flush()}
        else if(out.length===start&&/^(DIV|P|H1|H2|H3|PRE)$/.test(t))out.push('');
      }
    }
  })(root,0);
  if(line)flush();
  return out.join('\n').replace(/\n+$/,'');
}
function renderRich(){
  $memo.innerHTML=cur.html!=null?clean(cur.html):textToHtml(cur.text);
  updateBlank();
}
function updateBlank(){$memo.classList.toggle('blank',!$memo.textContent&&!$memo.querySelector('table,hr,li'))}
// 「標準」の色（目印の色）をテーマに合わせた色に置き換える
function fixFormat(root){
  root.querySelectorAll('[style]').forEach(el=>{
    if(el.style.color==='rgb(1, 2, 3)')el.style.color='var(--fg)';
    if(el.style.backgroundColor==='rgb(1, 2, 3)')el.style.backgroundColor='transparent';
    if(!el.getAttribute('style'))el.removeAttribute('style');
  });
  root.querySelectorAll('span:not([style]):not([class])').forEach(el=>el.replaceWith(...el.childNodes));
}
function memoChanged(){
  fixFormat($memo);
  updateBlank();
  const h=$memo.innerHTML;if(h===cur.html)return;
  cur.html=h;cur.text=toText($memo);touch(cur);
}
$memo.addEventListener('input',()=>{
  $memo.querySelectorAll('ul.chk>li.done').forEach(li=>{if(!li.textContent.trim())li.classList.remove('done')});
  memoChanged();
});
// 貼り付けは書式を整理してから（色は外す）
$memo.addEventListener('paste',e=>{
  const d=e.clipboardData;if(!d)return;
  const h=d.getData('text/html'),t=d.getData('text/plain');
  if(!h&&!t)return;
  e.preventDefault();
  if(h)document.execCommand('insertHTML',false,clean(h,true));else document.execCommand('insertText',false,t);
});
// チェックリストの丸をタップでチェック
$memo.addEventListener('click',e=>{
  const li=e.target.closest&&e.target.closest('ul.chk>li');
  if(!li||e.target!==li||e.clientX>=li.getBoundingClientRect().left)return;
  e.preventDefault();li.classList.toggle('done');memoChanged();
});
function caretEnd(el){
  el.focus({preventScroll:false});
  const r=document.createRange();r.selectNodeContents(el);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);
}
function caretIn(el){const r=document.createRange();r.selectNodeContents(el);r.collapse(true);$memo.focus();const s=getSelection();s.removeAllRanges();s.addRange(r)}
try{document.execCommand('defaultParagraphSeparator',false,'div')}catch{}

let saved=null,savedEl=null;
const hostOf=n=>{if(n&&n.nodeType===3)n=n.parentElement;return n&&n.closest?n.closest('#memo,#script .text'):null};
document.addEventListener('selectionchange',()=>{
  const s=getSelection();if(!s.rangeCount)return;
  const h=hostOf(s.anchorNode);
  if(h){saved=s.getRangeAt(0).cloneRange();savedEl=h;if(!$('#fpanel').hidden)updatePanel()}
});
// いま書式をかける場所：メモなら本文、台本なら最後に触った行
function edRoot(){
  if(!cur)return null;
  if(cur.mode!=='script')return $memo;
  return savedEl&&$script.contains(savedEl)?savedEl:null;
}
function selEl(){
  const root=edRoot();if(!root)return null;
  const s=getSelection();let n=s.rangeCount&&root.contains(s.anchorNode)?s.anchorNode:saved&&saved.startContainer;
  if(n&&n.nodeType===3)n=n.parentElement;
  return n&&root.contains(n)?n:null;
}
function restoreSel(){
  const root=edRoot();if(!root)return null;
  if(document.activeElement===root)return root;
  root.focus({preventScroll:true});
  if(saved&&root.contains(saved.startContainer)){const s=getSelection();s.removeAllRanges();s.addRange(saved)}
  else caretEnd(root);
  return root;
}
function edited(root){
  if(root===$memo)memoChanged();
  else if(root&&sc){updateLine(root);sync()}
}
function exec(cmd,val,css){
  const root=restoreSel();if(!root){toast('書式をつけたいセリフをタップしてください');return false}
  try{document.execCommand('styleWithCSS',false,!!css)}catch{}
  const ok=document.execCommand(cmd,false,val??null);
  try{document.execCommand('styleWithCSS',false,false)}catch{}
  edited(root);return ok;
}
// 括弧を入れる（文字を選んでいたら、その文字を囲む）
function bracket(o,c){
  const ae=document.activeElement;
  if(ae&&(ae.tagName==='TEXTAREA'||ae.tagName==='INPUT')&&ae.closest('#vNote')){
    const a=ae.selectionStart,b=ae.selectionEnd,mid=ae.value.slice(a,b);
    ae.setRangeText(o+mid+c,a,b,'end');if(!mid)ae.setSelectionRange(a+o.length,a+o.length);
    ae.dispatchEvent(new Event('input',{bubbles:true}));return;
  }
  const root=restoreSel();if(!root){toast('入力したい場所をタップしてください');return}
  const s=getSelection(),mid=s.toString();
  document.execCommand('insertText',false,o+mid+c);
  if(!mid&&s.modify)s.modify('move','backward','character');
  edited(root);
}
const listOf=()=>{const el=selEl();const li=el&&el.closest('li');return li&&$memo.contains(li)?li.parentElement:null};
function setList(kind){
  const ul=listOf();
  if(kind==='check'){
    if(ul&&ul.classList.contains('chk')){exec('insertUnorderedList');return}
    if(!(ul&&ul.tagName==='UL'))exec('insertUnorderedList');
    listOf()?.classList.add('chk');memoChanged();return;
  }
  if(kind==='ul'&&ul&&ul.classList.contains('chk')){ul.classList.remove('chk');memoChanged();return}
  exec(kind==='ul'?'insertUnorderedList':'insertOrderedList');
}
function setBlock(tag){
  if(!exec('formatBlock',`<${tag}>`)&&tag==='div')exec('formatBlock','<p>');
}

/* 書式パネル（Aa） */
const TXT_COLORS=[['標準','rgb(1, 2, 3)'],['赤','#ff3b30'],['オレンジ','#ff9500'],['黄','#d4a300'],['緑','#34c759'],['青','#0a84ff'],['紫','#af52de'],['ピンク','#ff2d92'],['グレー','#8e8e93']];
const HL_COLORS=[['なし','rgb(1, 2, 3)'],['黄','rgba(255,214,10,.45)'],['緑','rgba(52,199,89,.35)'],['青','rgba(10,132,255,.3)'],['ピンク','rgba(255,45,146,.3)'],['オレンジ','rgba(255,149,0,.38)']];
const PANEL=[
  ['', [['b:h1','タイトル'],['b:h2','見出し'],['b:h3','小見出し'],['b:div','本文'],['b:pre','等幅']]],
  ['', [['c:bold','<b>B</b>'],['c:italic','<i style="font-family:serif">I</i>'],['c:underline','<u>U</u>'],['c:strikeThrough','<s>S</s>'],['c:superscript','x²'],['c:subscript','x₂']]],
  ['', [['l:ul','・ 箇条書き'],['l:ol','1. 番号'],['l:check','◯ チェック'],['c:outdent','⇤'],['c:indent','⇥']]],
  ['配置', [['c:justifyLeft','左'],['c:justifyCenter','中央'],['c:justifyRight','右']]],
  ['文字の大きさ', [['s:2','小'],['s:3','標準'],['s:5','大'],['s:6','特大']]],
  ['文字の色', TXT_COLORS.map(([n,c],i)=>['fc:'+c,'',i?c:'none',n])],
  ['マーカー', HL_COLORS.map(([n,c],i)=>['hc:'+c,'',i?c:'none',n])],
  ['', [['x:hr','― 区切り線'],['x:clear','書式をクリア']]]
];
(function buildPanel(){
  const p=$('#fpanel');
  const h=document.createElement('div');h.className='fp-h';h.innerHTML='<span>書式</span><button data-close aria-label="閉じる">✕</button>';p.append(h);
  for(const[label,btns]of PANEL){
    if(label){const l=document.createElement('div');l.className='fp-l';l.textContent=label;p.append(l)}
    const r=document.createElement('div');r.className='fp-r';
    for(const[k,html,color,name]of btns){
      const b=document.createElement('button');b.dataset.k=k;b.innerHTML=html;
      if(/^(b:|l:|x:hr|c:(outdent|indent|justify))/.test(k))b.classList.add('mo');
      if(color){b.className='cl'+(color==='none'?' none':'');if(color!=='none')b.style.background=color;b.setAttribute('aria-label',name)}
      r.append(b);
    }
    p.append(r);
    if([...r.children].every(b=>b.classList.contains('mo'))){r.classList.add('mo');if(label)r.previousElementSibling.classList.add('mo')}
  }
})();
// ボタンを押してもキーボード（入力位置）が消えないようにする
['#fbar','#fpanel'].forEach(sel=>$(sel).addEventListener('mousedown',e=>e.preventDefault()));
$('#fpanel').addEventListener('click',e=>{
  if(e.target.closest('[data-close]')){closePanel();return}
  const b=e.target.closest('[data-k]');if(!b||!cur)return;
  const[t,v]=b.dataset.k.split(/:(.*)/);
  if(t==='b')setBlock(v);
  else if(t==='c')exec(v);
  else if(t==='l')setList(v);
  else if(t==='s')exec('fontSize',v);
  else if(t==='fc')exec('foreColor',v,true);
  else if(t==='hc'){if(!exec('hiliteColor',v,true))exec('backColor',v,true)}
  else if(v==='hr')exec('insertHorizontalRule');
  else if(v==='clear'){exec('removeFormat');if(cur.mode!=='script')setBlock('div')}
  updatePanel();
});
function updatePanel(){
  const st=c=>{try{return document.queryCommandState(c)}catch{return false}};
  let blk='';try{blk=(document.queryCommandValue('formatBlock')||'').toLowerCase()}catch{}
  const ul=listOf(),chk=ul&&ul.classList.contains('chk');
  $('#fpanel').querySelectorAll('[data-k]').forEach(b=>{
    const[t,v]=b.dataset.k.split(/:(.*)/);let on=false;
    if(t==='b')on=v==='div'?!/^(h1|h2|h3|pre)$/.test(blk):blk===v;
    else if(t==='c'&&!/dent$/.test(v))on=st(v);
    else if(t==='l')on=v==='check'?!!chk:v==='ul'?!!ul&&ul.tagName==='UL'&&!chk:!!ul&&ul.tagName==='OL';
    b.classList.toggle('on',on);
  });
}
function openPanel(){$('#fpanel').hidden=false;$('#fbar [data-f=panel]').classList.add('on');updatePanel()}
function closePanel(){$('#fpanel').hidden=true;$('#fbar [data-f=panel]').classList.remove('on')}
$('#fbar').addEventListener('click',e=>{
  const b=e.target.closest('[data-f]');if(!b||!cur)return;
  const f=b.dataset.f;
  if(f==='panel'){$('#fpanel').hidden?openPanel():closePanel()}
  else if(f==='kagi')bracket('「','」');
  else if(f==='kakko')bracket('（','）');
  else if(f==='check')setList('check');
  else if(f==='table')tableMenu();
  else if(f==='undo'||f==='redo'){const r=restoreSel();if(r){document.execCommand(f);edited(r)}}
  else if(f==='done'){closePanel();if(document.activeElement)document.activeElement.blur()}
});

/* 表 */
function tableMenu(){
  const el=selEl(),cell=el&&el.closest('td,th');
  if(!cell){
    exec('insertHTML','<table><tbody>'+('<tr>'+'<td><br></td>'.repeat(3)+'</tr>').repeat(3)+'</tbody></table><div><br></div>');
    return;
  }
  const tr=cell.parentElement,tbl=cell.closest('table'),ci=[...tr.children].indexOf(cell);
  const td=()=>{const d=document.createElement('td');d.innerHTML='<br>';return d};
  const newRow=()=>{const r=document.createElement('tr');for(let i=0;i<tr.children.length;i++)r.append(td());return r};
  const rows=()=>[...tbl.querySelectorAll('tr')];
  const tidy=()=>{rows().forEach(r=>{if(!r.children.length)r.remove()});if(!tbl.querySelector('td,th')){const d=document.createElement('div');d.innerHTML='<br>';tbl.replaceWith(d);caretIn(d)}};
  const done=f=>{memoChanged();if(f&&$memo.contains(f))caretIn(f)};
  sheet('表',[
    item('上に行を追加',()=>{const r=newRow();tr.before(r);done(r.children[ci])}),
    item('下に行を追加',()=>{const r=newRow();tr.after(r);done(r.children[ci])}),
    item('左に列を追加',()=>{rows().forEach(r=>{const c=r.children[ci];c?c.before(td()):r.append(td())});done(tr.children[ci])}),
    item('右に列を追加',()=>{rows().forEach(r=>{const c=r.children[ci];c?c.after(td()):r.append(td())});done(tr.children[ci+1])}),
    item('この行を削除',()=>{const near=tr.nextElementSibling||tr.previousElementSibling;tr.remove();tidy();done(near&&near.children[ci])},{cls:'danger'}),
    item('この列を削除',()=>{rows().forEach(r=>r.children[ci]?.remove());const near=tr.children[ci]||tr.children[ci-1];tidy();done(near)},{cls:'danger'}),
    item('表を削除',()=>{const d=document.createElement('div');d.innerHTML='<br>';tbl.replaceWith(d);done(d)},{cls:'danger'})
  ]);
}

/* キーボードの上にツールバーを出す */
(function(){
  const vv=window.visualViewport,root=document.documentElement;
  const place=()=>{
    const h=vv?vv.height:innerHeight,kb=vv?Math.max(0,Math.round(innerHeight-vv.height-vv.offsetTop)):0;
    root.style.setProperty('--kb',kb+'px');root.style.setProperty('--vh',h+'px');
    root.classList.toggle('kb',kb>40);
  };
  if(vv){vv.addEventListener('resize',place);vv.addEventListener('scroll',place)}
  addEventListener('resize',place);place();
})();

/* ---------- 起動 ---------- */
(function init(){
  load();
  // 旧「漫才台本エディタ」のデータを移行
  try{
    if(localStorage.getItem(KEY)==null){
      const old=JSON.parse(localStorage.getItem(OLD_KEY)||'null');
      if(old)for(const s of Object.values(old)){const n=fromScript(s);if(n&&n.text.trim())notes[n.id]=n}
      persistNow();
    }
  }catch{}
  // 30日経ったゴミ箱を空にする
  let purged=false;
  for(const n of Object.values(notes))if(n.deleted&&Date.now()-n.deleted>TRASH_DAYS*DAY){delete notes[n.id];purged=true}
  if(purged)persistNow();
  route();
  gcImgs();
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
    const had=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(r=>{
      // アプリに戻ってきたときに更新を確認
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)r.update().catch(()=>{})});
    }).catch(()=>{});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had)$('#update').hidden=false});
  }
  // Safariで開いているときは「ホーム画面に追加」を案内
  const standalone=navigator.standalone||matchMedia('(display-mode: standalone)').matches;
  let dismissed=false;try{dismissed=!!localStorage.getItem('netamemo.installHint')}catch{}
  if(!standalone&&!dismissed)$('#install').hidden=false;
  document.querySelectorAll('.banner').forEach(b=>b.addEventListener('click',e=>{
    if(e.target.closest('[data-reload]')){flush();location.reload();return}
    if(e.target.closest('[data-x]')){b.hidden=true;if(b.id==='install')try{localStorage.setItem('netamemo.installHint','1')}catch{}}
  }));
  if(standalone)enableSwipeBack();
})();

/* ---------- 左端スワイプで一覧へ戻る（ホーム画面アプリ用） ---------- */
function enableSwipeBack(){
  const v=$('#vNote');let s=null;
  v.addEventListener('touchstart',e=>{
    const t=e.touches[0];
    s=e.touches.length===1&&t.clientX<28&&!$dlg.open?{x:t.clientX,y:t.clientY,dx:0,on:false}:null;
  },{passive:true});
  v.addEventListener('touchmove',e=>{
    if(!s)return;const t=e.touches[0],dx=t.clientX-s.x,dy=t.clientY-s.y;
    if(!s.on){
      if(Math.abs(dy)>10&&Math.abs(dy)>dx){s=null;return}
      if(dx<10)return;
      s.on=true;v.classList.add('swiping');if(document.activeElement)document.activeElement.blur();
    }
    e.preventDefault();s.dx=Math.max(0,dx);
    v.style.transform=`translateX(${s.dx}px)`;v.style.opacity=1-s.dx/innerWidth*.6;
  },{passive:false});
  const end=()=>{
    if(!s||!s.on){s=null;return}
    const go=s.dx>Math.min(110,innerWidth*.3);s=null;
    v.classList.remove('swiping');v.classList.add('snap');
    v.style.transform=go?'translateX(100%)':'';v.style.opacity=go?'0':'';
    const reset=()=>{v.classList.remove('snap');v.style.transform='';v.style.opacity=''};
    setTimeout(()=>{if(go){goList();setTimeout(reset,300)}else reset()},220);
  };
  v.addEventListener('touchend',end);v.addEventListener('touchcancel',end);
}
