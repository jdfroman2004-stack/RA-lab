import { NextResponse } from "next/server";

function extractFirstStringFromInformation(info: any[]): string | null {
  for (const item of info || []) {
    const val = item?.Value;

    // Common case: StringWithMarkup
    const swm = val?.StringWithMarkup;
    if (Array.isArray(swm)) {
      for (const s of swm) {
        const str = typeof s?.String === "string" ? s.String.trim() : "";
        if (str) return str;
      }
    }

    // Sometimes values appear as plain String
    if (typeof val?.String === "string" && val.String.trim()) {
      return val.String.trim();
    }

    // Sometimes numbers exist (rare here), keep as string
    if (typeof val?.Number === "number") {
      return String(val.Number);
    }
  }
  return null;
}

function findFirstValueByHeading(data: any, headingKeywords: string[]): string | null {
  const keywords = headingKeywords.map((k) => k.toLowerCase());

  const stack: any[] = [data];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    // PubChem PUG_VIEW commonly uses TOCHeading, not Heading
    const heading =
      (typeof node.TOCHeading === "string" ? node.TOCHeading : null) ??
      (typeof node.Heading === "string" ? node.Heading : null);

    if (heading) {
      const h = heading.toLowerCase();
      if (keywords.some((k) => h.includes(k))) {
        const found = extractFirstStringFromInformation(node.Information || []);
        if (found) return found;
      }
    }

    // Dive into nested structures
    for (const key of Object.keys(node)) {
      stack.push(node[key]);
    }
  }

  return null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cid = searchParams.get("cid");

  if (!cid) {
    return NextResponse.json({ error: "Missing CID" }, { status: 400 });
  }

  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${encodeURIComponent(
    cid
  )}/JSON/`;

  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch PubChem data" },
      { status: 500 }
    );
  }

  const data = await res.json();

  const boilingPoint = findFirstValueByHeading(data, [
    "boiling point",
    "normal boiling point",
  ]);

  const flashPoint = findFirstValueByHeading(data, ["flash point"]);

  const meltingOrFreezingPoint = findFirstValueByHeading(data, [
    "melting point",
    "freezing point",
  ]);

  return NextResponse.json({
    boilingPoint,
    flashPoint,
    meltingOrFreezingPoint,
    source: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
  });
}