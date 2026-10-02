const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');const code=s.match(/<script>\n([\s\S]*)<\/script>/)[1];
const noop=()=>{};const g0=()=>({addColorStop:noop});const ctx=new Proxy({},{get:(t,k)=>k==='createLinearGradient'||k==='createRadialGradient'?g0:noop,set:()=>true});
const el=()=>({getContext:()=>ctx,style:{setProperty:noop},addEventListener:noop,querySelectorAll:()=>[],querySelector:()=>el(),width:0,height:0,dataset:{},classList:{toggle:noop},value:'x'});
global.document={querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el(),getElementById:()=>el()};global.window=global;global.matchMedia=()=>({matches:false});global.navigator={getGamepads:()=>[]};global.localStorage={getItem:()=>null,setItem(){}};global.addEventListener=noop;global.performance={now:()=>0};global.requestAnimationFrame=noop;global.AudioContext=function(){throw 1};global.localStorage={getItem:()=>null,setItem:noop};
(0,eval)(code+";globalThis.__t={start,pass,bstep,setup,get P(){return P},get B(){return B}}");
const t=__t;t.start(1);const P=t.P;const res={};
for(const ty of[undefined,0,1,2]){let ok=0,loose=0,wrong=0;const n=300;
 for(let i=0;i<n;i++){t.setup(0);const p=P[0],r=P[2];P.forEach((q,k)=>{if(k!==0&&k!==2){q.x=60;q.y=20+k*10}});
  p.x=300+Math.random()*200;p.y=100+Math.random()*300;p.z=0;p.vx=p.vy=0;const ang=Math.random()*6.28,d=80+Math.random()*260;r.x=p.x+Math.cos(ang)*d;r.y=Math.min(480,Math.max(20,p.y+Math.sin(ang)*d));r.x=Math.min(900,Math.max(30,r.x));
  const sp=Math.random()*150,a2=Math.random()*6.28;r.vx=Math.cos(a2)*sp;r.vy=Math.sin(a2)*sp;r.z=0;r.mode='i';
  const B=t.B;B.owner=p;B.mode='held';B.x=p.x+8;B.y=p.y;B.z=35;t.pass(p,r,ty);
  let T=0;while(T<2.5){t.bstep(.008);T+=.008;r.x=Math.min(920,Math.max(20,r.x+r.vx*.008));r.y=Math.min(480,Math.max(20,r.y+r.vy*.008));if(B.owner)break}
  if(B.owner===r)ok++;else if(B.owner)wrong++;else loose++}
 res[ty===undefined?'auto':ty]={caught:(100*ok/n).toFixed(0)+'%',loose:(100*loose/n).toFixed(0)+'%',other:(100*wrong/n).toFixed(0)+'%'}}
console.log(JSON.stringify(res));
