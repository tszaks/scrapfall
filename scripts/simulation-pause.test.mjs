import test from 'node:test';
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
const bundle=await rolldown({input:'src/game/simulationPause.ts',platform:'node'});
const {output}=await bundle.generate({format:'esm'});await bundle.close();
const {simulationNow,setSimulationPaused,simulationPause}=await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
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
