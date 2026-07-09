import { NextResponse } from "next/server";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { checkRateLimit } from "@/lib/protect";

/**
 * POST /api/ra/generic
 *
 * Builds a clean, unit-agnostic risk assessment draft as a properly laid-out
 * A4 landscape PDF (no form template required). Auto-fills the lookups;
 * leaves risk reasoning, controls and PPE to the student.
 */

type ChemicalProperties = {
  boilingPoint: string | null;
  flashPoint: string | null;
  meltingOrFreezingPoint: string | null;
  source: string;
};

type GhsSummary = {
  signalWord?: string | null;
  pictograms?: string[];
  hazardStatements?: string[];
};

type ChemRow = {
  name: string;
  quantity?: string | null;
  properties?: ChemicalProperties | null;
  ghs?: GhsSummary | null;
};

const A4L = { width: 841.89, height: 595.28 }; // A4 landscape, points
const MARGIN = 40;

const INK = rgb(0.09, 0.11, 0.16);
const MUTED = rgb(0.42, 0.45, 0.52);
const LINE = rgb(0.85, 0.86, 0.89);
const ACCENT = rgb(0.07, 0.09, 0.15);

function clean(v?: string | null) {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

/** Extract H-codes ("H225, H319") from full hazard statement strings. */
function hazardCodes(ghs?: GhsSummary | null): string {
  const codes = new Set<string>();
  for (const s of ghs?.hazardStatements ?? []) {
    const m = String(s).match(/H\d{3}/gi);
    if (m) m.forEach((c) => codes.add(c.toUpperCase()));
  }
  return Array.from(codes).join(", ");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = clean(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      // Hard-break single words that are too long
      if (font.widthOfTextAtSize(w, size) > maxWidth) {
        let chunk = "";
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) chunk += ch;
          else {
            lines.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      } else {
        line = w;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["—"];
}

export async function POST(req: Request) {
  const rl = checkRateLimit(req, { key: "pdf", limit: 12, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests — try again in ${rl.retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const chemicals: ChemRow[] = Array.isArray(body?.chemicals) ? body.chemicals : [];
    const operations: string[] = Array.isArray(body?.operationHazards)
      ? body.operationHazards.map((s: any) => String(s))
      : [];
    const unitCode = clean(body?.unitCode) || "";
    const experimentTitle = clean(body?.experimentTitle) || "";

    if (!chemicals.length) {
      return NextResponse.json({ error: "No chemicals provided" }, { status: 400 });
    }

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    /* ------------------------- table geometry ------------------------- */
    // Columns: Chemical | Qty | Melt/Freeze | Boiling | Flash | Signal | H-codes | Controls & PPE (student)
    const usable = A4L.width - MARGIN * 2;
    const colWidths = [
      usable * 0.16, // chemical
      usable * 0.1, // qty
      usable * 0.1, // melt
      usable * 0.1, // boil
      usable * 0.09, // flash
      usable * 0.08, // signal
      usable * 0.14, // h codes
      usable * 0.23, // controls (student)
    ];
    const headers = [
      "Chemical",
      "Quantity",
      "Melt/Freeze",
      "Boiling pt",
      "Flash pt",
      "GHS signal",
      "Hazard codes",
      "Controls & PPE (student to complete)",
    ];
    const cellFontSize = 8.5;
    const cellPad = 4;

    let page!: PDFPage;
    let y = 0;
    let pageNum = 0;

    const newPage = () => {
      pageNum += 1;
      page = pdf.addPage([A4L.width, A4L.height]);
      y = A4L.height - MARGIN;

      // Header band
      page.drawText("RISK ASSESSMENT — DRAFT", {
        x: MARGIN,
        y: y - 14,
        size: 16,
        font: bold,
        color: ACCENT,
      });
      const metaBits = [
        unitCode ? `Unit: ${unitCode}` : null,
        experimentTitle ? `Experiment: ${experimentTitle}` : null,
        `Generated: ${new Date().toLocaleDateString("en-AU")}`,
        `Page ${pageNum}`,
      ].filter(Boolean);
      page.drawText(metaBits.join("   •   "), {
        x: MARGIN,
        y: y - 30,
        size: 8.5,
        font,
        color: MUTED,
      });
      page.drawText("Name: ______________________    Student ID: ______________    Date: ____________", {
        x: A4L.width - MARGIN - 400,
        y: y - 14,
        size: 9,
        font,
        color: INK,
      });
      page.drawLine({
        start: { x: MARGIN, y: y - 40 },
        end: { x: A4L.width - MARGIN, y: y - 40 },
        thickness: 1.2,
        color: ACCENT,
      });
      y -= 54;
    };

    const drawTableHeader = () => {
      let x = MARGIN;
      const h = 20;
      page.drawRectangle({
        x: MARGIN,
        y: y - h,
        width: usable,
        height: h,
        color: rgb(0.95, 0.95, 0.96),
      });
      headers.forEach((label, i) => {
        page.drawText(label, {
          x: x + cellPad,
          y: y - h + 6,
          size: 8,
          font: bold,
          color: INK,
        });
        x += colWidths[i];
      });
      page.drawLine({
        start: { x: MARGIN, y: y - h },
        end: { x: A4L.width - MARGIN, y: y - h },
        thickness: 0.8,
        color: LINE,
      });
      y -= h;
    };

    newPage();
    drawTableHeader();

    /* --------------------------- chemical rows --------------------------- */
    for (const c of chemicals) {
      const cells = [
        clean(c.name) || "—",
        clean(c.quantity) || "—",
        clean(c.properties?.meltingOrFreezingPoint) || "—",
        clean(c.properties?.boilingPoint) || "—",
        clean(c.properties?.flashPoint) || "—",
        clean(c.ghs?.signalWord) || "—",
        hazardCodes(c.ghs) || "—",
        "", // student column stays blank
      ];

      const wrapped = cells.map((text, i) =>
        wrapText(text, font, cellFontSize, colWidths[i] - cellPad * 2)
      );
      const lineCount = Math.max(...wrapped.map((w) => w.length), 2);
      const rowH = lineCount * (cellFontSize + 2.5) + cellPad * 2;

      if (y - rowH < MARGIN + 20) {
        newPage();
        drawTableHeader();
      }

      let x = MARGIN;
      wrapped.forEach((lines, i) => {
        lines.forEach((ln, li) => {
          page.drawText(ln, {
            x: x + cellPad,
            y: y - cellPad - (li + 1) * (cellFontSize + 2.5) + 3,
            size: cellFontSize,
            font: i === 0 ? bold : font,
            color: cells[i] === "—" ? MUTED : INK,
          });
        });
        x += colWidths[i];
      });

      // row separator + column guides
      page.drawLine({
        start: { x: MARGIN, y: y - rowH },
        end: { x: A4L.width - MARGIN, y: y - rowH },
        thickness: 0.6,
        color: LINE,
      });
      let gx = MARGIN;
      for (let i = 0; i < colWidths.length - 1; i++) {
        gx += colWidths[i];
        page.drawLine({
          start: { x: gx, y },
          end: { x: gx, y: y - rowH },
          thickness: 0.4,
          color: LINE,
        });
      }

      y -= rowH;
    }

    /* ----------------------- operation hazards ----------------------- */
    const ensureSpace = (needed: number) => {
      if (y - needed < MARGIN + 20) newPage();
    };

    if (operations.length) {
      ensureSpace(60);
      y -= 22;
      page.drawText("Operation hazards (auto-suggested — student to justify controls)", {
        x: MARGIN,
        y,
        size: 11,
        font: bold,
        color: ACCENT,
      });
      y -= 6;
      for (const op of operations) {
        const lines = wrapText(`•  ${op}`, font, 9.5, usable - 10);
        ensureSpace(lines.length * 13 + 6);
        for (const ln of lines) {
          y -= 13;
          page.drawText(ln, { x: MARGIN + 4, y, size: 9.5, font, color: INK });
        }
      }
    }

    /* --------------------- student assessment section --------------------- */
    ensureSpace(150);
    y -= 26;
    page.drawText("Risk evaluation, additional controls and emergency procedures (student to complete)", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: ACCENT,
    });
    y -= 8;
    for (let i = 0; i < 6; i++) {
      ensureSpace(24);
      y -= 22;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: A4L.width - MARGIN, y },
        thickness: 0.6,
        color: LINE,
      });
    }

    ensureSpace(60);
    y -= 34;
    page.drawText(
      "Student signature: ____________________        Demonstrator / tutor approval: ____________________",
      { x: MARGIN, y, size: 10, font, color: INK }
    );

    /* ------------------------------ footer ------------------------------ */
    y -= 26;
    ensureSpace(30);
    page.drawText(
      "Auto-filled data sourced from PubChem. Verify all values against the supplier SDS before starting work. " +
        "This draft does not replace your own risk assessment.",
      { x: MARGIN, y, size: 8, font, color: MUTED }
    );

    const out = await pdf.save();

    return new NextResponse(Buffer.from(out), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Risk_Assessment_draft.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "RA export failed" }, { status: 500 });
  }
}
