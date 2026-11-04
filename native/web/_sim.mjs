import { readFileSync } from 'node:fs';
const J=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const { createEnemyAI } = await import('./enemy_ai.js'); const { createProps } = await import('./props.js'); const { ChunkAnims } = await import('./chunk_anim.js'); const { Areas } = await import('./areas.js');
const ai=J('./data/enemies/ai.json'), pd=J('./data/props/props.json');
const A=new Areas(ai.areas); const anims=new ChunkAnims(pd.chunkAnims); const props=createProps({data:pd,areas:A,warn:()=>{}});
let P=[-1737,-7.5,-375]; const player={pos:P,hp:780,id:0x16,f118:0,s64:0};
let eyeMode=process.argv[2]||'see';
const W=createEnemyAI({data:ai,player,rand:()=>.5,quiet:true,props,chunkAnims:anims,areas:A,eventFlags:{0:4,1:7,2:4,15:1,43:1,44:1,45:1,46:1,47:1,63:3},los:()=>false,
 viewCam:()=>{const r=W.objects? null:null;return {eye:[0,0,0],fov:73.5,toView:p=>eyeMode==='see'?[0,0,100]:[0,0,-100]};}});
A.onSwitch=(k,on)=>{props.areaSwitch(k,on);W.areaSwitch(k,on);};
const step=()=>{const o=P.slice();return o;};
let log=[],last=[];
const T150=W.triggers[150];
let prevE=-1,prevA='';
for(let f=0;f<4000;f++){
  const old=P.slice();
  if(f<100) P[2]+=0.4; 
  player.pos=P; A.frame(P); 
  W.tick(1.2,old,P); anims.frame(null,1.2);
  for(const e of W.events) if(/t149|t150|script (209|201|192|194)|rec 147|rec 149|rec 150|\b147\b/.test(e)) log.push(f+' '+e);
  const act=[147,149,150].filter(r=>{const o=W.objects.get(r+22);return o&&(o.flags28&1);}).join()+'|'+W.actors.map(a=>a.rec).filter(r=>[147,149,150].includes(r)).join();
  if(T150.e0!==prevE||act!==prevA){console.log(f,'door150',T150.e0,'actors',act,'s66',W.mshort[66]);prevE=T150.e0;prevA=act;}
}
console.log(log.slice(0,18).join('\n').slice(0,1800));
console.log('warn',[...new Set(log.filter(x=>/not transl/.test(x)))].slice(0,4));
