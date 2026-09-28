// One clock and cabin transform for the wheel, its riders and co-op avatars.
import { trafficClock } from '../trafficCore';
export type Wheel = { x:number;z:number;y:number;r:number;rot:number };
export const CABINS=20, WHEEL_TURN=70;
const TAU=Math.PI*2;
export const wheelAngle=(time=trafficClock.t)=>time*TAU/WHEEL_TURN;
export function wheelPoint(w:Wheel,u:number,y:number,n:number) {
 const c=Math.cos(w.rot),s=Math.sin(w.rot);
 return {x:w.x+u*c+n*s,y,z:w.z-u*s+n*c};
}
export function wheelCabin(w:Wheel,i:number,time=trafficClock.t) {
 const angle=wheelAngle(time)+i*TAU/CABINS;
 return wheelPoint(w,Math.cos(angle)*w.r,w.y+Math.sin(angle)*w.r,0);
}
export function wheelEye(w:Wheel,i:number,time=trafficClock.t) {
 const p=wheelCabin(w,i,time);
 return {...p,y:p.y-1.19}; // cabin floor -2.79, standing eye +1.6
}
export const wheelDeck=(w:Wheel)=>w.y-w.r-4.6;
export const wheelLoading=(w:Wheel)=>wheelPoint(w,0,wheelDeck(w)+1.8,2.1);
export const wheelExit=(w:Wheel)=>wheelPoint(w,0,wheelDeck(w)+1.8,3.4);
/** Raised base and its visible 10-tread approach. Null outside this structure. */
export function wheelGround(w:Wheel,x:number,z:number) {
 const dx=x-w.x,dz=z-w.z,c=Math.cos(w.rot),s=Math.sin(w.rot);
 const u=dx*c-dz*s,n=dx*s+dz*c;
 if(Math.abs(u)<=10&&Math.abs(n)<=4.5)return wheelDeck(w)+1.8;
 if(Math.abs(u)<=2&&n>4.5&&n<=9.3)return wheelDeck(w)+1.8*(9.3-n)/4.8;
 return null;
}
export const wheelRide={cabin:-1,boardedAt:0,cooldown:0};
export const wheelWorld={wheel:null as Wheel|null};
export function resetWheel(w:Wheel|null=null) {wheelWorld.wheel=w;wheelRide.cabin=-1;wheelRide.boardedAt=0;wheelRide.cooldown=0;}
export function leaveWheel(pos:{x:number;y:number;z:number},w:Wheel) {
 const p=wheelExit(w);Object.assign(pos,{x:p.x,y:p.y+1.6,z:p.z});
 wheelRide.cabin=-1;wheelRide.cooldown=4;
}
/** Walk to the marked loading line. Assigned cabin lanes prevent simultaneous co-op claims. */
export function stepWheel(pos:{x:number;y:number;z:number},w:Wheel,dt:number,playerNumber=1,coop=false) {
 wheelRide.cooldown=Math.max(0,wheelRide.cooldown-dt);
 const now=trafficClock.t;
 if(wheelRide.cabin<0) {
   const line=wheelLoading(w);
   if(wheelRide.cooldown>0||Math.hypot(pos.x-line.x,pos.z-line.z)>1.25||Math.abs(pos.y-1.6-line.y)>.65)return false;
   for(let i=0;i<CABINS;i++) {
     if(coop&&i%4!==Math.max(0,Math.min(3,playerNumber-1)))continue;
     const p=wheelCabin(w,i,now);
     if(Math.hypot(p.x-w.x,p.z-w.z)<1.1&&p.y<w.y-w.r+.12) {
       wheelRide.cabin=i;wheelRide.boardedAt=now;break;
     }
   }
   if(wheelRide.cabin<0)return false;
 }
 const p=wheelEye(w,wheelRide.cabin,now);
 // Step onto the same platform after a full loop; never drop a rider high above the pier.
 if(now-wheelRide.boardedAt>WHEEL_TURN-1&&p.y<wheelDeck(w)+3.6) {leaveWheel(pos,w);return false;}
 Object.assign(pos,p);return true;
}
/** Exact rail runs; shared by the mesh and the body's thin-prop collision. */
export function wheelRails() {
 return [
  [-10,-4.5,10,-4.5],[-10,-4.5,-10,4.5],[10,-4.5,10,4.5],
  [-10,4.5,-2,4.5],[2,4.5,10,4.5],[-2,4.5,-2,9.3],[2,4.5,2,9.3],
 ] as const;
}
export function wheelRailPosts(w:Wheel) {
 const out:{x:number;z:number;r:number}[]=[];
 for(const [u0,n0,u1,n1] of wheelRails()) {
  const steps=Math.ceil(Math.hypot(u1-u0,n1-n0)/.4);
  for(let i=0;i<=steps;i++) {const p=wheelPoint(w,u0+(u1-u0)*i/steps,0,n0+(n1-n0)*i/steps);out.push({x:p.x,z:p.z,r:.1});}
 }
 return out;
}
