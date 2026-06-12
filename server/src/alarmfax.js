// Erzeugt ein Alarmfax als PDF (Buffer) im Stil eines Leitstellen-Alarmfaxes.
import PDFDocument from "pdfkit";

const pad2 = (n) => String(n).padStart(2, "0");

function fmtDateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} / ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function einsatzNummer(mission) {
  const d = mission.alarmiertAt ? new Date(mission.alarmiertAt) : new Date();
  const first = (mission.stichwort || "").trim().split(/[\s–-]+/)[0] || "E";
  const yy = String(d.getFullYear()).slice(2);
  return `${first} ${yy}${pad2(d.getMonth() + 1)}${pad2(d.getDate())} ${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function schlagwortCode(stichwort) {
  return (stichwort || "").trim().split(/[\s–-]+/)[0] || "";
}

// Adresse in Strasse (Einsatzort) und Ort (Ortsteil/Gemeinde) zerlegen
function parseAdresse(adresse) {
  const s = (adresse || "").trim();
  if (!s) return { strasse: "", ort: "" };
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const strasse = parts[0] || "";
  const ort = parts
    .slice(1)
    .join(", ")
    .replace(/^\d{4,5}\s*/, "") // PLZ am Anfang entfernen
    .replace(/,?\s*Deutschland$/i, "")
    .trim();
  return { strasse, ort };
}

export function buildAlarmfaxPdf(mission, vehicles, station) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 28 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const L = 28, R = 567, W = R - L;
      const black = "#000";
      const line = (x1, y1, x2, y2) => doc.lineWidth(0.8).moveTo(x1, y1).lineTo(x2, y2).stroke(black);
      const rect = (x, y, w, h) => doc.lineWidth(0.8).rect(x, y, w, h).stroke(black);

      let y = 28;

      // ===== Kopfzeile: Datum/Zeit | ENr. | Schlagwort-Code | Seite =====
      const hH = 30;
      rect(L, y, W, hH);
      const x1 = L + 150;
      const x2 = x1 + 150;
      const x3 = R - 110;
      line(x1, y, x1, y + hH);
      line(x2, y, x2, y + hH);
      line(x3, y, x3, y + hH);
      doc.font("Helvetica").fontSize(9).fillColor(black);
      doc.text(fmtDateTime(mission.alarmiertAt), L + 5, y + 11, { width: 140 });
      doc.text(`ENr.: ${einsatzNummer(mission)}`, x1 + 5, y + 11, { width: 140 });
      doc.font("Helvetica-Bold").fontSize(15).text(schlagwortCode(mission.stichwort), x2, y + 7, { width: x3 - x2, align: "center" });
      doc.font("Helvetica-Bold").fontSize(9).text("Seite 1 von 1", x3, y + 11, { width: R - x3 - 5, align: "center" });
      y += hH;

      // ===== Einsatzdaten-Block (Label | Wert | Einsatzplan) =====
      const { strasse, ort } = parseAdresse(mission.adresse);
      const rows = [
        ["Schlagwort:", mission.stichwort || ""],
        ["Ortsteil/Gemeinde:", ort],
        ["Einsatzort:", strasse],
        ["Abschnitt:", ""],
        ["Mitteiler/Tel.:", mission.mitteiler || ""],
        ["Objekt:", mission.objekt || ""],
      ];
      const rowH = 19;
      const blockH = rows.length * rowH;
      const valX = L + 120;
      const planX = R - 110;
      rect(L, y, W, blockH);
      line(valX, y, valX, y + blockH);
      line(planX, y, planX, y + blockH);
      rows.forEach((r, i) => {
        const ry = y + i * rowH;
        if (i > 0) line(L, ry, planX, ry);
        doc.font("Helvetica").fontSize(9).fillColor(black).text(r[0], L + 5, ry + 5, { width: 112 });
        doc.font("Helvetica-Bold").fontSize(10).text(r[1], valX + 6, ry + 5, { width: planX - valX - 10 });
      });
      doc.font("Helvetica").fontSize(9).text("Einsatzplan:", planX + 6, y + 6, { width: R - planX - 10 });
      y += blockH;

      // ===== Hinweise aus Freitext =====
      const hintText = mission.beschreibung || "";
      doc.font("Helvetica").fontSize(10);
      const innerW = W - 12;
      const textH = doc.heightOfString("Hinweise aus Freitext: " + (hintText || " "), { width: innerW });
      const hintH = Math.max(40, textH + 12);
      rect(L, y, W, hintH);
      doc.font("Helvetica-Bold").fontSize(10).fillColor(black).text("Hinweise aus Freitext: ", L + 6, y + 6, { width: innerW, continued: true });
      doc.font("Helvetica").fontSize(10).text(hintText, { width: innerW });
      y += hintH;

      // ===== Fahrzeuge: BF | FF | RettD, HiOrg =====
      const colW = W / 3;
      const cBF = L, cFF = L + colW, cRD = L + 2 * colW;
      const headH = 18;
      rect(L, y, W, headH);
      line(cFF, y, cFF, y + headH);
      line(cRD, y, cRD, y + headH);
      doc.font("Helvetica-Bold").fontSize(10).fillColor(black);
      doc.text("BF", cBF, y + 4, { width: colW, align: "center" });
      doc.text("FF", cFF, y + 4, { width: colW, align: "center" });
      doc.text("RettD, HiOrg", cRD, y + 4, { width: colW, align: "center" });
      y += headH;

      const dispo = (mission.vehicleIds || []).map((id) => vehicles.find((v) => v.id === id)).filter(Boolean);
      const eigene = dispo.filter((v) => !v.extern); // -> BF-Spalte
      const fremde = dispo.filter((v) => v.extern);  // -> FF-Spalte (nach Abteilung gruppiert)
      const wacheName = (station?.name || "").trim() || "Eigene Abteilung";

      // Fremde nach Abteilung gruppieren
      const fremdeGruppen = [];
      for (const v of fremde) {
        const name = (v.abteilung || "").trim() || "Fremde Abteilung";
        let g = fremdeGruppen.find((x) => x.name === name);
        if (!g) { g = { name, items: [] }; fremdeGruppen.push(g); }
        g.items.push(v);
      }

      const bfLines = 1 + eigene.length;
      const ffLines = fremdeGruppen.reduce((n, g) => n + 1 + g.items.length, 0);
      const contentH = Math.max(96, Math.max(bfLines, ffLines, 1) * 14 + 14);
      rect(L, y, W, contentH);
      line(cFF, y, cFF, y + contentH);
      line(cRD, y, cRD, y + contentH);

      // BF-Spalte: eigene Wache als Kopf, darunter die eigenen Fahrzeuge
      doc.font("Helvetica-Bold").fontSize(10).fillColor(black).text(wacheName, cBF + 6, y + 6, { width: colW - 12 });
      doc.font("Helvetica").fontSize(10);
      let by = y + 6 + 16;
      for (const v of eigene) {
        doc.text(v.funkrufname, cBF + 12, by, { width: colW - 18 });
        by += 14;
      }

      // FF-Spalte: fremde Abteilungen, je Abteilung ein Kopf mit ihren Fahrzeugen
      let fy = y + 6;
      for (const g of fremdeGruppen) {
        doc.font("Helvetica-Bold").fontSize(10).fillColor(black).text(g.name, cFF + 6, fy, { width: colW - 12 });
        fy += 15;
        doc.font("Helvetica").fontSize(10);
        for (const v of g.items) {
          doc.text(v.funkrufname, cFF + 12, fy, { width: colW - 18 });
          fy += 14;
        }
        fy += 2;
      }
      y += contentH;

      // Fuss
      doc.font("Helvetica").fontSize(7.5).fillColor("#666")
        .text(`Automatisch erzeugt am ${fmtDateTime(new Date().toISOString())} – FFW Alarmsystem`, L, y + 8, { width: W, align: "right" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
