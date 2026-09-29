import { Object3D, Vector3 } from "three";

/** A socket includes the view animation, hand bones, weapon scale and barrel devices. */
export function readGunMuzzle(root: Object3D | null, out: Vector3, weapon?: string) {
  if (!root) return false;
  let socket: Object3D | undefined;
  if (weapon) socket = root.getObjectByName(`gun-muzzle:${weapon}`);
  else
    root.traverse((o) => {
      if (o.name.startsWith("gun-muzzle:")) socket = o;
    });
  if (!socket) return false;
  socket.updateWorldMatrix(true, false);
  out.setFromMatrixPosition(socket.matrixWorld);
  return true;
}

/** Published after remote interpolation and hand animation, before queued fire is drawn. */
export const remoteGunRoots = new Map<string, Object3D>();
