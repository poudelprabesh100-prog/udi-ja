const $=id=>document.getElementById(id);
const MP={},peers=[];
const palettes=[['Marigold','#ffcb4b','#ed6540'],['Rose','#fa6484','#a42259'],['Peacock','#52ddcf','#087d92'],['Orchid','#c796fd','#6744b4']];
const price=[0,150,340,675],speed=[215,248,278,305],health=[3,4,4,5];
// Workshop catalogue: cooldown upgrades (levels), one-use flight items, and cosmetic trails / cut effects
const BASE_CD={dash:4.2,guard:5.4},CD_STEP=.15;
const upgrades=[{k:'dash',name:'Swift Dodge',desc:'Dodge recharges 15% faster per level.',cost:[120,260,480]},{k:'guard',name:'Steady Brace',desc:'Brace recharges 15% faster per level.',cost:[120,260,480]}];
const items=[{k:'shield',name:'Diyo Shield',price:70,desc:'Blocks the first hit you take.'},{k:'manja',name:'Sharp Manja',price:90,desc:'Cutting reach is 25% longer for the first 25 seconds.'},{k:'wind',name:'Swift Wind',price:80,desc:'Dodge and Brace recharge twice as fast for 30 seconds.'}];
const trails=[{k:'none',name:'No trail',price:0},{k:'petals',name:'Marigold Petals',price:140},{k:'embers',name:'Diya Embers',price:260}];
const cutFx=[{k:'none',name:'Classic',price:0},{k:'petals',name:'Marigold Shower',price:160},{k:'fireworks',name:'Fireworks',price:240},{k:'diya',name:'Diya Glow',price:380}];
let coins=0,owned=[0],line=50,earned=0,up={dash:0,guard:0},stock={shield:0,manja:0,wind:0},armed={shield:false,manja:false,wind:false},fxOwned=['none'],fx={trail:'none',cut:'none'},groundsOwned=[];
try{const saved=JSON.parse(localStorage.tiharHangar||'{}');coins=Math.max(0,Number(saved.coins)||0);owned=[...new Set([0,...(saved.owned||[]).filter(i=>[1,2,3].includes(i))])];
 for(const u of upgrades)up[u.k]=Math.min(3,Math.max(0,Math.floor(Number(saved.up?.[u.k]))||0));
 for(const it of items){stock[it.k]=Math.min(99,Math.max(0,Math.floor(Number(saved.stock?.[it.k]))||0));armed[it.k]=!!saved.armed?.[it.k]&&stock[it.k]>0}
 fxOwned=[...new Set(['none',...(saved.fxOwned||[]).filter(k=>typeof k==='string'&&(k.startsWith('t:')||k.startsWith('c:'))&&[...trails,...cutFx].some(x=>x.k===k.slice(2)))])];
 fx.trail=fxOwned.includes('t:'+saved.fx?.trail)?saved.fx.trail:'none';fx.cut=fxOwned.includes('c:'+saved.fx?.cut)?saved.fx.cut:'none';
 groundsOwned=(saved.grounds||[]).filter(k=>typeof k==='string')}catch{}
function save(){try{localStorage.tiharHangar=JSON.stringify({coins,owned,up,stock,armed,fxOwned,fx,grounds:groundsOwned})}catch{}}
// Rush Mode high scores, one per difficulty (Easy / Normal / Hard)
let record=false,rushBest=[0,0,0];try{const r=JSON.parse(localStorage.tiharRush||'[]');rushBest=[0,1,2].map(i=>Math.max(0,Math.floor(Number(r[i]))||0))}catch{}
function showBest(){const el=$('rushBest');if(el)el.textContent='High score · '+['Easy','Normal','Hard'][difficulty]+': '+(rushBest[difficulty]||'none yet')+(rushBest[difficulty]?' pts':'')}
function kiteSVG(n){
 const silhouettes=['','M50 5 94 31 77 65 60 60 50 97 39 60 23 65 6 31Z','M50 5 97 71 67 60 50 94 34 60 3 71Z','M50 18 86 5 98 32 84 54 94 69 72 86 53 64 50 99 46 65 27 86 6 69 16 53 2 32 14 5Z'];
 if(n){const [,a,b]=palettes[n];return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 138"><path d="M50 92q19 15 0 25t5 17" fill="none" stroke="#ffce80" stroke-width="2"/><path d="${silhouettes[n]}" fill="${a}" stroke="#512d48" stroke-width="2"/><path d="m12 32 38 19 38-19-38 37z" fill="${b}"/><path d="m50 27 9 17-9 12-9-12z" fill="#ffeba7"/><path d="m22 37 12 4-3 7zm56 0-12 4 3 7z" fill="#fff3bd"/></svg>`}
 const [,a,b]=palettes[n];
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 138"><path d="M50 93Q61 105 45 117T49 136" fill="none" stroke="#ffdf98" stroke-width="1.4"/><path d="m47 114-9-6 2 9 8-2 7 6 1-9z" fill="${a}"/><path d="M50 3 96 48 50 98 4 48Z" fill="${a}" stroke="#58343f" stroke-width="2"/><path d="M50 3 50 98 4 48Z" fill="${b}"/><path d="m9 47 41 23 41-23-41 40zM26 29l24 10 24-10-24 24z" fill="#ffebaf"/><path d="m50 41 11 11-11 12-11-12z" fill="${b}"/><path d="M50 4v93M5 48q44-26 90 0" fill="none" stroke="#592d40" opacity=".65"/><path d="m50 98-8 5 7-14 11 15z" fill="${b}"/></svg>`;
}
let skin=0,mode='survival',difficulty=1,state='setup',sound=false,audio;
const kiteImages=palettes.map((p,i)=>{let img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(kiteSVG(i));return img});
$('posterKites').innerHTML=[[1,62,5,16,16],[0,81,25,8,-16],[2,49,20,5,-12]].map(([n,x,y,w,r])=>kiteSVG(n).replace('<svg ',`<svg style="left:${x}%;top:${y}%;width:${w}%;height:67%;transform:rotate(${r}deg)" `)).join('');
function select(group,el){for(const b of group.children){b.classList.toggle('selected',el===b);b.setAttribute('aria-pressed',el===b)}}
for(const b of $('modes').children)b.onclick=()=>{mode=b.dataset.mode;select($('modes'),b)};
[...$('levels').children].forEach((b,i)=>b.onclick=()=>{difficulty=i;select($('levels'),b);showBest()});
showBest();
palettes.forEach(([name],i)=>{let b=document.createElement('button');b.title=name;b.setAttribute('aria-label',name+' kite');b.innerHTML=kiteSVG(i)+'<small>'+name+' · '+(price[i]||'Free')+'</small>';b.removeAttribute('title');b.innerHTML+='<span class="kite-tip" role="tooltip" id="kite-tip-'+i+'">Speed '+speed[i]+' · Durability '+health[i]+' hits</span>';b.setAttribute('aria-describedby','kite-tip-'+i);$('skins').append(b);b.onclick=()=>{if(!owned.includes(i)){dialog(name+' kite',price[i]+' coins · Wallet '+coins+' coins\nSpeed '+speed[i]+' · Durability '+health[i],coins>=price[i]?[['Buy and equip',()=>{coins-=price[i];owned.push(i);save();b.click()}],['Back',()=>{}]]:[['Back',()=>{}]]);return}skin=i;MP.skin?.(i);$('kn').textContent=name+' · '+coins+' coins';select($('skins'),b)}});$('skins').firstElementChild.click();
// ---- Workshop: cooldown upgrades, one-use flight items, trails and cut effects
const trailBits=[],rings=[],petalCols=['#ff9a1f','#ffbf3c','#ff7a45','#ff6a8a'];
function useItems(){shieldOn=false;manjaT=windT=0;if(mode==='versus')return;let used=false;
 for(const it of items)if(armed[it.k]&&stock[it.k]>0){stock[it.k]--;used=true;if(!stock[it.k])armed[it.k]=false;if(it.k==='shield')shieldOn=true;else if(it.k==='manja')manjaT=25;else windT=30}
 if(used){save();renderShop()}}
const emit=o=>{if(trailBits.length<260)trailBits.push(o)};
function drawFx(dt){
 if(state==='play'&&player.hp>0){const x=player.x-5,y=player.y+24;
  if(fx.trail==='petals'&&Math.random()<dt*20)emit({k:'p',x,y,vx:(Math.random()-.5)*30,vy:10+Math.random()*26,t:1.5,m:1.5,a:Math.random()*6.28,va:(Math.random()-.5)*7,c:petalCols[Math.floor(Math.random()*4)]});
  if(fx.trail==='embers'&&Math.random()<dt*45)emit({k:'e',x:x+(Math.random()-.5)*8,y,vx:(Math.random()-.5)*22,vy:-8-Math.random()*30,t:1,m:1});}
 for(let i=trailBits.length-1;i>=0;i--){const p=trailBits[i];p.t-=dt;if(p.t<=0){trailBits.splice(i,1);continue}p.x+=p.vx*dt;p.y+=p.vy*dt;const a=Math.min(1,p.t/p.m*1.4);
  if(p.k==='p'){p.a+=p.va*dt;p.vx*=1-1.2*dt;p.vy+=(p.g||0)*dt;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.globalAlpha=a;ctx.fillStyle=p.c;ctx.beginPath();ctx.ellipse(0,0,5,2.6,0,0,6.283);ctx.fill();ctx.restore()}
  else{ctx.globalCompositeOperation='lighter';ctx.fillStyle='#ffb23c';ctx.globalAlpha=a*.28;ctx.beginPath();ctx.arc(p.x,p.y,7,0,6.283);ctx.fill();ctx.globalAlpha=a;ctx.fillStyle='#ffe38a';ctx.beginPath();ctx.arc(p.x,p.y,2.2,0,6.283);ctx.fill();ctx.globalCompositeOperation='source-over'}}
 for(let i=rings.length-1;i>=0;i--){const g=rings[i];g.t-=dt;if(g.t<=0){rings.splice(i,1);continue}const k=1-g.t/g.m;ctx.globalAlpha=(1-k)*.9;ctx.strokeStyle=g.c;ctx.lineWidth=1+4*(1-k);ctx.beginPath();ctx.arc(g.x,g.y,10+k*g.r,0,6.283);ctx.stroke()}
 ctx.globalAlpha=1;ctx.lineWidth=1}
function cutEffect(x,y){const k=fx.cut;
 if(k==='petals'){for(let i=0;i<38;i++){const a=Math.random()*6.28,v=40+Math.random()*130;emit({k:'p',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-40,t:1.9,m:1.9,a,va:(Math.random()-.5)*9,g:70,c:petalCols[i%4]})}tone(520,.25,'sine',.06,780)}
 else if(k==='fireworks'){tone(300,.3,'sawtooth',.04,1200);[0,1,2].forEach(i=>setTimeout(()=>{if(state==='setup')return;const ox=(i-1)*34,oy=-i*18;burst(x+ox,y+oy,palettes[(i+Math.floor(Math.random()*3))%4][1],36);burst(x+ox,y+oy,'#fff6bd',14);tone(900+i*260,.16,'triangle',.05,300)},i*130))}
 else if(k==='diya'){rings.push({x,y,t:.8,m:.8,r:90,c:'#ffd36a'},{x,y,t:1.1,m:1.1,r:140,c:'#ff9a3c'});for(let i=0;i<22;i++){const a=Math.random()*6.28,v=20+Math.random()*60;emit({k:'e',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-30,t:1.3,m:1.3})}tone(988,.4,'sine',.06);tone(1318,.5,'sine',.04)}}
function wallet(){$('kn').textContent=palettes[skin][0]+' · '+coins+' coins'}
function shopGroup(title,chips){const d=document.createElement('div'),h=document.createElement('h3'),c=document.createElement('div');h.textContent=title;c.className='chips';
 for(const [name,sub,sel,fn] of chips){const b=document.createElement('button');b.className='chip'+(sel?' selected':'');b.setAttribute('aria-pressed',String(!!sel));b.innerHTML='<strong></strong><small></small>';b.firstChild.textContent=name;b.lastChild.textContent=sub;b.onclick=fn;c.append(b)}
 d.append(h,c);return d}
const fxHas=(pre,t)=>t.price===0||fxOwned.includes(pre+t.k),fxLabel=(pre,t,cur)=>cur===t.k?'Equipped':fxHas(pre,t)?'Owned':t.price+' coins';
function renderShop(){wallet();$('shopGrid').replaceChildren(
 shopGroup('COOLDOWN UPGRADES',upgrades.map(u=>[u.name,up[u.k]>=3?'Max · level 3':'Level '+up[u.k]+'/3 · '+u.cost[up[u.k]]+' coins',up[u.k]>0,()=>upgradeDialog(u)])),
 shopGroup('FLIGHT ITEMS · ONE USE',items.map(it=>[it.name,armed[it.k]&&stock[it.k]?'Bringing ×'+stock[it.k]:stock[it.k]?'×'+stock[it.k]+' ready':it.price+' coins',armed[it.k]&&stock[it.k]>0,()=>itemDialog(it)])),
 shopGroup('KITE TRAIL',trails.map(t=>[t.name,fxLabel('t:',t,fx.trail),fx.trail===t.k,()=>fxDialog('trail','t:',t)])),
 shopGroup('CUT EFFECT',cutFx.map(t=>[t.name,fxLabel('c:',t,fx.cut),fx.cut===t.k,()=>fxDialog('cut','c:',t)])))}
function upgradeDialog(u){const lv=up[u.k],cost=u.cost[lv],secs=l=>(BASE_CD[u.k]*(1-CD_STEP*l)).toFixed(1)+'s';
 dialog(u.name,u.desc+'\nLevel '+lv+'/3 · recharge '+secs(lv)+(lv<3?' → '+secs(lv+1):'')+'\nWallet '+coins+' coins\nSolo flights only.',lv>=3?[['Back',()=>{}]]:[...(coins>=cost?[['Upgrade · '+cost+' coins',()=>{coins-=cost;up[u.k]++;save();renderShop();upgradeDialog(u)}]]:[]),['Back',()=>{}]])}
function itemDialog(it){const n=stock[it.k];
 dialog(it.name,it.desc+'\nYou have '+n+' · Wallet '+coins+' coins\nOne use per flight. Solo flights only.',[...(n>0?[[armed[it.k]?'Leave it behind':'Bring it',()=>{armed[it.k]=!armed[it.k];save();renderShop()}]]:[]),...(coins>=it.price?[['Buy one · '+it.price+' coins',()=>{coins-=it.price;stock[it.k]++;armed[it.k]=true;save();renderShop();itemDialog(it)}]]:[]),['Back',()=>{}]])}
function fxDialog(slot,pre,t){const equip=()=>{fx[slot]=t.k;save();renderShop()};if(fxHas(pre,t)){equip();return}
 dialog(t.name,t.price+' coins · Wallet '+coins+' coins',coins>=t.price?[['Buy and equip',()=>{coins-=t.price;fxOwned.push(pre+t.k);equip()}],['Back',()=>{}]]:[['Back',()=>{}]])}
renderShop();

// Sound effects always play; the Music button only controls the background track.
function ensureAudio(){const C=window.AudioContext||window.webkitAudioContext;if(!C)return;try{audio??=new C();if(audio.state==='suspended')audio.resume().catch(()=>{})}catch{}}
for(const n of ['pointerdown','touchend','click','keydown'])addEventListener(n,ensureAudio,{passive:true});
function tone(f,d=.13,type='sine',vol=.08,to){if(!audio)ensureAudio();if(!audio)return;const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(to)o.frequency.exponentialRampToValueAtTime(to,t+d);g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(audio.destination);o.start(t);o.stop(t+d)}
const music=new Audio(),webmTrack='tihar-dhun.webm',mp3Track='Tihar Dhun- Deusi Bhailo.mp3',ua=navigator.userAgent;
// WebKit (every iPhone/iPad browser, desktop Safari) reports WebM/Opus support but often plays nothing, so it gets the MP3.
const webkitOnly=/iPhone|iPad|iPod/.test(ua)||(/Safari/.test(ua)&&!/Chrome|Chromium|Android|Edg|OPR|Firefox/.test(ua))||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
let usingMp3=webkitOnly||music.canPlayType('audio/webm; codecs=opus')!=='probably';
music.loop=true;music.volume=.14;music.preload='auto';music.src=usingMp3?mp3Track:webmTrack;
function playMusic(){const p=music.play();if(p)p.catch(err=>{if(err&&err.name==='NotAllowedError')return;fallbackMusic()})}
function fallbackMusic(){if(usingMp3)return;usingMp3=true;music.src=mp3Track;music.load();if(sound)music.play().catch(()=>{})}
music.addEventListener('error',fallbackMusic);
$('sound').onclick=()=>{sound=!sound;if(sound)playMusic();else music.pause();$('sound').querySelector('span').textContent='Music '+(sound?'on':'off');$('sound').setAttribute('aria-pressed',String(sound))};
const canvas=$('arena'),ctx=canvas.getContext('2d'),keys=new Set();let W,H,player,bots=[],particles=[],time,points,cuts,elapsed,prev=0,cool=0,flash=0,jx=0,jy=0,target=null,fire=0,recap='',victory=false;
function size(){W=canvas.clientWidth;H=canvas.clientHeight;let d=Math.min(devicePixelRatio||1,2);canvas.width=W*d;canvas.height=H*d;ctx.setTransform(d,0,0,d,0,0)}
const bounty=[100,150,225,325];
const rosters=[[0,0,0,0,0,1,1,1,2,3],[0,1,1,1,1,2,2,2,2,3],[0,1,2,2,2,3,3,3,3,3]];
let bag=[];
function bot(i){
 if(!bag.length){bag=[...rosters[difficulty]];for(let j=bag.length-1;j>0;j--){const k=Math.floor(Math.random()*(j+1));[bag[j],bag[k]]=[bag[k],bag[j]]}}
 const n=bag.pop(),anchor=.04+.92*Math.random(),x=clamp(W*anchor+(Math.random()-.5)*W*.35,22,W-22),y=H*(.16+.57*Math.random());
 return {n,hp:health[n],anchor,x,y,spool:clamp((Math.hypot(W*anchor-x,H-y)-100)/(H+W*.4)*100,0,100),course:0,dive:Math.random()<.5,phase:Math.random()*6.28,cd:2+Math.random()*3,warning:0}}
function start(){if($('modal').open)$('modal').close();document.body.classList.add('playing');$('hud').hidden=false;state='play';size();player={x:W/2,y:H*.72,n:skin,hp:health[skin]};bag=[];peers.length=0;bots=Array.from({length:mode==='versus'?0:mode==='rush'?4:10},(_,i)=>bot(i));dash=guard=dashWait=guardWait=0;useItems();trailBits.length=rings.length=0;line=50;time=90;elapsed=points=cuts=cool=flash=0;particles=[];target=null;keys.clear();jx=jy=0;window.scrollTo(0,0);tone(660)}
function lobby(){state='setup';peers.length=0;document.body.classList.remove('playing');$('hud').hidden=true;ctx.clearRect(0,0,W,H)}
function dialog(title,body,buttons){if($('modal').open)$('modal').close();$('mt').textContent=title;$('mb').textContent=body;$('actions').replaceChildren();for(const [s,fn] of buttons){let b=document.createElement('button');b.textContent=s;b.onclick=()=>{$('modal').close();fn()};$('actions').append(b)}$('modal').showModal()}
function pause(user){if(state!=='play')return;if(mode==='versus'){keys.clear();target=null;jx=jy=0;if(user===true)MP.menu();return}state='paused';keys.clear();target=null;jx=jy=0;dialog('Flight paused','Resume when you’re ready.',[['Resume',()=>state='play'],['Flight setup',lobby]])}
$('pause').onclick=()=>pause(true);
let hintOpen=false;const landscape=matchMedia('(orientation:landscape)');
function launch(){if(mode!=='versus'){const sel=grounds.querySelector('.selected');if(sel?.classList.contains('locked'))chooseGround(grounds.firstElementChild)}let seen=false;try{seen=sessionStorage.tiharLandscapeHint==='1'}catch{}
 if(matchMedia('(pointer:coarse)').matches&&!landscape.matches&&!seen){try{sessionStorage.tiharLandscapeHint='1'}catch{}hintOpen=true;
  // One animated picture instead of a paragraph: a phone turning sideways. Rotating starts the game by itself.
  dialog('Rotate your phone','',[['Play in portrait',start],['Back',()=>{}]]);
  $('mb').innerHTML='<svg class="rotateHint" viewBox="0 0 150 110" aria-hidden="true"><g class="phone"><rect x="55" y="17" width="40" height="76" rx="8" fill="#2f1c2b" stroke="#ffd36c" stroke-width="4"/><rect x="62" y="27" width="26" height="48" rx="3" fill="#ffc35f" opacity=".22"/><path d="M75 35l9 11-9 14-9-14z" fill="#ffd36c"/><circle cx="75" cy="84" r="2.5" fill="#ffd36c"/></g><g class="arrow"><path d="M113 28a44 44 0 0 1 0 54" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M104 77l10 6 2-12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g></svg><span class="rotateCaption">Landscape plays best</span>';return}
 start()}
$('modal').addEventListener('close',()=>hintOpen=false);
landscape.addEventListener('change',e=>{if(e.matches&&hintOpen)start()});
$('launch').onclick=launch;
const goal='Goal: outlast ten rivals in Last Kite Flying, or survive 90 seconds in Rush Mode. Each hit removes one durability, and your kite’s durability decides how many hits it can take. Finishing a Marigold, Rose, Peacock or Orchid rival earns 100, 150, 225 or 325 points.';
function helpText(){return (matchMedia('(pointer:coarse)').matches?[
'TOUCH CONTROLS',
'Steer: drag the joystick on the left.',
'Cut: tap CUT when the gold ring touches a rival’s string. The highlighted string is your target.',
'Dodge: tap to dash in your last steering direction.',
'Brace: tap to harden your line for a moment. Dodge and Brace have cooldowns and stop you cutting while active.',
'Reel in: hold to tighten the line for faster turns.',
'Pay out: hold to let line out for more distance and cutting reach.',
'A red ring around a rival means it is about to cut your string. Dodge or brace before it strikes.',
'The buttons are see-through until you press them.'+(landscape.matches?'':' Tip: turn your phone sideways for a wider view.')
]:[
'KEYBOARD AND MOUSE',
'Steer: WASD or arrow keys, or move the mouse over the sky.',
'Cut: Space or click when the gold ring touches a rival’s string. The highlighted string is your target.',
'Dodge: Shift dashes in your last steering direction.',
'Brace: F hardens your line for a moment. Dodge and Brace have cooldowns and stop you cutting while active.',
'Reel in: hold Q for faster turns. Pay out: hold E, or use the mouse wheel, for more distance and cutting reach. The Q / E buttons on screen work too.',
'A red ring around a rival means it is about to cut your string. Dodge or brace before it strikes. Hard rivals anticipate your movement and strike from farther away.'
]).join(String.fromCharCode(10,10))+String.fromCharCode(10,10)+goal+String.fromCharCode(10,10)+'WORKSHOP: spend coins on faster Dodge and Brace recharge, one-use flight items (Diyo Shield, Sharp Manja, Swift Wind), kite trails, cut effects and three extra flying grounds. Upgrades and items work in solo flights only.'+String.fromCharCode(10,10)+'PLAY WITH FRIENDS: create a lobby, share the 5-letter code or invite link, and up to three players fly together. The last kite flying wins. Cutting a friend’s string takes one durability from them unless they dodge or brace in time.'}
$('help').onclick=()=>{const resume=state==='play'&&mode!=='versus';if(resume)state='paused';dialog('How to fly',helpText(),[['Got it',()=>{if(resume)state='play'}]])};
$('modal').addEventListener('cancel',e=>{e.preventDefault();$('actions').firstElementChild.click()});
function burst(x,y,color,count=20){for(let i=0;i<count;i++){let a=Math.random()*6.28,s=30+Math.random()*150;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,t:.6+Math.random()*.65,c:color})}}
// Durability warning: falling alarm (extra beep on the last point), red edge flash, phone buzz
function hurt(){const last=player.hp===1;[[520,0],[340,130],...(last?[[520,260],[340,390]]:[[240,260]])].forEach(([f,t])=>setTimeout(()=>tone(f,.16,'square',.07),t));
 const sky=$('sky');sky.classList.remove('hit');void sky.offsetWidth;sky.classList.add('hit');
 try{navigator.vibrate?.(last?[90,50,90,50,160]:[110,60,110])}catch{}}
function finish(win){state='result';victory=win;fire=0;earned=cuts*7+Math.floor(elapsed/15)+(win?15+5*difficulty+player.hp*2:0);coins+=earned;save();$("kn").textContent=palettes[skin][0]+' · '+coins+' coins';recap='+'+earned+' coins · Wallet '+coins+' coins\n'+cuts+' kite'+(cuts===1?'':'s')+' cut · '+points+' points';record=false;if(mode==='rush'){if(points>rushBest[difficulty]){rushBest[difficulty]=points;record=true;try{localStorage.tiharRush=JSON.stringify(rushBest)}catch{}}recap+='\nScore '+points+' · High score '+rushBest[difficulty]+(record?'  ★ New record!':'');showBest()}if(record)tone(1046,.5);if(win||record){for(let i=0;i<5;i++)burst(Math.random()*W,Math.random()*H*.7,palettes[i%4][1],40);tone(880,.4)}setTimeout(()=>{if(state==='result')dialog(record?'New high score!':win?'Congratulations, kite champion!':'Your line was cut',recap,[['Fly again',start],['Flight setup',lobby]])},win?1850:450)}
let dash=0,guard=0,dashWait=0,guardWait=0,lastDX=1,lastDY=0,shieldOn=false,manjaT=0,windT=0;
// Cooldowns are longer by default; Workshop upgrades and the Swift Wind item shorten them (friend matches use the base values for fairness)
const cd=t=>BASE_CD[t]*(mode==='versus'?1:(1-CD_STEP*up[t])*(windT>0?.5:1));
function maneuver(type){if(state!=='play')return;if(type==='dash'&&dashWait<=0){dash=.23;dashWait=cd('dash');tone(260,.22,'sawtooth',.05,1100)}else if(type==='guard'&&guardWait<=0){guard=.65;guardWait=cd('guard');tone(620,.2,'triangle',.08,330);setTimeout(()=>tone(880,.14,'triangle',.05),90)}}
let range=62;let lastTick=0;function reel(v){if(state!=='play')return;const before=line;line=clamp(line+v,0,100);if(line!==before){const now=performance.now();if(now-lastTick>85){lastTick=now;tone(300+line*5,.05,'square',.03)}}}
function tether(k){
 const ax=W*(k===player?.5:k.anchor),bend=(k===player?line:k.spool)*.25;
 return Array.from({length:17},(_,i)=>{const t=i/16;return {x:k.x+(ax-k.x)*t+2*t*(1-t)*bend,y:k.y+(H-k.y)*t}})
}
function contact(attacker,victim){
 const path=tether(victim);let best={d:Infinity};
 for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b.x-a.x,dy=b.y-a.y,t=clamp(((attacker.x-a.x)*dx+(attacker.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
 const x=a.x+t*dx,y=a.y+t*dy,d=Math.hypot(attacker.x-x,attacker.y-y);if(d<best.d)best={x,y,d}}
 return best;
}
function aim(){let best=null;for(const b of [...bots,...peers]){const hit=contact(player,b);if(hit.d<=range&&(!best||hit.d<best.d))best={...hit,b}}return best}
function damage(b,hit,credit){
 burst(hit.x,hit.y,palettes[b.n][1]);b.hp--;if(b.hp>0)return;
 bots.splice(bots.indexOf(b),1);if(credit){cuts++;points+=bounty[b.n];cutEffect(hit.x,hit.y)}
 if(mode==='rush')bots.push(bot());else if(!bots.length)finish(true)
}
function cut(){if(state!=='play'||cool>0||guard>0||dash>0)return;cool=.52;flash=.18;const hit=aim();if(hit){if(hit.b.remote)MP.cut(hit.b,hit);else damage(hit.b,hit,true);tone(1300,.1,'square',.05,520);tone(750)}else tone(320,.09,'sawtooth',.03,180)}
window.addEventListener('keydown',e=>{if(state!=='play')return;let k=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright',' ','w','s','a','d','q','e','shift','f','escape'].includes(k)){e.preventDefault();keys.add(k);if(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(k))target=null;if(k===' ')cut();if(!e.repeat&&k==='shift')maneuver('dash');if(!e.repeat&&k==='f')maneuver('guard');if(k==='escape')pause(true)}});window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>pause());document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});
canvas.onpointermove=e=>{if(state==='play'&&e.pointerType==='mouse'){let r=canvas.getBoundingClientRect();target={x:e.clientX-r.left,y:e.clientY-r.top}}};canvas.onpointerdown=e=>{if(e.pointerType==='mouse')cut()};$('cut').onpointerdown=cut;
let stick=$('stick');function steer(e){let r=stick.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,m=Math.max(22,Math.hypot(x,y));jx=x/m;jy=y/m;stick.firstElementChild.style.transform='translate('+jx*22+'px,'+jy*22+'px)'}stick.onpointerdown=e=>{stick.setPointerCapture(e.pointerId);steer(e)};stick.onpointermove=e=>{if(stick.hasPointerCapture(e.pointerId))steer(e)};stick.onlostpointercapture=()=>{jx=jy=0;stick.firstElementChild.style.transform=''};
function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function flyRival(b,foe,dt,inputX,inputY){
 b.course-=dt;
 if(b.course<=0){
   b.dive=!b.dive;
   b.course=2.8+Math.random()*2.4;
   b.intercept=Math.round(6+Math.random()*8);
   b.highLane=.11+Math.random()*.26;
 }
 const intercept=tether(foe)[b.intercept];
 const drift=Math.sin(elapsed*.8+b.phase)*25;
 const lead=difficulty===2&&foe===player?30:0, input=Math.max(1,Math.hypot(inputX,inputY));
 const goalX=clamp(intercept.x+drift+lead*inputX/input,22,W-22);
 const goalY=b.dive?clamp(intercept.y+lead*inputY/input,H*.43,H*.84):H*b.highLane;
 const anchorX=b.anchor*W,scale=H+W*.4;
 const desired=clamp((Math.hypot(goalX-anchorX,H-goalY)-100)/scale*100,0,100);
 b.spool+=clamp(desired-b.spool,-26*dt,26*dt);
 const dx=goalX-b.x,dy=goalY-b.y,dist=Math.max(1,Math.hypot(dx,dy));
 const travel=Math.min(dist,[60,95,155][difficulty]*(1.25-b.spool*.005)*dt);
 b.x+=dx/dist*travel;b.y+=dy/dist*travel;
 const radius=100+scale*b.spool/100,actual=Math.hypot(b.x-anchorX,H-b.y);
 if(actual>radius){b.x=anchorX+(b.x-anchorX)*radius/actual;b.y=H+(b.y-H)*radius/actual}
}
function step(dt){reel(((keys.has('e')?1:0)-(keys.has('q')?1:0))*60*dt);manjaT-=dt;windT-=dt;range=(42+line*.4)*(manjaT>0?1.25:1);dash-=dt;guard-=dt;dashWait-=dt;guardWait-=dt;
const touchUI=touchLayout.matches;$('dash').textContent=dashWait>0?'Dodge '+dashWait.toFixed(1):touchUI?'Dodge':'Dodge · Shift';$('guard').textContent=guardWait>0?'Brace '+guardWait.toFixed(1):touchUI?'Brace':'Brace F';elapsed+=dt;time-=dt;cool-=dt;flash-=dt;let x=jx+(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')?1:0),y=jy+(keys.has('arrowdown')||keys.has('s')?1:0)-(keys.has('arrowup')||keys.has('w')?1:0);if(target){x=(target.x-player.x)/12;y=(target.y-player.y)/12}let m=Math.max(1,Math.hypot(x,y));if(Math.hypot(x,y)>.15){lastDX=x/m;lastDY=y/m}if(dash>0){x=lastDX*3;y=lastDY*3;m=1}if(guard>0){x*=.4;y*=.4}player.x=clamp(player.x+x/m*speed[skin]*(1.25-line*.005)*dt,22,W-22);player.y=clamp(player.y+y/m*speed[skin]*(1.25-line*.005)*dt,44,H-38);let reach=100+line*.01*(H+W*.4),ax=player.x-W/2,ay=player.y-H,dist=Math.hypot(ax,ay);if(dist>reach){player.x=W/2+ax/dist*reach;player.y=H+ay/dist*reach}
for(const b of [...bots]){if(!bots.includes(b))continue;const candidates=[player,...bots.filter(other=>other!==b)];if(!candidates.includes(b.foe)||(!b.warning&&(b.focus-=dt)<=0)){b.foe=candidates.sort((u,v)=>Math.hypot(u.x-b.x,u.y-b.y)-Math.hypot(v.x-b.x,v.y-b.y))[0];b.focus=1+Math.random()*2;b.warning=0}const foe=b.foe,near=()=>contact(b,foe).d;flyRival(b,foe,dt,x,y);b.cd-=dt;if(b.warning>0){b.warning-=dt;if(b.warning<=0&&near()<(difficulty===2?89:66)&&(foe!==player||(guard<=0&&dash<=0))){if(foe!==player){damage(foe,contact(b,foe),false);continue}if(shieldOn){shieldOn=false;burst(player.x,player.y,'#65f2ef',34);tone(900,.2,'triangle',.08,420);continue}player.hp--;burst(player.x,player.y,'#ff5578');hurt();if(player.hp<=0){finish(false);break}}}else if(b.cd<=0&&near()<(difficulty===2?105:77)){b.warning=[1.45,1.05,.52][difficulty];b.cd=[4.2,3.2,1.65][difficulty]}}
if(state==='play'&&mode==='rush'&&time<=0)finish(true);$('stats').textContent=(mode==='versus'?MP.stats():mode==='rush'?Math.ceil(Math.max(0,time))+'s · Score '+points+' | High score '+Math.max(points,rushBest[difficulty]):(bots.length+1)+' flying · '+points+' pts')+' · Reel '+Math.round(line)+'% · Durability '+Math.max(0,player.hp)+'/'+health[skin]+(shieldOn?' · Shield':'')+(manjaT>0?' · Manja '+Math.ceil(manjaT)+'s':'')+(windT>0?' · Wind '+Math.ceil(windT)+'s':'');MP.tick?.(dt)}
function drawKite(b,isPlayer){let sz=isPlayer?49:42;ctx.save();ctx.translate(b.x,b.y);ctx.rotate(Math.sin(elapsed*2+(b.phase||0))*.12);ctx.strokeStyle='#51304799';ctx.beginPath();ctx.moveTo(0,10);ctx.quadraticCurveTo(-14,33,-6,49);ctx.stroke();if(kiteImages[b.n].complete)ctx.drawImage(kiteImages[b.n],-sz/2,-sz/2,sz,sz*1.38);ctx.restore();if(!isPlayer&&b.warning>0&&b.foe===player){ctx.beginPath();ctx.arc(b.x,b.y,difficulty===2?89:66,0,Math.PI*2);ctx.strokeStyle='#ff334e';ctx.lineWidth=2;ctx.stroke();ctx.lineWidth=1}if(isPlayer){ctx.beginPath();ctx.arc(b.x,b.y,range,0,Math.PI*2);ctx.strokeStyle=guard>0?'#65f2ef':flash>0?'#fff8b1':'#ffec9bc0';ctx.lineWidth=flash>0?4:2;ctx.stroke();ctx.lineWidth=1}if(isPlayer&&shieldOn){ctx.beginPath();ctx.arc(b.x,b.y+6,34,0,6.283);ctx.fillStyle='#65f2ef22';ctx.fill();ctx.strokeStyle='#8ff8f4';ctx.lineWidth=2;ctx.stroke();ctx.lineWidth=1}if(isPlayer){ctx.fillStyle='#23243b';ctx.fillRect(b.x-17,b.y-39,34,15);ctx.fillStyle='white';ctx.textAlign='center';ctx.font='bold 10px sans-serif';ctx.fillText('YOU',b.x,b.y-28)}}
function frame(now){let dt=Math.min(.05,(now-prev)/1000);prev=now;if(state==='play')step(dt);if(state==='play'||state==='result'){ctx.clearRect(0,0,W,H);MP.frame?.(dt);const hit=aim();for(const k of [...bots,...peers,player]){if(k.hp<=0)continue;ctx.beginPath();tether(k).forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.lineWidth=k===hit?.b?3:1.5;ctx.strokeStyle=k===player?'#fff1bd':k===hit?.b?'#ffdf60':palettes[k.n][1];ctx.stroke()}ctx.lineWidth=1;if(hit){ctx.beginPath();ctx.arc(hit.x,hit.y,5,0,Math.PI*2);ctx.fillStyle='#fff6bd';ctx.fill()}bots.forEach(b=>{drawKite(b,false);ctx.fillStyle='#242439';ctx.fillRect(b.x-16,b.y-32,32,5);ctx.fillStyle='#acf495';ctx.fillRect(b.x-16,b.y-32,32*b.hp/health[b.n],5)});MP.draw?.();drawFx(dt);if(player.hp>0)drawKite(player,true);if(state==='result'&&victory&&(fire-=dt)<=0){fire=.22;burst(Math.random()*W,Math.random()*H*.72,palettes[Math.floor(Math.random()*4)][1],38)}for(const p of particles){p.t-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=62*dt;ctx.globalAlpha=Math.min(1,Math.max(0,p.t*2));ctx.fillStyle=p.c;ctx.fillRect(p.x,p.y,4,4)}ctx.globalAlpha=1;particles=particles.filter(p=>p.t>0)}requestAnimationFrame(frame)}
new ResizeObserver(()=>{if(state!=='setup'&&canvas.clientWidth)size()}).observe(canvas);requestAnimationFrame(frame);

canvas.addEventListener('wheel',e=>{if(state==='play'){e.preventDefault();reel(Math.sign(e.deltaY)*6)}},{passive:false});
const touchLayout=matchMedia('(pointer:coarse)');
for(const [label,short,key,v] of [['Q · Reel in','Reel in','q',-10],['E · Pay out','Pay out','e',10]]){
 const b=document.createElement('button');b.textContent=touchLayout.matches?short:label;b.title=v<0?'Reel in':'Pay out';
 let hold=0;const release=()=>{clearTimeout(hold);keys.delete(key)};
 // tap = one step, hold = continuous reel (same path as the Q / E keys)
 b.onpointerdown=e=>{e.preventDefault();try{b.setPointerCapture(e.pointerId)}catch{}reel(v);clearTimeout(hold);hold=setTimeout(()=>{if(state==='play')keys.add(key)},240)};
 b.onpointerup=b.onpointercancel=b.onlostpointercapture=release;
 $('reel').append(b)}
// Dodge / Brace fire on press (no tap delay); click with detail 0 covers keyboard activation
for(const [id,type] of [['dash','dash'],['guard','guard']]){const b=$(id);b.onpointerdown=e=>{e.preventDefault();maneuver(type)};b.onclick=e=>{if(e.detail===0)maneuver(type)}}
const grounds=$('grounds');
function chooseGround(b,remote){select(grounds,b);$('sky').style.backgroundImage=b.style.getPropertyValue('--scene');$('location').textContent=b.textContent.toUpperCase()+', NEPAL';if(!remote)try{localStorage.tiharGround=b.dataset.ground}catch{}}
let preferred='valley';try{preferred=localStorage.tiharGround||preferred}catch{}
const groundCost=b=>+b.dataset.price||0;
function refreshGrounds(){for(const b of grounds.children)b.classList.toggle('locked',groundCost(b)>0&&!groundsOwned.includes(b.dataset.ground))}
for(const b of grounds.children)b.onclick=()=>{if(MP.locked?.())return;
 if(b.classList.contains('locked')){const p=groundCost(b);dialog(b.textContent,p+' coins · Wallet '+coins+' coins\nA new Tihar flying ground.',coins>=p?[['Buy and fly here',()=>{coins-=p;groundsOwned.push(b.dataset.ground);save();refreshGrounds();renderShop();chooseGround(b);MP.ground?.(b.dataset.ground)}],['Back',()=>{}]]:[['Back',()=>{}]]);return}
 chooseGround(b);MP.ground?.(b.dataset.ground)};
refreshGrounds();
{const pb=[...grounds.children].find(b=>b.dataset.ground===preferred);chooseGround(pb&&!pb.classList.contains('locked')?pb:grounds.firstElementChild)}

// Stop double-tap zoom, pinch zoom and text/image selection from interrupting a flight
{let lastTap=0;const playing=()=>document.body.classList.contains('playing');
document.addEventListener('touchend',e=>{const t=Date.now();if(playing()&&t-lastTap<400&&!e.target.closest('#pause,dialog'))e.preventDefault();lastTap=t},{passive:false});
document.addEventListener('touchmove',e=>{if(playing()&&e.touches.length>1)e.preventDefault()},{passive:false});
for(const n of ['gesturestart','gesturechange','gestureend'])document.addEventListener(n,e=>e.preventDefault());
$('sky').addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('selectstart',e=>{if(playing()&&!e.target.closest?.('dialog'))e.preventDefault()});}
