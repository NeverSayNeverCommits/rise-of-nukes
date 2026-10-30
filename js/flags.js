// National flags drawn in code. (Flag emojis do not show up on Windows, so we draw our own.)
const TAU = Math.PI * 2;

function star(ctx, x, y, r, points = 5, inner = 0.4, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points, rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

function sun(ctx, x, y, r, rays, rayLen, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * TAU - Math.PI / 2, w = Math.PI / rays * 0.55;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a - w) * r, y + Math.sin(a - w) * r);
    ctx.lineTo(x + Math.cos(a) * rayLen, y + Math.sin(a) * rayLen);
    ctx.lineTo(x + Math.cos(a + w) * r, y + Math.sin(a + w) * r);
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

// Draw a flag into the rectangle (x, y, w, h).
export function drawFlag(ctx, nation, x, y, w, h) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  switch (nation) {
    case 'germany':
      ['#000000', '#dd0000', '#ffce00'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(x, y + (h * i) / 3, w, h / 3 + 1); });
      break;
    case 'taiwan': {
      ctx.fillStyle = '#fe0000'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#000095'; ctx.fillRect(x, y, w / 2, h / 2);
      const cx = x + w / 4, cy = y + h / 4, r = h * 0.075;
      sun(ctx, cx, cy, r * 1.25, 12, r * 2.4, '#ffffff');
      ctx.fillStyle = '#000095'; ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      break;
    }
    case 'philippines': {
      ctx.fillStyle = '#0038a8'; ctx.fillRect(x, y, w, h / 2);
      ctx.fillStyle = '#ce1126'; ctx.fillRect(x, y + h / 2, w, h / 2);
      const tw = h * 0.866;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + tw, y + h / 2); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fcd116';
      sun(ctx, x + tw * 0.34, y + h / 2, h * 0.07, 8, h * 0.16, '#fcd116');
      for (const [sx, sy] of [[0.09, 0.12], [0.09, 0.88], [0.78, 0.5]]) star(ctx, x + tw * sx, y + h * sy, h * 0.045);
      break;
    }
    case 'pakistan': {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#01411c'; ctx.fillRect(x + w * 0.25, y, w * 0.75, h);
      const cx = x + w * 0.625, cy = y + h * 0.5;
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx, cy, h * 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#01411c'; ctx.beginPath(); ctx.arc(cx + h * 0.08, cy - h * 0.07, h * 0.27, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; star(ctx, cx + h * 0.15, cy - h * 0.13, h * 0.09, 5, 0.42, -0.3);
      break;
    }
    default: { // random: a question mark
      ctx.fillStyle = '#444'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(h * 0.8)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', x + w / 2, y + h * 0.55);
    }
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

// A cached canvas with the flag, for drawing on the map.
const cache = new Map();
export function flagCanvas(nation, w = 36, h = 24) {
  const k = `${nation}|${w}|${h}`;
  if (!cache.has(k)) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    drawFlag(c.getContext('2d'), nation, 0, 0, w, h);
    cache.set(k, c);
  }
  return cache.get(k);
}

// An <img> tag with the flag, for HTML.
export function flagImg(nation, h = 14) {
  const url = flagCanvas(nation, 48, 32).toDataURL();
  return `<img class="flag" src="${url}" style="height:${h}px" alt="${nation}">`;
}
