// @ts-nocheck -- hub UI ported verbatim from the legacy template
// Hub: mode picker, update log, controls. Boots the shared engine in-page (no document.write) except the legacy Classic mode.
import { boot } from "./game";
import classicHtml from "../modes/classic/index.html?raw";
import classicJs from "../modes/classic/game.js?raw";

const FLAGS: Record<string, { np: number; r3d: boolean }> = {
  "5v5-3d": { np: 5, r3d: true },
  "5v5-2d": { np: 5, r3d: false },
  "1v1-3d": { np: 1, r3d: true },
  "1v1-2d": { np: 1, r3d: false },
};
let hubRaf = 0;
function go(k: string, my: number, mp: number, online: any = false, quick: any = null) {
  if (k === "classic") {
    const h = classicHtml.replace('<script src="game.js"></script>', () => "<script>\n" + classicJs + "</script>");
    document.open();
    document.write(h);
    document.close();
    return;
  }
  cancelAnimationFrame(hubRaf);
  hubRaf = -1;
  (document.getElementById("hcss") as HTMLStyleElement).media = "not all";
  (document.getElementById("gcss") as HTMLStyleElement).media = "all";
  document.getElementById("hub")!.remove();
  document.getElementById("game")!.hidden = false;
  document.getElementById("bk")!.onclick = () => location.reload();
  boot({ ...FLAGS[k], my, mp, mode: k, online, quick });
}
(window as any).go = go;
const pre = (window as any).__H2K_MODE;
if (pre) go(pre, 0, 0);
else hubInit();
function hubInit() {

const MODES=[
{t:'5v5 NBA GAME',ic:'🏆',c:'#1d428a',big:1,tags:['FULL COURT','4 QUARTERS','FOULS · FTs','REPLAYS','BOX SCORE'],hot:'FLAGSHIP',d:'The full game: 7 teams, motion offense, screens, rebounds, free throws and technicals, Pro Play animation, instant replays and a box score.',b:[['▶ 3D','5v5-3d'],['▶ 2D','5v5-2d',0,0,1]]},
{t:'1V1 SHOWDOWN',ic:'⚡',c:'#7b3fb5',tags:['PICK ANY STAR','FULL COURT'],d:'Pick any of 35 players and duel the CPU with the same physics, fouls and tempo shooting.',b:[['▶ 3D','1v1-3d'],['▶ 2D','1v1-2d',0,0,1]]},
{t:'MY PLAYER',ic:'🧬',c:'#e8541e',tags:['CREATE-A-PLAYER','SAVED'],d:'Build your own player: ratings, shot form, height, build and look. Play him in 5v5 or 1v1.',b:[['▶ 5v5 3D','5v5-3d',1],['▶ 1v1 3D','1v1-3d',1],['5v5 2D','5v5-2d',1,0,1],['1v1 2D','1v1-2d',1,0,1]]},
{t:'PLAY ONLINE',ic:'🌐',c:'#0b7a8a',online:1,tags:['NO INSTALL','ROOM CODES','ANTI-LAG'],hot:'NEW',d:'Host a game and send your friend the 4-letter code, or type a friend\'s code below. Works right on this page.',b:[['▶ Host 5v5','5v5-3d',0,0,0,'host'],['▶ Host 1v1','1v1-3d',0,0,0,'host'],['Lobby (2D)','5v5-2d',0,0,1,1]]},
{t:'LOCAL 2-PLAYER',ic:'🎮',c:'#0f8a5f',tags:['SAME DEVICE','KEYBOARD'],d:'Two people, one keyboard. Player 2 gets the right-side team with arrows, Enter, / . and ,',b:[['▶ 5v5 3D','5v5-3d',0,1],['▶ 1v1 3D','1v1-3d',0,1]]},
{t:'CLASSIC 1V1',ic:'📼',c:'#007a33',tags:['ORIGINAL','SIDE VIEW'],d:'The original side-view 1v1 with signature shot forms, the double step-back and the hold-and-release meter.',b:[['▶ PLAY','classic']]}];
const LOG=[
{v:'3.3',n:'Animation Engine',d:'Today',n2:1,l:['<b>New skeleton</b> — chest, neck, head, ankles and fingers: players turn their heads to follow the ball, twist through the shoulders, roll through each step and grip the ball','<b>Stride-matched running</b> — walk, jog and sprint cycles timed to speed so feet stop sliding, with heel kick, toe-off, real backpedals and low defensive slides that never cross the feet','<b>Smooth transitions</b> — every move blends in at its own speed (snappy into a shot, slow into a rest)','<b>Life between plays</b> — breathing, hands on knees when tired or lined up for free throws','<b>Animation Studio</b> — pause menu → 🎬 to watch any animation from any angle','Online fix: the host can no longer start before a friend who just joined has picked a side']},
{v:'3.2',n:'Feel the Game',d:'Oct 2026',l:['<b>Real dribbling</b> — the hand pushes the ball into the floor and catches it on the way up, beside the dribbling hand; faster when driving, lower when guarded, with a bounce sound','<b>Signature celebrations</b> — shimmy, night-night, flex, three-up, chest thump, roar, shh and point-to-the-sky after big threes, dunks, and-ones and clutch shots (every player has their own; works online)','<b>Shot flight</b> — real release angles (about 48–55°, deep shots higher) and true backspin you can see on the 3D ball','<b>Net physics</b> — the net grabs and slows a swish, shakes when the ball rings the rim, and never lets a fast ball slip through','Greens still drop: perfect-shot and swish tests rerun on every change']},
{v:'3.1',n:'Bug Fixes',d:'Oct 2026',l:['<b>Fixed:</b> the ball could fly out of the arena on a hard bounce and freeze the game','<b>Fixed:</b> My Player 1v1 now faces the opponent you picked on the matchup screen','<b>Fixed:</b> the game clock showed the wrong time with longer or shorter quarter lengths','<b>Fixed:</b> the FOULS counter labels were swapped when you play the right-side team (online or player 2)','<b>Fixed:</b> long online games slowly used more memory on the joining player\'s device','New automated check plays full games in every mode (score, clock, ball and stats must stay valid)']},
{v:'3.0',n:'Online + Next-Gen',d:'Oct 2026',l:['<b>Play online</b> — host a game, friends join with a 4-letter code; 1v1 or 5v5 with up to 2 humans per side','<b>Anti-lag</b> — instant response for your player, smooth interpolation for everyone else, shot timing judged on your own screen','<b>New player models</b> — smooth skinned bodies with planted feet (leg IK)','<b>Effects</b> — bloom, ambient occlusion, motion blur and a reflective floor (Display → Effects)','<b>Real physics passes</b> with backspin; bodies deflect loose balls; dribble has momentum','<b>Menu</b> — grouped settings that are remembered, keyboard team picking, Esc pause menu','One shared engine for every mode; the whole game is now 2.7 MB']},
{v:'2.5',n:'Arena Night',d:'Oct 2026',l:['<b>Camera options</b> — Broadcast, 2K Style, Baseline and Player Lock (K key, CAM button, or pick in the menu)','<b>Instant replays</b> — slow-motion replay after dunks, green threes and more (Space skips)','<b>Live stats + box score</b> — points, rebounds, assists, FG and 3P, blocks, shown live and at full time','<b>Gamepad support</b> — left stick, A shoot, X pass, B lob, Y step-back, LB/RB moves, LT post, RT sprint, Select camera','<b>Reactive crowd audio</b> that swells after baskets and blocks','<b>Pro Play shot upgrade</b> — the ball now sits in the shooting hand through the gather, set point and release, and is released from the real hand position; fadeaways now turn into the shot','<b>New menu</b> and this update log']},
{v:'2.4',n:'Graphics',d:'Oct 2026',l:['1,800-fan animated crowd that jumps after baskets','Jumbotron over center court with live score and clock','Glowing arena lights, jersey names above numbers, score bug team colors','Graphics Low / Medium / High with automatic downgrade on slow devices','Fixed Curry missing deep greens — steeper arcs and two-axis aim correction']},
{v:'2.3',n:'Animation',d:'Oct 2026',l:['Defenders face the ball and slide; handlers backpedal toward the rim','Dribbling hand reaches the real ball position (hand IK)','Contest hands, pass-and-catch poses','Fixed-timestep simulation so slow devices no longer run in slow motion']},
{v:'2.2',n:'Physics',d:'Oct 2026',l:['Rapier physics: ball, 24-piece rim, backboard, floor and walls','Backspin and Magnus lift on jumpers','Shots are pre-simulated so perfect timing still goes in']},
{v:'2.1',n:'Real 3D',d:'Oct 2026',l:['Real WebGL with three.js bundled in — no CDN','Shadows, glossy hardwood, glass backboards, physics net','Fixed the black screen (a black overlay was covering the 3D view)']},
{v:'2.0',n:'Gameplay',d:'Oct 2026',l:['Local 2-player','No steals; physics net; crossover flick','Cuts and relocations for every off-ball player; Curry runs the most','Passing overhaul, rebound assist, wider greens, meter green at the top']},
{v:'1.x',n:'Foundations',d:'Sep–Oct 2026',l:['5v5 and 1v1 modes in 3D and 2D plus the Classic 1v1','Fouls, free throws, technicals, inbounds, shot clock, quarters','Tempo shooting and 4 shot meters incl. Arrow 2; contest shrinks the window','My Player creator, dribble moves, post moves, Pro Play engine','Warriors-style screens and pindowns; Curry signature form']}];
const K1=[['Move','WASD / arrows'],['Shoot','hold SPACE, release on green'],['Tempo mode','T, then tap SPACE twice'],['Sprint','Shift'],['Pass','E (toward your stick)'],['Lob pass','R'],['Meter style','M'],['Camera','K'],['Switch defender','Q']];
const K2=[['Hesitation','C'],['Spin move','X'],['Behind the back','V'],['Step-back','F (Curry: double)'],['Crossover','flick the stick the other way'],['Post up','hold B'],['Hook / drop step / turnaround','C / X / V while posting']];
const K3=[['Skip replay','SPACE'],['Back to menu','← Modes button']];
const K4=[['Move','arrow keys'],['Shoot','Enter (hold and release)'],['Pass','/'],['Spin / hesitation','. and ,'],['Sprint','Right Shift']];
const K5=[['Move','left stick'],['Shoot','A (hold and release)'],['Pass / lob','X / B'],['Step-back','Y'],['Hesi / spin','LB / RB'],['Post / sprint','LT / RT'],['Camera','Select']];
const $=s=>document.querySelector(s);
let LP:any=null,RC:any={w:0,l:0,st:0};try{LP=JSON.parse(localStorage.getItem('h2k_lastplay')||'null');RC={...RC,...JSON.parse(localStorage.getItem('h2k_rec')||'{}')}}catch(e){}
const MODE_N:any={'5v5-3d':'5v5 3D','5v5-2d':'5v5 2D','1v1-3d':'1v1 3D','1v1-2d':'1v1 2D'};
const qp=document.createElement('div');qp.className='qp';qp.innerHTML=`${LP&&MODE_N[LP.mode]?`<button id="qpb" class="qpb">▶ QUICK PLAY <small>${MODE_N[LP.mode]} · your last matchup</small></button>`:`<button id="qpb" class="qpb">▶ QUICK PLAY <small>5v5 3D · jump straight in</small></button>`}<div class="qrec"><b>${RC.w}</b>W <b>${RC.l}</b>L${RC.st>1?` · 🔥 <b>${RC.st}</b> straight`:''}</div>`;
document.querySelector('#play .hero')!.appendChild(qp);
$('#qpb').onclick=()=>LP&&MODE_N[LP.mode]?go(LP.mode,0,0,false,{sel:LP.sel,opp:LP.opp}):go('5v5-3d',0,0,false,{sel:0,opp:-1});
$('#grid').innerHTML=MODES.map((m,i)=>`<div class="m${m.big?' big':''}" style="--c:${m.c};--i:${i}"><div class="ic">${m.ic}</div><h2>${m.t}</h2><div class="tags">${m.hot?`<i class="hot">${m.hot}</i>`:''}${m.tags.map(t=>`<i>${t}</i>`).join('')}</div><p>${m.d}</p>${m.b.map(b=>`<button class="${b[4]?'b2':''}" data-g="${b[1]}" data-my="${b[2]||0}" data-mp="${b[3]||0}" data-on="${b[5]||0}">${b[0]}</button>`).join('')}${m.online?'<div class="jn"><input id="hc" maxlength="4" placeholder="CODE" aria-label="Game code" autocomplete="off"><button id="hj" data-skip="1">JOIN ▶</button><span id="hcm"></span></div>':''}</div>`).join('');
document.querySelectorAll<HTMLElement>('[data-g]').forEach(b=>b.onclick=()=>go(b.dataset.g!,+b.dataset.my!,+b.dataset.mp!,b.dataset.on==='host'?{host:true}:b.dataset.on==='1'));
const hc=$('#hc'),hj=$('#hj'),joinIt=()=>{const c=(hc.value||'').toUpperCase().replace(/[^A-Z]/g,'');if(c.length!==4){$('#hcm').textContent='Enter the 4-letter code';hc.focus();return}go('5v5-3d',0,0,{join:c})};
if(hc){hc.oninput=()=>{hc.value=hc.value.toUpperCase().replace(/[^A-Z]/g,'');$('#hcm').textContent=''};hc.onkeydown=e=>{if(e.key==='Enter')joinIt()};hj.onclick=joinIt;try{const l=localStorage.getItem('h2k_last');if(l)hc.placeholder=l}catch(e){}}
document.querySelectorAll('.m').forEach(c=>{c.onmousemove=e=>{const r=c.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;c.style.setProperty('--ry',((x-.5)*8)+'deg');c.style.setProperty('--rx',((.5-y)*6)+'deg');c.style.setProperty('--mx',x*100+'%');c.style.setProperty('--my',y*100+'%')};c.onmouseleave=()=>{c.style.setProperty('--rx','0deg');c.style.setProperty('--ry','0deg')}});
$('#logp').innerHTML=LOG.map((r,i)=>`<div class="rel" style="animation-delay:${i*60}ms"><h3>v${r.v} <span>${r.n}</span>${r.n2?'<em>LATEST</em>':''}<s>${r.d}</s></h3><ul>${r.l.map(x=>`<li>${x}</li>`).join('')}</ul></div>`).join('');
const kh=(id,a)=>$(id).innerHTML=a.map(x=>`<div><span>${x[0]}</span><kbd>${x[1]}</kbd></div>`).join('');kh('#k1',K1);kh('#k2',K2);kh('#k3',K3);kh('#k4',K4);kh('#k5',K5);
try{if(localStorage.getItem('h2k_seen')==='3.3')$('#nw').style.display='none'}catch(e){}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));['play','log','how'].forEach(t=>$('#'+t).hidden=t!==b.dataset.t);if(b.dataset.t==='log'){$('#nw').style.display='none';try{localStorage.setItem('h2k_seen','3.3')}catch(e){}}window.scrollTo(0,0)});
const cv=$('#bg'),c=cv.getContext('2d');let W,H,pts=[];function rs(){W=cv.width=innerWidth;H=cv.height=innerHeight;pts=Array.from({length:42},()=>({x:Math.random()*W,y:Math.random()*H,r:1+Math.random()*3,v:.15+Math.random()*.5}))}rs();addEventListener('resize',rs);let t0=0;
function fr(t){if(hubRaf<0)return;if(document.hidden){hubRaf=requestAnimationFrame(fr);return}c.clearRect(0,0,W,H);const g=c.createRadialGradient(W*.5,H*.1,0,W*.5,H*.1,Math.max(W,H)*.9);g.addColorStop(0,'#1c2257');g.addColorStop(.5,'#0a0c1c');g.addColorStop(1,'#05060d');c.fillStyle=g;c.fillRect(0,0,W,H);
 c.strokeStyle='rgba(255,170,80,.10)';c.lineWidth=1;const hz=H*.62,off=(t*.02)%80;for(let i=-12;i<=12;i++){c.beginPath();c.moveTo(W/2+i*40,hz);c.lineTo(W/2+i*260,H);c.stroke()}for(let k=0;k<12;k++){const y=hz+Math.pow((k*80+off)/960,2)*(H-hz)*2.2;if(y>hz&&y<H){c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke()}}
 c.beginPath();c.arc(W/2,hz+8,Math.min(W,H)*.2,Math.PI,0);c.strokeStyle='rgba(255,210,63,.12)';c.lineWidth=2;c.stroke();
 for(const p of pts){p.y-=p.v;if(p.y<-5){p.y=H+5;p.x=Math.random()*W}c.fillStyle='rgba(255,140,50,.35)';c.beginPath();c.arc(p.x,p.y,p.r,0,6.3);c.fill()}hubRaf=requestAnimationFrame(fr)}hubRaf=requestAnimationFrame(fr);

}
