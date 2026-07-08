import { NextResponse } from "next/server";
import { getProperties } from "@/lib/pubchem";

/**
 * GET /api/chem/properties?cid=702
 * Kept for backwards compatibility — the wizard now prefers /api/chem/summary.
 * Uses heading-filtered PUG View requests instead of downloading the full
 * compound record, which is dramatically faster.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cid = searchParams.get("cid");

  if (!cid) {
    return NextResponse.json({ error: "Missing CID" }, { status: 400 });
  }

  try {
    const props = await getProperties(cid);
    return NextResponse.json(props);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to fetch PubChem data" },
      { status: 500 }
    );
  }
}
