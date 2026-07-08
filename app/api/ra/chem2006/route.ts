import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

type ChemicalProperties = {
  boilingPoint: string | null;
  flashPoint: string | null;
  meltingOrFreezingPoint: string | null;
  source: string;
};

type ConfirmedChem = {
  name: string;
  confirmedCid: number;
  quantity?: string | null;
  properties?: ChemicalProperties;
};

function clean(v?: string | null) {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const chemicals: ConfirmedChem[] = Array.isArray(body?.chemicals) ? body.chemicals : [];

    // only confirmed chems
    const confirmed = chemicals.filter((c) => c?.confirmedCid);

    // The CHEM2006 template has 12 rows (chem00..chem11). Anything beyond
    // that physically cannot fit — report it instead of silently dropping.
    const maxRows = 12;
    const omitted = confirmed.slice(maxRows).map((c) => c.name);

    const templatePath = path.join(process.cwd(), "public", "templates", "CHEM2006_Risk_Assessment_Form.pdf");
    const templateBytes = await fs.readFile(templatePath);

    const pdfDoc = await PDFDocument.load(templateBytes);

    // Embed font once, then tell pdf-lib to use it for form appearances
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const form = pdfDoc.getForm();
    form.updateFieldAppearances(font);

    // ===== Fill PHYSICAL PROPERTIES TABLE via FORM FIELDS =====
    // Form fields: chem00, quant00, melting00, boiling00, flash00, cleanup00 ... up to 11
    const setField = (fieldName: string, value: string) => {
      // Template mismatches shouldn't 500 the whole export — fill what exists.
      try {
        form.getTextField(fieldName).setText(value);
      } catch {
        console.warn(`PDF field missing in template: ${fieldName}`);
      }
    };

    confirmed.slice(0, maxRows).forEach((c, i) => {
      const id = pad2(i);

      const name = clean(c.name) || "—";
      const quantity = clean(c.quantity) || ""; // auto-filled from AI extraction
      const melt = clean(c.properties?.meltingOrFreezingPoint) || "—";
      const boil = clean(c.properties?.boilingPoint) || "—";
      const flash = clean(c.properties?.flashPoint) || "—";

      setField(`chem${id}`, name);
      setField(`quant${id}`, quantity);
      setField(`cleanup${id}`, ""); // left for students
      setField(`melting${id}`, melt);
      setField(`boiling${id}`, boil);
      setField(`flash${id}`, flash);
    });

    // Clear any unused rows so old template content doesn't show
    for (let i = Math.min(confirmed.length, maxRows); i < maxRows; i++) {
      const id = pad2(i);
      for (const prefix of ["chem", "quant", "melting", "boiling", "flash", "cleanup"]) {
        setField(`${prefix}${id}`, "");
      }
    }

    // OPTIONAL: Fill waste disposal box if you want (otherwise leave for students)
    // Example: aggregate a simple line per chemical, or just leave blank.
    // form.getTextField("waste-disposal").setText("");

    // IMPORTANT:
    // If you FLATTEN, the filled values become “printed” and fields stop being editable.
    // For CHEM2006 you probably want students to still edit many things, so keep flatten OFF.
    // form.flatten();

    const out = await pdfDoc.save();

    return new NextResponse(Buffer.from(out), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="CHEM2006_RA_autofill.pdf"`,
        // Client shows a warning when the 12-row template couldn't fit everything
        "X-Omitted-Chemicals": encodeURIComponent(omitted.join(", ")),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "RA export failed" }, { status: 500 });
  }
}
