// Property cards in the "World Property Cards" style: drawn on a canvas for the board tiles and as
// HTML for the card dialog. Design units are the card's 280 x 420 px.
import { INK, landmarkUrl, mix, CORNER_PADS } from '/shared/cards.js';
import { CHARACTER_META } from './character-meta.js';

export const CARD_W = 280;
export const CARD_H = 420;
const FONT = '"Lilita One", "Arial Rounded MT Bold", system-ui, sans-serif';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Once a property is bought, the art panel shows the owner's character instead of the landmark
// (the landmark itself stands beside the tile on the board).
const ownerCharacter = (card) => (card.owner?.token && CHARACTER_META[card.owner.token] ? card.owner.token : null);
const characterUrl = (id) => `/characters/${id}/confident.svg`;

// ---------- Art images (shared by canvas and HTML) ----------
const images = new Map();
function artImage(url, onload) {
  let rec = images.get(url);
  if (!rec) {
    const img = new Image();
    rec = { img, ready: false, waiting: [] };
    img.onload = () => { rec.ready = true; for (const f of rec.waiting) f(); rec.waiting = []; };
    img.src = url;
    images.set(url, rec);
  }
  if (!rec.ready && onload) rec.waiting.push(onload);
  return rec;
}

// ---------- Canvas card (board tiles) ----------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function strokedText(ctx, text, x, y, size, { stroke = 4, fill = '#ffffff', align = 'center', shadow = 0, maxW = Infinity } = {}) {
  let fs = size;
  ctx.font = `400 ${fs}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && fs > 9) { fs -= 1; ctx.font = `400 ${fs}px ${FONT}`; }
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (shadow) { ctx.lineWidth = stroke; ctx.strokeStyle = INK; ctx.strokeText(text, x, y + shadow); ctx.fillStyle = INK; ctx.fillText(text, x, y + shadow); }
  if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = INK; ctx.strokeText(text, x, y); }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * Draw a card face. `card` comes from cardModel(). Calls `onUpdate` again once the landmark art loads.
 * Returns the canvas (size CARD_W*scale x CARD_H*scale).
 */
export function drawCard(card, { scale = 1, canvas = document.createElement('canvas'), onUpdate } = {}) {
  canvas.width = Math.round(CARD_W * scale);
  canvas.height = Math.round(CARD_H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  const B = 6; // outer border

  // Card body
  roundRect(ctx, B / 2, B / 2, CARD_W - B, CARD_H - B, 26);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.save();
  roundRect(ctx, B, B, CARD_W - 2 * B, CARD_H - 2 * B, 22);
  ctx.clip();
  const x0 = B, w = CARD_W - 2 * B;

  // Header band
  let y = B;
  ctx.fillStyle = card.color;
  ctx.fillRect(x0, y, w, 56);
  if (card.kind === 'utility') {
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y, w, 56); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 8;
    for (let k = -80; k < w + 80; k += 18) { ctx.beginPath(); ctx.moveTo(x0 + k, y + 56); ctx.lineTo(x0 + k + 56, y); ctx.stroke(); }
    ctx.restore();
  }
  // Badge
  ctx.beginPath(); ctx.arc(x0 + 10 + 17, y + 28, 15, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
  if (card.kind === 'utility') {
    ctx.save(); ctx.translate(x0 + 18, y + 19); ctx.scale(0.9, 0.9);
    const bolt = new Path2D('M11,1 L3,11 L9,11 L8,19 L17,8 L11,8 Z');
    ctx.fillStyle = '#FFD43B'; ctx.fill(bolt); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(bolt);
    ctx.restore();
  } else {
    ctx.fillStyle = INK; ctx.font = `400 16px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(card.badge, x0 + 27, y + 29);
  }
  // Position pill
  const pill = `${card.idx}/${card.total}`;
  ctx.font = `400 15px ${FONT}`;
  const pw = ctx.measureText(pill).width + 16;
  roundRect(ctx, x0 + w - 10 - pw, y + 16, pw, 24, 10); ctx.fillStyle = INK; ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText(pill, x0 + w - 10 - pw / 2, y + 29);
  strokedText(ctx, card.setName.toUpperCase(), x0 + 52, y + 29, 15, { stroke: 4, align: 'left', maxW: w - 52 - pw - 18 });
  y += 56;
  ctx.fillStyle = INK; ctx.fillRect(x0, y, w, 5); y += 5;

  // Art panel with sunburst
  const artH = 221;
  ctx.fillStyle = card.artBg; ctx.fillRect(x0, y, w, artH);
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y, w, artH); ctx.clip();
  const cx = x0 + w / 2, cy = y + artH * 0.62;
  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  for (let a = 0; a < 360; a += 20) {
    const r1 = (a * Math.PI) / 180, r2 = ((a + 10) * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(r1) * 400, cy - Math.cos(r1) * 400); ctx.lineTo(cx + Math.sin(r2) * 400, cy - Math.cos(r2) * 400); ctx.closePath(); ctx.fill();
  }
  const who = ownerCharacter(card);
  if (who) {
    // Character standing on a shadow in the art panel, fitted below the "Owned" tag.
    const meta = CHARACTER_META[who];
    const k = Math.min((w - 40) / meta.width, (artH - 50) / meta.height);
    const cw = meta.width * k, ch = meta.height * k;
    const footY = y + artH - 14;
    ctx.beginPath(); ctx.ellipse(cx, footY, cw * 0.36, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(26,15,20,0.22)'; ctx.fill();
    const rec = artImage(characterUrl(who), onUpdate);
    if (rec.ready) ctx.drawImage(rec.img, cx - cw / 2, footY - meta.footY * k, cw, ch);
  } else {
    const rec = artImage(landmarkUrl(card.lm), onUpdate);
    if (rec.ready) ctx.drawImage(rec.img, x0 + 7, y, 254, 254 * (232 / 260));
  }
  ctx.restore();
  if (card.owner) {
    const label = `OWNED · ${card.owner.name}`.toUpperCase();
    ctx.font = `400 14px ${FONT}`;
    const ow = Math.min(ctx.measureText(label).width + 20, w - 20);
    roundRect(ctx, x0 + w - 10 - ow, y + 10, ow, 26, 10);
    ctx.fillStyle = INK; ctx.save(); ctx.translate(0, 3); ctx.fill(); ctx.restore();
    roundRect(ctx, x0 + w - 10 - ow, y + 10, ow, 26, 10);
    ctx.fillStyle = card.owner.color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    strokedText(ctx, label, x0 + w - 10 - ow / 2, y + 23, 14, { stroke: 3, maxW: ow - 12 });
  }
  y += artH;

  // Name band
  ctx.fillStyle = INK; ctx.fillRect(x0, y, w, 5); y += 5;
  ctx.fillStyle = card.shade; ctx.fillRect(x0, y, w, 53);
  strokedText(ctx, card.city, x0 + w / 2, y + 27, card.nameSize, { stroke: 6, shadow: 3, maxW: w - 20 });
  y += 53;

  // Footer: price pill and set pips
  ctx.fillStyle = INK; ctx.fillRect(x0, y, w, 4); y += 4;
  const fy = y + (CARD_H - B - y) / 2;
  ctx.font = `400 22px ${FONT}`;
  const tw = ctx.measureText(card.price).width;
  const pillW = 3 + 26 + 6 + tw + 12 + 8, pillH = 38, px = x0 + 12, py = fy - pillH / 2 - 2;
  roundRect(ctx, px, py + 4, pillW, pillH, 19); ctx.fillStyle = INK; ctx.fill();
  roundRect(ctx, px, py, pillW, pillH, 19); ctx.fillStyle = '#FFD43B'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
  const coinX = px + 4 + 15, coinY = py + pillH / 2;
  ctx.beginPath(); ctx.arc(coinX, coinY, 11, 0, Math.PI * 2); ctx.fillStyle = '#FFC629'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  ctx.beginPath(); ctx.arc(coinX, coinY, 6, 0, Math.PI * 2); ctx.lineWidth = 2.5; ctx.strokeStyle = '#D6931A'; ctx.stroke();
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(card.price, coinX + 17, coinY + 1);
  const pip = card.total > 4 ? 14 : 18;
  for (let k = 0; k < card.total; k++) {
    const pxp = x0 + w - 12 - (card.total - k) * (pip + 4) + 4 + pip / 2;
    ctx.beginPath(); ctx.arc(pxp, fy, pip / 2 - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = k + 1 === card.idx ? card.color : '#ffffff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  }

  if (card.mortgaged) {
    ctx.fillStyle = 'rgba(26,15,20,0.55)'; ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.save(); ctx.translate(CARD_W / 2, CARD_H / 2); ctx.rotate((-14 * Math.PI) / 180);
    ctx.font = `400 30px ${FONT}`;
    const mw = ctx.measureText('MORTGAGED').width + 32;
    roundRect(ctx, -mw / 2, -26 + 6, mw, 52, 14); ctx.fillStyle = INK; ctx.fill();
    roundRect(ctx, -mw / 2, -26, mw, 52, 14); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = '#E8414B'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('MORTGAGED', 0, 2);
    ctx.restore();
  }
  ctx.restore();
  // Outer ink border
  roundRect(ctx, B / 2, B / 2, CARD_W - B, CARD_H - B, 26);
  ctx.lineWidth = B; ctx.strokeStyle = INK; ctx.stroke();
  return canvas;
}

// ---------- Corner pads ----------
/** Round corner pad face: colour disc, highlight, white icon and the label. */
export function drawCornerPad(kind, { size = 256, canvas = document.createElement('canvas') } = {}) {
  const pad = CORNER_PADS[kind];
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const s = size / 200;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, 200, 200);
  // Disc with the design's inner top highlight: a lighter crescent along the top edge.
  ctx.save(); ctx.beginPath(); ctx.arc(100, 100, 96, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = pad.color; ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, 0, 200, 200);
  ctx.beginPath(); ctx.arc(100, 110, 96, 0, Math.PI * 2); ctx.fillStyle = pad.color; ctx.fill();
  ctx.restore();
  ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(100, 100, 96, 0, Math.PI * 2); ctx.stroke();
  // Icon in the design's 100x100 box, centred in the upper part of the pad
  ctx.save(); ctx.translate(100 - 34, 30); ctx.scale(0.68, 0.68);
  for (const part of pad.icon) {
    ctx.save();
    if (part.rotate) { const [a, rx, ry] = part.rotate; ctx.translate(rx, ry); ctx.rotate((a * Math.PI) / 180); ctx.translate(-rx, -ry); }
    const p = new Path2D(part.d);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (part.fill !== 'none') { ctx.fillStyle = part.fill; ctx.fill(p); }
    if (part.sw) { ctx.lineWidth = part.sw; ctx.strokeStyle = INK; ctx.stroke(p); }
    ctx.restore();
  }
  ctx.restore();
  strokedText(ctx, pad.label, 100, 142, 30, { stroke: 6, maxW: 150 });
  return canvas;
}

// ---------- HTML card (dialog) ----------
export function cardHTML(card) {
  const pips = Array.from({ length: card.total }, (_, k) => `<i style="background:${k + 1 === card.idx ? card.color : '#fff'}"></i>`).join('');
  return `<div class="pcard-face ${card.kind === 'utility' ? 'utility' : ''}" style="--c:${card.color};--art:${card.artBg};--shade:${card.shade}">
    <div class="pc-head"><span class="pc-badge">${card.kind === 'utility' ? '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M11,1 L3,11 L9,11 L8,19 L17,8 L11,8 Z" fill="#FFD43B" stroke="#1A0F14" stroke-width="2" stroke-linejoin="round"/></svg>' : esc(card.badge)}</span>
      <span class="pc-set">${esc(card.setName)}</span><span class="pc-pos">${card.idx}/${card.total}</span></div>
    <div class="pc-art">${ownerCharacter(card) ? `<img class="pc-char" src="${characterUrl(ownerCharacter(card))}" alt="">` : `<img src="${landmarkUrl(card.lm)}" alt="">`}${card.owner ? `<span class="pc-owned" style="background:${card.owner.color}">Owned · ${esc(card.owner.name)}</span>` : ''}</div>
    <div class="pc-name"><span style="font-size:calc(${card.nameSize} * var(--u))">${esc(card.city)}</span></div>
    <div class="pc-foot"><span class="pc-price"><svg viewBox="0 0 28 28" width="26" height="26"><circle cx="14" cy="14" r="11.5" fill="#FFC629" stroke="#1A0F14" stroke-width="3"/><circle cx="14" cy="14" r="6.5" fill="none" stroke="#D6931A" stroke-width="2.5"/><path d="M8,9 Q11,6 15,6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>${esc(card.price)}</span>
      <span class="pc-pips ${card.total > 4 ? 'small' : ''}">${pips}</span></div>
    ${card.mortgaged ? '<div class="pc-mortgaged"><span>MORTGAGED</span></div>' : ''}
  </div>`;
}

export { mix };
