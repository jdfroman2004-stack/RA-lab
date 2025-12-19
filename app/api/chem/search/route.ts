import { NextResponse } from "next/server";

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function score(query: string, title: string) {
  const q = norm(query);
  const t = norm(title);

  if (t === q) return 100;
  if (t.replace(/\s+/g, "") === q.replace(/\s+/g, "")) return 95; // methanol vs methyl alcohol style
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  return 10;
}

async function nameToCids(name: string): Promise<number[]> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(
    name
  )}/cids/JSON`;

  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const cids: number[] = json?.IdentifierList?.CID ?? [];
  return Array.isArray(cids) ? cids : [];
}

async function autocompleteTerms(q: string): Promise<string[]> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound/${encodeURIComponent(
    q
  )}/JSON?limit=8`;

  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const terms: string[] = json?.dictionary_terms?.compound ?? [];
  return Array.isArray(terms) ? terms : [];
}

async function cidsToTitles(cids: number[]) {
  if (!cids.length) return new Map<number, string>();

  // PubChem can handle comma-separated CIDs for property fetch
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cids.join(
    ","
  )}/property/Title/JSON`;

  const res = await fetch(url);
  if (!res.ok) return new Map<number, string>();

  const json = await res.json().catch(() => null);
  const props: { CID: number; Title: string }[] = json?.PropertyTable?.Properties ?? [];

  const map = new Map<number, string>();
  if (Array.isArray(props)) {
    for (const p of props) map.set(p.CID, p.Title);
  }
  return map;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });

  // 1) Best: direct name -> CIDs
  let cids = await nameToCids(q);

  // 2) Fallback: try autocomplete suggestions, then name->cid on those terms
  if (!cids.length) {
    const terms = await autocompleteTerms(q);
    for (const term of terms) {
      const alt = await nameToCids(term);
      cids.push(...alt);
    }
  }

  // Deduplicate, keep a reasonable cap
  cids = Array.from(new Set(cids)).slice(0, 30);

  if (!cids.length) return NextResponse.json({ results: [] });

  // Get titles (may return a subset; don't lose CIDs if title missing)
  const titleMap = await cidsToTitles(cids);

  const results = cids
    .map((cid) => {
      const title = titleMap.get(cid) ?? `CID ${cid}`;
      return { cid, title, score: score(q, title) };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ cid, title }) => ({ cid, title }));

  return NextResponse.json({ results });
}
