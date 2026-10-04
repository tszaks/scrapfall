// Scripted input route. Diagnostic evidence, not physical controller/Safari real play.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base=process.env.BASE??'http://127.0.0.1:5307', tag=process.env.TAG??'candidate';
const seconds=Number(process.env.SECONDS??15), rate=Number(process.env.CPU_THROTTLE??1);
const modes=(process.env.MODES??'foot,drive').split(',');
const out=process.env.OUT??'output/driving-performance'; await mkdir(out,{recursive:true});
const report={routeVersion:2,tag,base,commit:process.env.COMMIT??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 started:new Date().toISOString(),seconds,cpuThrottle:rate,viewport:[1512,982],dpr:1,quality:'high',
 method:'Headless Chromium Metal, uncapped, scripted W on same Vice seed11 street start, 15s after a 3s stationary warmup. Driving accelerates normally, so route distance differs from on foot. Not Safari, physical controller or real-player FPS. GPU timer covers sampled main-scene passes; RAF callback duration is elapsed wall time, including scheduling interruptions and waits, not CPU consumption. Concurrent desktop activity recorded.',
 hardware:execFileSync('sysctl',['-n','machdep.cpu.brand_string'],{encoding:'utf8'}).trim(),
 backgroundStart:execFileSync('ps',['-axww','-o','pcpu=,comm='],{encoding:'utf8'}), cases:[]};
console.log(JSON.stringify({tag,phase:'launch'}));
const browser=await chromium.launch({args:['--use-angle=metal','--ignore-gpu-blocklist','--disable-gpu-vsync','--disable-frame-rate-limit']});report.browser=browser.version();
const save=()=>writeFile(`${out}/${tag}.json`,JSON.stringify(report,null,2));
try{for(const mode of modes){
 const page=await browser.newPage({viewport:{width:1512,height:982},deviceScaleFactor:1});
 const row={mode,errors:[]};report.cases.push(row);await save();console.log(JSON.stringify({tag,mode,phase:'navigate'}));page.on('pageerror',e=>row.errors.push(e.message));
 await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window);window.__measure={active:false,cpu:[],frameCpu:0,long:[]};
 window.requestAnimationFrame=cb=>raf(t=>{const s=performance.now();try{return cb(t);}finally{if(__measure.active){const cost=performance.now()-s;__measure.cpu.push(cost);__measure.frameCpu+=cost;}}});
 new PerformanceObserver(l=>{if(__measure.active)__measure.long.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})));}).observe({type:'longtask'});});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate});
 const response=await page.goto(`${base}/game/?map=vice&seed=11&debug=1&tour=1&quality=high&weather=sunny`,{waitUntil:'domcontentloaded',timeout:30000});
 row.htmlSha256=createHash('sha256').update(await response.body()).digest('hex');row.pageUrl=page.url();
 await page.getByRole('button',{name:/^start$/i}).click({timeout:120000});await page.getByRole('button',{name:/enter arena/i}).click({timeout:120000});
 await page.waitForFunction(()=>window.__rs?.playtest?.driveCars.size);
 console.log(JSON.stringify({tag,mode,phase:'fixture'}));
 row.fixture=await page.evaluate(mode=>{const r=__rs,t=r.playtest,c=[...t.driveCars.values()][0];
 Object.assign(c,{claimed:true,x:-19.44,z:-6,yaw:-Math.PI/2,speed:0});__rsCars[0].driven=true;
 if(mode==='foot'){c.z=6;r.playtest.warp(c.x,r.groundAt(c.x,-6),-6);}else r.playtest.warp(c.x,r.groundAt(c.x,c.z),c.z-c.width-1);r.look.current.yaw=Math.PI/2;r.look.current.pitch=0;
 if(mode==='drive')t.claimVehicle(c.id,t.driving.self,r.camera.position.x,r.camera.position.z);
 r.invuln.current=1e6;
 r.trigger.current=false;
 const gl=r.gl.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
 return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),framebuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],pixelRatio:r.gl.getPixelRatio(),quality:window.__rsQuality,vehicle:t.myVehicle()?.id??null,scene:r.city?{half:r.city.half,spawn:r.city.spawn}:null};},mode);
 assert.match(row.fixture.renderer,/Metal/);assert.equal(!!row.fixture.vehicle,mode==='drive');
 await page.waitForTimeout(3000);
 if(process.env.PROFILE==='1'){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
 console.log(JSON.stringify({tag,mode,phase:'measure'}));
 row.measurementStarted=new Date().toISOString();
 row.metrics=await page.evaluate(async({seconds,mode})=>{
 const r=__rs,m=__measure,gl=r.gl,ctx=gl.getContext(),ext=ctx.getExtension('EXT_disjoint_timer_query_webgl2');
 const original=gl.render,auto=gl.info.autoReset;gl.info.autoReset=false;gl.info.reset();
 const pending=[],gpu=[],frames=[],submit=[],calls=[],triangles=[],poses=[],shaders=[],cpu=[],logicalSteps=[],viewSteps=[];
 let lastLogical=r.camera.position.clone(),lastView=null,viewPosition=null;
 let renderMs=0,last=0,frame=0,renderCount=0,programs=gl.info.programs.length;const initialPrograms=programs,resources=performance.getEntriesByType('resource').length;
 let cameraFov=null;const startPose=r.camera.position.toArray();
 gl.render=function(scene,cam){let query=null;if(scene===r.scene){cameraFov=cam.fov;viewPosition=cam.position.clone();if(ext&&renderCount++%30===0&&pending.length<8){query=ctx.createQuery();ctx.beginQuery(ext.TIME_ELAPSED_EXT,query);}}
 const t=performance.now();try{return original.call(this,scene,cam)}finally{renderMs+=performance.now()-t;if(query){ctx.endQuery(ext.TIME_ELAPSED_EXT);pending.push(query);}}};
 const started=performance.now();r.keys.current.add('KeyW');m.active=true;
 await new Promise(resolve=>{function step(now){if(last){frames.push(now-last);cpu.push(m.frameCpu);m.frameCpu=0;submit.push(renderMs);logicalSteps.push(r.camera.position.distanceTo(lastLogical));lastLogical.copy(r.camera.position);if(viewPosition){if(lastView)viewSteps.push(viewPosition.distanceTo(lastView));lastView=viewPosition;}calls.push(gl.info.render.calls);triangles.push(gl.info.render.triangles);}last=now;renderMs=0;gl.info.reset();
 if(ext){if(ctx.getParameter(ext.GPU_DISJOINT_EXT)){pending.splice(0).forEach(q=>ctx.deleteQuery(q));}else while(pending.length&&ctx.getQueryParameter(pending[0],ctx.QUERY_RESULT_AVAILABLE)){const q=pending.shift();gpu.push(ctx.getQueryParameter(q,ctx.QUERY_RESULT)/1e6);ctx.deleteQuery(q);}}
 if(programs!==gl.info.programs.length){shaders.push({ms:now-started,from:programs,to:gl.info.programs.length});programs=gl.info.programs.length;}
 if(frame++%30===0)poses.push({ms:now-started,eye:r.camera.position.toArray(),vehicle:r.playtest.myVehicle()?.speed??null});
 if(now-started<seconds*1000)requestAnimationFrame(step);else resolve();}requestAnimationFrame(step);});
 m.active=false;r.keys.current.delete('KeyW');gl.render=original;gl.info.autoReset=auto;gl.info.reset();pending.forEach(q=>ctx.deleteQuery(q));
 const pct=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]:null;
 const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
 // Sum elapsed RAF callback durations, including diagnostics, scheduling interruptions and waits; this is not CPU consumption.
 return {durationMs:performance.now()-started,frames:frames.length,p50:pct(frames,.5),p95:pct(frames,.95),p99:pct(frames,.99),over25:frames.filter(v=>v>25).length,over50:frames.filter(v=>v>50).length,
 cpuRafFrameP95:pct(cpu,.95),cpuRafFrameMean:mean(cpu),cpuOutsideRenderMean:mean(cpu)-mean(submit),logicalStepZeroFraction:logicalSteps.filter(x=>x<0.00001).length/logicalSteps.length,viewStepZeroFraction:viewSteps.filter(x=>x<0.00001).length/viewSteps.length,renderSubmitMean:mean(submit),renderSubmitP95:pct(submit,.95),gpuPassP95:pct(gpu,.95),gpuSamples:gpu.length,
 callsMean:mean(calls),trianglesMean:mean(triangles),cameraFov,initialPrograms,shaderEvents:shaders,newResources:performance.getEntriesByType('resource').slice(resources).map(r=>({name:r.name,duration:r.duration})),
 longTasks:m.long,poses,startPose,endPose:r.camera.position.toArray(),vehicle:r.playtest.myVehicle()?.id??null};
 },{seconds,mode});
 row.measurementEnded=new Date().toISOString();
 if(process.env.PROFILE==='1'){const p=await cdp.send('Profiler.stop');await writeFile(`${out}/${tag}-${mode}.cpuprofile`,JSON.stringify(p.profile));}
 assert.deepEqual(row.errors,[]);assert.equal(!!row.metrics.vehicle,mode==='drive');
 const a=row.metrics.startPose,b=row.metrics.endPose;row.distance=Math.hypot(a[0]-b[0],a[2]-b[2]);assert.ok(row.distance>4,`route did not move: ${row.distance}`);
 row.movingPoseFraction=row.metrics.poses.filter(p=>p.vehicle===null||Math.abs(p.vehicle)>0.2).length/row.metrics.poses.length;
 row.sustainedMotion=mode==='foot'?row.distance>20:row.movingPoseFraction>0.8;
 row.assets=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')).map(r=>({url:r.name,size:r.encodedBodySize})));
 await page.close();await save();
 if(!row.sustainedMotion)throw Error('Route did not sustain movement; not valid as moving-route evidence');
 }}catch(e){report.failure=e.stack;process.exitCode=1;}finally{report.backgroundEnd=execFileSync('ps',['-axww','-o','pcpu=,comm='],{encoding:'utf8'});await save();await browser.close();}
console.log(JSON.stringify({tag,cases:report.cases.map(r=>({mode:r.mode,distance:r.distance,p95:r.metrics?.p95,p99:r.metrics?.p99})),failure:report.failure}));
