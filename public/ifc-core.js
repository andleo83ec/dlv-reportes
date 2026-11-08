/* Lector IFC (STEP) liviano: niveles, elementos, propiedades y geometría triangulada.
   Sin dependencias: la triangulación 2D se inyecta (THREE.ShapeUtils en el navegador). */
const IfcReader = (() => {
  "use strict";

  // ---------- STEP: cadenas ----------
  function decodeStr(s) {
    if (s.indexOf("''") >= 0) s = s.replace(/''/g, "'");
    if (s.indexOf("\\") < 0) return s;
    let out = "", i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c !== "\\") { out += c; i++; continue; }
      if (s.startsWith("\\X2\\", i)) {
        i += 4; let end = s.indexOf("\\X0\\", i); if (end < 0) end = s.length;
        const hex = s.slice(i, end);
        for (let k = 0; k + 4 <= hex.length; k += 4) out += String.fromCharCode(parseInt(hex.substr(k, 4), 16));
        i = end + 4; continue;
      }
      if (s.startsWith("\\X4\\", i)) {
        i += 4; let end = s.indexOf("\\X0\\", i); if (end < 0) end = s.length;
        const hex = s.slice(i, end);
        for (let k = 0; k + 8 <= hex.length; k += 8) out += String.fromCodePoint(parseInt(hex.substr(k, 8), 16));
        i = end + 4; continue;
      }
      if (s.startsWith("\\X\\", i)) { out += String.fromCharCode(parseInt(s.substr(i + 3, 2), 16)); i += 5; continue; }
      if (s.startsWith("\\S\\", i)) { out += String.fromCharCode(s.charCodeAt(i + 3) + 128); i += 4; continue; }
      if (s[i + 1] === "P" && s[i + 3] === "\\") { i += 4; continue; }
      if (s[i + 1] === "\\") { out += "\\"; i += 2; continue; }
      out += c; i++;
    }
    return out;
  }

  // ---------- STEP: lista de argumentos ----------
  function parseArgs(t, start) {
    let p = start;
    const N = t.length;
    function ws() { for (;;) { const c = t.charCodeAt(p); if (c === 32 || c === 10 || c === 13 || c === 9) p++; else break; } }
    function val() {
      ws();
      const c = t.charCodeAt(p);
      if (c === 35) { p++; let n = 0, d; while ((d = t.charCodeAt(p)) >= 48 && d <= 57) { n = n * 10 + d - 48; p++; } return { r: n }; }
      if (c === 39) {
        p++; const s = p;
        while (p < N) { const d = t.charCodeAt(p); if (d === 39) { if (t.charCodeAt(p + 1) === 39) { p += 2; continue; } break; } p++; }
        const raw = t.slice(s, p); p++; return decodeStr(raw);
      }
      if (c === 40) return list();
      if (c === 36 || c === 42) { p++; return null; }
      if (c === 46) { p++; const s = p; while (p < N && t.charCodeAt(p) !== 46) p++; const v = t.slice(s, p); p++; return { e: v }; }
      if (c === 34) { p++; const s = p; while (p < N && t.charCodeAt(p) !== 34) p++; const v = t.slice(s, p); p++; return v; }
      if ((c >= 48 && c <= 57) || c === 45 || c === 43) {
        const s = p; p++;
        for (;;) { const d = t.charCodeAt(p); if ((d >= 48 && d <= 57) || d === 46 || d === 69 || d === 101 || d === 45 || d === 43) p++; else break; }
        return parseFloat(t.slice(s, p));
      }
      const s = p;
      for (;;) { const d = t.charCodeAt(p); if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 95) p++; else break; }
      const tn = t.slice(s, p).toUpperCase(); ws();
      if (t.charCodeAt(p) === 40) { const inner = list(); return { tv: tn, v: inner.length === 1 ? inner[0] : inner }; }
      if (p === s) p++; // carácter inesperado: avanzar
      return tn;
    }
    function list() {
      ws(); p++;
      const out = []; ws();
      if (t.charCodeAt(p) === 41) { p++; return out; }
      while (p < N) {
        out.push(val()); ws();
        const c = t.charCodeAt(p);
        if (c === 44) { p++; continue; }
        if (c === 41) { p++; break; }
        p++;
      }
      return out;
    }
    return list();
  }

  const tick = () => new Promise(r => setTimeout(r, 0));

  // ---------- STEP: índice de entidades ----------
  async function scan(t, prog) {
    const ents = new Map(), byType = new Map();
    let i = t.indexOf("DATA;");
    if (i < 0) throw new Error("El archivo no parece un IFC (no tiene sección DATA).");
    i += 5;
    const N = t.length;
    let nextYield = i + 3e6;
    while (i < N) {
      const c = t.charCodeAt(i);
      if (c === 35) {
        let j = i + 1, id = 0, d;
        while ((d = t.charCodeAt(j)) >= 48 && d <= 57) { id = id * 10 + d - 48; j++; }
        while ((d = t.charCodeAt(j)) === 32 || d === 10 || d === 13 || d === 9) j++;
        if (t.charCodeAt(j) !== 61) { i = j; continue; }
        j++;
        while ((d = t.charCodeAt(j)) === 32 || d === 10 || d === 13 || d === 9) j++;
        let k = j;
        while ((d = t.charCodeAt(k)) && ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 95)) k++;
        const type = t.slice(j, k).toUpperCase();
        let p = k, inStr = false;
        while (p < N) {
          const ch = t.charCodeAt(p);
          if (inStr) { if (ch === 39) { if (t.charCodeAt(p + 1) === 39) { p += 2; continue; } inStr = false; } }
          else if (ch === 39) inStr = true;
          else if (ch === 59) break;
          p++;
        }
        ents.set(id, { t: type, s: k, a: null });
        let l = byType.get(type); if (!l) byType.set(type, l = []); l.push(id);
        i = p + 1;
        if (i > nextYield) { nextYield = i + 3e6; prog("Leyendo archivo", i / N); await tick(); }
      } else if (c === 47 && t.charCodeAt(i + 1) === 42) {
        const e = t.indexOf("*/", i + 2); i = e < 0 ? N : e + 2;
      } else if (c === 69 && t.startsWith("ENDSEC", i)) break;
      else i++;
    }
    return { ents, byType };
  }

  // ---------- matrices 4x4 (columna mayor) ----------
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  const axes = (x, y, z, o) => [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
  const xf = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
  const det3 = m => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1]; }

  const CATS = {
    IFCWALL: "Muros", IFCWALLSTANDARDCASE: "Muros", IFCWALLELEMENTEDCASE: "Muros", IFCSLAB: "Losas", IFCSLABSTANDARDCASE: "Losas",
    IFCCOLUMN: "Columnas", IFCCOLUMNSTANDARDCASE: "Columnas", IFCBEAM: "Vigas", IFCBEAMSTANDARDCASE: "Vigas",
    IFCFOOTING: "Cimentación", IFCPILE: "Pilotes", IFCSTAIR: "Escaleras", IFCSTAIRFLIGHT: "Escaleras", IFCRAMP: "Rampas", IFCRAMPFLIGHT: "Rampas",
    IFCRAILING: "Pasamanos", IFCROOF: "Cubierta", IFCDOOR: "Puertas", IFCDOORSTANDARDCASE: "Puertas", IFCWINDOW: "Ventanas", IFCWINDOWSTANDARDCASE: "Ventanas",
    IFCCOVERING: "Recubrimientos", IFCCURTAINWALL: "Muro cortina", IFCPLATE: "Placas", IFCPLATESTANDARDCASE: "Placas", IFCMEMBER: "Perfiles", IFCMEMBERSTANDARDCASE: "Perfiles",
    IFCREINFORCINGBAR: "Acero de refuerzo", IFCREINFORCINGMESH: "Malla electrosoldada", IFCTENDON: "Acero de refuerzo",
    IFCFURNISHINGELEMENT: "Mobiliario", IFCFURNITURE: "Mobiliario", IFCBUILDINGELEMENTPROXY: "Objetos", IFCBUILDINGELEMENTPART: "Partes",
    IFCCHIMNEY: "Chimeneas", IFCSHADINGDEVICE: "Parasoles", IFCTRANSPORTELEMENT: "Ascensores",
    IFCFLOWSEGMENT: "Instalaciones", IFCFLOWTERMINAL: "Instalaciones", IFCFLOWFITTING: "Instalaciones", IFCFLOWCONTROLLER: "Instalaciones",
    IFCPIPESEGMENT: "Tuberías", IFCPIPEFITTING: "Tuberías", IFCDUCTSEGMENT: "Ductos", IFCDUCTFITTING: "Ductos",
    IFCSANITARYTERMINAL: "Sanitarios", IFCLIGHTFIXTURE: "Iluminación", IFCCABLECARRIERSEGMENT: "Instalaciones eléctricas",
    IFCDISCRETEACCESSORY: "Accesorios", IFCMECHANICALFASTENER: "Accesorios", IFCELEMENTASSEMBLY: "Ensambles", IFCGEOGRAPHICELEMENT: "Terreno"
  };
  const EXCLUDE = new Set(["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE", "IFCOPENINGELEMENT", "IFCOPENINGSTANDARDCASE",
    "IFCZONE", "IFCANNOTATION", "IFCGRID", "IFCVIRTUALELEMENT", "IFCSPATIALZONE", "IFCEXTERNALSPATIALELEMENT", "IFCDISTRIBUTIONPORT", "IFCFACILITY"]);
  const SKIP_REP = new Set(["Axis", "FootPrint", "Box", "Annotation", "Profile", "Plan", "Reference", "Clearance", "Lighting", "CoG"]);
  const PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: .1, CENTI: .01, MILLI: .001, MICRO: 1e-6, NANO: 1e-9 };

  async function load(text, opt = {}) {
    const prog = opt.onProgress || (() => {});
    const T = opt.triangulate;
    const { ents, byType } = await scan(text, prog);
    const ids = t => byType.get(t) || [];
    const type = id => { const e = ents.get(id); return e ? e.t : ""; };
    const A = id => { const e = ents.get(id); if (!e) return []; if (!e.a) e.a = parseArgs(text, e.s); return e.a; };
    const R = v => (v && v.r) ? v.r : 0;
    const num = v => (v && v.tv) ? num(v.v) : (typeof v === "number" ? v : 0);
    const isT = v => v && v.e === "T";
    const refs = v => Array.isArray(v) ? v.map(R).filter(Boolean) : (R(v) ? [R(v)] : []);

    // ---- unidades ----
    let LS = 1, AS = 1, volUnit = 1, areaUnit = 1;
    const unitLabels = { len: "m", area: "m²", vol: "m³" };
    const projId = ids("IFCPROJECT")[0];
    const projA = projId ? A(projId) : [];
    function siFactor(u) { const a = A(u); return a[2] && a[2].e ? (PREFIX[a[2].e] || 1) : 1; }
    function unitFactor(u) {
      const ty = type(u), a = A(u);
      if (ty === "IFCSIUNIT") return { kind: a[1] && a[1].e, f: siFactor(u), pre: a[2] && a[2].e };
      if (ty === "IFCCONVERSIONBASEDUNIT" || ty === "IFCCONVERSIONBASEDUNITWITHOFFSET") {
        const mw = A(R(a[3])); const base = R(mw[1]) ? unitFactor(R(mw[1])).f : 1;
        return { kind: a[1] && a[1].e, f: num(mw[0]) * base, name: a[2] };
      }
      return { kind: null, f: 1 };
    }
    const unitList = projA[8] ? refs(A(R(projA[8]))[0]) : [...ids("IFCSIUNIT"), ...ids("IFCCONVERSIONBASEDUNIT")];
    for (const u of unitList) {
      const uf = unitFactor(u);
      if (uf.kind === "LENGTHUNIT") { LS = uf.f; unitLabels.len = uf.name ? String(uf.name).toLowerCase() : (uf.pre === "MILLI" ? "mm" : uf.pre === "CENTI" ? "cm" : "m"); }
      else if (uf.kind === "PLANEANGLEUNIT") AS = uf.f;
      else if (uf.kind === "VOLUMEUNIT") volUnit = uf.f ** (uf.pre ? 3 : 1);
      else if (uf.kind === "AREAUNIT") areaUnit = uf.f ** (uf.pre ? 2 : 1);
    }

    // ---- geometría básica ----
    const P3 = id => { const c = A(id)[0] || []; return [num(c[0]), num(c[1]), num(c[2])]; };
    const DIR = id => { const c = A(id)[0] || []; return norm([num(c[0]), num(c[1]), num(c[2])]); };
    const axCache = new Map();
    function axis2(id) {
      if (!id) return I4;
      if (axCache.has(id)) return axCache.get(id);
      const ty = type(id), a = A(id);
      let m;
      if (ty === "IFCAXIS2PLACEMENT2D") {
        const o = P3(R(a[0])); let x = R(a[1]) ? DIR(R(a[1])) : [1, 0, 0]; x = norm([x[0], x[1], 0]);
        m = axes(x, [-x[1], x[0], 0], [0, 0, 1], o);
      } else if (ty === "IFCAXIS2PLACEMENT3D") {
        const o = P3(R(a[0]));
        const z = R(a[1]) ? DIR(R(a[1])) : [0, 0, 1];
        let x = R(a[2]) ? DIR(R(a[2])) : [1, 0, 0];
        if (Math.abs(dot(x, z)) > 0.999) x = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        x = norm(sub(x, scl(z, dot(x, z))));
        m = axes(x, cross(z, x), z, o);
      } else if (ty.startsWith("IFCCARTESIANTRANSFORMATIONOPERATOR")) m = cto(id);
      else m = I4;
      axCache.set(id, m); return m;
    }
    function cto(id) {
      if (!id) return I4;
      const ty = type(id), a = A(id);
      const is2d = ty.indexOf("2D") > 0;
      let x = R(a[0]) ? DIR(R(a[0])) : [1, 0, 0];
      let y = R(a[1]) ? DIR(R(a[1])) : [0, 1, 0];
      const o = P3(R(a[2]));
      const s = a[3] == null ? 1 : num(a[3]);
      let z = (!is2d && R(a[4])) ? DIR(R(a[4])) : norm(cross(x, y));
      if (is2d) { z = [0, 0, 1]; x = norm([x[0], x[1], 0]); }
      x = norm(sub(x, scl(z, dot(x, z)))); y = cross(z, x);
      let sx = s, sy = s, sz = s;
      if (ty.endsWith("NONUNIFORM")) { sy = is2d ? (a[4] == null ? s : num(a[4])) : (a[5] == null ? s : num(a[5])); sz = is2d ? 1 : (a[6] == null ? s : num(a[6])); }
      return axes(scl(x, sx), scl(y, sy), scl(z, sz), o);
    }
    const plCache = new Map();
    function placement(id, depth = 0) {
      if (!id) return I4;
      if (plCache.has(id)) return plCache.get(id);
      let m = I4;
      if (type(id) === "IFCLOCALPLACEMENT" && depth < 64) {
        const a = A(id);
        m = mul(placement(R(a[0]), depth + 1), axis2(R(a[1])));
      }
      plCache.set(id, m); return m;
    }

    // ---- curvas ----
    const SEG = Math.PI / 12;
    function arcPts(cx, cy, r1, r2, t1, t2, m) {
      const n = Math.max(2, Math.ceil(Math.abs(t2 - t1) / SEG));
      const out = [];
      for (let i = 0; i <= n; i++) { const t = t1 + (t2 - t1) * i / n; out.push(xf(m, cx + r1 * Math.cos(t), cy + r2 * Math.sin(t), 0)); }
      return out;
    }
    function arc3(p0, p1, p2) {
      const ax = p0[0], ay = p0[1], bx = p1[0], by = p1[1], cx = p2[0], cy = p2[1];
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(d) < 1e-12) return [p0, p1, p2];
      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
      const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
      const r = Math.hypot(ax - ux, ay - uy);
      let t0 = Math.atan2(ay - uy, ax - ux), t1 = Math.atan2(by - uy, bx - ux), t2 = Math.atan2(cy - uy, cx - ux);
      const ccw = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 0;
      if (ccw) { while (t1 < t0) t1 += 2 * Math.PI; while (t2 < t1) t2 += 2 * Math.PI; }
      else { while (t1 > t0) t1 -= 2 * Math.PI; while (t2 > t1) t2 -= 2 * Math.PI; }
      const z = p0[2] || 0;
      return arcPts(ux, uy, r, r, t0, t2, axes([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, z]));
    }
    function pushPts(out, pts) {
      for (const p of pts) {
        const l = out[out.length - 1];
        if (l && Math.abs(l[0] - p[0]) < 1e-9 && Math.abs(l[1] - p[1]) < 1e-9 && Math.abs((l[2] || 0) - (p[2] || 0)) < 1e-9) continue;
        out.push(p);
      }
    }
    function curve(id, depth = 0) {
      if (!id || depth > 16) return [];
      const ty = type(id), a = A(id);
      switch (ty) {
        case "IFCPOLYLINE": return refs(a[0]).map(P3);
        case "IFCINDEXEDPOLYCURVE": {
          const pl = A(R(a[0]))[0] || [];
          const P = i => { const c = pl[i - 1] || [0, 0, 0]; return [num(c[0]), num(c[1]), num(c[2])]; };
          const out = [];
          if (!a[1]) { for (let i = 1; i <= pl.length; i++) pushPts(out, [P(i)]); return out; }
          for (const sg of a[1]) {
            const ix = Array.isArray(sg.v) ? sg.v : [sg.v];
            if (sg.tv === "IFCARCINDEX" && ix.length === 3) pushPts(out, arc3(P(ix[0]), P(ix[1]), P(ix[2])));
            else pushPts(out, ix.map(P));
          }
          return out;
        }
        case "IFCCOMPOSITECURVE": case "IFCCOMPOSITECURVEONSURFACE": {
          const out = [];
          for (const s of refs(a[0])) {
            const sa = A(s);
            let pts = curve(R(sa[2]), depth + 1);
            if (sa[1] && sa[1].e === "F") pts = pts.slice().reverse();
            pushPts(out, pts);
          }
          return out;
        }
        case "IFCTRIMMEDCURVE": {
          const basis = R(a[0]), bt = type(basis), ba = A(basis);
          const sense = !(a[3] && a[3].e === "F");
          const trimPt = tr => { for (const v of (tr || [])) if (v && v.r) return P3(v.r); return null; };
          const trimPar = tr => { for (const v of (tr || [])) if (v && v.tv === "IFCPARAMETERVALUE") return num(v.v); else if (typeof v === "number") return v; return null; };
          if (bt === "IFCLINE") {
            let p1 = trimPt(a[1]), p2 = trimPt(a[2]);
            if (!p1 || !p2) {
              const o = P3(R(ba[0])), va = A(R(ba[1])), dv = DIR(R(va[0])), mg = num(va[1]);
              p1 = p1 || add(o, scl(dv, mg * (trimPar(a[1]) || 0)));
              p2 = p2 || add(o, scl(dv, mg * (trimPar(a[2]) || 0)));
            }
            return sense ? [p1, p2] : [p2, p1];
          }
          if (bt === "IFCCIRCLE" || bt === "IFCELLIPSE") {
            const m = axis2(R(ba[0]));
            const r1 = num(ba[1]), r2 = bt === "IFCELLIPSE" ? num(ba[2]) : r1;
            const ang = tr => {
              const p = trimPt(tr);
              if (p && (a[4] && a[4].e === "CARTESIAN" || trimPar(tr) == null)) {
                const d = sub(p, [m[12], m[13], m[14]]);
                const lx = dot(d, [m[0], m[1], m[2]]), ly = dot(d, [m[4], m[5], m[6]]);
                return Math.atan2(ly / r2, lx / r1);
              }
              const v = trimPar(tr); return v == null ? 0 : v * AS;
            };
            let t1 = ang(a[1]), t2 = ang(a[2]);
            if (sense) { while (t2 <= t1 + 1e-9) t2 += 2 * Math.PI; } else { while (t2 >= t1 - 1e-9) t2 -= 2 * Math.PI; }
            return arcPts(0, 0, r1, r2, t1, t2, m);
          }
          return curve(basis, depth + 1);
        }
        case "IFCCIRCLE": { const m = axis2(R(a[0])); const r = num(a[1]); const p = arcPts(0, 0, r, r, 0, 2 * Math.PI, m); p.pop(); return p; }
        case "IFCELLIPSE": { const m = axis2(R(a[0])); const p = arcPts(0, 0, num(a[1]), num(a[2]), 0, 2 * Math.PI, m); p.pop(); return p; }
        case "IFCLINE": return [];
        case "IFCOFFSETCURVE2D": case "IFCOFFSETCURVE3D": return curve(R(a[0]), depth + 1);
        default:
          if (ty.startsWith("IFCBSPLINECURVE") || ty.startsWith("IFCRATIONALBSPLINECURVE")) return refs(a[1]).map(P3);
          return [];
      }
    }
    function clean2(pts) {
      const out = [];
      for (const p of pts) {
        const l = out[out.length - 1];
        if (l && Math.abs(l[0] - p[0]) < 1e-9 && Math.abs(l[1] - p[1]) < 1e-9) continue;
        out.push([p[0], p[1]]);
      }
      while (out.length > 2) { const f = out[0], l = out[out.length - 1]; if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop(); else break; }
      return out;
    }
    const area2 = p => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]); return s / 2; };

    // ---- perfiles ----
    function circ(r, n = 24) { const o = []; for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n; o.push([r * Math.cos(t), r * Math.sin(t)]); } return o; }
    function profile(id, depth = 0) {
      if (!id || depth > 8) return [];
      const ty = type(id), a = A(id);
      let shapes = null;
      const D = i => num(a[i]);
      switch (ty) {
        case "IFCARBITRARYCLOSEDPROFILEDEF": return [{ o: clean2(curve(R(a[2]))), h: [] }];
        case "IFCARBITRARYPROFILEDEFWITHVOIDS": return [{ o: clean2(curve(R(a[2]))), h: refs(a[3]).map(c => clean2(curve(c))) }];
        case "IFCCOMPOSITEPROFILEDEF": return refs(a[2]).flatMap(p => profile(p, depth + 1));
        case "IFCDERIVEDPROFILEDEF": case "IFCMIRROREDPROFILEDEF": {
          const m = cto(R(a[3]));
          const tf = pts => pts.map(p => { const q = xf(m, p[0], p[1], 0); return [q[0], q[1]]; });
          return profile(R(a[2]), depth + 1).map(s => ({ o: tf(s.o), h: s.h.map(tf) }));
        }
        case "IFCCENTERLINEPROFILEDEF": {
          const pts = curve(R(a[2])), t = D(3) / 2, out = [];
          for (let i = 0; i + 1 < pts.length; i++) {
            const p = pts[i], q = pts[i + 1]; const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); if (l < 1e-9) continue;
            const nx = -dy / l * t, ny = dx / l * t;
            out.push({ o: [[p[0] + nx, p[1] + ny], [p[0] - nx, p[1] - ny], [q[0] - nx, q[1] - ny], [q[0] + nx, q[1] + ny]], h: [] });
          }
          return out;
        }
        case "IFCRECTANGLEPROFILEDEF": case "IFCROUNDEDRECTANGLEPROFILEDEF": {
          const x = D(3) / 2, y = D(4) / 2; shapes = [{ o: [[-x, -y], [x, -y], [x, y], [-x, y]], h: [] }]; break;
        }
        case "IFCRECTANGLEHOLLOWPROFILEDEF": {
          const x = D(3) / 2, y = D(4) / 2, t = D(5);
          shapes = [{ o: [[-x, -y], [x, -y], [x, y], [-x, y]], h: (x > t && y > t) ? [[[-x + t, -y + t], [-x + t, y - t], [x - t, y - t], [x - t, -y + t]]] : [] }]; break;
        }
        case "IFCCIRCLEPROFILEDEF": shapes = [{ o: circ(D(3)), h: [] }]; break;
        case "IFCCIRCLEHOLLOWPROFILEDEF": shapes = [{ o: circ(D(3)), h: [circ(D(3) - D(4)).reverse()] }]; break;
        case "IFCELLIPSEPROFILEDEF": shapes = [{ o: circ(1).map(p => [p[0] * D(3), p[1] * D(4)]), h: [] }]; break;
        case "IFCISHAPEPROFILEDEF": {
          const b = D(3) / 2, h = D(4) / 2, w = D(5) / 2, f = D(6);
          shapes = [{ o: [[-b, -h], [b, -h], [b, -h + f], [w, -h + f], [w, h - f], [b, h - f], [b, h], [-b, h], [-b, h - f], [-w, h - f], [-w, -h + f], [-b, -h + f]], h: [] }]; break;
        }
        case "IFCASYMMETRICISHAPEPROFILEDEF": {
          const bb = D(3) / 2, h = D(4) / 2, w = D(5) / 2, fb = D(6), bt = (a[8] != null ? D(8) : D(3)) / 2, ft = a[9] != null ? D(9) : fb;
          shapes = [{ o: [[-bb, -h], [bb, -h], [bb, -h + fb], [w, -h + fb], [w, h - ft], [bt, h - ft], [bt, h], [-bt, h], [-bt, h - ft], [-w, h - ft], [-w, -h + fb], [-bb, -h + fb]], h: [] }]; break;
        }
        case "IFCLSHAPEPROFILEDEF": {
          const d = D(3) / 2, w = (a[4] != null ? D(4) : D(3)) / 2, t = D(5);
          shapes = [{ o: [[-w, -d], [w, -d], [w, -d + t], [-w + t, -d + t], [-w + t, d], [-w, d]], h: [] }]; break;
        }
        case "IFCTSHAPEPROFILEDEF": {
          const d = D(3) / 2, b = D(4) / 2, w = D(5) / 2, f = D(6);
          shapes = [{ o: [[-w, -d], [w, -d], [w, d - f], [b, d - f], [b, d], [-b, d], [-b, d - f], [-w, d - f]], h: [] }]; break;
        }
        case "IFCUSHAPEPROFILEDEF": {
          const d = D(3) / 2, b = D(4) / 2, w = D(5), f = D(6);
          shapes = [{ o: [[-b, -d], [b, -d], [b, -d + f], [-b + w, -d + f], [-b + w, d - f], [b, d - f], [b, d], [-b, d]], h: [] }]; break;
        }
        case "IFCCSHAPEPROFILEDEF": {
          const d = D(3) / 2, b = D(4) / 2, t = D(5);
          shapes = [{ o: [[-b, -d], [b, -d], [b, -d + t], [-b + t, -d + t], [-b + t, d - t], [b, d - t], [b, d], [-b, d]], h: [] }]; break;
        }
        case "IFCZSHAPEPROFILEDEF": {
          const d = D(3) / 2, b = D(4), w = D(5) / 2, f = D(6);
          shapes = [{ o: [[-w, -d], [b - w, -d], [b - w, -d + f], [w, -d + f], [w, d], [w - b, d], [w - b, d - f], [-w, d - f]], h: [] }]; break;
        }
        case "IFCTRAPEZIUMPROFILEDEF": {
          const bx = D(3), tx = D(4), y = D(5) / 2, off = D(6);
          shapes = [{ o: [[-bx / 2, -y], [bx / 2, -y], [-bx / 2 + off + tx, y], [-bx / 2 + off, y]], h: [] }]; break;
        }
        default: return [];
      }
      if (shapes && R(a[2])) {
        const m = axis2(R(a[2]));
        const tf = pts => pts.map(p => { const q = xf(m, p[0], p[1], 0); return [q[0], q[1]]; });
        shapes = shapes.map(s => ({ o: tf(s.o), h: s.h.map(tf) }));
      }
      return shapes;
    }

    // ---- emisión de triángulos ----
    function tri(out, a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
    function triVol(a, b, c) { return dot(a, cross(b, c)) / 6; }

    function extrudeShapes(shapes, m, d, depth, out) {
      let vol = 0;
      const dv = scl(d, depth);
      for (const s0 of shapes) {
        let o = s0.o; if (o.length < 3) continue;
        if (area2(o) < 0) o = o.slice().reverse();
        const holes = s0.h.filter(h => h.length >= 3).map(h => area2(h) > 0 ? h.slice().reverse() : h);
        const all = o.concat(...holes);
        const tris = T(o, holes);
        const bot = all.map(p => xf(m, p[0], p[1], 0));
        const top = all.map(p => xf(m, p[0] + dv[0], p[1] + dv[1], dv[2]));
        let a2 = area2(o); for (const h of holes) a2 += area2(h);
        vol += Math.abs(a2 * depth * d[2] * det3(m));
        for (const t of tris) {
          const [i, j, k] = t;
          const cr = (all[j][0] - all[i][0]) * (all[k][1] - all[i][1]) - (all[j][1] - all[i][1]) * (all[k][0] - all[i][0]);
          if (cr > 0) { tri(out, bot[i], bot[k], bot[j]); tri(out, top[i], top[j], top[k]); }
          else { tri(out, bot[i], bot[j], bot[k]); tri(out, top[i], top[k], top[j]); }
        }
        let base = 0;
        for (const loop of [o, ...holes]) {
          const n = loop.length;
          for (let i = 0; i < n; i++) {
            const i0 = base + i, i1 = base + (i + 1) % n;
            tri(out, bot[i0], bot[i1], top[i1]); tri(out, bot[i0], top[i1], top[i0]);
          }
          base += n;
        }
      }
      return vol;
    }

    function polyFace(loops, out) {
      // loops: arrays de puntos 3D ya transformados; el primero es el contorno exterior
      const outer = loops[0]; if (!outer || outer.length < 3) return 0;
      let n = [0, 0, 0];
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i], q = outer[(i + 1) % outer.length];
        n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]);
      }
      let v = 0;
      if (outer.length === 3 && loops.length === 1) { tri(out, outer[0], outer[1], outer[2]); return triVol(outer[0], outer[1], outer[2]); }
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      const [u, w] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [2, 0];
      const pr = l => l.map(p => [p[u], p[w]]);
      const holes = loops.slice(1).filter(l => l.length >= 3);
      const all = outer.concat(...holes);
      let tris;
      if (outer.length === 4 && !holes.length) tris = [[0, 1, 2], [0, 2, 3]];
      else tris = T(pr(outer), holes.map(pr));
      for (const t of tris) {
        let a = all[t[0]], b = all[t[1]], c = all[t[2]];
        if (!a || !b || !c) continue;
        if (dot(cross(sub(b, a), sub(c, a)), n) < 0) { const x = b; b = c; c = x; }
        tri(out, a, b, c); v += triVol(a, b, c);
      }
      return v;
    }

    function loopPts(id, m) {
      const ty = type(id), a = A(id);
      if (ty === "IFCPOLYLOOP") return refs(a[0]).map(p => { const c = P3(p); return xf(m, c[0], c[1], c[2]); });
      if (ty === "IFCEDGELOOP") {
        const out = [];
        for (const oe of refs(a[0])) {
          const oa = A(oe); const ec = A(R(oa[2]));
          const vs = P3(R(A(R(ec[0]))[0])), ve = P3(R(A(R(ec[1]))[0]));
          let g = curve(R(ec[2]));
          if (g.length >= 2) { if (ec[3] && ec[3].e === "F") g = g.slice().reverse(); } else g = [vs, ve];
          if (oa[3] && oa[3].e === "F") g = g.slice().reverse();
          for (let i = 0; i < g.length - 1; i++) out.push(xf(m, g[i][0], g[i][1], g[i][2]));
        }
        return out;
      }
      return [];
    }
    function faces(list, m, out) {
      let v = 0;
      for (const f of list) {
        const bounds = refs(A(f)[0]);
        const loops = [];
        let outerIdx = 0;
        bounds.forEach((b, i) => {
          const ba = A(b); let pts = loopPts(R(ba[0]), m);
          if (ba[1] && ba[1].e === "F") pts = pts.reverse();
          if (type(b) === "IFCFACEOUTERBOUND") outerIdx = i;
          loops.push(pts);
        });
        if (outerIdx) loops.unshift(loops.splice(outerIdx, 1)[0]);
        v += polyFace(loops, out);
      }
      return v;
    }
    function shell(id, m, out) { return faces(refs(A(id)[0]), m, out); }

    function faceSet(id, m, out) {
      const ty = type(id), a = A(id);
      const cl = A(R(a[0]))[0] || [];
      const pts = cl.map(c => xf(m, num(c[0]), num(c[1]), num(c[2])));
      let v = 0;
      if (ty === "IFCPOLYGONALFACESET") {
        const pn = Array.isArray(a[3]) ? a[3] : null;
        const P = i => pts[(pn ? pn[i - 1] : i) - 1];
        for (const f of refs(a[2])) {
          const fa = A(f);
          const loops = [(fa[0] || []).map(P).filter(Boolean)];
          if (type(f) === "IFCINDEXEDPOLYGONALFACEWITHVOIDS") for (const h of (fa[1] || [])) loops.push(h.map(P).filter(Boolean));
          v += polyFace(loops, out);
        }
      } else {
        const pn = Array.isArray(a[4]) ? a[4] : null;
        const P = i => pts[(pn ? pn[i - 1] : i) - 1];
        for (const t of (a[3] || [])) {
          const p = P(t[0]), q = P(t[1]), r = P(t[2]);
          if (p && q && r) { tri(out, p, q, r); v += triVol(p, q, r); }
        }
      }
      return v;
    }

    function tube(pts, r, out) {
      const N = 8; let vol = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const p = pts[i], q = pts[i + 1], d = sub(q, p), L = Math.hypot(d[0], d[1], d[2]); if (L < 1e-9) continue;
        const z = scl(d, 1 / L); const ref = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        const x = norm(cross(ref, z)), y = cross(z, x);
        const ring = c => { const o = []; for (let k = 0; k < N; k++) { const t = 2 * Math.PI * k / N; o.push(add(c, add(scl(x, r * Math.cos(t)), scl(y, r * Math.sin(t))))); } return o; };
        const a = ring(p), b = ring(q);
        for (let k = 0; k < N; k++) { const k1 = (k + 1) % N; tri(out, a[k], a[k1], b[k1]); tri(out, a[k], b[k1], b[k]); }
        vol += Math.PI * r * r * L;
      }
      return vol;
    }

    function revolve(shapes, m, ax, angle, out) {
      const steps = Math.max(3, Math.ceil(Math.abs(angle) / SEG));
      const full = Math.abs(Math.abs(angle) - 2 * Math.PI) < 1e-3;
      const o = ax.o, k = ax.d;
      const rot = (p, th) => {
        const v = sub(p, o), c = Math.cos(th), s = Math.sin(th);
        return add(o, add(add(scl(v, c), scl(cross(k, v), s)), scl(k, dot(k, v) * (1 - c))));
      };
      for (const sh of shapes) {
        const loop = sh.o; if (loop.length < 3) continue;
        const rings = [];
        for (let i = 0; i <= steps; i++) rings.push(loop.map(p => { const q = rot([p[0], p[1], 0], angle * i / steps); return xf(m, q[0], q[1], q[2]); }));
        for (let i = 0; i < steps; i++) for (let j = 0; j < loop.length; j++) {
          const j1 = (j + 1) % loop.length, A_ = rings[i][j], B = rings[i][j1], C = rings[i + 1][j1], D_ = rings[i + 1][j];
          tri(out, A_, B, C); tri(out, A_, C, D_);
        }
        if (!full) { polyFace([rings[0]], out); polyFace([rings[steps].slice().reverse()], out); }
      }
      return 0;
    }

    // ---- estilos (colores) ----
    const styleColor = new Map();
    function colorOfStyles(list, depth = 0) {
      for (const s of list) {
        const ty = type(s), a = A(s);
        if (ty === "IFCPRESENTATIONSTYLEASSIGNMENT") { const c = colorOfStyles(refs(a[0]), depth + 1); if (c) return c; }
        else if (ty === "IFCSURFACESTYLE") {
          for (const el of refs(a[2])) {
            const et = type(el), ea = A(el);
            if (et === "IFCSURFACESTYLESHADING" || et === "IFCSURFACESTYLERENDERING") {
              const col = A(R(ea[0]));
              const tr = ea[1] != null && (et === "IFCSURFACESTYLERENDERING" || typeof num(ea[1]) === "number") ? num(ea[1]) : 0;
              return [num(col[1]), num(col[2]), num(col[3]), 1 - (tr || 0)];
            }
          }
        }
      }
      return null;
    }
    for (const si of ids("IFCSTYLEDITEM")) {
      const a = A(si); const it = R(a[0]); if (!it) continue;
      const c = colorOfStyles(refs(a[1])); if (c && !styleColor.has(it)) styleColor.set(it, c);
    }
    const matColor = new Map();
    for (const md of ids("IFCMATERIALDEFINITIONREPRESENTATION")) {
      const a = A(md); const mat = R(a[3]);
      for (const rp of refs(a[2])) for (const si of refs(A(rp)[3])) {
        const c = colorOfStyles(refs(A(si)[1])); if (c && !matColor.has(mat)) matColor.set(mat, c);
      }
    }

    // ---- ítems de representación ----
    function item(id, m, out, st, depth = 0) {
      if (!id || depth > 12) return 0;
      if (!st.color && styleColor.has(id)) st.color = styleColor.get(id);
      const ty = type(id), a = A(id);
      switch (ty) {
        case "IFCEXTRUDEDAREASOLID": case "IFCEXTRUDEDAREASOLIDTAPERED": {
          const mm = R(a[1]) ? mul(m, axis2(R(a[1]))) : m;
          return extrudeShapes(profile(R(a[0])), mm, DIR(R(a[2])), num(a[3]), out);
        }
        case "IFCMAPPEDITEM": {
          const rm = A(R(a[0]));
          const mm = mul(m, mul(cto(R(a[1])), axis2(R(rm[0]))));
          const rep = A(R(rm[1]));
          let v = 0; for (const it of refs(rep[3])) v += item(it, mm, out, st, depth + 1); return v;
        }
        case "IFCBOOLEANRESULT": case "IFCBOOLEANCLIPPINGRESULT": {
          let v = item(R(a[1]), m, out, st, depth + 1);
          if (a[0] && a[0].e === "UNION") v += item(R(a[2]), m, out, st, depth + 1);
          return v;
        }
        case "IFCFACETEDBREP": case "IFCFACETEDBREPWITHVOIDS": case "IFCADVANCEDBREP": case "IFCADVANCEDBREPWITHVOIDS":
          return Math.abs(shell(R(a[0]), m, out));
        case "IFCCLOSEDSHELL": case "IFCOPENSHELL": case "IFCCONNECTEDFACESET": return Math.abs(shell(id, m, out));
        case "IFCSHELLBASEDSURFACEMODEL": case "IFCFACEBASEDSURFACEMODEL": { let v = 0; for (const s of refs(a[0])) v += Math.abs(shell(s, m, out)); return v; }
        case "IFCPOLYGONALFACESET": case "IFCTRIANGULATEDFACESET": case "IFCTRIANGULATEDIRREGULARNETWORK": return Math.abs(faceSet(id, m, out));
        case "IFCSWEPTDISKSOLID": case "IFCSWEPTDISKSOLIDPOLYGONAL": {
          const pts = curve(R(a[0])).map(p => xf(m, p[0], p[1], p[2]));
          return tube(pts, num(a[1]) * Math.cbrt(Math.abs(det3(m)) || 1), out);
        }
        case "IFCREVOLVEDAREASOLID": {
          const mm = R(a[1]) ? mul(m, axis2(R(a[1]))) : m;
          const ap = A(R(a[2]));
          return revolve(profile(R(a[0])), mm, { o: P3(R(ap[0])), d: R(ap[1]) ? DIR(R(ap[1])) : [0, 0, 1] }, num(a[3]) * AS, out);
        }
        case "IFCBLOCK": {
          const mm = mul(m, axis2(R(a[0]))); const x = num(a[1]), y = num(a[2]);
          return extrudeShapes([{ o: [[0, 0], [x, 0], [x, y], [0, y]], h: [] }], mm, [0, 0, 1], num(a[3]), out);
        }
        case "IFCRIGHTCIRCULARCYLINDER": {
          const mm = mul(m, axis2(R(a[0])));
          return extrudeShapes([{ o: circ(num(a[2])), h: [] }], mm, [0, 0, 1], num(a[1]), out);
        }
        case "IFCCSGSOLID": return item(R(a[0]), m, out, st, depth + 1);
        default: return 0;
      }
    }

    // ---- relaciones ----
    const storeyOf = new Map(), parentOf = new Map();
    for (const r of ids("IFCRELCONTAINEDINSPATIALSTRUCTURE")) { const a = A(r); const s = R(a[5]); for (const e of refs(a[4])) storeyOf.set(e, s); }
    for (const r of ids("IFCRELAGGREGATES")) { const a = A(r); const p = R(a[4]); for (const c of refs(a[5])) parentOf.set(c, p); }
    for (const r of ids("IFCRELNESTS")) { const a = A(r); const p = R(a[4]); for (const c of refs(a[5])) if (!parentOf.has(c)) parentOf.set(c, p); }
    const defsOf = new Map(), typeOf = new Map(), matOf = new Map();
    for (const r of ids("IFCRELDEFINESBYPROPERTIES")) {
      const a = A(r); const defs = refs(a[5]);
      for (const o of refs(a[4])) { let l = defsOf.get(o); if (!l) defsOf.set(o, l = []); l.push(...defs); }
    }
    for (const r of ids("IFCRELDEFINESBYTYPE")) { const a = A(r); for (const o of refs(a[4])) typeOf.set(o, R(a[5])); }
    for (const r of ids("IFCRELASSOCIATESMATERIAL")) { const a = A(r); for (const o of refs(a[4])) if (!matOf.has(o)) matOf.set(o, R(a[5])); }

    function storeyFor(id) {
      let x = id;
      for (let i = 0; i < 24; i++) {
        if (type(x) === "IFCBUILDINGSTOREY") return x;
        if (storeyOf.has(x)) x = storeyOf.get(x); else if (parentOf.has(x)) x = parentOf.get(x); else return 0;
      }
      return 0;
    }
    function matIds(id, depth = 0) {
      if (!id || depth > 6) return [];
      const ty = type(id), a = A(id);
      switch (ty) {
        case "IFCMATERIAL": return [id];
        case "IFCMATERIALLIST": return refs(a[0]).flatMap(x => matIds(x, depth + 1));
        case "IFCMATERIALLAYERSETUSAGE": case "IFCMATERIALPROFILESETUSAGE": case "IFCMATERIALPROFILESETUSAGETAPERING": return matIds(R(a[0]), depth + 1);
        case "IFCMATERIALLAYERSET": return refs(a[0]).flatMap(x => matIds(x, depth + 1));
        case "IFCMATERIALLAYER": case "IFCMATERIALLAYERWITHOFFSETS": return matIds(R(a[0]), depth + 1);
        case "IFCMATERIALPROFILESET": case "IFCMATERIALCONSTITUENTSET": return refs(a[2]).flatMap(x => matIds(x, depth + 1));
        case "IFCMATERIALPROFILE": case "IFCMATERIALPROFILEWITHOFFSETS": case "IFCMATERIALCONSTITUENT": return matIds(R(a[2]), depth + 1);
        default: return [];
      }
    }
    function materialsOf(el) {
      let m = matOf.get(el);
      if (!m && typeOf.has(el)) m = matOf.get(typeOf.get(el));
      return [...new Set(matIds(m))];
    }
    function quantityVolume(el) {
      let net = 0, gross = 0;
      for (const d of (defsOf.get(el) || [])) {
        if (type(d) !== "IFCELEMENTQUANTITY") continue;
        for (const q of refs(A(d)[5])) {
          if (type(q) !== "IFCQUANTITYVOLUME") continue;
          const qa = A(q), nm = String(qa[0] || "").toLowerCase(), v = num(qa[3]) * volUnit;
          if (nm.includes("net")) net = net || v; else if (nm.includes("gross") || nm.includes("bruto")) gross = gross || v; else gross = gross || v;
        }
      }
      return net || gross || 0;
    }

    // ---- niveles ----
    const storeys = ids("IFCBUILDINGSTOREY").map(id => {
      const a = A(id); const pm = placement(R(a[5]));
      const elev = a[9] != null ? num(a[9]) * LS : pm[14] * LS;
      return { id, name: a[2] || a[7] || "Nivel " + id, elev };
    }).sort((x, y) => x.elev - y.elev);

    // ---- elementos ----
    const cand = new Set();
    for (const k of storeyOf.keys()) cand.add(k);
    for (const k of parentOf.keys()) cand.add(k);
    const list = [...cand].filter(id => {
      const ty = type(id); if (!ty || EXCLUDE.has(ty) || ty.startsWith("IFCREL")) return false;
      const a = A(id); return R(a[6]) && R(a[5]);
    }).sort((x, y) => x - y);

    const raw = [];
    const seen = new Set();
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let n = 0; n < list.length; n++) {
      const id = list[n];
      if (n % 120 === 0) { prog("Generando geometría", n / list.length); await tick(); }
      const a = A(id);
      const ty = type(id);
      const pds = A(R(a[6]));
      const reps = refs(pds[2]);
      let rep = 0;
      for (const r of reps) { const ra = A(r); if (ra[1] === "Body") { rep = r; break; } }
      if (!rep) for (const r of reps) { const ra = A(r); if (ra[1] === "Facetation" || ra[1] === "Mesh") { rep = r; break; } }
      if (!rep) for (const r of reps) { const ra = A(r); if (!SKIP_REP.has(ra[1])) { rep = r; break; } }
      if (!rep) continue;
      const M = placement(R(a[5]));
      const out = [];
      const st = { color: null };
      let vol = 0;
      for (const it of refs(A(rep)[3])) {
        try { vol += item(it, M, out, st); } catch (err) { /* ítem no soportado: se omite */ }
      }
      if (!out.length) continue;
      for (let i = 0; i < out.length; i += 3) {
        const x = out[i], y = out[i + 1], z = out[i + 2];
        if (x < mn[0]) mn[0] = x; if (y < mn[1]) mn[1] = y; if (z < mn[2]) mn[2] = z;
        if (x > mx[0]) mx[0] = x; if (y > mx[1]) mx[1] = y; if (z > mx[2]) mx[2] = z;
      }
      let guid = String(a[0] || "E" + id);
      if (seen.has(guid)) guid = guid + "-" + id; seen.add(guid);
      const mats = materialsOf(id);
      let color = st.color;
      if (!color) for (const mi of mats) if (matColor.has(mi)) { color = matColor.get(mi); break; }
      const tId = typeOf.get(id);
      raw.push({
        id, guid, type: ty, cat: CATS[ty] || ty.replace(/^IFC/, "").replace(/STANDARDCASE$/, "").toLowerCase().replace(/^./, c => c.toUpperCase()),
        name: a[2] || "", objType: a[4] || "", tag: a[7] || "", storey: storeyFor(id),
        typeName: tId ? (A(tId)[2] || "") : "", material: mats.map(m => A(m)[0]).filter(Boolean).join(" · "),
        color, out, volGeo: vol * LS * LS * LS, volQto: quantityVolume(id)
      });
    }
    prog("Preparando modelo", 1); await tick();

    const center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const elements = raw.map(r => {
      const o = r.out, pos = new Float32Array(o.length);
      for (let i = 0; i < o.length; i += 3) {
        pos[i] = (o[i] - center[0]) * LS; pos[i + 1] = (o[i + 1] - center[1]) * LS; pos[i + 2] = (o[i + 2] - center[2]) * LS;
      }
      const e = Object.assign({}, r, { pos, vol: r.volQto || r.volGeo });
      delete e.out; return e;
    });
    const size = [(mx[0] - mn[0]) * LS, (mx[1] - mn[1]) * LS, (mx[2] - mn[2]) * LS];

    // ---- propiedades bajo demanda ----
    function fmt(v) {
      if (v == null) return "";
      if (v.tv) {
        if (v.tv === "IFCBOOLEAN" || v.tv === "IFCLOGICAL") return v.v && v.v.e === "T" ? "Sí" : v.v && v.v.e === "F" ? "No" : "—";
        return fmt(v.v);
      }
      if (v.e) return v.e === "T" ? "Sí" : v.e === "F" ? "No" : v.e;
      if (v.r) return "";
      if (Array.isArray(v)) return v.map(fmt).filter(Boolean).join(", ");
      if (typeof v === "number") return Number.isInteger(v) ? String(v) : (Math.round(v * 1000) / 1000).toLocaleString("es-EC");
      return String(v);
    }
    function psetRows(d) {
      const ty = type(d), a = A(d), rows = [];
      if (ty === "IFCPROPERTYSET") {
        for (const p of refs(a[4])) {
          const pt = type(p), pa = A(p);
          if (pt === "IFCPROPERTYSINGLEVALUE") rows.push([pa[0], fmt(pa[2])]);
          else if (pt === "IFCPROPERTYENUMERATEDVALUE" || pt === "IFCPROPERTYLISTVALUE") rows.push([pa[0], fmt(pa[2])]);
          else if (pt === "IFCPROPERTYBOUNDEDVALUE") rows.push([pa[0], fmt(pa[3]) + " – " + fmt(pa[2])]);
        }
      } else if (ty === "IFCELEMENTQUANTITY") {
        for (const q of refs(a[5])) {
          const qt = type(q), qa = A(q);
          const unit = qt === "IFCQUANTITYLENGTH" ? unitLabels.len : qt === "IFCQUANTITYAREA" ? unitLabels.area : qt === "IFCQUANTITYVOLUME" ? unitLabels.vol : qt === "IFCQUANTITYWEIGHT" ? "kg" : "";
          rows.push([qa[0], fmt(qa[3]) + (unit ? " " + unit : "")]);
        }
      }
      return rows.filter(r => r[0] && r[1] !== "");
    }
    function properties(el) {
      const groups = [];
      for (const d of (defsOf.get(el.id) || [])) {
        const rows = psetRows(d); if (rows.length) groups.push({ name: A(d)[2] || "Propiedades", rows });
      }
      const t = typeOf.get(el.id);
      if (t) for (const d of refs(A(t)[5])) { const rows = psetRows(d); if (rows.length) groups.push({ name: (A(d)[2] || "Propiedades") + " (tipo)", rows }); }
      return groups;
    }

    const hdr = text.slice(0, 2000);
    const schema = (hdr.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i) || [])[1] || "";
    const app = decodeStr((hdr.match(/FILE_NAME\s*\([^;]*?'[^']*'\s*,\s*'[^']*'\s*,\s*\([^)]*\)\s*,\s*\([^)]*\)\s*,\s*'([^']*)'/i) || [])[1] || "");
    return {
      project: { guid: projA[0] || "", name: projA[2] || projA[5] || "Proyecto" },
      schema, app, storeys, elements, size, entityCount: ents.size, properties, unitLabels
    };
  }

  return { load, _parseArgs: parseArgs, _decode: decodeStr };
})();
if (typeof module !== "undefined") module.exports = IfcReader;
