// Real generated towers, full body collision, repeated ascent/descent and both exit portals.
import assert from 'node:assert/strict';
import { generateAlpine } from '../src/game/alpine/layout';
import { alpineAccess } from '../src/game/access/alpineAccess';
import { installAccess, player, playerBlocked, stepPlayer, stepDoors } from '../src/game/access/world';
import { toWorld } from '../src/game/access/layout';
import { spiralPoint, TAU } from '../src/game/access/spiral';
import { setArenaSize } from '../src/game/level';
const reports: unknown[]=[];
for(const solo of [true,false]) for(const seed of [1000,8919,20260928]) {
  installAccess(null);setArenaSize(800,2);
  const city=generateAlpine(seed,solo).layout,list=alpineAccess(city,solo);
  const b=list.find(b=>b.spec.name==='church-tower');
  assert(b?.stair?.spiral,`missing church spiral ${seed}/${solo}`);
  const s=b.stair,sp=s.spiral;installAccess(list);
  Object.assign(player,{zone:1,b:b.id,lap:0,region:0,y:b.groundY});
  const pos={x:b.ox,z:b.oz};let prev=b.groundY,maxJump=0;
  const walk=(a:number,d:number)=>{
    const [x,z]=toWorld(b,a,d);stepDoors(1,[{x,y:player.y,z}]);
    assert.equal(playerBlocked(x,z,.4),false,`blocked lap${player.lap} region${player.region} at ${a},${d}`);
    const vx=x-pos.x,vz=z-pos.z;Object.assign(pos,{x,z});
    const y=stepPlayer(pos,vx,vz,()=>false);maxJump=Math.max(maxJump,Math.abs(y-prev));prev=y;
  };
  const radius=1.15;
  for(let n=0;n<s.laps;n++) for(let j=0;j<=400;j++) {
    const [a,d]=spiralPoint(sp,TAU*j/400,radius);walk(a,d);
  }
  assert.equal(player.lap,s.laps);assert(Math.abs(player.y-b.top)<.001);
  assert(maxJump<.12,`floor jump ${maxJump}`);
  const [cx,cz]=toWorld(b,0,sp.centerD);
  assert.equal(playerBlocked(cx,cz,.4),true,'core must block');
  for(let n=0;n<s.laps;n++) for(let j=400;j>=0;j--) {
    const [a,d]=spiralPoint(sp,TAU*j/400,radius);walk(a,d);
  }
  assert.equal(player.lap,0);assert(Math.abs(player.y-b.groundY)<.001);
  reports.push({seed,solo,laps:s.laps,rise:b.top-b.groundY,maxJump});
}
console.log(JSON.stringify(reports,null,2));
