import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cid = searchParams.get("cid");

  return NextResponse.json({
    ok: true,
    cid,
    message: "GHS route module is valid",
  });
}
