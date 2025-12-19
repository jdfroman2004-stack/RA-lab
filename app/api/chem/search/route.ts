import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(
    query
  )}/cids/JSON?name_type=word`;

  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ results: [] });
  }

  const data = await res.json();
  const cids = data?.IdentifierList?.CID ?? [];

  return NextResponse.json({
    results: cids.slice(0, 5).map((cid: number) => ({ cid })),
  });
}
