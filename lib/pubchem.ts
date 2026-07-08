/**
 * Shared PubChem PUG View helpers.
 *
 * Key performance idea: PUG View supports ?heading= filtering, so instead of
 * downloading the ENTIRE compound record (often multiple MB) we request only
 * the sections we need. Responses are also cached by Next for 7 days —
 * physical properties and GHS classifications of a given CID don't change.
 */

type AnyObj = Record<string, any>;

const REVALIDATE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function fetchPugViewHeading(
  cid: string | number,
  heading: string
): Promise<AnyObj | null> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${encodeURIComponent(
    String(cid)
  )}/JSON?heading=${encodeURIComponent(heading)}`;

  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return null; // PubChem 404s when a compound lacks that section
    return await res.json();
  } catch {
    return null;
  }
}

/* ------------------------- generic value extraction ------------------------- */

export function extractFirstStringFromInformation(info: any[]): string | null {
  for (const item of info || []) {
    const val = item?.Value;

    const swm = val?.StringWithMarkup;
    if (Array.isArray(swm)) {
      for (const s of swm) {
        const str = typeof s?.String === "string" ? s.String.trim() : "";
        if (str) return str;
      }
    }

    if (typeof val?.String === "string" && val.String.trim()) {
      return val.String.trim();
    }

    if (typeof val?.Number === "number") {
      return String(val.Number);
    }
    if (Array.isArray(val?.Number) && typeof val.Number[0] === "number") {
      const unit = typeof val?.Unit === "string" ? ` ${val.Unit}` : "";
      return `${val.Number[0]}${unit}`;
    }
  }
  return null;
}

export function findFirstValueByHeading(
  data: AnyObj,
  headingKeywords: string[]
): string | null {
  const keywords = headingKeywords.map((k) => k.toLowerCase());

  const stack: any[] = [data];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

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

    for (const key of Object.keys(node)) {
      stack.push(node[key]);
    }
  }

  return null;
}

/**
 * Fetch a single physical property. Tries each heading in order and returns
 * the first value found (e.g. ["Melting Point", "Freezing Point"]).
 */
export async function getPropertyValue(
  cid: string | number,
  headings: string[]
): Promise<string | null> {
  for (const heading of headings) {
    const data = await fetchPugViewHeading(cid, heading);
    if (!data) continue;
    const value = findFirstValueByHeading(data, [heading.toLowerCase()]);
    if (value) return value;
  }
  return null;
}

/* --------------------------------- GHS --------------------------------- */

function collectStringsAndUrls(v: any): { strings: string[]; urls: string[] } {
  const strings: string[] = [];
  const urls: string[] = [];

  const walk = (x: any) => {
    if (!x || typeof x !== "object") return;

    if (typeof x.String === "string") strings.push(x.String);

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

    if (Array.isArray(x.Markup)) {
      for (const m of x.Markup) {
        if (m?.URL) urls.push(String(m.URL));
        if (m?.Href) urls.push(String(m.Href));
      }
    }

    for (const key of Object.keys(x)) {
      const child = x[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === "object") walk(child);
    }
  };

  walk(v);

  return {
    strings: Array.from(new Set(strings.filter(Boolean))),
    urls: Array.from(new Set(urls.filter(Boolean))),
  };
}

function normalizePictogramName(raw: string): string | null {
  const s = raw.toLowerCase();

  if (s.includes("flame over circle") || s.includes("oxidizer")) return "oxidizer";
  if (s.includes("exploding bomb")) return "exploding_bomb";
  if (s.includes("gas cylinder")) return "gas_cylinder";
  if (s.includes("corrosion")) return "corrosion";
  if (s.includes("environment")) return "environment";
  if (s.includes("exclamation")) return "exclamation";
  if (s.includes("health hazard")) return "health_hazard";
  if (s.includes("skull")) return "skull";
  if (s.includes("flame")) return "flame";

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

export type GhsResult = {
  cid: number;
  signalWord: string | null;
  pictograms: string[];
  pictogramUrls: Record<string, string>;
  hazardStatements: string[];
  source: string;
};

function findSectionByHeading(node: AnyObj, heading: string): AnyObj | null {
  if (!node || typeof node !== "object") return null;

  if (
    node.TOCHeading &&
    String(node.TOCHeading).toLowerCase() === heading.toLowerCase()
  ) {
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

export async function getGhsClassification(
  cid: string | number
): Promise<GhsResult | null> {
  const data = await fetchPugViewHeading(cid, "GHS Classification");
  const record = data?.Record;
  if (!record) return null;

  const ghsSection = findSectionByHeading(record, "GHS Classification") ?? record;
  const info = Array.isArray(ghsSection?.Information) ? ghsSection.Information : [];

  let signalWord: string | null = null;
  const hazardStatements: string[] = [];
  const pictograms: string[] = [];

  const scanForPictos = (strings: string[], urls: string[]) => {
    for (const s of strings) {
      const p = normalizePictogramName(s);
      if (p) pictograms.push(p);
    }
    for (const u of urls) {
      const p = normalizePictogramName(u);
      if (p) pictograms.push(p);
    }
  };

  for (const item of info) {
    const name = String(item?.Name || "").toLowerCase();
    const { strings, urls } = collectStringsAndUrls(item?.Value);

    if (name.includes("signal")) {
      const sw = strings.find(Boolean);
      if (sw) signalWord = sw;
    }

    if (name.includes("hazard statement")) {
      for (const s of strings) {
        if (s && /H\d{3}/i.test(s)) hazardStatements.push(s);
      }
    }

    if (name.includes("pictogram")) {
      scanForPictos(strings, urls);
    }

    // GHS codes occasionally appear in other value fields
    scanForPictos(strings, urls);
  }

  const uniqPictos = Array.from(new Set(pictograms));
  const pictogramUrls: Record<string, string> = {};
  for (const p of uniqPictos) {
    pictogramUrls[p] = `/ghs/${p}.svg`;
  }

  return {
    cid: Number(cid),
    signalWord: signalWord || null,
    pictograms: uniqPictos,
    pictogramUrls,
    hazardStatements: Array.from(new Set(hazardStatements)),
    source: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}#section=GHS-Classification`,
  };
}

/* ------------------------------ properties ------------------------------ */

export type PropertiesResult = {
  boilingPoint: string | null;
  flashPoint: string | null;
  meltingOrFreezingPoint: string | null;
  source: string;
};

export async function getProperties(
  cid: string | number
): Promise<PropertiesResult> {
  const [boilingPoint, flashPoint, meltingOrFreezingPoint] = await Promise.all([
    getPropertyValue(cid, ["Boiling Point"]),
    getPropertyValue(cid, ["Flash Point"]),
    getPropertyValue(cid, ["Melting Point", "Freezing Point"]),
  ]);

  return {
    boilingPoint,
    flashPoint,
    meltingOrFreezingPoint,
    source: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
  };
}
