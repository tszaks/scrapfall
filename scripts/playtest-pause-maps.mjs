import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser=await chromium.launch({args:process.platform==='darwin'?['--use-angle=metal']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const watchdog=setTimeout(()=>browser.close(),240000),results=[],errors=[];
try {
  for(const map of ['vice','gulch','pier','whiteout']){
    const p=await browser.newPage({viewport:{width:960,height:720}});
    p.on('pageerror',e=>errors.push(e.message));
    await p.goto(`${process.env.BASE??'http://127.0.0.1:4186'}/game/?map=${map}&seed=7&debug=1&quality=low`);
    await p.getByRole('button',{name:/^Start$/}).click({timeout:60000});
    await p.getByRole('button',{name:/ENTER ARENA/i}).click({timeout:45000});
    await p.waitForFunction(()=>window.__rs?.wave.current>=1,null,{timeout:45000});
    await p.evaluate(()=>{__rs.invuln.current=1e6;});
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape');
    await p.getByRole('heading',{name:'PAUSED',exact:true}).waitFor();
    const snapshot=()=>p.evaluate(()=>({
      pose:__rs.camera.position.toArray(),wave:__rs.wave.current,timer:__rs.nextWaveTimer.current,
      cars:__rs.liveCars.map(c=>[c.x,c.z,c.sin,c.cos]),
      alpine:__rs.playtest.alpine.t,
      enemies:__rs.enemies.filter(e=>e.alive).map(e=>[e.x,e.z,e.hp]),
      invuln:__rs.invuln.current,
    }));
    const before=await snapshot();await p.waitForTimeout(1500);
    assert.deepEqual(await snapshot(),before,`${map} solo pause freezes physical drivers and clocks`);
    await p.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await p.evaluate(()=>__rs.simulationPause.paused),true);
    const close=p.getByRole('button',{name:/^(Back|Close|Done)$/i});
    if(await close.count())await close.first().click();
    else await p.keyboard.press('Escape');
    await p.getByRole('button',{name:'Resume',exact:true}).click();
    await p.waitForFunction(()=>!__rs.simulationPause.paused);
    await p.waitForTimeout(100);
    assert.ok((await snapshot()).invuln>before.invuln-1,'resume does not catch up paused time');
    results.push({map,traffic:before.cars.length,passed:true});console.log('PASS',map,'solo pause/settings/resume');
    await p.close();
  }
  assert.deepEqual(errors,[]);
} finally {
  clearTimeout(watchdog);writeFileSync(process.env.OUT??'/tmp/scrapfall-pause-maps.json',JSON.stringify({results,errors},null,2));
  await browser.close();console.log('BROWSERS CLOSED');
}
