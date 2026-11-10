#!/usr/bin/env node
// Throwaway visual check: replay nxdraw display lists (C++ goldens or TS output) onto a
// Canvas2D in headless Chromium and save PNGs.   node render-png.cjs OUT.png IN.nxdraw [IN2.nxdraw ...]
// (several inputs are stacked vertically). GDI semantics follow NXSYSMac/DeviceContext.mm.
const fs = require('fs');
const { chromium } = require('playwright');

const [out, ...ins] = process.argv.slice(2);
if (!out || !ins.length) { console.error('usage: render-png.cjs OUT.png IN.nxdraw...'); process.exit(64); }
const lists = ins.map((f) => fs.readFileSync(f, 'latin1'));

const page_js = `
function unq(s, i){ let o='', c; i++; for(; (c=s[i]) !== '"'; i++){ if(c==='\\\\'){ const n=s[++i]; if(n==='u'){ o+=String.fromCharCode(parseInt(s.slice(i+1,i+5),16)); i+=4;} else o+=n; } else o+=c; } return o; }
const hex = (h) => '#' + h;
const STOCK_BRUSH = {BLACK_BRUSH:'#000000', WHITE_BRUSH:'#ffffff', LTGRAY_BRUSH:'#c8c8c8'};
function replay(text, ctx, ox, oy){
  let pen = null, brush = '#000000', font = null, tcolor = '#ffffff', bkmode = 0, bk = '#000000', cx = 0, cy = 0;
  let w = 0, h = 0;
  for (const line of text.split('\\n')) {
    if (!line || line[0]==='#') continue;
    const sp = line.indexOf(' '); const cmd = sp<0?line:line.slice(0,sp); const rest = sp<0?'':line.slice(sp+1); const t = rest.split(' ');
    switch (cmd) {
      case 'VIEW': w = +t[2]; h = +t[3]; break;
      case 'SELECT':
        if (t[0]==='PEN') pen = {w:+t[2], c:hex(t[3])};
        else if (t[0]==='BRUSH') brush = hex(t[1]);
        else if (t[0]==='STOCK') { if (t[1]==='BLACK_PEN') pen={w:2,c:'#000000'}; else if (t[1]==='NULL_PEN') pen=null; else brush = STOCK_BRUSH[t[1]]; }
        else if (t[0]==='FONT') font = {h:+t[1], wt:+t[2], face: unq(rest, rest.indexOf('"'))};
        break;
      case 'MOVETO': cx=+t[0]; cy=+t[1]; break;
      case 'LINETO': if(pen){ ctx.beginPath(); ctx.lineWidth=pen.w; ctx.strokeStyle=pen.c; ctx.moveTo(ox+cx,oy+cy); ctx.lineTo(ox+ +t[0], oy+ +t[1]); ctx.stroke(); } cx=+t[0]; cy=+t[1]; break;
      case 'ELLIPSE': { const l=+t[0],tp=+t[1],r=+t[2],b=+t[3]; ctx.beginPath(); ctx.ellipse(ox+(l+r)/2, oy+(tp+b)/2, (r-l)/2, (b-tp)/2, 0, 0, 6.2832); ctx.fillStyle=brush; ctx.fill(); break; }
      case 'RECTANGLE': { ctx.fillStyle=brush; ctx.fillRect(ox+ +t[0], oy+ +t[1], +t[2]- +t[0], +t[3]- +t[1]); break; }
      case 'POLYGON': { const n=+t[0]; ctx.beginPath(); for(let k=0;k<n;k++){ const x=ox+ +t[1+2*k], y=oy+ +t[2+2*k]; k?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.closePath(); ctx.fillStyle=brush; ctx.fill(); if(pen){ ctx.lineWidth=pen.w; ctx.strokeStyle=pen.c; ctx.stroke(); } break; }
      case 'FILLRECT': ctx.fillStyle = t[4]==='STOCK'? STOCK_BRUSH[t[5]] : hex(t[5]); ctx.fillRect(ox+ +t[0], oy+ +t[1], +t[2]- +t[0], +t[3]- +t[1]); break;
      case 'TEXTCOLOR': tcolor = hex(t[0]); break;
      case 'BKCOLOR': bk = hex(t[0]); break;
      case 'BKMODE': bkmode = +t[0]; break;
      case 'DRAWTEXT': {
        const l=+t[0], tp=+t[1], r=+t[2], b=+t[3], fl=+t[4]; const s = unq(rest, rest.indexOf('"'));
        let fh = font ? font.h : 10; fh *= 0.8; if (fh < 10) fh = 10;   // WinMacFontRatio, MIN_FONT_SIZE
        const bold = font && font.wt === 4; const face = (font && font.face) || 'Helvetica';
        ctx.font = (bold?'bold ':'') + fh + 'px ' + (face==='Helvetica' ? 'Helvetica, Arial, sans-serif' : face + ', sans-serif');
        ctx.textBaseline = 'top'; ctx.fillStyle = tcolor;
        const tw = ctx.measureText(s).width;
        let x = l, y = tp;
        if (fl & 256) y += (b - tp)/2 - fh/2;
        if (fl & 128) x += (r - l)/2 - tw/2;
        ctx.fillText(s, ox+x, oy+y); break; }
    }
  }
  return {w, h};
}
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<body style="margin:0;background:#000"><canvas id=c></canvas></body>');
  const dims = await page.evaluate(({ lists, js }) => {
    eval(js);
    const sizes = lists.map((t) => { const m = /\nVIEW (\d+) (\d+) (\d+) (\d+)/.exec(t); return { w: +m[3], h: +m[4] }; });
    const W = Math.max(...sizes.map((s) => s.w)), H = sizes.reduce((a, s) => a + s.h + 8, 0);
    const c = document.getElementById('c'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    let y = 0;
    lists.forEach((t, i) => { replay(t, ctx, 0, y); y += sizes[i].h; ctx.fillStyle = '#336'; ctx.fillRect(0, y, W, 8); y += 8; });
    return { W, H };
  }, { lists, js: page_js });
  await page.setViewportSize({ width: dims.W, height: dims.H });
  await page.locator('#c').screenshot({ path: out });
  await browser.close();
  console.log('wrote', out, dims.W + 'x' + dims.H);
})();
