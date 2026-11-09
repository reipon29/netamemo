const KEY='netamemo.notes.v1',OLD_KEY='manzai.scripts.v1',DAY=864e5,TRASH_DAYS=30;
const COLORS=['#e8590c','#1971c2','#2f9e44','#9c36b5','#c2255c','#0c8599','#e67700','#5c7cfa'];
const $=s=>document.querySelector(s);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
// ピンチ・ダブルタップでの拡大縮小を止める
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('gesturechange',e=>e.preventDefault());
document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault()},{passive:false});
const PREF='netamemo.prefs';
let prefs={};try{prefs=JSON.parse(localStorage.getItem(PREF))||{}}catch{}
const savePrefs=()=>{try{localStorage.setItem(PREF,JSON.stringify(prefs))}catch{}};
// ステータス
const STATUS={idea:['アイデア','#f59f00'],wip:['制作中','#1971c2'],done:['完成','#2f9e44'],drop:['ボツ','#8e8e93']};
const $notes=$('#notes'),$q=$('#q'),$memo=$('#memo'),$shead=$('#shead'),$script=$('#script');

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
addEventListener('storage',e=>{if(e.key!==KEY)return;load();if(cur&&cur.text.trim())notes[cur.id]=cur;if(!$('#vList').hidden)renderList()});
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});

function newNote(text='',mode='memo'){const t=Date.now();return{id:uid(),text,mode,spk:[],pinned:false,created:t,updated:t}}
const live=()=>Object.values(notes).filter(n=>!n.deleted);
function titleOf(n){
  const ls=n.text.split('\n').map(s=>s.trim()).filter(Boolean);
  return{title:ls[0]||'新規メモ',preview:ls[1]||'追加テキストなし'};
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

function lastSpeakers(){
  const n=live().filter(n=>n!==cur&&n.mode==='script'&&Array.isArray(n.spk)&&n.spk.some(p=>p&&p.name)).sort((a,b)=>b.updated-a.updated)[0];
  return n?n.spk.filter(p=>p&&p.name).map(p=>({name:cleanName(p.name)||'?',color:p.color})):[];
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
  // 話者がいないとき（新しい台本など）は、最後に使った台本の話者を使う
  if(!sc.speakers.length){const prev=lastSpeakers();if(prev.length)prev.forEach(p=>add(p.name,p.color));else{add('A');add('B')}}
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
  return{id:String(n.id||uid()),text:n.text,mode:n.mode==='script'?'script':'memo',spk:Array.isArray(n.spk)?n.spk:[],pinned:!!n.pinned,created:n.created||n.updated||t,updated:n.updated||t,...(n.deleted?{deleted:n.deleted}:{}),...(STATUS[n.status]?{status:n.status}:{})};
}

/* ---------- 画面遷移 ---------- */
let cur=null,sc=null,fromList=false,listY=0;
function show(view){
  $('#vList').hidden=view!=='list';$('#vNote').hidden=view!=='note';document.documentElement.dataset.view=view;
  $('meta[name=theme-color]').content=getComputedStyle(document.body).backgroundColor;
}
function route(){
  const m=location.hash.match(/^#\/n\/(.+)$/),n=m&&notes[m[1]];
  if(n&&!n.deleted)openNote(n);else{leaveNote();showList()}
}
addEventListener('popstate',route);
function leaveNote(){
  if(!cur)return;
  if(!cur.text.trim()){if(notes[cur.id]){delete notes[cur.id];persistNow()}}
  else flush();
  if(document.activeElement)document.activeElement.blur();
  endPractice(false);cur=null;sc=null;
}
function showList(){fromList=false;show('list');renderList();scrollTo(0,listY)}
function goNote(n,focus){
  if(!$('#vList').hidden)listY=scrollY;
  history.pushState(null,'','#/n/'+n.id);fromList=true;openNote(n);
  if(focus){if(sc)focusLine(sc.lines[0].id,0);else $memo.focus()}
}
function goList(){
  if(fromList)history.back();
  else{history.replaceState(null,'','#/');leaveNote();showList()}
}
function openNote(n){
  if(cur&&cur!==n)leaveNote();
  cur=n;show('note');
  setNdate();
  setMode(n.mode||'memo');
  scrollTo(0,0);
}
function setNdate(){
  if(!cur)return;const st=STATUS[cur.status];
  $('#ndate').textContent=fmtLong(cur.updated)+(st?' ・ '+st[0]:'');
}
function setMode(m){
  endPractice(false);
  cur.mode=m;
  $('#seg').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===m));
  const script=m==='script';
  $memo.hidden=script;$('#scriptWrap').hidden=!script;$('#spbar').hidden=!script;
  if(script){sc=parseScript(cur.text,cur.spk);renderScript()}
  else{sc=null;$memo.value=cur.text;autosize($memo)}
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
  const all=live();
  if(prefs.filter&&!STATUS[prefs.filter])prefs.filter='';
  renderFilters(all);
  const f=prefs.filter;
  const arr=all.filter(n=>(!q||n.text.toLowerCase().includes(q))&&(!f||n.status===f)).sort((a,b)=>b.updated-a.updated);
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
  if(!arr.length){const e=document.createElement('div');e.className='empty';e.textContent=q?`「${$q.value.trim()}」を含むメモはありません`:prefs.filter?`「${STATUS[prefs.filter][0]}」のメモはありません`:'メモはありません\n右下のボタンで作成';e.style.whiteSpace='pre-line';$notes.append(e)}
  $('#count').textContent=all.length?`${all.length}件のメモ`:'';
  backupNudge(all);
}
// 前回のバックアップから30日たったら、一覧の先頭にそっと出す
function backupNudge(all){
  if(!all.length)return;
  const now=Date.now(),base=prefs.lastBackup||Math.min(...all.map(n=>n.created||now));
  if(now-base<30*DAY||prefs.bkSnooze&&now-prefs.bkSnooze<7*DAY)return;
  const d=document.createElement('div');d.className='bk glass';
  const t=document.createElement('span');t.textContent=prefs.lastBackup?`最後のバックアップから${Math.floor((now-base)/DAY)}日たちました`:'バックアップしておきましょう';
  const go=document.createElement('button');go.className='go';go.textContent='書き出す';go.addEventListener('click',exportBackup);
  const x=document.createElement('button');x.className='x';x.setAttribute('aria-label','閉じる');x.textContent='✕';
  x.addEventListener('click',()=>{prefs.bkSnooze=now;savePrefs();d.remove()});
  d.append(t,go,x);$notes.prepend(d);
}
function renderFilters(all){
  const box=$('#filters'),cnt={};
  for(const n of all)if(STATUS[n.status])cnt[n.status]=(cnt[n.status]||0)+1;
  const any=Object.keys(cnt).length>0||!!prefs.filter;
  box.hidden=!any;if(!any)return;
  const chip=(k,label,color,num)=>{
    const b=document.createElement('button');b.className='fchip';b.dataset.f=k;b.setAttribute('aria-pressed',(prefs.filter||'')===k);
    if(color)b.style.setProperty('--c',color);
    b.textContent=label;if(num!=null){const m=document.createElement('small');m.textContent=num;b.append(m)}
    return b;
  };
  box.replaceChildren(chip('','すべて'),...Object.entries(STATUS).map(([k,[l,c]])=>chip(k,l,c,cnt[k]||0)));
}
$('#filters').addEventListener('click',e=>{
  const b=e.target.closest('.fchip');if(!b)return;
  prefs.filter=b.dataset.f===prefs.filter?'':b.dataset.f;savePrefs();renderList();
});
function rowEl(n){
  const{title,preview}=titleOf(n);
  const b=document.createElement('button');b.className='row';b.dataset.id=n.id;
  const t=document.createElement('div');t.className='rt';
  if(STATUS[n.status]){const g=document.createElement('span');g.className='tag st';g.textContent=STATUS[n.status][0];g.style.background=STATUS[n.status][1];t.append(g)}
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
  const row=$notes.querySelector(`.row[data-id="${id}"]`);if(!row)return;
  popMenu(row,[
    [mi('pin',n.pinned?'ピン留めを解除':'ピン留め',()=>{n.pinned=!n.pinned;persistNow();renderList()}),
     mi('flag','ステータス',null,{small:STATUS[n.status]?.[0]||'なし',sub:()=>statusGroups(n)})],
    [mi('share','共有',()=>shareText(n)),
     mi('dup','複製',()=>{const c={...structuredClone(n),id:uid(),pinned:false,created:Date.now()};touch(c);persistNow();renderList();toast('複製しました')})],
    [mi('trash','削除',()=>{trash(n);renderList()},{cls:'danger'})]
  ]);
}

/* ---------- メモ編集 ---------- */
$memo.addEventListener('input',()=>{cur.text=$memo.value;autosize($memo);touch(cur)});
function autosize(t){
  if(CSS.supports('field-sizing','content'))return;
  const y=scrollY;t.style.height='auto';t.style.height=t.scrollHeight+'px';scrollTo(0,y);
}
addEventListener('resize',()=>document.querySelectorAll('#vNote textarea').forEach(autosize));

/* ---------- 台本エディタ ---------- */
let lastId=null,lastPos=0;
function sync(){cur.text=serialize(sc);cur.spk=sc.speakers.map(({name,color})=>({name,color}));touch(cur)}
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
  const t=document.createElement('textarea');t.className='text';t.rows=1;t.value=ln.text;t.dataset.id=ln.id;t.setAttribute('enterkeyhint','next');
  if(prac){t.readOnly=true;t.tabIndex=-1;if(ln.sp===prac.sp&&ln.text.trim())t.classList.add('mask')}
  return[b,t];
}
function renderScript(){
  lastId=null;lastPos=0;
  $shead.value=sc.head;autosize($shead);$shead.readOnly=!!prac;
  renderChips();
  $script.replaceChildren(...sc.lines.flatMap(rowEls));
  $script.querySelectorAll('.text').forEach(autosize);
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
const taOf=id=>$script.querySelector(`textarea[data-id="${id}"]`);
const nameOf=id=>$script.querySelector(`.name[data-id="${id}"]`);
function focusLine(id,pos){const t=taOf(id);if(!t)return;t.focus();pos=pos==null?t.value.length:pos;t.setSelectionRange(pos,pos)}
function insertAfter(prevId,ln){const t=taOf(prevId);const els=rowEls(ln);if(t)t.after(...els);else $script.append(...els);autosize(els[1])}
function removeRow(id){taOf(id)?.remove();nameOf(id)?.remove()}

$shead.addEventListener('input',()=>{sc.head=$shead.value;autosize($shead);sync()});
$script.addEventListener('input',e=>{
  const t=e.target;if(!t.classList.contains('text'))return;
  sc.lines[idx(t.dataset.id)].text=t.value;autosize(t);lastPos=t.selectionStart;sync();
});
$script.addEventListener('focusin',e=>{
  const t=e.target;if(!t.classList.contains('text'))return;
  if(prac){t.blur();return}
  lastId=t.dataset.id;
  $script.querySelectorAll('.name.active').forEach(n=>n.classList.remove('active'));
  nameOf(lastId)?.classList.add('active');
});
['keyup','click','select'].forEach(ev=>$script.addEventListener(ev,e=>{if(e.target.classList.contains('text'))lastPos=e.target.selectionStart}));
$script.addEventListener('keydown',e=>{
  const t=e.target;if(!t.classList.contains('text'))return;
  if(e.isComposing||e.keyCode===229)return;
  const id=t.dataset.id,i=idx(id),ln=sc.lines[i];
  if(e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    const a=t.selectionStart,b=t.selectionEnd,after=t.value.slice(b);
    ln.text=t.value.slice(0,a);t.value=ln.text;autosize(t);
    const nl={id:uid(),sp:nextSpeaker(ln.sp),text:after};
    sc.lines.splice(i+1,0,nl);insertAfter(id,nl);focusLine(nl.id,0);sync();
  }else if(e.key==='Backspace'&&t.selectionStart===0&&t.selectionEnd===0&&i>0){
    e.preventDefault();
    const prev=sc.lines[i-1],p=prev.text.length;
    prev.text+=ln.text;sc.lines.splice(i,1);removeRow(id);
    const pt=taOf(prev.id);pt.value=prev.text;autosize(pt);focusLine(prev.id,p);sync();
  }else if(e.key==='ArrowUp'&&t.selectionStart===0&&i>0){e.preventDefault();focusLine(sc.lines[i-1].id)}
  else if(e.key==='ArrowDown'&&t.selectionEnd===t.value.length&&i<sc.lines.length-1){e.preventDefault();focusLine(sc.lines[i+1].id,0)}
});
$script.addEventListener('click',e=>{
  if(prac){const t=e.target.closest('.text');if(t&&(t.classList.contains('mask')||t.classList.contains('peek'))){t.classList.toggle('mask');t.classList.toggle('peek');updPbar()}return}
  if(dragDone){dragDone=false;return}
  const b=e.target.closest('.name');if(b)openLine(b.dataset.id);
});

/* ---------- 話者名を長押しして上下に動かすと、行を並べ替え ---------- */
let drag=null,dragHold=null,dragDone=false;
$script.addEventListener('pointerdown',e=>{
  const b=e.target.closest('.name');if(!b||prac||!e.isPrimary)return;
  dragDone=false;const x=e.clientX,y=e.clientY,pid=e.pointerId;
  dragHold={x,y,t:setTimeout(()=>{dragHold=null;startDrag(b,x,y,pid)},420)};
});
$script.addEventListener('pointermove',e=>{
  if(dragHold&&Math.hypot(e.clientX-dragHold.x,e.clientY-dragHold.y)>8){clearTimeout(dragHold.t);dragHold=null}
  if(drag){drag.x=e.clientX;drag.y=e.clientY;placeDrag()}
});
['pointerup','pointercancel'].forEach(ev=>$script.addEventListener(ev,()=>{
  if(dragHold){clearTimeout(dragHold.t);dragHold=null}
  if(drag)endDrag(ev==='pointercancel');
}));
$script.addEventListener('touchmove',e=>{if(drag)e.preventDefault()},{passive:false});
function startDrag(b,x,y,pid){
  const id=b.dataset.id,ln=sc.lines[idx(id)];if(!ln)return;
  if(document.activeElement)document.activeElement.blur();
  try{b.setPointerCapture(pid)}catch{}
  dragDone=true;
  const ind=document.createElement('div');ind.className='drop';$script.append(ind);
  const g=document.createElement('div');g.className='ghost glass';
  const nm=document.createElement('b');nm.textContent=spk(ln.sp).name;nm.style.color=spk(ln.sp).color;
  const tx=document.createElement('span');tx.textContent=ln.text.split('\n')[0]||'（空の行）';
  g.append(nm,tx);document.body.append(g);
  nameOf(id).classList.add('drag');taOf(id).classList.add('drag');
  if(navigator.vibrate)navigator.vibrate(10);
  drag={id,ind,g,x,y,to:idx(id)};
  // 画面の端に近づいたら自動でスクロール
  drag.iv=setInterval(()=>{if(!drag)return;const d=drag.y<140?-8:drag.y>innerHeight-90?8:0;if(d){scrollBy(0,d);placeDrag()}},16);
  placeDrag();
}
function placeDrag(){
  const ids=sc.lines.map(l=>l.id);let to=ids.length;
  for(let i=0;i<ids.length;i++){const r=taOf(ids[i]).getBoundingClientRect();if(drag.y<r.top+r.height/2){to=i;break}}
  drag.to=to;
  const top=to<ids.length?taOf(ids[to]).getBoundingClientRect().top:taOf(ids[ids.length-1]).getBoundingClientRect().bottom;
  drag.ind.style.top=(top-$script.getBoundingClientRect().top-1.5)+'px';
  drag.g.style.transform=`translate(${Math.min(innerWidth-drag.g.offsetWidth-12,Math.max(12,drag.x-40))}px,${drag.y-50}px)`;
}
function endDrag(cancel){
  const d=drag;drag=null;clearInterval(d.iv);d.ind.remove();d.g.remove();
  nameOf(d.id)?.classList.remove('drag');taOf(d.id)?.classList.remove('drag');
  if(cancel)return;
  const from=idx(d.id);let to=d.to;if(to>from)to--;
  if(to===from||from<0)return;
  const[ln]=sc.lines.splice(from,1);sc.lines.splice(to,0,ln);renderScript();sync();
}
$script.addEventListener('mousedown',e=>{if(prac)e.preventDefault()});

/* ---------- 練習モード：選んだ話者のセリフを隠す。タップでめくる ---------- */
let prac=null;
const practiceGroups=()=>[sc.speakers.map(s=>mi(null,s.name,()=>startPractice(s.id),{dot:s.color}))];
function startPractice(sp){
  if(document.activeElement)document.activeElement.blur();
  prac={sp};$('#vNote').classList.add('practice');$('#pbar').hidden=false;tmReset();
  renderScript();updPbar();
}
function endPractice(render=true){
  if(!prac)return;prac=null;tmReset();
  $('#vNote').classList.remove('practice');$('#pbar').hidden=true;
  if(render&&sc)renderScript();
}
function updPbar(){
  if(!prac)return;const s=spk(prac.sp);
  const hid=$script.querySelectorAll('.text.mask').length,all=hid+$script.querySelectorAll('.text.peek').length;
  const n=$('#pinfo');n.replaceChildren();
  const b=document.createElement('b');b.textContent=s.name;b.style.color=s.color;
  n.append(b,`のセリフ ${all-hid}/${all}`);
  $('#pAll').textContent=hid?'全部表示':'全部隠す';
}
$('#pAll').addEventListener('click',()=>{
  const hid=$script.querySelectorAll('.text.mask').length;
  $script.querySelectorAll('.text.mask,.text.peek').forEach(t=>{t.classList.toggle('mask',!hid);t.classList.toggle('peek',!!hid)});
  updPbar();
});
$('#pEnd').addEventListener('click',()=>endPractice());
// 通し練習のタイマー：タップで開始・一時停止、長押しでリセット
const tm={start:0,acc:0,iv:null};
const PLAY='<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M1 1.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L1.9.7a.6.6 0 0 0-.9.5z"/></svg>';
const PAUSE='<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect x="1" y="1" width="2.8" height="10" rx=".8"/><rect x="6.2" y="1" width="2.8" height="10" rx=".8"/></svg>';
function tmDraw(){
  const s=Math.floor((tm.acc+(tm.iv?Date.now()-tm.start:0))/1000),b=$('#pTime');
  b.innerHTML=(tm.iv?PAUSE:PLAY)+`<span>${Math.floor(s/60)}:${p2(s%60)}</span>`;b.classList.toggle('run',!!tm.iv);
}
function tmReset(){clearInterval(tm.iv);tm.iv=null;tm.acc=0;tmDraw()}
let tmHold=null,tmHeld=false;
$('#pTime').addEventListener('pointerdown',()=>{tmHeld=false;tmHold=setTimeout(()=>{tmHeld=true;tmReset();toast('タイマーをリセットしました')},600)});
['pointerup','pointercancel','pointerleave'].forEach(ev=>$('#pTime').addEventListener(ev,()=>clearTimeout(tmHold)));
$('#pTime').addEventListener('click',()=>{
  if(tmHeld){tmHeld=false;return}
  if(tm.iv){tm.acc+=Date.now()-tm.start;clearInterval(tm.iv);tm.iv=null}
  else{tm.start=Date.now();tm.iv=setInterval(tmDraw,250)}
  tmDraw();
});

let wasEditing=false;
$('#speakers').addEventListener('pointerdown',e=>{wasEditing=!!document.activeElement&&document.activeElement.classList.contains('text');if(e.target.closest('.chip'))e.preventDefault()});
// 話者の列の右端：括弧ボタン（文字を選んでいたら、その文字を囲む）
const $tools=$('#spbar .sptools');
['pointerdown','mousedown'].forEach(ev=>$tools.addEventListener(ev,e=>e.preventDefault()));
$tools.addEventListener('click',e=>{
  const b=e.target.closest('[data-t]');if(!b||!sc)return;
  const[o,c]=b.dataset.t==='kagi'?['「','」']:['（','）'];
  let t=document.activeElement;
  if(!t||t.tagName!=='TEXTAREA'||!t.closest('#scriptWrap')){
    // 入力中でなければ、最後に触った行（なければ最後の行）に入れる
    const id=lastId&&taOf(lastId)?lastId:sc.lines[sc.lines.length-1].id;
    focusLine(id,id===lastId?lastPos:null);t=taOf(id);
  }
  const a=t.selectionStart,z=t.selectionEnd,mid=t.value.slice(a,z);
  t.setRangeText(o+mid+c,a,z,'end');if(!mid)t.setSelectionRange(a+o.length,a+o.length);
  t.dispatchEvent(new Event('input',{bubbles:true}));
});
$('#speakers').addEventListener('click',e=>{
  const c=e.target.closest('.chip');if(!c)return;
  if(c.dataset.edit){openSpk(c);return}
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
  const i=idx(id),ln=sc.lines[i],anchor=nameOf(id);if(!ln||!anchor)return;
  const ins=off=>()=>{const nl={id:uid(),sp:off?nextSpeaker(ln.sp):ln.sp,text:''};sc.lines.splice(i+off,0,nl);renderScript();focusLine(nl.id,0);sync()};
  popMenu(anchor,[
    sc.speakers.map(s=>mi(null,s.name,()=>{ln.sp=s.id;refreshNames();sync()},{dot:s.color,check:s.id===ln.sp})),
    [mi('above','上に行を挿入',ins(0)),mi('below','下に行を挿入',ins(1))],
    [mi('trash','この行を削除',()=>{sc.lines.splice(i,1);if(!sc.lines.length)sc.lines.push({id:uid(),sp:sc.speakers[0].id,text:''});renderScript();sync()},{cls:'danger'})]
  ],{left:true});
}
function spkGroups(){
  const rows=sc.speakers.map(s=>{
    const row=document.createElement('div');row.className='sprow';
    const dot=document.createElement('button');dot.className='dot';dot.style.background=s.color;dot.setAttribute('aria-label','色を変更');
    dot.addEventListener('click',()=>{s.color=COLORS[(COLORS.indexOf(s.color)+1)%COLORS.length];dot.style.background=s.color;refreshNames();sync()});
    const inp=document.createElement('input');inp.value=s.name;inp.placeholder='名前';inp.dataset.sp=s.id;
    inp.addEventListener('input',()=>{s.name=cleanName(inp.value)||'?';refreshNames();sync()});
    const del=document.createElement('button');del.className='sdel';del.setAttribute('aria-label','削除');
    del.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>';
    del.addEventListener('click',()=>{
      if(sc.speakers.length<=1){toast('話者は1人以上必要です');return}
      const used=sc.lines.filter(l=>l.sp===s.id).length,rest=sc.speakers.filter(x=>x.id!==s.id);
      if(used&&!confirm(`「${s.name}」の${used}行は「${rest[0].name}」に変更されます。削除しますか？`))return;
      sc.speakers=rest;sc.lines.forEach(l=>{if(l.sp===s.id)l.sp=rest[0].id});renderScript();sync();renderPage(0);
    });
    row.append(dot,inp,del);return row;
  });
  return[rows,[mi('plus','話者を追加',()=>{
    const s={id:uid(),name:freeName(),color:freeColor()};sc.speakers.push(s);refreshNames();sync();
    setTimeout(()=>pop&&pop.p.querySelector(`input[data-sp="${s.id}"]`)?.select(),0);
  },{keep:true})]];
}
function openSpk(anchor){popMenu(anchor||$("#speakers .chip.plain"),spkGroups,{left:true})}

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),2200)}

/* ---------- ポップオーバーメニュー（Liquid Glass 風） ---------- */
const sv=d=>`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const MI={
  above:sv('<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>'),
  below:sv('<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>'),
  plus:sv('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  restore:sv('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>'),
  share:sv('<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/>'),
  backup:sv('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>'),
  timer:sv('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>'),
  eye:sv('<path d="M3 12s3.5-6.5 9-6.5S21 12 21 12s-3.5 6.5-9 6.5S3 12 3 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 4l16 16"/>'),
  flag:sv('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  script:sv('<path d="M7 7h1M7 12h1M7 17h1M11 7h6M11 12h6M11 17h4"/><rect x="3.5" y="3" width="17" height="18" rx="3"/>'),
  clip:sv('<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z"/><path d="M9 11h6M9 15h4"/>'),
  import:sv('<path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  export:sv('<path d="M12 14V3M7.5 7.5 12 3l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  trash:sv('<path d="M4 6.5h16M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/><path d="M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4l1-13M10 10.5v6M14 10.5v6"/>'),
  reload:sv('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/>'),
  pin:sv('<path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5z"/><path d="M12 13v7.5"/>'),
  copy:sv('<rect x="8" y="8" width="12" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-7A2.5 2.5 0 0 0 4 5.5v8A2.5 2.5 0 0 0 6.5 16H8"/>'),
  save:sv('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9.5 14.5 12 17l2.5-2.5"/>'),
  dup:sv('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M14 11.5v5M11.5 14h5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>')
};
const mi=(icon,label,fn,opt={})=>({icon,label,fn,...opt});
const CHEV='<svg class="chev" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 5 5.5-5 5.5"/></svg>';
const CHECK='<svg class="chk" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 8.5 3.5 3.5 7.5-8"/></svg>';
let pop=null;
function closePop(now){
  if(!pop)return;const{p,scrim}=pop;pop=null;scrim.remove();
  if(now){p.remove();return}
  p.classList.remove('on');p.classList.add('out');setTimeout(()=>p.remove(),220);
}
function popItem(it){
  const b=document.createElement('button');b.className='pop-item'+(it.cls?' '+it.cls:'');b.setAttribute('role','menuitem');
  if(it.icon){const i=document.createElement('i');i.innerHTML=MI[it.icon]||'';b.append(i)}
  else if(it.dot){const i=document.createElement('i');const d=document.createElement('span');d.className='sdot'+(it.dot==='none'?' ring':'');if(it.dot!=='none')d.style.background=it.dot;i.append(d);b.append(i)}
  const t=document.createElement('span');t.className='pop-t';
  const l=document.createElement('span');l.textContent=it.label;t.append(l);
  if(it.small){const m=document.createElement('small');m.textContent=it.small;t.append(m)}
  b.append(t);
  if(it.check)b.insertAdjacentHTML('beforeend',CHECK);
  if(it.sub)b.insertAdjacentHTML('beforeend',CHEV);
  b.addEventListener('click',()=>{
    if(it.sub){pop.stack.push({title:it.subTitle||it.label,groups:it.sub});renderPage(1);return}
    if(it.keep){it.fn();renderPage(0);return}
    closePop();it.fn();
  });
  return b;
}
function renderPage(dir){
  const pg=pop.stack[pop.stack.length-1];
  const el=document.createElement('div');el.className='pop-page'+(dir>0?' in-r':dir<0?' in-l':'');
  if(pop.stack.length>1){
    const b=document.createElement('button');b.className='pop-back';
    b.innerHTML=CHEV;const t=document.createElement('span');t.textContent=pg.title;b.append(t);
    b.addEventListener('click',()=>{pop.stack.pop();renderPage(-1)});
    el.append(b);
  }
  const groups=(typeof pg.groups==='function'?pg.groups():pg.groups).filter(g=>g.length);
  groups.forEach((g,gi)=>{
    if(gi||pop.stack.length>1){const d=document.createElement('div');d.className='pop-sep';el.append(d)}
    for(const it of g)el.append(it instanceof Node?it:popItem(it));
  });
  pop.p.replaceChildren(el);
}
function popMenu(anchor,groups,opt={}){
  closePop(true);
  if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
  const scrim=document.createElement('div');scrim.className='pop-scrim';
  const p=document.createElement('div');p.className='pop';p.setAttribute('role','menu');
  scrim.addEventListener('click',()=>closePop());
  document.body.append(scrim,p);
  pop={p,scrim,stack:[{groups}]};renderPage(0);
  const r=anchor.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=innerHeight;
  const h=p.offsetHeight;
  const right=opt.left?Math.max(10,vw-Math.max(r.left,10)-p.offsetWidth):Math.max(10,vw-r.right);
  // 下に入りきらなければ上に出す
  const up=r.bottom+6+h>vh-12&&r.top-6-h>12;
  p.style.right=right+'px';
  if(up){p.style.bottom=(vh-r.top+6)+'px';p.style.maxHeight=(r.top-18)+'px'}
  else{p.style.top=(r.bottom+6)+'px';p.style.maxHeight=`calc(100dvh - ${r.bottom+18}px - env(safe-area-inset-bottom))`}
  const left=vw-right-p.offsetWidth;
  p.style.transformOrigin=`${Math.min(p.offsetWidth-20,Math.max(20,r.left+r.width/2-left))}px ${up?'calc(100% + 10px)':'-10px'}`;
  p.getBoundingClientRect();p.classList.add('on');
}
addEventListener('keydown',e=>{if(e.key==='Escape'&&pop)closePop()});
addEventListener('popstate',()=>closePop(true));

/* ---------- 読み上げ時間 ---------- */
const SPEEDS=[[300,'ゆっくり'],[350,'ふつう'],[400,'速め']];
const cpm=()=>SPEEDS.some(([v])=>v===prefs.cpm)?prefs.cpm:350;
// 空白と（）内のト書きは数えない
const spoken=t=>t.replace(/[（(][^（）()]*[）)]/g,'').replace(/\s/g,'').length;
function fmtDur(chars){
  if(!chars)return'0秒';
  const sec=Math.max(5,Math.round(chars/cpm()*60/5)*5),m=Math.floor(sec/60),r=sec%60;
  return m?`${m}分${r?r+'秒':''}`:`${r}秒`;
}
function noteChars(n){
  if(n===cur&&sc)return sc.lines.reduce((a,l)=>a+spoken(l.text),0);
  return spoken(n.text);
}
function timeGroups(){
  const total=noteChars(cur);
  const head=document.createElement('div');head.className='dur';
  const b=document.createElement('b');b.textContent='約 '+fmtDur(total);
  const sm=document.createElement('small');sm.textContent=total.toLocaleString()+'字';
  head.append(b,sm);
  const g=[[head]];
  if(sc&&sc.speakers.length>1){
    const box=document.createElement('div');box.className='durs';
    for(const s of sc.speakers){
      const c=sc.lines.filter(l=>l.sp===s.id).reduce((a,l)=>a+spoken(l.text),0);
      const r=document.createElement('div');
      const nm=document.createElement('b');nm.textContent=s.name;nm.style.color=s.color;
      const bar=document.createElement('i');bar.style.setProperty('--w',(total?c/total*100:0)+'%');bar.style.setProperty('--c',s.color);
      const v=document.createElement('span');v.textContent=(total?Math.round(c/total*100):0)+'%';
      r.append(nm,bar,v);box.append(r);
    }
    g.push([box]);
  }
  g.push(SPEEDS.map(([v,l])=>mi(null,l,()=>{prefs.cpm=v;savePrefs()},{small:`1分あたり${v}字`,check:v===cpm(),keep:true})));
  return g;
}

/* ---------- ステータス ---------- */
function statusGroups(n){
  const set=k=>()=>{
    if(k)n.status=k;else delete n.status;
    notes[n.id]=n;persistNow();
    if(n===cur)setNdate();else renderList();
  };
  return[
    Object.entries(STATUS).map(([k,[l,c]])=>mi(null,l,set(k),{dot:c,check:n.status===k})),
    [mi(null,'なし',set(''),{dot:'none',check:!n.status})]
  ];
}

/* ---------- メニュー ---------- */
$('#btnListMenu').addEventListener('click',e=>{
  const nTrash=Object.values(notes).filter(n=>n.deleted).length;
  popMenu(e.currentTarget,[
    [mi('script','新規台本',()=>goNote(newNote('','script'),true)),
     mi('clip','クリップボードから新規メモ',async()=>{const t=await readClip();if(t==null)return;const n=newNote(t,looksLikeScript(t)?'script':'memo');touch(n);persistNow();goNote(n)},{small:'「メモ」の全文コピーを取り込み'})],
    [mi('import','読み込み・復元',()=>$('#file').click(),{small:'.txt / バックアップ .json'}),
     mi('export','書き出し',null,{sub:()=>[[
       mi('save','すべて .txt で書き出し',exportAllTxt,{small:'ファイルAppへ'}),
       mi('backup','バックアップを書き出し',exportBackup,{small:'.json（復元用）'})
     ]]})],
    [mi('trash','最近削除した項目',null,{small:nTrash?nTrash+'件':'',sub:trashGroups}),
     mi('reload','最新版に更新',forceUpdate,{small:'メモは消えません'})]
  ]);
});
$('#btnShare').addEventListener('click',()=>shareText(cur));
$('#btnNoteMenu').addEventListener('click',e=>{
  const n=cur;
  popMenu(e.currentTarget,[
    [mi('pin',n.pinned?'ピン留めを解除':'ピン留め',()=>{n.pinned=!n.pinned;notes[n.id]=n;schedule();toast(n.pinned?'ピン留めしました':'ピン留めを解除しました')}),
     mi('flag','ステータス',null,{small:STATUS[n.status]?.[0]||'なし',sub:()=>statusGroups(n)})],
    [mi('timer','読み上げ時間',null,{small:'約'+fmtDur(noteChars(n)),sub:timeGroups}),
     ...(n.mode==='script'?[prac?mi('eye','練習モードを終了',()=>endPractice()):mi('eye','練習モード',null,{small:'セリフを隠して覚える',subTitle:'隠す話者',sub:practiceGroups})]:[])],
    [mi('copy','テキストをコピー',async()=>{try{await navigator.clipboard.writeText(n.text);toast('コピーしました')}catch{toast('コピーできませんでした')}}),
     mi('save','.txt ファイルで保存',()=>saveFiles([new File([n.text],fileBase(n)+'.txt',{type:'text/plain'})])),
     mi('dup','複製',()=>{const c={...structuredClone(n),id:uid(),pinned:false,created:Date.now()};touch(c);persistNow();history.replaceState(null,'','#/n/'+c.id);openNote(c);toast('複製しました')})],
    [mi('trash','削除',()=>{if(!n.text.trim()){goList();return}trash(n);goList()},{cls:'danger'})]
  ]);
});

function trash(n){n.deleted=Date.now();n.pinned=false;notes[n.id]=n;persistNow();toast('「最近削除した項目」に移動しました')}
function trashGroups(){
  const arr=Object.values(notes).filter(n=>n.deleted).sort((a,b)=>b.deleted-a.deleted);
  const left=n=>Math.max(0,TRASH_DAYS-Math.floor((Date.now()-n.deleted)/DAY));
  if(!arr.length){const d=document.createElement('div');d.className='pop-empty';d.textContent='ありません';return[[d]]}
  return[
    arr.map(n=>mi(null,titleOf(n).title,null,{small:`あと${left(n)}日で完全に削除`,sub:()=>[[
      mi('restore','復元',()=>{delete n.deleted;persistNow();renderList();toast('復元しました')}),
      mi('trash','完全に削除',()=>{if(!confirm('完全に削除しますか？元に戻せません。'))return;delete notes[n.id];persistNow()},{cls:'danger'})
    ]]})),
    [mi('trash','すべて完全に削除',()=>{if(!confirm(`${arr.length}件を完全に削除しますか？元に戻せません。`))return;arr.forEach(n=>delete notes[n.id]);persistNow()},{cls:'danger'})]
  ];
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
  if(!n.text.trim()){toast('メモが空です');return}
  flush();
  if(navigator.share){try{await navigator.share({text:n.text});return}catch(e){if(e.name==='AbortError')return}}
  try{await navigator.clipboard.writeText(n.text);toast('共有できないためコピーしました。「メモ」に貼り付けてください')}catch{toast('共有できませんでした')}
}
async function readClip(){
  try{const t=await navigator.clipboard.readText();if(!t||!t.trim()){toast('クリップボードが空です');return null}return t.replace(/\r\n?/g,'\n')}
  catch{toast('クリップボードを読み取れませんでした');return null}
}
async function saveFiles(files){
  // 共有シート →「ファイルに保存」でファイルAppへ
  if(!(navigator.canShare&&navigator.canShare({files}))){toast('この端末ではファイルを書き出せません');return}
  try{await navigator.share({files});return true}catch(e){if(e.name!=='AbortError')toast('書き出せませんでした')}
  return false;
}
const stamp=()=>{const d=new Date();return`${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}`};
function exportAllTxt(){
  const arr=live().filter(n=>n.text.trim());if(!arr.length){toast('メモがありません');return}
  const used={};
  saveFiles(arr.map(n=>{let b=fileBase(n),name=b,i=2;while(used[name])name=`${b} (${i++})`;used[name]=1;return new File([n.text],name+'.txt',{type:'text/plain'})}));
}
function exportBackup(){
  const arr=live();if(!arr.length){toast('メモがありません');return}
  saveFiles([new File([JSON.stringify({app:'netamemo',version:1,notes:arr},null,1)],`ネタメモ_バックアップ_${stamp()}.json`,{type:'application/json'})]).then(ok=>{if(ok){prefs.lastBackup=Date.now();delete prefs.bkSnooze;savePrefs();if(!$('#vList').hidden)renderList()}});
}
$('#file').addEventListener('change',async e=>{
  const files=[...e.target.files];e.target.value='';if(!files.length)return;
  const added=[];let bad=0;
  for(const f of files){
    const txt=(await f.text()).replace(/^﻿/,'').replace(/\r\n?/g,'\n');
    try{
      if(/\.json$/i.test(f.name)){
        const o=JSON.parse(txt);
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

/* ---------- 下の検索欄をキーボードの上に出す ---------- */
if(window.visualViewport){
  const vv=visualViewport,tb=$('.tb');
  const f=()=>{const kb=Math.max(0,innerHeight-vv.height-vv.offsetTop);document.documentElement.style.setProperty('--kb',kb+'px');tb.classList.toggle('kb',kb>60)};
  vv.addEventListener('resize',f);vv.addEventListener('scroll',f);
}

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
    s=e.touches.length===1&&t.clientX<28&&!pop?{x:t.clientX,y:t.clientY,dx:0,on:false}:null;
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
