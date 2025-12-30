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

    const templatePath = path.join(process.cwd(), "public", "templates", "CHEM2006_Risk_Assessment_Form.pdf");
    const templateBytes = await fs.readFile(templatePath);

    const pdfDoc = await PDFDocument.load(templateBytes);

    // Embed font once, then tell pdf-lib to use it for form appearances
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const form = pdfDoc.getForm();
    form.updateFieldAppearances(font);

    // ===== Fill PHYSICAL PROPERTIES TABLE via FORM FIELDS =====
    // Your form uses: chem00, quant00, melting00, boiling00, flash00, cleanup00 ... up to 11
    const maxRows = 12; // you have 00..11
    confirmed.slice(0, maxRows).forEach((c, i) => {
      const id = pad2(i);

      const name = clean(c.name) || "—";
      const melt = clean(c.properties?.meltingOrFreezingPoint) || "—";
      const boil = clean(c.properties?.boilingPoint) || "—";
      const flash = clean(c.properties?.flashPoint) || "—";

      // These will throw if the field doesn't exist, so keep it clean + direct
      form.getTextField(`chem${id}`).setText(name);

      // leave quantity + cleanup for students (blank)
      form.getTextField(`quant${id}`).setText("");
      form.getTextField(`cleanup${id}`).setText("");

      form.getTextField(`melting${id}`).setText(melt);
      form.getTextField(`boiling${id}`).setText(boil);
      form.getTextField(`flash${id}`).setText(flash);
    });

    // Clear any unused rows so old template content doesn’t show
    for (let i = confirmed.length; i < maxRows; i++) {
      const id = pad2(i);
      try { form.getTextField(`chem${id}`).setText(""); } catch {}
      try { form.getTextField(`quant${id}`).setText(""); } catch {}
      try { form.getTextField(`melting${id}`).setText(""); } catch {}
      try { form.getTextField(`boiling${id}`).setText(""); } catch {}
      try { form.getTextField(`flash${id}`).setText(""); } catch {}
      try { form.getTextField(`cleanup${id}`).setText(""); } catch {}
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
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "RA export failed" }, { status: 500 });
  }
}
