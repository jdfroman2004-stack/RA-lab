import { NextResponse } from "next/server";
import { checkAccessCode, checkRateLimit } from "@/lib/protect";

const MAX_PROCEDURE_CHARS = 8000;
const MAX_IMAGE_BASE64_CHARS = 4_500_000; // ~3.3MB image

/**
 * GET handler so the route never 405s if opened in a browser
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "Use POST with JSON body: { procedure: string } or { imageBase64, imageMediaType }",
  });
}

/**
 * Extracts chemicals + lab operations from a pasted procedure OR a photo of
 * one (e.g. a phone photo of the lab manual page).
 */
export async function POST(req: Request) {
  const userAgent = req.headers.get("user-agent") || "";

  // Ignore social media preview bots (LinkedIn, Facebook, Twitter)
  if (/linkedinbot|facebookexternalhit|twitterbot/i.test(userAgent)) {
    return new Response(JSON.stringify({ ignored: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Protection: this endpoint spends OpenAI credits ---
  const accessError = checkAccessCode(req);
  if (accessError) {
    return NextResponse.json({ error: accessError, accessCodeRequired: true }, { status: 401 });
  }

  const rl = checkRateLimit(req, { key: "ai", limit: 6, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: `Too many requests — try again in ${rl.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const body = await req.json();
    const procedure = String(body?.procedure || "").trim();
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
    const imageMediaType =
      typeof body?.imageMediaType === "string" ? body.imageMediaType : "image/jpeg";

    const hasImage = imageBase64.length > 0;

    if (!hasImage && procedure.length < 20) {
      return NextResponse.json({ error: "Procedure text too short" }, { status: 400 });
    }
    if (procedure.length > MAX_PROCEDURE_CHARS) {
      return NextResponse.json(
        { error: `Procedure too long (max ${MAX_PROCEDURE_CHARS.toLocaleString()} characters).` },
        { status: 400 }
      );
    }
    if (hasImage && imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
      return NextResponse.json(
        { error: "Image too large — try a smaller photo (under ~3 MB)." },
        { status: 400 }
      );
    }
    if (hasImage && !/^image\/(jpeg|png|webp)$/.test(imageMediaType)) {
      return NextResponse.json({ error: "Unsupported image type." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY. Add it to .env.local and restart npm run dev." },
        { status: 500 }
      );
    }

    // JSON schema the model MUST follow
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        procedureText: { type: ["string", "null"] },
        chemicals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              amount: { type: ["string", "null"] },
              unit: { type: ["string", "null"] },
              concentration: { type: ["string", "null"] },
              notes: { type: ["string", "null"] },
            },
            required: ["name", "amount", "unit", "concentration", "notes"],
          },
        },
        operations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string" },
              detail: { type: ["string", "null"] },
            },
            required: ["type", "detail"],
          },
        },
      },
      required: ["procedureText", "chemicals", "operations"],
    };

    const instruction = hasImage
      ? "The image is a photo of a chemistry lab procedure (e.g. from a lab manual). First transcribe the procedure text into procedureText, then extract chemicals and lab operations. Return JSON only."
      : "Extract chemicals and lab operations from the following procedure. Set procedureText to null. Return JSON only.";

    const userContent: any[] = [{ type: "input_text", text: instruction }];
    if (hasImage) {
      userContent.push({
        type: "input_image",
        image_url: `data:${imageMediaType};base64,${imageBase64}`,
      });
    } else {
      userContent.push({
        type: "input_text",
        text: `Procedure:\n"""${procedure}"""`,
      });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        input: [
          {
            role: "system",
            content:
              "You extract chemicals and lab operations from chemistry procedures. Do NOT assess risk. Do NOT suggest PPE or controls.",
          },
          {
            role: "user",
            content: userContent,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "procedure_extraction",
            strict: true,
            schema,
          },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI error:", response.status, errText);

      return NextResponse.json(
        { error: "OpenAI request failed", status: response.status, detail: errText },
        { status: 500 }
      );
    }

    const data = await response.json();

    // Extract the model text output robustly
    let outputText: string | null = null;

    for (const item of data.output ?? []) {
      if (item?.type !== "message") continue;
      for (const c of item.content ?? []) {
        if (c?.type === "output_text") {
          outputText = c.text;
          break;
        }
      }
      if (outputText) break;
    }

    if (!outputText) {
      return NextResponse.json(
        { error: "No output_text found in model response" },
        { status: 500 }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return NextResponse.json(
        { error: "Model output was not valid JSON", output: outputText },
        { status: 500 }
      );
    }

    // Keep the FULL extraction (name + amount + unit + concentration) — the
    // model already returns it, so don't throw the quantity data away.
    type RichChem = {
      name: string;
      amount: string | null;
      unit: string | null;
      concentration: string | null;
      quantity: string | null; // pre-formatted for display / PDF fill
    };

    const seen = new Set<string>();
    const chemicalsDetailed: RichChem[] = [];

    for (const c of parsed.chemicals || []) {
      let name = "";
      let amount: string | null = null;
      let unit: string | null = null;
      let concentration: string | null = null;

      if (typeof c === "string") {
        name = c.trim();
      } else if (c && typeof c === "object") {
        name = String(c.name || "").trim();
        amount = c.amount ? String(c.amount).trim() : null;
        unit = c.unit ? String(c.unit).trim() : null;
        concentration = c.concentration ? String(c.concentration).trim() : null;
      }

      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const qtyParts: string[] = [];
      if (amount) qtyParts.push(unit ? `${amount} ${unit}` : amount);
      if (concentration) qtyParts.push(concentration);

      chemicalsDetailed.push({
        name,
        amount,
        unit,
        concentration,
        quantity: qtyParts.length ? qtyParts.join(", ") : null,
      });
    }

    const chemicals = chemicalsDetailed.map((c) => c.name);

    const operations = (parsed.operations || [])
      .map((o: any) => {
        if (typeof o === "string") return o.trim();
        if (o && typeof o === "object") {
          const t = String(o.type || "").trim();
          const d = o.detail ? String(o.detail).trim() : "";
          return d ? `${t} — ${d}` : t;
        }
        return "";
      })
      .filter(Boolean);

    const procedureText =
      hasImage && typeof parsed.procedureText === "string" && parsed.procedureText.trim()
        ? parsed.procedureText.trim().slice(0, MAX_PROCEDURE_CHARS)
        : null;

    return NextResponse.json({
      chemicals, // string[] of names (backwards compatible)
      chemicalsDetailed, // full extraction incl. amount / unit / concentration
      operations: Array.from(new Set(operations)),
      procedureText, // transcription when input was a photo
    });
  } catch (err: any) {
    console.error("Route error:", err);
    return NextResponse.json(
      { error: "Server error", detail: err?.message },
      { status: 500 }
    );
  }
}
