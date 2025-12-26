import { NextResponse } from "next/server";

type AnyObj = Record<string, any>;

function findSectionByHeading(node: AnyObj, heading: string): AnyObj | null {
  if (!node || typeof node !== "object") return null;

  if (node.TOCHeading && String(node.TOCHeading).toLowerCase() === heading.toLowerCase()) {
    return node;
  }

  const kids = node.Section;
  if (Array.isArray(kids)) {
    for (const k of kids) {
      const found = findSectionByHeading(k, heading);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Collects all strings AND all Markup URLs from a Value blob.
 * PubChem often puts pictograms in Markup.URL rather than plain text.
 */
function collectStringsAndUrls(v: any): { strings: string[]; urls: string[] } {
  const strings: string[] = [];
  const urls: string[] = [];

  const walk = (x: any) => {
    if (!x || typeof x !== "object") return;

    if (typeof x.String === "string") strings.push(x.String);

    // Common PubChem shape: StringWithMarkup: [{ String, Markup: [{URL,...}] }]
    if (Array.isArray(x.StringWithMarkup)) {
      for (const item of x.StringWithMarkup) {
        if (item?.String) strings.push(String(item.String));
        if (Array.isArray(item?.Markup)) {
          for (const m of item.Markup) {
            if (m?.URL) urls.push(String(m.URL));
            if (m?.Href) urls.push(String(m.Href));
          }
        }
      }
    }

    // Some shapes have Markup directly
    if (Array.isArray(x.Markup)) {
      for (const m of x.Markup) {
        if (m?.URL) urls.push(String(m.URL));
        if (m?.Href) urls.push(String(m.Href));
      }
    }

    // recurse everything
    for (const key of Object.keys(x)) {
      const child = x[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === "object") walk(child);
    }
  };

  walk(v);

  // de-dupe
  return {
    strings: Array.from(new Set(strings.filter(Boolean))),
    urls: Array.from(new Set(urls.filter(Boolean))),
  };
}

/**
 * PubChem may give pictograms as:
 * - text names ("Flame", "Corrosion")
 * - GHS codes ("GHS02")
 * - URLs that contain GHS codes ("...GHS02..." or "...ghs02...")
 */
function normalizePictogramName(raw: string): string | null {
  const s = raw.toLowerCase();

  // map by text
  if (s.includes("flame over circle") || s.includes("oxidizer")) return "oxidizer";
  if (s.includes("exploding bomb")) return "exploding_bomb";
  if (s.includes("gas cylinder")) return "gas_cylinder";
  if (s.includes("corrosion")) return "corrosion";
  if (s.includes("environment")) return "environment";
  if (s.includes("exclamation")) return "exclamation";
  if (s.includes("health hazard")) return "health_hazard";
  if (s.includes("skull")) return "skull";
  if (s.includes("flame")) return "flame";

  // map by GHS codes
  if (s.includes("ghs01")) return "exploding_bomb";
  if (s.includes("ghs02")) return "flame";
  if (s.includes("ghs03")) return "oxidizer";
  if (s.includes("ghs04")) return "gas_cylinder";
  if (s.includes("ghs05")) return "corrosion";
  if (s.includes("ghs06")) return "skull";
  if (s.includes("ghs07")) return "exclamation";
  if (s.includes("ghs08")) return "health_hazard";
  if (s.includes("ghs09")) return "environment";

  return null;
}

// Professional “diamond” placeholders (not UNECE official artwork, but clear & consistent)
function pictogramSvg(name: string): string {
  const labelMap: Record<string, string> = {
    flame: "FLAME",
    skull: "TOX",
    health_hazard: "HEALTH",
    exclamation: "IRRIT",
    environment: "ENV",
    corrosion: "CORR",
    gas_cylinder: "GAS",
    exploding_bomb: "BOMB",
    oxidizer: "OX",
  };

  const label = labelMap[name] || name.toUpperCase();

  return `
<svg width="56" height="56" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${name}">
  <rect x="12" y="12" width="32" height="32" transform="rotate(45 28 28)" fill="white" stroke="#e11d48" stroke-width="3"/>
  <text x="28" y="33" text-anchor="middle" font-size="10" font-family="Arial" font-weight="700" fill="#0f172a">${label}</text>
</svg>`.trim();
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cid = (url.searchParams.get("cid") || "").trim();

    if (!cid) return NextResponse.json({ error: "Missing cid" }, { status: 400 });

    const pugViewUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${encodeURIComponent(
      cid
    )}/JSON`;

    const res = await fetch(pugViewUrl, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: "PubChem PUG View fetch failed", status: res.status },
        { status: 502 }
      );
    }

    const data = await res.json();
    const record = data?.Record;
    if (!record) {
      return NextResponse.json({ error: "No Record in PUG View response" }, { status: 502 });
    }

    // Find "GHS Classification" section
    const ghsSection = findSectionByHeading(record, "GHS Classification");
    const info = Array.isArray(ghsSection?.Information) ? ghsSection.Information : [];

    let signalWord: string | null = null;
    const hazardStatements: string[] = [];
    const pictograms: string[] = [];

    for (const item of info) {
      const name = String(item?.Name || "").toLowerCase();
      const { strings, urls } = collectStringsAndUrls(item?.Value);

      // Signal word
      if (name.includes("signal")) {
        const sw = strings.find(Boolean);
        if (sw) signalWord = sw;
      }

      // Hazard statements
      if (name.includes("hazard statement")) {
        for (const s of strings) {
          if (s && /H\d{3}/i.test(s)) hazardStatements.push(s);
        }
      }

      // Pictograms: extract from BOTH strings and URLs
      if (name.includes("pictogram")) {
        for (const s of strings) {
          const p = normalizePictogramName(s);
          if (p) pictograms.push(p);
        }
        for (const u of urls) {
          const p = normalizePictogramName(u);
          if (p) pictograms.push(p);
        }
      }

      // Extra safety: sometimes GHS codes appear in other value fields
      // (so we scan all strings/urls lightly)
      for (const s of strings) {
        const p = normalizePictogramName(s);
        if (p) pictograms.push(p);
      }
      for (const u of urls) {
        const p = normalizePictogramName(u);
        if (p) pictograms.push(p);
      }
    }

    const uniqPictos = Array.from(new Set(pictograms));
    const uniqHaz = Array.from(new Set(hazardStatements));

    const fileMap: Record<string, string> = {
  exploding_bomb: "exploding_bomb",
  gas_cylinder: "gas_cylinder",
  health_hazard: "health_hazard",
  flame: "flame",
  skull: "skull",
  environment: "environment",
  corrosion: "corrosion",
  oxidizer: "oxidizer",
  exclamation: "exclamation",
};


    const pictogramUrls: Record<string, string> = {};
for (const p of uniqPictos) {
  pictogramUrls[p] = `/ghs/${fileMap[p] ?? p}.svg`;


}

return NextResponse.json({
  cid: Number(cid),
  signalWord: signalWord || null,
  pictograms: uniqPictos,
  pictogramUrls,
  hazardStatements: uniqHaz,
  source: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}#section=GHS-Classification`,
  _routeVersion: "ghs-live-v3",
});


  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "GHS failed" }, { status: 500 });
  }
}
