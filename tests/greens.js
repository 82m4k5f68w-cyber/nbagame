const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');const code=s.match(/<script>\n([\s\S]*)<\/script>/)[1];
const noop=()=>{};const g0=()=>({addColorStop:noop});const ctx=new Proxy({},{get:(t,k)=>k==='createLinearGradient'||k==='createRadialGradient'?g0:noop,set:()=>true});
const el=()=>({getContext:()=>ctx,style:{setProperty:noop},addEventListener:noop,querySelectorAll:()=>[],width:0,height:0,dataset:{},classList:{toggle:noop}});
global.document={querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el(),getElementById:()=>el()};global.window=global;global.matchMedia=()=>({matches:false});global.navigator={getGamepads:()=>[]};global.localStorage={getItem:()=>null,setItem(){}};global.addEventListener=noop;global.performance={now:()=>0};global.requestAnimationFrame=noop;global.AudioContext=function(){throw 1};
(async()=>{(0,eval)(fs.readFileSync('libs/rapier.iife.js','utf8'));(0,eval)(code+";globalThis.__t={RAPok:()=>!!RAP,start,upd,K,ev,launch,bstep,get P(){return P},get B(){return B},get ap(){return ap},HXs,setup}");
const t=__t;for(let i=0;i<200&&!t.RAPok();i++)await new Promise(r=>setTimeout(r,20));console.log('rapier',t.RAPok());t.start(0);const P=t.P;let made=0,n=0,res={};
for(let i=0;i<400;i++){t.setup(0);const p=P[0];P.forEach((q,k)=>{if(k)q.x=60,q.y=20+k*8,q.z=0});p.x=480+Math.random()*330;p.y=60+Math.random()*380;p.z=20;p.vz=0;p.mode='s';p.t=.4;p.sv=0;p.rl=0;
 const D=Math.hypot(887.5-p.x,250-p.y);p.mt=p.st===1?.45:.6;
 const B=t.B;B.owner=p;B.mode='held';t.launch(p);let T=0;B.sc=0;let hit=0;
 while(T<4&&B.z>-5){t.bstep(.004);T+=.004;if(B.owner)break}
 n++;const cat=B.sc?'made':B.owner?'caught':'miss';res[cat]=(res[cat]||0)+1}
console.log(res);
})();
