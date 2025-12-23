import { NextResponse } from "next/server";




/**
 * GET handler so the route never 405s if opened in a browser
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Use POST with JSON body: { procedure: string }",
  });
}

/**
 * Extracts chemicals + lab operations from a pasted procedure
 */
export async function POST(req: Request) {
    const userAgent = req.headers.get("user-agent") || "";

  // Ignore social media preview bots (LinkedIn, Facebook, Twitter)
  if (/linkedinbot|facebookexternalhit|twitterbot/i.test(userAgent)) {
    return new Response(
      JSON.stringify({ ignored: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  try {
    const body = await req.json();
    const procedure = String(body?.procedure || "").trim();

    if (procedure.length < 20) {
      return NextResponse.json(
        { error: "Procedure text too short" },
        { status: 400 }
      );
    }

    

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Missing OPENAI_API_KEY. Add it to .env.local and restart npm run dev.",
        },
        { status: 500 }
      );
    }

    // JSON schema the model MUST follow
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
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
      required: ["chemicals", "operations"],
    };

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
            content: `Extract chemicals and lab operations from the following procedure. Return JSON only.\n\nProcedure:\n"""${procedure}"""`,
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
        {
          error: "OpenAI request failed",
          status: response.status,
          detail: errText,
        },
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
        { error: "No output_text found in model response", raw: data },
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

    const chemicals = (parsed.chemicals || [])
  .map((c: any) => {
    // ✅ If model returned string array:
    if (typeof c === "string") return c.trim();
    // ✅ If model returned object array:
    if (c && typeof c === "object") return String(c.name || "").trim();
    return "";
  })
  .filter(Boolean);


    const operations = (parsed.operations || [])
  .map((o: any) => {
    // if string
    if (typeof o === "string") return o.trim();
    // if object
    if (o && typeof o === "object") {
      const t = String(o.type || "").trim();
      const d = o.detail ? String(o.detail).trim() : "";
      return d ? `${t} — ${d}` : t;
    }
    return "";
  })
  .filter(Boolean);


    return NextResponse.json({
      chemicals: Array.from(new Set(chemicals)),
      operations: Array.from(new Set(operations)),
      extracted: parsed,
    });
  } catch (err: any) {
    console.error("Route error:", err);
    return NextResponse.json(
      { error: "Server error", detail: err?.message },
      { status: 500 }
    );
  }
}


