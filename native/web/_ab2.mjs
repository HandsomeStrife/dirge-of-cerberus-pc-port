// walk-free experiment: the page at the alcove
import { createRequire } from 'node:module'; import { spawn, execSync } from 'node:child_process'; import net from 'node:net'; import path from 'node:path';
const here='/srv/games/dirge-port/native/web'; const require=createRequire(import.meta.url);
let chromium; try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(execSync('npm root -g').toString().trim(),'playwright')));}
const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const srv=spawn('python3',['-I','-m','http.server',String(port),'--bind','127.0.0.1','--directory',here],{stdio:'ignore'});
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{ const pg=await b.newPage({viewport:{width:960,height:540}}); pg.on('pageerror',e=>console.log('ERR',e.message));
 await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0`,{waitUntil:'load'});
 await pg.waitForFunction(()=>window.__play&&window.__play.stats.ticks>30,null,{timeout:120000}); await pg.evaluate(()=>window.__play.packsReady);
 const r=await pg.evaluate(async()=>{ const P=window.__play,W=P.enemyAI,wait=ms=>new Promise(res=>setTimeout(res,ms)); const out=[];
  const go=(x,z,h,yaw,pair)=>{const c=P.ctrl,fr=P.col.findPoly(x,z,-7.5,200);c.pos={x,y:fr?fr[1]:0,z};c.prev={...c.pos};c.heading=c.prevHeading=h;c.C.face={x:Math.sin(h),y:0,z:Math.cos(h)};if(c.body)c.body.poly=fr?fr[0]:null;P.light.stream.reset(pair);P.follow.reset(c.pos,{yaw,pitch:0});};
  P.areas&&0; go(-1599,-191,3.14,3.14,[2,3]); await wait(300); { const p=[-1599,-7,-191]; }
  await wait(1200); out.push(['186',W.triggers[186].active,(W.actors||[]).map(a=>a.rec).join()]);
  go(-1672,-420,3.14,3.14,[2,3]);
  for(let i=0;i<70;i++){ await wait(1000); const T=W.triggers[150]; const A=(W.actors||[]).map(a=>a.rec); out.push([i,T.e0,T.active,A.includes(147),A.includes(149),A.includes(150),W.mshort[66],(W.actors||[]).filter(a=>a.rec===149).map(a=>[a.pos[0]|0,a.pos[2]|0].join())[0],P.ctrl.pos.x|0,P.ctrl.pos.z|0,(P.areas&&P.areas.current!=null)?P.areas.current:'-']);}
  return {out,keys:Object.keys(W).slice(0,8),areas:P.areas?Object.keys(P.areas).slice(0,8):null}; });
 console.log(JSON.stringify(r.out.filter((x,i)=>i%6==0||x[1]!==0))); console.log(r.keys,r.areas);
}catch(e){console.log('EX',String(e).slice(0,300));}finally{await b.close();srv.kill();}
