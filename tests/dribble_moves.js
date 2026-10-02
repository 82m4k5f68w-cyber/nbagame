const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');const code=s.match(/<script>\n([\s\S]*)<\/script>/)[1];
const noop=()=>{};const g0=()=>({addColorStop:noop});const ctx=new Proxy({},{get:(t,k)=>k==='createLinearGradient'||k==='createRadialGradient'?g0:noop,set:()=>true});
const el=()=>({getContext:()=>ctx,style:{setProperty:noop},addEventListener:noop,querySelectorAll:()=>[],querySelector:()=>el(),width:0,height:0,dataset:{},classList:{toggle:noop},value:'x'});
global.document={querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el(),getElementById:()=>el()};global.window=global;global.matchMedia=()=>({matches:false});global.navigator={getGamepads:()=>[]};global.localStorage={getItem:()=>null,setItem(){}};global.addEventListener=noop;global.performance={now:()=>0};global.requestAnimationFrame=noop;global.AudioContext=function(){throw 1};global.localStorage={getItem:()=>null,setItem:noop};
(0,eval)(code+";globalThis.__t={start,upd,draw,setup,set INB(v){inb=v},K,ev,set MY(v){MYM=v},get P(){return P},get B(){return B},get sc(){return sc},get ap(){return ap}}");

const t=__t;const out={};
for(const key of[null,'cc','x','vv']){t.MY=0;t.start(1);const P=t.P;t.setup(0);t.INB=0;const p=P[0];p.x=500;p.y=250;p.vx=p.vy=0;t.B.owner=p;t.B.mode='held';
 const d=P[5];d.x=530;d.y=250;let maxs=0,x0=p.x,y0=p.y,mvSeen=0,hasBall=0;
 for(let i=0;i<90;i++){if(i===10&&key)t.ev[key]=1;t.K.ArrowRight=true;t.upd(.016);maxs=Math.max(maxs,Math.hypot(p.vx,p.vy));if(p.mvT>0)mvSeen++;if(t.B.owner===p)hasBall++}
 out[key||'none']={maxSpeed:maxs.toFixed(0),dx:(p.x-x0).toFixed(0),dy:(p.y-y0).toFixed(0),moveFrames:mvSeen,ballKept:hasBall+'/90'}}
console.log(JSON.stringify(out));
