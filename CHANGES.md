# RA-Lab — batch 2: QR-launch readiness (July 2026)

Includes everything from batch 1 (quantities, 1-click confirm flow, fast
cached PubChem lookups via /api/chem/summary, session persistence, bug fixes)
PLUS:

## Security & cost protection (lib/protect.ts)
- Per-IP rate limiting on /api/ai/parse-procedure (6/min), /api/chem/summary
  (60/min) and PDF generation (12/min). In-memory: burst protection at zero
  infra cost. NOTE: per-serverless-instance, so not a global guarantee —
  upgrade to Upstash Redis if the tool takes off (call sites won't change).
- Input caps: 8,000-char procedure limit (server + client counter),
  ~3 MB image limit, image type whitelist.
- OPTIONAL access code: set RA_ACCESS_CODE in Vercel env vars to require a
  code (put it on the poster). Leave unset = fully open. The wizard prompts
  once, remembers the code in the browser.

## Photo upload (the adoption feature)
- "Photo of procedure" button in Step 1 — on phones it opens the camera.
- Image is compressed client-side (1600px JPEG) and sent to gpt-4o-mini
  vision, which transcribes the procedure into the textarea AND extracts
  chemicals/operations in the same call.

## Generic RA PDF (app/api/ra/generic)
- New properly-structured A4 landscape PDF drawn with pdf-lib: header with
  name/ID/date lines, paginated chemicals table (name, qty, melt, boil,
  flash, GHS signal, H-codes, blank student controls column), operation
  hazards list, ruled student-assessment section, signature lines, SDS
  disclaimer. No 12-row limit. Template picker added next to the download
  button (CHEM2006 form / Generic RA).

## Mobile pass
- <=640px: stacked card headers, full-width buttons, tighter spacing,
  smaller table minimum. QR users arrive on phones.

## Landing page + metadata
- app/page.tsx rewritten: clear pitch, 3-step how-it-works, prominent
  "what it doesn't do" box (the tutor-friendly framing), CTA to /wizard.
- Proper <title>/description metadata (was "Create Next App").

## Analytics
- @vercel/analytics added (new dependency!) and mounted in layout.tsx.
  Enable Analytics on the project in the Vercel dashboard to see data.

## Files changed in this batch
- NEW  lib/protect.ts
- NEW  app/api/ra/generic/route.ts
- MOD  app/api/ai/parse-procedure/route.ts  (protection + vision input)
- MOD  app/api/chem/summary/route.ts        (rate limit)
- MOD  app/wizard/page.tsx                  (photo, access code, template picker, mobile)
- MOD  app/page.tsx                         (new landing)
- MOD  app/layout.tsx                       (Analytics + metadata)
- MOD  app/globals.css                      (landing styles)
- MOD  package.json / package-lock.json     (@vercel/analytics)

## Your to-dos after deploying (5 minutes, dashboards I can't touch)
1. OpenAI dashboard -> Billing -> set a hard monthly usage limit.
2. (Optional) Vercel -> ra-lab -> Settings -> Environment Variables ->
   add RA_ACCESS_CODE = your chosen code -> redeploy. Write it on the poster.
3. Vercel -> ra-lab -> Analytics tab -> Enable.

## Deferred (next sessions)
- CHEM2006 template print-structure fix (needs your template + a failing example)
- Upstash-backed durable rate limiting
- Shareable/exportable sessions
- Additional unit-specific form templates
