import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cid = searchParams.get("cid") ?? "unknown";

  return NextResponse.json({
    ok: true,
    cid,
    message: "GHS endpoint is live",
  });
}
