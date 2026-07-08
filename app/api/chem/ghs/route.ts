import { NextResponse } from "next/server";
import { getGhsClassification } from "@/lib/pubchem";

/**
 * GET /api/chem/ghs?cid=702
 * Kept for backwards compatibility — the wizard now prefers /api/chem/summary.
 * Fetches only the "GHS Classification" heading rather than the full record.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cid = (url.searchParams.get("cid") || "").trim();

    if (!cid) {
      return NextResponse.json({ error: "Missing cid" }, { status: 400 });
    }

    const ghs = await getGhsClassification(cid);

    if (!ghs) {
      return NextResponse.json(
        { error: "No GHS classification found for this compound" },
        { status: 404 }
      );
    }

    return NextResponse.json(ghs);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "GHS failed" },
      { status: 500 }
    );
  }
}
