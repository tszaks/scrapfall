import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const base=process.env.BASE??'http://127.0.0.1:4186';
const browser=await chromium.launch({args:process.platform==='darwin'?['--use-angle=metal']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const watchdog=setTimeout(()=>browser.close(),240000);
const ctx=await browser.newContext({viewport:{width:960,height:720}});
await ctx.addInitScript(()=>{
  const PC=window.RTCPeerConnection;window.__pausePCs=[];
  window.RTCPeerConnection=class extends PC {constructor(...args){super(...args);window.__pausePCs.push(this);}};
});
const errors=[],results=[];
const page=async()=>{const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));return p;};
const h=await page();let g=await page();
const wait=(p,fn,arg)=>p.waitForFunction(fn,arg,{timeout:45000});
const state=p=>p.evaluate(()=>({
  paused:__rs.simulationPause.paused,roomPaused:__rs.net.current?.paused,
  hp:__rs.healthRef.current,down:__rs.downedRef.current,
  wave:__rs.wave.current,timer:__rs.nextWaveTimer.current,
  pose:__rs.camera.position.toArray(),
  enemies:__rs.enemies.filter(e=>e.alive).map(e=>[e.x,e.z,e.hp,e.cooldown]),
  bullets:__rs.bullets.current.filter(b=>b.active).map(b=>[...b.pos.toArray(),b.life]),
  enemyBullets:__rs.enemyBullets.current.filter(b=>b.active).map(b=>[...b.pos.toArray(),b.life]),
  cars:window.__rsCars?.map(c=>[c.x,c.z,c.speed]),
  bleed:[...__rs.squad.entries()].map(([id,s])=>[id,s.st,s.bleed,s.prog]),
  reload:__rs.playtest.supply.remaining,
  invuln:__rs.invuln.current,
  peers:__rs.net.current?.peers().length,
}));
const pass=(name,data)=>{results.push({name,...data});console.log('PASS',name);};
try {
  for(const p of [h,g])await p.goto(`${base}/game/?map=vice&seed=11&debug=1&quality=low`);
  await h.getByRole('button',{name:'HOST A ROOM'}).click({timeout:60000});
  const code=(await h.getByRole('button',{name:/TAP TO COPY/}).innerText({timeout:45000})).trim().slice(0,4);
  await g.getByRole('textbox',{name:'Room code'}).fill(code);
  await g.getByRole('button',{name:/^JOIN$/}).click();
  await g.getByRole('button',{name:/READY UP/}).click({timeout:45000});
  await h.getByRole('button',{name:/^Start$/}).click();
  await h.getByRole('button',{name:/ENTER ARENA/i}).click({timeout:60000});
  for(const p of [h,g])await wait(p,()=>window.__rs?.wave.current>=1);
  for(const p of [h,g])await p.evaluate(()=>{__rs.invuln.current=1e6;});
  await wait(h,()=>__rs.enemies.some(e=>e.alive));
  await g.keyboard.press('Escape');
  await g.getByRole('heading',{name:'GAME MENU'}).waitFor();
  const localBefore=await state(h);await h.waitForTimeout(600);
  assert.equal((await state(h)).paused,false);
  assert.notDeepEqual((await state(h)).enemies,localBefore.enemies,'guest menu does not stop host world');
  await g.getByRole('button',{name:/^Resume$/}).click();
  pass('guest menu remains local');
  // Native transport rejects spoofed authority, even with a forged from field.
  await g.evaluate(()=>{for(const type of ['pause','resume','pause-state','begin'])__rs.net.current.broadcast({type,from:'host',paused:true});});
  await h.waitForTimeout(300);assert.equal((await state(h)).paused,false);
  pass('forged guest authority rejected');
  // Test bleed-out, reload, cooldowns and real shots in the same pause.
  await g.evaluate(()=>{__rs.invuln.current=0;for(let i=0;i<25;i++)__rs.takeHit(100,'pause test');__rs.invuln.current=1e6;});
  await wait(g,()=>__rs.downedRef.current);
  await wait(h,()=>[...__rs.squad.values()].some(s=>s.st===1));
  await h.evaluate(()=>{__rs.trigger.current=true;});
  await wait(h,()=>__rs.bullets.current.some(b=>b.active));
  await h.evaluate(()=>{__rs.invuln.current=0;__rs.takeHit(5,'regen freeze');__rs.invuln.current=1e6;__rs.stats.current.regen=14;});
  await h.keyboard.press('Escape');
  for(const p of [h,g])await p.getByRole('heading',{name:'PAUSED BY HOST'}).waitFor();
  await h.evaluate(()=>{__rs.playtest.supply.reloading='pistol';__rs.playtest.supply.remaining=.8;});
  await h.waitForTimeout(200);
  const frozen=await Promise.all([state(h),state(g)]);
  assert.ok(frozen[0].bullets.length,'active player projectile exists');
  await g.keyboard.down('KeyW');await g.keyboard.down('Enter');
  await g.evaluate(()=>{__rs.net.current.broadcast({type:'hit',i:0,dmg:99999});__rs.net.current.broadcast({type:'vehicle-use',exit:1});});
  await h.evaluate(()=>__rs.takeHit(100,'paused damage must be rejected'));
  await h.waitForTimeout(8500);
  const held=await Promise.all([state(h),state(g)]);
  assert.deepEqual(held,frozen,'world, inputs, traffic, health, bleed-out and gameplay clocks freeze');
  assert.equal(await g.getByRole('button',{name:'Resume room'}).isDisabled(),true);
  await g.screenshot({path:'/tmp/scrapfall-paused-guest.png'});
  pass('shared pause freezes gameplay for longer than heartbeat timeout',{host:frozen[0],guest:frozen[1]});
  // A real RTC data-channel closure exercises recovery while remaining in this run.
  const guestHp=frozen[1].hp,guestPose=frozen[1].pose;
  await g.evaluate(()=>window.__pausePCs.forEach(pc=>pc.close()));
  await wait(g,()=>__rs.net.current?.role==='guest' && __rs.net.current.paused && __rs.simulationPause.paused && window.__pausePCs.some(pc=>pc.connectionState==='connected'));
  await g.waitForTimeout(500);
  assert.equal((await state(g)).hp,guestHp,'same-wave reconnect cannot heal');
  assert.deepEqual((await state(g)).pose,guestPose,'same-wave reconnect cannot reposition');
  pass('paused RTC reconnect preserves downed state');
  await g.keyboard.up('KeyW');await g.keyboard.up('Enter');
  await h.getByRole('button',{name:'Resume room'}).click();
  for(const p of [h,g])await wait(p,()=>!__rs.simulationPause.paused);
  await h.waitForTimeout(250);
  const resumed=await state(h);
  assert.ok(resumed.reload>0,'reload did not consume paused time');
  assert.ok(resumed.bleed.find(s=>s[1]===1)[2]>frozen[0].bleed.find(s=>s[1]===1)[2]-2,'bleed-out did not catch up');
  pass('synchronized resume has no timer catch-up');
  await wait(h,()=>__rs.healthRef.current>=__rs.stats.current.maxHp);
  pass('HP regeneration resumes after frozen gameplay time');
  // Repeated pause/resume and focus-driven local menus must not accidentally heal.
  for(let i=0;i<2;i++){
    await h.keyboard.press('Escape');await wait(g,()=>__rs.simulationPause.paused);
    assert.equal((await state(g)).hp,0);
    await h.getByRole('button',{name:'Resume room'}).click();await wait(g,()=>!__rs.simulationPause.paused);
  }
  pass('repeated pause does not revive');
  await h.evaluate(async()=>{if(document.pointerLockElement)await document.exitPointerLock();});
  await h.waitForTimeout(200);assert.equal((await state(h)).paused,false);
  pass('pointer-lock loss does not pause room');
  await h.keyboard.press('Escape');await wait(g,()=>__rs.simulationPause.paused);
  // Keep the bounded browser window at two pages: replace the guest with a fresh join.
  await g.close();g=await page();
  await g.goto(`${base}/game/?map=vice&debug=1&quality=low`);
  await g.getByRole('textbox',{name:'Room code'}).fill(code);
  await g.getByRole('button',{name:/^JOIN$/}).click();
  await wait(g,()=>window.__rs?.wave.current>=1 && __rs.simulationPause.paused);
  await g.getByRole('heading',{name:'PAUSED BY HOST'}).waitFor();
  assert.equal((await state(g)).wave,(await state(h)).wave);
  await wait(g,()=>Array.isArray(window.__rsCars));
  await g.waitForTimeout(500);
  const joinState=await state(g);await g.waitForTimeout(700);
  assert.deepEqual(await state(g),joinState);
  pass('fresh join receives frozen world');
  await h.close();
  await wait(g,()=>__rs.net.current.role==='host');
  assert.equal((await state(g)).paused,true);
  await g.getByRole('button',{name:'Resume room'}).click();
  await wait(g,()=>!__rs.simulationPause.paused);
  pass('host migration preserves pause and successor can resume');
  assert.deepEqual(errors,[]);
} catch(e) {
  console.error(e);
  for(const p of [h,g])if(!p.isClosed())console.error((await p.locator('body').innerText()).slice(-1500));
  process.exitCode=1;
} finally {
  clearTimeout(watchdog);
  writeFileSync(process.env.OUT??'/tmp/scrapfall-pause-result.json',JSON.stringify({results,errors},null,2));
  await browser.close();
  console.log('BROWSERS CLOSED');
}
