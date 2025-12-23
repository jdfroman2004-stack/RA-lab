import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();

    if (!q) return NextResponse.json({ matches: [] });

    // Name -> CIDs
    const cidRes = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(
        q
      )}/cids/JSON`,
      { cache: "no-store" }
    );

    if (!cidRes.ok) {
      return NextResponse.json({ matches: [] });
    }

    const cidJson = await cidRes.json();
    const cids: number[] = cidJson?.IdentifierList?.CID || [];
    const top = cids.slice(0, 12);

    if (top.length === 0) return NextResponse.json({ matches: [] });

    // CIDs -> Titles
    const titleRes = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${top.join(
        ","
      )}/property/Title/JSON`,
      { cache: "no-store" }
    );

    let titleByCid: Record<number, string> = {};
    if (titleRes.ok) {
      const titleJson = await titleRes.json();
      const props = titleJson?.PropertyTable?.Properties || [];
      for (const p of props) {
        if (p?.CID && p?.Title) titleByCid[p.CID] = p.Title;
      }
    }

    const matches = top.map((cid) => ({
      cid,
      title: titleByCid[cid] || `CID ${cid}`,
    }));

    return NextResponse.json({ matches });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "search failed" },
      { status: 500 }
    );
  }
}
