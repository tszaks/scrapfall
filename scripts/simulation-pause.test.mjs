import test from 'node:test';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
globalThis.__pauseFrames=[];
const bundle=await rolldown({input:'pause-test',platform:'node',plugins:[{
  name:'frame-boundary',
  resolveId(id){if(['pause-test','react','@react-three/fiber'].includes(id))return '\0'+id;},
  load(id){
    if(id==='\0pause-test')return `export * from ${JSON.stringify(process.cwd()+'/src/game/simulationPause.ts')}; export * from ${JSON.stringify(process.cwd()+'/src/game/useSimulationFrame.ts')}; export * from ${JSON.stringify(process.cwd()+'/src/game/skierTargets.ts')};`;
    if(id==='\0react')return 'export const useRef=current=>({current});';
    if(id==='\0@react-three/fiber')return 'export const useFrame=callback=>globalThis.__pauseFrames.push(callback);';
  }
}]});
const {output}=await bundle.generate({format:'esm'});await bundle.close();
const {simulationNow,setSimulationPaused,simulationPause,useSimulationFrame,skierTargets,downSkier,encodeSkiers}=await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
test('gameplay clock preserves partial timers through repeated pause and resume',()=>{
  assert.equal(simulationNow(500),500);
  setSimulationPaused(true,1000);
  assert.equal(simulationNow(50000),1000);
  const revision=simulationPause.revision;
  setSimulationPaused(true,60000);
  assert.equal(simulationPause.revision,revision,'duplicate messages do not restart the pause');
  setSimulationPaused(false,61000);
  assert.equal(simulationNow(61000),1000);
  assert.equal(simulationNow(61500),1500);
  setSimulationPaused(true,62000);setSimulationPaused(false,92000);
  assert.equal(simulationNow(93000),3000);
});

test('all gameplay callbacks hold independently and discard the first resumed delta',()=>{
  const steps=[[],[]];
  for(let i=0;i<2;i++)useSimulationFrame((_,dt)=>steps[i].push(dt));
  const frames=globalThis.__pauseFrames;
  frames.forEach(fn=>fn({},.016));
  setSimulationPaused(true,100000);
  frames.forEach(fn=>fn({},30));
  setSimulationPaused(false,130000);
  frames.forEach(fn=>fn({},30));
  frames.forEach(fn=>fn({},.016));
  assert.deepEqual(steps,[[.016,0,.016],[.016,0,.016]]);
});
test('downed skier recovery remains frozen for an arbitrarily long pause',()=>{
  skierTargets.push({x:0,y:0,z:0,active:true,downUntil:0});
  downSkier(0);
  setSimulationPaused(true);
  const remaining=encodeSkiers()[0];
  assert.ok(remaining>19900);
  // The real clock can advance; the encoded gameplay deadline stays fixed.
  assert.equal(simulationNow(performance.now()+60000),simulationNow());
  assert.equal(encodeSkiers()[0],remaining);
  setSimulationPaused(false);
});
