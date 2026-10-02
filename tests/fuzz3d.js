const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');const code=s.match(/<script>\n([\s\S]*)<\/script>/)[1];
const noop=()=>{};const g0=()=>({addColorStop:noop});const ctx=new Proxy({},{get:(t,k)=>k==='createLinearGradient'||k==='createRadialGradient'?g0:noop,set:()=>true});
const el=()=>({getContext:()=>ctx,style:{setProperty:noop},addEventListener:noop,querySelectorAll:()=>[],width:0,height:0,dataset:{},classList:{toggle:noop}});
global.document={querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el(),getElementById:()=>el()};global.window=global;global.navigator={getGamepads:()=>{throw new Error('Access to the feature gamepad is disallowed by permissions policy')}};global.navigator={getGamepads:()=>[]};global.matchMedia=()=>({matches:false});global.addEventListener=noop;global.performance={now:()=>0};global.requestAnimationFrame=noop;global.AudioContext=function(){throw 1};
(0,eval)(fs.readFileSync('libs/rapier.iife.js','utf8'));(async()=>{(0,eval)(code+";globalThis.__t={RAPok:()=>!!RAP,start,upd,draw,K,ev,get P(){return P}}");
const t=__t;for(let i=0;i<200&&!t.RAPok();i++)await new Promise(r=>setTimeout(r,20));console.log('rapier',t.RAPok());let mx=-9,mn=9,bad=0;
for(let g=0;g<3;g++){t.start(g);for(let i=0;i<9000;i++){if(i%9===0){t.K.ArrowRight=Math.random()<.6;t.K.ArrowLeft=Math.random()<.3;t.K.ArrowUp=Math.random()<.4;t.K.ArrowDown=Math.random()<.4}const r=Math.random();if(r<.03)t.ev.sd=1;if(r>.03&&r<.06)t.ev.su=1;if(r>.06&&r<.08)t.ev.e=1;
 try{t.upd(.016);t.draw()}catch(e){console.log('ERR',e.stack.split('\n').slice(0,3).join('\n'));process.exit()}
 for(const p of t.P){if(!p.q)continue;for(const v of Object.values(p.q))if(!isFinite(v))bad++;mx=Math.max(mx,p.q.wR);mn=Math.min(mn,p.q.wR)}}}
console.log('ok bad',bad,'wrist range',mn.toFixed(2),mx.toFixed(2));
})();
