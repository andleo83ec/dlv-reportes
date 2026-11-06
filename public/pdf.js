// Genera el PDF del reporte diario en formato DLV-FOR-RDO-01 (2 hojas A4).
// window.pdfDLV(obra, reporte, fotos, acumFn) -> jsPDF
//   fotos: [{data: "data:image/jpeg;base64,...", w, h} | null] en el mismo orden que reporte.fotos
//   acumFn(actividad) -> acumulado del rubro hasta este reporte
(function () {
  "use strict";
  const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const fmtF = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
  const diaSemana = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-").map(Number); return DIAS[new Date(y, m - 1, d).getDay()]; };
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const totPer = (a) => (a || []).reduce((t, p) => ({ n: t.n + num(p.n), h: t.h + num(p.h) }), { n: 0, h: 0 });

  function diasInfo(o, fecha) {
    if (!o || !o.inicio || !fecha) return { trans: "", rest: "", fin: "" };
    const a = new Date(String(o.inicio).slice(0, 10) + "T00:00:00"), b = new Date(String(fecha).slice(0, 10) + "T00:00:00");
    const trans = Math.round((b - a) / 864e5) + 1, plazo = num(o.plazo);
    const fin = plazo ? new Date(a.getTime() + (plazo - 1) * 864e5) : null;
    const finS = fin ? fin.getFullYear() + "-" + String(fin.getMonth() + 1).padStart(2, "0") + "-" + String(fin.getDate()).padStart(2, "0") : "";
    return { trans, rest: plazo ? plazo - trans : "", fin: finS };
  }
  window.diasInfoDLV = diasInfo;

  window.pdfDLV = function (o, d, fotosData, acumFn) {
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    const M = 12, CW = 186, NAVY = [29, 53, 87], BAR = [74, 79, 87], LBL = [236, 235, 227], SUB = [217, 222, 230], GRID = [140, 140, 140], AMB = [232, 163, 23], OKC = [223, 240, 223];
    const FS = 6.4, RH = 3.65;
    const fit = (t, w) => { t = String(t ?? ""); if (doc.getTextWidth(t) <= w) return t; while (t.length && doc.getTextWidth(t + "…") > w) t = t.slice(0, -1); return t + "…"; };

    function tbl(y, widths, rows, opt = {}) {
      const tot = widths.reduce((a, b) => a + b, 0), ws = widths.map((w) => (w * CW) / tot), rh = opt.rh || RH;
      doc.setDrawColor(...GRID); doc.setLineWidth(0.15);
      for (const row of rows) {
        let x = M;
        for (let c = 0; c < row.length; c++) {
          let cell = row[c]; if (cell === null) continue;
          if (typeof cell !== "object") cell = { t: cell };
          const span = cell.span || 1; let w = 0; for (let k = 0; k < span; k++) w += ws[c + k];
          if (cell.fill) { doc.setFillColor(...cell.fill); doc.rect(x, y, w, rh, "F"); }
          doc.rect(x, y, w, rh);
          doc.setFont("helvetica", cell.b ? "bold" : "normal"); doc.setFontSize(cell.fs || FS); doc.setTextColor(20, 20, 20);
          const t = fit(cell.t, w - 1.4);
          if (cell.al === "c") doc.text(t, x + w / 2, y + rh - 1.05, { align: "center" });
          else if (cell.al === "r") doc.text(t, x + w - 0.7, y + rh - 1.05, { align: "right" });
          else doc.text(t, x + 0.7, y + rh - 1.05);
          x += w; c += span - 1;
        }
        y += rh;
      }
      return y;
    }
    function bar(y, t, sub) {
      const h = sub ? 3.3 : 3.9;
      doc.setFillColor(...(sub ? SUB : BAR)); doc.rect(M, y, CW, h, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(...(sub ? NAVY : [255, 255, 255]));
      doc.text(t, M + 1, y + (sub ? 2.4 : 2.8)); return y + h;
    }
    const L = (t) => ({ t, b: true, fill: LBL });
    const H = (t) => ({ t, b: true, fill: LBL, al: "c", fs: 5.9 });

    function header(pg) {
      const top = M, hh = 20, lw = 46, rw = 44;
      doc.setDrawColor(...GRID); doc.setLineWidth(0.2); doc.rect(M, top, CW, hh);
      doc.line(M + lw, top, M + lw, top + hh); doc.line(M + CW - rw, top, M + CW - rw, top + hh);
      doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("DLV", M + 5, top + 11);
      doc.setFillColor(...AMB); doc.rect(M + 5, top + 12.3, 17, 1.1, "F");
      doc.setFontSize(6.6); doc.text("CONSTRUCCIONES CÍA. LTDA.", M + 5, top + 16.2);
      doc.setFont("helvetica", "normal"); doc.setFontSize(5.6); doc.setTextColor(85, 85, 85); doc.text("Cuenca - Ecuador", M + 5, top + 18.6);
      const cx = M + lw + (CW - lw - rw) / 2;
      doc.setTextColor(...NAVY); doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("REPORTE DIARIO DE OBRA", cx, top + 9.5, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85, 85, 85);
      doc.text(pg === 1 ? "Hoja 1 de 2 · Datos y avance" : "Hoja 2 de 2 · Panel fotográfico", cx, top + 14, { align: "center" });
      const x = M + CW - rw, rh = hh / 3;
      [["CÓDIGO DE FORMATO", "DLV-FOR-RDO-01"], ["REVISIÓN", "Rev. 01 · nov-2026"], ["REPORTE N.°", "RDO-" + String(d.numero).padStart(4, "0")]].forEach(([k, v], i) => {
        const yy = top + rh * i; if (i) doc.line(x, yy, M + CW, yy);
        doc.setFont("helvetica", "normal"); doc.setFontSize(5.4); doc.setTextColor(85, 85, 85); doc.text(k, x + 1, yy + 2.4);
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(...NAVY); doc.text(v, x + 1, yy + 5.6);
      });
      return tbl(top + hh + 1.5, [21, 35, 22, 22, 11, 19], [
        [L("OBRA:"), o.nombre || "", L("FECHA:"), fmtF(d.fecha), L("DÍA:"), diaSemana(d.fecha)],
        [L("CLIENTE / PROPIETARIO:"), o.cliente || "", L("CONTRATO / PROFORMA:"), o.contrato || "", L("TURNO:"), d.turno || ""],
        [L("RESIDENTE DE OBRA:"), o.residente || "", L("FISCALIZADOR:"), o.fiscalizador || "", L("UBICACIÓN:"), o.ubicacion || ""],
      ]);
    }
    function firmas(y) {
      y += 2.5; const gap = 6, w = (CW - 2 * gap) / 3, h = 14;
      [["RESIDENTE DE OBRA - DLV", o.residente], ["FISCALIZACIÓN", o.fiscalizador], ["GERENTE DE PROYECTO - DLV", o.gerente]].forEach(([t, n], i) => {
        const x = M + i * (w + gap);
        doc.setFillColor(...NAVY); doc.rect(x, y, w, 3.2, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(6.2); doc.setTextColor(255, 255, 255); doc.text(t, x + w / 2, y + 2.3, { align: "center" });
        doc.setDrawColor(...GRID); doc.rect(x, y + 3.2, w, h);
        doc.setFont("helvetica", "normal"); doc.setFontSize(6); doc.setTextColor(60, 60, 60);
        doc.text(fit(n || "Nombre / firma", w - 22), x + 1, y + 3.2 + h - 1.2);
        doc.text("___/___/______", x + w - 1, y + 3.2 + h - 1.2, { align: "right" });
      });
      return y + 3.2 + h;
    }
    function footer(p) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(5.4); doc.setTextColor(120, 120, 120);
      doc.text("DLV Construcciones Cía. Ltda. · Av. Primero de Mayo y Av. de las Américas, Cuenca", M, 290);
      doc.text("Página " + p + " de 2", M + CW, 290, { align: "right" });
    }

    /* ---- Hoja 1 ---- */
    const di = diasInfo(o, d.fecha), cl = d.clima || {};
    let y = header(1) + 1.5;
    y = tbl(y, [1, 1, 1, 1, 1, 1], [
      [H("PLAZO CONTRACTUAL (días)"), H("INICIO CONTRACTUAL"), H("TÉRMINO CONTRACTUAL"), H("DÍAS TRANSCURRIDOS"), H("DÍAS RESTANTES"), H("% AVANCE FÍSICO ACUM.")],
      [{ t: o.plazo || "", al: "c", b: true }, { t: fmtF(o.inicio), al: "c", b: true }, { t: fmtF(di.fin), al: "c", b: true }, { t: di.trans, al: "c", b: true }, { t: di.rest, al: "c", b: true, fill: OKC }, { t: d.avance ? d.avance + " %" : "", al: "c", b: true }],
    ]);
    y += 2; y = bar(y, "1. CONDICIONES CLIMÁTICAS");
    y = tbl(y, [22, 18, 18, 13, 29], [
      [H(""), H("MAÑANA"), H("TARDE"), H("HORAS PARALIZADAS"), H("OBSERVACIONES")],
      ["Condición", { t: cl.manana || "", al: "c" }, { t: cl.tarde || "", al: "c" }, { t: cl.horasPar || "", al: "c" }, cl.obs || ""],
    ]);

    y += 2; y = bar(y, "2. RECURSOS"); y = bar(y, "2.1 EQUIPOS", true);
    const eq = d.equipos || [], liv = eq.filter((e) => e.tipo === "liviano"), pes = eq.filter((e) => e.tipo === "pesado");
    const nE = Math.max(6, liv.length, pes.length);
    const eqRows = [
      [{ t: "EQUIPOS LIVIANOS", b: true, fill: LBL, al: "c", span: 5 }, null, null, null, null, { t: "EQUIPOS PESADOS", b: true, fill: LBL, al: "c", span: 4 }, null, null, null],
      [H("N.°"), H("EQUIPO"), H("ESTADO"), H("HORAS"), H("CANT."), H("N.°"), H("EQUIPO"), H("ESTADO"), H("HORAS")],
    ];
    for (let i = 0; i < nE; i++) { const a = liv[i] || {}, b = pes[i] || {}; eqRows.push([{ t: i + 1, al: "c" }, a.equipo || "", a.equipo ? a.estado : "", { t: a.horas || "", al: "c" }, { t: a.cant || "", al: "c" }, { t: i + 1, al: "c" }, b.equipo || "", b.equipo ? b.estado : "", { t: b.horas || "", al: "c" }]); }
    y = tbl(y, [4, 22, 10, 7, 6, 4, 26, 10, 7], eqRows);

    y = bar(y, "2.2 MANO DE OBRA", true);
    const dir = d.directa || [], ind = d.indirecta || [], nP = Math.max(6, dir.length, ind.length), td = totPer(dir), ti = totPer(ind);
    const pRows = [
      [{ t: "DIRECTA (DLV)", b: true, fill: LBL, al: "c", span: 4 }, null, null, null, { t: "INDIRECTA / SUBCONTRATOS", b: true, fill: LBL, al: "c", span: 4 }, null, null, null],
      [H("N.°"), H("CATEGORÍA"), H("N.° PERS."), H("HORAS"), H("N.°"), H("CATEGORÍA"), H("N.° PERS."), H("HORAS")],
    ];
    for (let i = 0; i < nP; i++) { const a = dir[i] || {}, b = ind[i] || {}; pRows.push([{ t: i + 1, al: "c" }, a.cat || "", { t: a.n || "", al: "c" }, { t: a.h || "", al: "c" }, { t: i + 1, al: "c" }, b.cat || "", { t: b.n || "", al: "c" }, { t: b.h || "", al: "c" }]); }
    pRows.push([{ t: "", fill: LBL }, { t: "TOTAL PERSONAL DIRECTO", b: true, fill: LBL }, { t: td.n, b: true, fill: LBL, al: "c" }, { t: td.h || "", b: true, fill: LBL, al: "c" }, { t: "", fill: LBL }, { t: "TOTAL INDIRECTO", b: true, fill: LBL }, { t: ti.n, b: true, fill: LBL, al: "c" }, { t: ti.h || "", b: true, fill: LBL, al: "c" }]);
    y = tbl(y, [4, 30, 8, 8, 4, 30, 8, 8], pRows);

    y += 2; y = bar(y, "3. ACTIVIDADES EJECUTADAS (código y nombre de rubro según presupuesto)");
    const acts = (d.actividades || []).filter((a) => a.desc || a.cod), nA = Math.max(10, acts.length);
    const aRows = [[H("CÓD."), H("RUBRO / DESCRIPCIÓN"), H("UBICACIÓN (piso, eje)"), H("UND"), H("CANT. DÍA"), H("ACUMULADO")]];
    for (let i = 0; i < nA; i++) { const a = acts[i]; aRows.push(a ? [a.cod || "", a.desc || "", a.ubic || "", { t: a.und || "", al: "c" }, { t: a.cant || "", al: "r" }, { t: r2(acumFn(a)), al: "r" }] : ["", "", "", "", "", ""]); }
    y = tbl(y, [7, 48, 22, 6, 9, 10], aRows);

    y += 2; y = bar(y, "4. MATERIALES RECIBIDOS");
    const mats = d.materiales || [], nM = Math.max(3, mats.length);
    const mRows = [[H("MATERIAL"), H("PROVEEDOR"), H("GUÍA / FACTURA"), H("UND"), H("CANT."), H("CONFORME")]];
    for (let i = 0; i < nM; i++) { const x = mats[i]; mRows.push(x ? [x.material || "", x.proveedor || "", x.guia || "", { t: x.und || "", al: "c" }, { t: x.cant || "", al: "r" }, { t: x.conforme || "", al: "c" }] : ["", "", "", "", "", ""]); }
    y = tbl(y, [30, 22, 16, 6, 8, 14], mRows);

    y += 2; y = bar(y, "5. SEGURIDAD Y CONTROL DE CALIDAD");
    const s = d.sso || {}, ck = (k) => (s[k] ? "[X]" : "[  ]"), en = d.ensayos || {};
    y = tbl(y, [62, 10, 28], [
      [`${ck("charla")} Charla 5 min${s.tema ? " (" + s.tema + ")" : ""}   ${ck("epp")} EPP completo   ${ck("arnes")} Arnés en altura   ${ck("bordes")} Bordes protegidos   ${ck("andamios")} Andamios`, L("INCIDENTES:"), s.incidentes || "Ninguno"],
      [{ t: `ENSAYOS: asentamiento ${en.slump || "____"} cm · cilindros N.° ${en.cilindros || "____"} · f'c ${en.fc || "____"} kg/cm2 · otros: ${en.otros || "____"}`, span: 3 }, null, null],
    ]);

    y += 2; y = bar(y, "6. NOVEDADES E INSTRUCCIONES DE FISCALIZACIÓN (retrasos, órdenes de cambio, pendientes)");
    const novs = (d.novedades || []).filter(Boolean), nN = Math.max(3, novs.length), nRows = [];
    for (let i = 0; i < nN; i++) nRows.push([{ t: i + 1, al: "c" }, novs[i] || ""]);
    y = tbl(y, [3, 97], nRows, { rh: 4.3 });
    firmas(y); footer(1);

    /* ---- Hoja 2 ---- */
    doc.addPage();
    y = header(2) + 1.5; y = bar(y, "7. PANEL FOTOGRÁFICO"); y += 1.5;
    const gap = 4, w = (CW - gap) / 2, cap = 3.6, firmH = 3.2 + 14 + 2.5;
    const ph = (290 - 4 - firmH - y - 2 * gap) / 3 - cap;
    const fotos = d.fotos || [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const n = r * 2 + c, x = M + c * (w + gap), top = y + r * (ph + cap + gap);
      doc.setDrawColor(...GRID); doc.setLineWidth(0.15); doc.rect(x, top, w, ph);
      const im = fotosData[n];
      if (im) { const k = Math.min((w - 2) / im.w, (ph - 2) / im.h), iw = im.w * k, ih = im.h * k; doc.addImage(im.data, "JPEG", x + (w - iw) / 2, top + (ph - ih) / 2, iw, ih); }
      else { doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(180, 180, 180); doc.text("FOTO " + (n + 1), x + w / 2, top + ph / 2, { align: "center" }); }
      doc.rect(x, top + ph, w, cap);
      const f = fotos[n] || {}; doc.setFontSize(5.8); doc.setTextColor(60, 60, 60);
      doc.text(fit(n + 1 + ". " + (f.desc || "Descripción:"), w * 0.6 - 2), x + 1, top + ph + 2.6);
      doc.text(fit(f.ubic ? "Ubicación: " + f.ubic : "Ubicación:", w * 0.4 - 2), x + w * 0.6, top + ph + 2.6);
    }
    firmas(y + 3 * (ph + cap) + 2 * gap); footer(2);
    return doc;
  };
})();
