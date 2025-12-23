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

function collectStringsFromValue(v: AnyObj): string[] {
  const out: string[] = [];

  // Common PubChem shapes:
  // Value.StringWithMarkup -> [{String: "..."}]
  // Value.String -> "..."
  // Value.Table -> ...
  if (!v || typeof v !== "object") return out;

  if (typeof v.String === "string") out.push(v.String);

  const swm = v.StringWithMarkup;
  if (Array.isArray(swm)) {
    for (const item of swm) {
      if (item?.String) out.push(String(item.String));
    }
  }

  // Sometimes values are nested
  for (const key of Object.keys(v)) {
    const child = v[key];
    if (child && typeof child === "object") {
      if (Array.isArray(child)) {
        for (const c of child) out.push(...collectStringsFromValue(c));
      } else {
        out.push(...collectStringsFromValue(child));
      }
    }
  }

  return out.filter(Boolean);
}

/**
 * We use "named pictograms" so the UI can render consistently.
 * PubChem text sometimes includes: "GHS02 Flame", "GHS06 Skull and crossbones", etc.
 */
function normalizePictogramName(raw: string): string | null {
  const s = raw.toLowerCase();

  if (s.includes("flame")) return "flame";
  if (s.includes("skull")) return "skull";
  if (s.includes("health hazard")) return "health_hazard";
  if (s.includes("exclamation")) return "exclamation";
  if (s.includes("environment")) return "environment";
  if (s.includes("corrosion")) return "corrosion";
  if (s.includes("gas cylinder")) return "gas_cylinder";
  if (s.includes("exploding bomb")) return "exploding_bomb";
  if (s.includes("oxidizer") || s.includes("flame over circle")) return "oxidizer";

  // also map by GHS codes if present
  if (s.includes("ghs02")) return "flame";
  if (s.includes("ghs06")) return "skull";
  if (s.includes("ghs08")) return "health_hazard";
  if (s.includes("ghs07")) return "exclamation";
  if (s.includes("ghs09")) return "environment";
  if (s.includes("ghs05")) return "corrosion";
  if (s.includes("ghs04")) return "gas_cylinder";
  if (s.includes("ghs01")) return "exploding_bomb";
  if (s.includes("ghs03")) return "oxidizer";

  return null;
}

// Simple “real-looking” diamonds (clean + professional).
// These are not the official UNECE symbol art, but they render reliably and clearly.
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

    if (!cid) {
      return NextResponse.json({ error: "Missing cid" }, { status: 400 });
    }

    // PubChem PUG View (JSON) for compound record
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
      return NextResponse.json(
        { error: "No Record in PUG View response" },
        { status: 502 }
      );
    }

    // Find "GHS Classification" section anywhere under Record.Section
    const ghsSection = findSectionByHeading(record, "GHS Classification");
    const info = Array.isArray(ghsSection?.Information)
      ? ghsSection.Information
      : [];

    // Extract signal word, hazard statements, pictograms
    let signalWord: string | null = null;
    const hazardStatements: string[] = [];
    const pictograms: string[] = [];

    for (const item of info) {
      const name = String(item?.Name || "").toLowerCase();
      const strings = collectStringsFromValue(item?.Value);

      if (name.includes("signal")) {
        // ex: "Danger" / "Warning"
        const sw = strings.find(Boolean);
        if (sw) signalWord = sw;
      }

      if (name.includes("hazard statement")) {
        for (const s of strings) {
          // keep lines like "H225: Highly flammable liquid and vapour"
          if (s && /H\d{3}/i.test(s)) hazardStatements.push(s);
        }
      }

      if (name.includes("pictogram")) {
        for (const s of strings) {
          const p = normalizePictogramName(s);
          if (p) pictograms.push(p);
        }
      }
    }

    // Deduplicate
    const uniqPictos = Array.from(new Set(pictograms));
    const uniqHaz = Array.from(new Set(hazardStatements));

    const pictogramSvgs: Record<string, string> = {};
    for (const p of uniqPictos) pictogramSvgs[p] = pictogramSvg(p);

    return NextResponse.json({
      cid,
      signalWord: signalWord || null,
      pictograms: uniqPictos,
      pictogramSvgs,
      hazardStatements: uniqHaz,
      source: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}#section=GHS-Classification`,
      _routeVersion: "ghs-live",
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "GHS failed" },
      { status: 500 }
    );
  }
}
