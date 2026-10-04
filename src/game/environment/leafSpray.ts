// Original procedural leaf spray: small oval leaves attached to a branching twig.
// The facade atlas stores cutout coverage in the otherwise-unused glass mask layer.
export function paintLeafSpray(
  color: CanvasRenderingContext2D,
  mask: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  let seed = 673;
  const rand = () => ((seed = Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (const ctx of [color, mask]) {
    ctx.save();
    ctx.scale(width, height);
    ctx.lineCap = "round";
  }
  const stem = (x: number, y: number, tx: number, ty: number, weight: number) => {
    for (const ctx of [color, mask]) {
      ctx.strokeStyle = ctx === mask ? "#fff" : "#776e53";
      ctx.lineWidth = weight;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
  };
  stem(0.5, 0.96, 0.5, 0.13, 0.011);
  for (let side = -1; side <= 1; side += 2)
    for (let row = 0; row < 5; row++) {
      const rootY = 0.87 - row * 0.15 + (rand() - 0.5) * 0.04;
      const tipX = 0.5 + side * (0.32 + rand() * 0.07 - row * 0.028);
      const tipY = rootY - 0.2;
      stem(0.5, rootY, tipX, tipY, 0.005);
      for (let leaf = 0; leaf < 4; leaf++) {
        const t = 0.3 + leaf * 0.2;
        const x = 0.5 + (tipX - 0.5) * t;
        const y = rootY + (tipY - rootY) * t;
        const flip = leaf % 2 === 0 ? 1 : -1;
        const angle = side * (0.75 + flip * 0.6);
        const length = 0.063 + rand() * 0.025;
        const shade = Math.round(175 + rand() * 70);
        for (const ctx of [color, mask]) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillStyle =
            ctx === mask ? "#fff" : `rgb(${shade},${shade},${Math.round(shade * 0.86)})`;
          ctx.beginPath();
          ctx.ellipse(0, -length * 0.65, length * 0.39, length, 0, 0, Math.PI * 2);
          ctx.fill();
          if (ctx === color) {
            ctx.strokeStyle = "rgba(52,66,28,0.28)";
            ctx.lineWidth = 0.002;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -length * 1.5);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
  for (const ctx of [color, mask]) ctx.restore();
}
