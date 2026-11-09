/* Iso Tycoon – помощник отрисовки изометрической карты (SVG, без зависимостей) */
window.IsoTycoon = (function () {
  var NS = 'http://www.w3.org/2000/svg';
  var TW = 64, TH = 32;

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function P(x, y, o) { return [o.x + (x - y) * TW / 2, o.y + (x + y) * TH / 2]; }
  function pts(list) { return list.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
  function lift(p, h) { return [p[0], p[1] - h]; }

  function tile(g, x, y, o, cls) {
    return el('polygon', { 'class': 'iso-tile ' + cls, points: pts([P(x, y, o), P(x + 1, y, o), P(x + 1, y + 1, o), P(x, y + 1, o)]) }, g);
  }

  /* b: {x, y, w, d, h, roof: 'brick'|'teal'|'slate', windows, selected, ghost: 'ok'|'bad', label} */
  function building(g, b, o) {
    var A = P(b.x, b.y, o), B = P(b.x + b.w, b.y, o), C = P(b.x + b.w, b.y + b.d, o), D = P(b.x, b.y + b.d, o);
    var h = b.h, grp = el('g', { 'class': 'iso-building' + (b.ghost ? ' ghost-' + b.ghost : '') }, g);
    el('polygon', { 'class': 'iso-wall-l', points: pts([D, C, lift(C, h), lift(D, h)]) }, grp);
    el('polygon', { 'class': 'iso-wall-r', points: pts([C, B, lift(B, h), lift(C, h)]) }, grp);
    // окна: ряды по этажам на обеих стенах
    var floors = Math.max(1, Math.floor(h / 18));
    if (b.windows !== false) {
      for (var f = 0; f < floors; f++) {
        var y0 = h - 6 - f * 18, y1 = y0 - 8;
        [[D, C, b.w], [C, B, b.d]].forEach(function (side) {
          var s = side[0], e = side[1], n = Math.max(1, side[2] * 2);
          for (var i = 0; i < n; i++) {
            var t0 = (i + 0.25) / n, t1 = (i + 0.75) / n;
            var a = [s[0] + (e[0] - s[0]) * t0, s[1] + (e[1] - s[1]) * t0];
            var c = [s[0] + (e[0] - s[0]) * t1, s[1] + (e[1] - s[1]) * t1];
            var lo = h - y0, hi = h - y1; // высота низа и верха окна над землёй
            el('polygon', { 'class': 'iso-glass', points: pts([lift(a, lo), lift(c, lo), lift(c, hi), lift(a, hi)]) }, grp);
          }
        });
      }
    }
    el('polygon', { 'class': 'iso-roof roof-' + (b.roof || 'brick'), points: pts([lift(A, h), lift(B, h), lift(C, h), lift(D, h)]) }, grp);
    if (b.selected) el('polygon', { 'class': 'iso-select', points: pts([lift(A, h), lift(B, h), lift(B, 0), lift(C, 0), lift(D, 0), lift(D, h)]) }, grp);
    if (b.label) {
      var top = lift(A, h + 14), lg = el('g', { 'class': 'iso-float' }, g);
      var w = b.label.length * 7 + 14;
      el('rect', { x: top[0] - w / 2, y: top[1] - 18, width: w, height: 20, rx: 10 }, lg);
      var t = el('text', { x: top[0], y: top[1] - 4, 'text-anchor': 'middle' }, lg); t.textContent = b.label;
    }
    return grp;
  }

  function tree(g, x, y, o) {
    var c = P(x + 0.5, y + 0.5, o), grp = el('g', { 'class': 'iso-treeg' }, g);
    el('rect', { 'class': 'iso-trunk', x: c[0] - 2, y: c[1] - 10, width: 4, height: 10 }, grp);
    el('ellipse', { 'class': 'iso-tree', cx: c[0], cy: c[1] - 20, rx: 11, ry: 14 }, grp);
  }

  /* map: {cols, rows, maxH, ground(x,y)->'grass'|'road'|'water', buildings:[], trees:[[x,y]], tiles:[{x,y,cls}]} */
  function render(svg, map) {
    var cols = map.cols, rows = map.rows, maxH = map.maxH || 90;
    var o = { x: rows * TW / 2, y: maxH + 24 };
    var W = (cols + rows) * TW / 2, H = (cols + rows) * TH / 2 + maxH + 24;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var gTiles = el('g', {}, svg), gObj = el('g', {}, svg);
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      var k = map.ground ? map.ground(x, y) : 'grass';
      tile(gTiles, x, y, o, k === 'grass' ? ((x + y) % 2 ? 'grass-2' : 'grass') : k);
    }
    (map.tiles || []).forEach(function (t) { tile(gTiles, t.x, t.y, o, t.cls); });
    var objs = [];
    (map.buildings || []).forEach(function (b) { objs.push({ k: b.x + b.y + b.w + b.d, f: function () { building(gObj, b, o); } }); });
    (map.trees || []).forEach(function (t) { objs.push({ k: t[0] + t[1] + 1.5, f: function () { tree(gObj, t[0], t[1], o); } }); });
    objs.sort(function (a, b) { return a.k - b.k; }).forEach(function (q) { q.f(); });
    return svg;
  }

  /* миниатюра одного здания для карточки в меню строительства */
  function thumb(svg, b) {
    return render(svg, { cols: b.w, rows: b.d, maxH: b.h + 6, buildings: [Object.assign({ x: 0, y: 0 }, b)], ground: function () { return 'grass'; } });
  }

  return { render: render, thumb: thumb, TW: TW, TH: TH };
})();
