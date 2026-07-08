import { NextResponse } from "next/server";
import { getGhsClassification, getProperties } from "@/lib/pubchem";

/**
 * GET /api/chem/summary?cid=702
 *
 * One request from the client fetches everything the wizard needs for a
 * chemical. Under the hood the PubChem heading requests run in parallel and
 * are cached server-side, so repeated lookups of common lab chemicals
 * (ethanol, acetone, HCl...) across students are nearly instant.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cid = (url.searchParams.get("cid") || "").trim();

    if (!cid) {
      return NextResponse.json({ error: "Missing cid" }, { status: 400 });
    }

    const [properties, ghs] = await Promise.all([
      getProperties(cid),
      getGhsClassification(cid),
    ]);

    return NextResponse.json({
      cid: Number(cid),
      properties,
      ghs, // null when PubChem has no GHS section for this compound
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "summary failed" },
      { status: 500 }
    );
  }
}
