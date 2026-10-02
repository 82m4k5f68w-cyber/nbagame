const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');const code=s.match(/<script>\n([\s\S]*)<\/script>/)[1];
const noop=()=>{};const g0=()=>({addColorStop:noop});const ctx=new Proxy({},{get:(t,k)=>k==='createLinearGradient'||k==='createRadialGradient'?g0:noop,set:()=>true});
const el=()=>({getContext:()=>ctx,style:{setProperty:noop},addEventListener:noop,querySelectorAll:()=>[],querySelector:()=>el(),width:0,height:0,dataset:{},classList:{toggle:noop},value:'x'});
global.document={querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el(),getElementById:()=>el()};global.window=global;global.navigator={getGamepads:()=>{throw new Error('Access to the feature gamepad is disallowed by permissions policy')}};global.navigator={getGamepads:()=>[]};global.matchMedia=()=>({matches:false});global.addEventListener=noop;global.performance={now:()=>0};global.requestAnimationFrame=noop;global.AudioContext=function(){throw 1};global.localStorage={getItem:()=>null,setItem:noop};
(0,eval)(code+";globalThis.__t={start,upd,draw,menu,edMy,K,ev,set MY(v){MYM=v},get P(){return P},get B(){return B},get sc(){return sc},get ap(){return ap}}");
const t=__t;t.menu();t.edMy();let mv=0,post=0;
for(let g=0;g<6;g++){t.MY=g%2;t.start(g%7);for(let i=0;i<8000;i++){if(i%9===0){t.K.ArrowRight=Math.random()<.6;t.K.ArrowLeft=Math.random()<.3;t.K.ArrowUp=Math.random()<.4;t.K.ArrowDown=Math.random()<.4;t.K.KeyB=Math.random()<.3}const r=Math.random();if(r<.03)t.ev.sd=1;if(r>.03&&r<.06)t.ev.su=1;if(r>.06&&r<.08)t.ev.e=1;if(r>.08&&r<.1)t.ev.cc=1;if(r>.1&&r<.12)t.ev.x=1;if(r>.12&&r<.14)t.ev.vv=1;
 try{t.upd(.016);t.draw()}catch(e){console.log('ERR',e.stack.split('\n').slice(0,3).join('\n'));process.exit()}
 for(const p of t.P){if(p.mvT>0)mv++;if(p.postA)post++;if(![p.x,p.y,p.z,p.vx,p.vy].every(isFinite)){console.log('NaN');process.exit()}}
 if(g%2===1&&t.ap!==0){console.log('ap drift',t.ap);process.exit()}}}
console.log('ok move frames',mv,'post frames',post,t.sc,'myName',t.P[0].n);
