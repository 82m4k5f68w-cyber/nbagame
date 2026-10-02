const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');const code=s.match(/<script>\n([\s\S]*)<\/script>/)[1];
const noop=()=>{};const g0=()=>({addColorStop:noop});const ctx=new Proxy({},{get:(t,k)=>k==='createLinearGradient'||k==='createRadialGradient'?g0:noop,set:()=>true});
const el=()=>({getContext:()=>ctx,style:{setProperty:noop},addEventListener:noop,querySelectorAll:()=>[],width:0,height:0,dataset:{},classList:{toggle:noop}});
global.document={querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el(),getElementById:()=>el()};global.window=global;global.matchMedia=()=>({matches:false});global.navigator={getGamepads:()=>[]};global.localStorage={getItem:()=>null,setItem(){}};global.addEventListener=noop;global.performance={now:()=>0};global.requestAnimationFrame=noop;global.AudioContext=function(){throw 1};
(async()=>{(0,eval)(fs.readFileSync('libs/rapier.iife.js','utf8'));(0,eval)(code+";globalThis.__t={upd,ev,INB:v=>{inb=v},RAPok:()=>!!RAP,setRAP:v=>{if(!v){globalThis.__R=RAP;RAP=null}else RAP=globalThis.__R||RAP},start,upd,K,ev,launch,bstep,get P(){return P},get B(){return B},get ap(){return ap},HXs,setup}");
const t=__t;for(let i=0;i<200&&!t.RAPok();i++)await new Promise(r=>setTimeout(r,20));
const out={};
for(const[lo,hi,label,mv]of[[560,660,'mid/3 (23-33ft)',0],[430,560,'deep (33-45ft)',0],[330,430,'heave (45ft+)',0],[560,660,'moving toward hoop',1]]){let made=0,n=60;
 for(let i=0;i<n;i++){t.start(1);const P=t.P,p=P[0];t.setup(0);t.INB(0);P.forEach((q,k)=>{if(k)q.x=60,q.y=20+k*8});p.x=lo+Math.random()*(hi-lo);p.y=120+Math.random()*260;p.vx=p.vy=0;const B=t.B;B.owner=p;B.mode='held';
  if(mv){t.K.ArrowRight=true}t.ev.sd=1;t.upd(1/60);t.ev.sd=0;let tm=0;while(p.mode==='c'&&tm<2){if(p.t>=.45)t.ev.su=1;t.upd(1/60);t.ev.su=0;tm+=1/60}t.K.ArrowRight=false;
  let T=0;while(B.owner===p&&T<1.5){t.upd(1/60);T+=1/60}T=0;while(T<5&&!B.owner){t.upd(1/60);T+=1/60;if(B.sc)break}if(B.sc)made++}
 out[label]=made+'/'+n}
console.log('Curry greens',JSON.stringify(out))})();
