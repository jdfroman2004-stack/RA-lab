"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ----------------------------- Types ----------------------------- */

type AnalysisResult = {
  chemicals: string[];
  operations: string[];
};

type UnitSystem = "metric" | "imperial";

type PubChemMatch = {
  cid: number;
  title: string;
};

type ChemState = {
  name: string;
  matches: PubChemMatch[];
  selectedCid: number | null;
  confirmedCid: number | null;
};

type ChemicalProperties = {
  boilingPoint: string | null;
  flashPoint: string | null;
  meltingOrFreezingPoint: string | null;
  source: string;
};

type GhsData = {
  cid: number;
  signalWord: string | null;
  pictograms: string[];
  pictogramUrls?: Record<string, string>;
  hazardStatements: string[];
  source: string;
};

type ConfirmedChem = {
  name: string;
  confirmedCid: number;
  quantity?: string | null;
  properties?: ChemicalProperties | null;
};

type SavedSession = {
  savedAt: number;
  procedure: string;
  analysis: AnalysisResult | null;
  chemStates: Record<string, ChemState>;
  properties: Record<string, ChemicalProperties>;
  ghsData: Record<string, GhsData>;
  quantities: Record<string, string>;
};

const SESSION_KEY = "ra-lab-session-v1";
const ACCESS_KEY = "ra-lab-access-code";
const PDF_MAX_ROWS = 12; // CHEM2006 template has chem00..chem11
const MAX_PROCEDURE_CHARS = 8000;

type RaTemplate = "chem2006" | "generic";

function getStoredAccessCode(): string {
  try {
    return window.localStorage.getItem(ACCESS_KEY) || "";
  } catch {
    return "";
  }
}

function storeAccessCode(code: string) {
  try {
    window.localStorage.setItem(ACCESS_KEY, code);
  } catch {}
}

/* ------------------------- Helper functions ----------------------- */

function fToC(f: number) {
  return (f - 32) * (5 / 9);
}
function formatC(c: number) {
  return `${c.toFixed(1)} °C`;
}
function convertTempToMetric(s: string) {
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*F/i);
  if (!m) return s;
  return s.replace(m[0], formatC(fToC(Number(m[1]))));
}
function displayTemp(value: string | null | undefined, unit: UnitSystem) {
  if (!value) return "—";
  if (unit === "metric" && /F/i.test(value)) return convertTempToMetric(value);
  return value;
}

function sdsSearchUrl(name: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(`"${name}" safety data sheet SDS`)}`;
}

function operationHazards(ops: string[]) {
  const hazards = new Set<string>();
  for (const op of ops.map((o) => o.toLowerCase())) {
    if (op.includes("reflux") || op.includes("heat") || op.includes("hot")) {
      hazards.add("Heat / hot surfaces (burns)");
      hazards.add("Hot solvent vapours (inhalation / ignition risk)");
    }
    if (op.includes("quench") || op.includes("dropwise") || op.includes("gas evolution")) {
      hazards.add("Exothermic quench / splashing");
      hazards.add("Pressure build-up / gas evolution (venting required)");
    }
    if (op.includes("rotavap") || op.includes("distill") || op.includes("reduced pressure")) {
      hazards.add("Vacuum / glass implosion risk");
      hazards.add("Concentrated solvent vapours");
    }
    if (op.includes("extract") || op.includes("separatory") || op.includes("wash")) {
      hazards.add("Pressure in separatory funnel (vent frequently)");
      hazards.add("Solvent exposure during liquid-liquid extraction");
    }
    if (op.includes("chromatograph") || op.includes("column") || op.includes("silica")) {
      hazards.add("Flammable solvent exposure during chromatography");
      hazards.add("Silica dust / skin irritation (dry silica)");
    }
    if (op.includes("filter") || op.includes("vacuum filtration")) {
      hazards.add("Vacuum filtration / glassware breakage risk");
    }
  }
  return Array.from(hazards);
}

function shortGhs(ghs?: GhsData) {
  if (!ghs) return "—";
  const parts: string[] = [];
  if (ghs.signalWord) parts.push(`Signal: ${ghs.signalWord}`);
  if (ghs.pictograms?.length) parts.push(`Pictograms: ${ghs.pictograms.join(", ")}`);
  if (ghs.hazardStatements?.length) parts.push(...ghs.hazardStatements.slice(0, 3));
  return parts.join(" • ");
}

/* =========================== PAGE =========================== */

export default function WizardPage() {
  const [procedure, setProcedure] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [chemStates, setChemStates] = useState<Record<string, ChemState>>({});
  const [properties, setProperties] = useState<Record<string, ChemicalProperties>>({});
  const [ghsData, setGhsData] = useState<Record<string, GhsData>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busyChems, setBusyChems] = useState<Record<string, boolean>>({});
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric");

  const [showChemicals, setShowChemicals] = useState(true);
  const [showOps, setShowOps] = useState(true);
  const [showTable, setShowTable] = useState(true);

  const [raTemplate, setRaTemplate] = useState<RaTemplate>("chem2006");
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const [restoreAvailable, setRestoreAvailable] = useState<SavedSession | null>(null);
  const hydrated = useRef(false);

  /* ---------------------- Session persistence ---------------------- */
  // Auto-saves work to this browser so an accidental refresh doesn't wipe
  // a half-finished risk assessment. Nothing leaves the user's machine.

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) {
        const saved: SavedSession = JSON.parse(raw);
        if (saved?.procedure || saved?.analysis) setRestoreAvailable(saved);
      }
    } catch {
      /* corrupt session — ignore */
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (!procedure && !analysis) return; // nothing worth saving
    const session: SavedSession = {
      savedAt: Date.now(),
      procedure,
      analysis,
      chemStates,
      properties,
      ghsData,
      quantities,
    };
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* storage full/blocked — non-fatal */
    }
  }, [procedure, analysis, chemStates, properties, ghsData, quantities]);

  function restoreSession() {
    if (!restoreAvailable) return;
    setProcedure(restoreAvailable.procedure || "");
    setAnalysis(restoreAvailable.analysis || null);
    setChemStates(restoreAvailable.chemStates || {});
    setProperties(restoreAvailable.properties || {});
    setGhsData(restoreAvailable.ghsData || {});
    setQuantities(restoreAvailable.quantities || {});
    setRestoreAvailable(null);
  }

  function dismissSession() {
    setRestoreAvailable(null);
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  /* ------------------------- AI Parse ------------------------- */

  /**
   * Calls parse-procedure; if the server requires an access code, prompts
   * once, stores it, and retries.
   */
  async function callParseApi(payload: Record<string, unknown>) {
    const attempt = async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const code = getStoredAccessCode();
      if (code) headers["x-ra-access-code"] = code;
      const res = await fetch("/api/ai/parse-procedure", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    };

    let { res, data } = await attempt();

    if (res.status === 401 && data?.accessCodeRequired) {
      const entered = window.prompt(
        "This tool needs an access code (it's on the poster, or ask a tutor):"
      );
      if (entered && entered.trim()) {
        storeAccessCode(entered.trim());
        ({ res, data } = await attempt());
      }
    }

    return { res, data };
  }

  async function runAnalysis(payload: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    setNotice(null);
    setAnalysis(null);
    setChemStates({});
    setProperties({});
    setGhsData({});
    setQuantities({});

    try {
      const { res, data } = await callParseApi(payload);

      if (!res.ok || data?.error) {
        const msg = data?.detail
          ? `${data.error} (status ${data.status ?? res.status})\n\n${data.detail}`
          : data?.error
          ? String(data.error)
          : `Request failed (${res.status})`;
        throw new Error(msg);
      }

      const chemicals: string[] = Array.isArray(data?.chemicals) ? data.chemicals : [];
      const operations: string[] = Array.isArray(data?.operations) ? data.operations : [];

      // Photo mode: show the transcription so the student can check/edit it
      if (typeof data?.procedureText === "string" && data.procedureText.trim()) {
        setProcedure(data.procedureText.trim());
      }

      // Quantities come straight from the AI extraction (amount/unit/concentration)
      const qtys: Record<string, string> = {};
      if (Array.isArray(data?.chemicalsDetailed)) {
        for (const c of data.chemicalsDetailed) {
          if (c?.name && c?.quantity) qtys[c.name] = String(c.quantity);
        }
      }
      setQuantities(qtys);

      setAnalysis({ chemicals, operations });

      const init: Record<string, ChemState> = {};
      chemicals.forEach((c) => {
        init[c] = { name: c, matches: [], selectedCid: null, confirmedCid: null };
      });
      setChemStates(init);

      setShowChemicals(true);
      setShowOps(true);
      setShowTable(true);

      // Auto-search PubChem for every chemical in parallel and preselect the
      // top match, so the student only has to review + confirm.
      await Promise.allSettled(chemicals.map((c) => findMatches(c)));
    } catch (e: any) {
      setError(e.message ?? "AI request failed");
    } finally {
      setLoading(false);
      setPhotoBusy(false);
    }
  }

  function analyseProcedure() {
    return runAnalysis({ procedure });
  }

  /** Compress a photo client-side, then analyse it with the vision model. */
  async function analysePhoto(file: File) {
    setPhotoBusy(true);
    setError(null);
    try {
      const compressed = await new Promise<{ base64: string; mediaType: string }>(
        (resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => {
            const MAX = 1600;
            let { width: w, height: h } = img;
            if (Math.max(w, h) > MAX) {
              const s = MAX / Math.max(w, h);
              w = Math.round(w * s);
              h = Math.round(h * s);
            }
            const cv = document.createElement("canvas");
            cv.width = w;
            cv.height = h;
            cv.getContext("2d")!.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            const dataUrl = cv.toDataURL("image/jpeg", 0.85);
            resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Could not read that image."));
          };
          img.src = url;
        }
      );

      await runAnalysis({
        imageBase64: compressed.base64,
        imageMediaType: compressed.mediaType,
      });
    } catch (e: any) {
      setError(e.message ?? "Photo analysis failed");
      setPhotoBusy(false);
    }
  }

  /* ------------------------- PubChem ------------------------- */

  async function findMatches(name: string) {
    try {
      const res = await fetch(`/api/chem/search?q=${encodeURIComponent(name)}`);
      const data = await res.json().catch(() => ({}));

      const matches: PubChemMatch[] = Array.isArray(data?.matches) ? data.matches : [];

      setChemStates((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          name,
          matches,
          selectedCid: matches?.[0]?.cid ?? null,
          confirmedCid: prev[name]?.confirmedCid ?? null,
        },
      }));
    } catch (e: any) {
      setError(e.message ?? "Match lookup failed");
    }
  }

  /**
   * One round-trip fetches properties + GHS together via /api/chem/summary.
   */
  async function fetchSummary(name: string, cidOverride?: number) {
    const cid = cidOverride ?? chemStates[name]?.confirmedCid;
    if (!cid) {
      setError(`Confirm CID first for "${name}".`);
      return;
    }

    setBusyChems((prev) => ({ ...prev, [name]: true }));
    try {
      const res = await fetch(`/api/chem/summary?cid=${encodeURIComponent(cid)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error ?? "Failed to fetch chemical data");

      if (data?.properties) {
        setProperties((prev) => ({ ...prev, [name]: data.properties }));
      }
      if (data?.ghs) {
        setGhsData((prev) => ({ ...prev, [name]: data.ghs }));
      } else {
        // Compound has no GHS section on PubChem — clear stale data if any
        setGhsData((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    } catch (e: any) {
      setError(e.message ?? "Data fetch failed");
    } finally {
      setBusyChems((prev) => ({ ...prev, [name]: false }));
    }
  }

  /** Confirming a CID immediately fetches its data — no extra clicks. */
  function confirmCid(name: string) {
    const cid = chemStates[name]?.selectedCid;
    if (!cid) return;
    setChemStates((prev) => ({
      ...prev,
      [name]: { ...prev[name], confirmedCid: cid },
    }));
    void fetchSummary(name, cid);
  }

  /** Confirm every chemical that has a suggested match, then fetch all data. */
  async function confirmAllSuggested() {
    const chems = analysis?.chemicals ?? [];
    const targets = chems.filter(
      (c) => chemStates[c]?.selectedCid && !chemStates[c]?.confirmedCid
    );
    if (!targets.length) {
      setNotice("Nothing to confirm — every chemical is either confirmed or has no match yet.");
      return;
    }

    setChemStates((prev) => {
      const next = { ...prev };
      for (const c of targets) {
        next[c] = { ...next[c], confirmedCid: next[c].selectedCid };
      }
      return next;
    });

    // Sequential keeps PubChem rate limits happy
    for (const c of targets) {
      await fetchSummary(c, chemStates[c].selectedCid!);
    }
  }

  async function fetchAllChemicals() {
    if (!analysis?.chemicals?.length) return;
    const confirmed = analysis.chemicals.filter((c) => !!chemStates[c]?.confirmedCid);
    if (!confirmed.length) {
      setError("Confirm at least one CID first, then use Fetch all.");
      return;
    }
    for (const c of confirmed) {
      await fetchSummary(c);
    }
  }

  /* ------------------------- PDF export ------------------------- */

  async function downloadRaPdf() {
    setError(null);
    setNotice(null);

    const chemList: string[] = analysis?.chemicals ?? [];

    const confirmed: ConfirmedChem[] = chemList
      .filter((name) => !!chemStates[name]?.confirmedCid)
      .map((name) => ({
        name,
        confirmedCid: Number(chemStates[name]!.confirmedCid),
        quantity: quantities[name] ?? null,
        properties: properties[name] ?? null,
      }));

    if (!confirmed.length) {
      setError("Confirm at least one chemical first.");
      return;
    }

    if (raTemplate === "chem2006" && confirmed.length > PDF_MAX_ROWS) {
      setNotice(
        `Heads up: the CHEM2006 form fits ${PDF_MAX_ROWS} chemicals. ` +
          `${confirmed.length - PDF_MAX_ROWS} won't fit and will be left off: ` +
          confirmed.slice(PDF_MAX_ROWS).map((c) => c.name).join(", ") +
          ` — or switch to the Generic template, which fits everything.`
      );
    }

    try {
      const endpoint = raTemplate === "chem2006" ? "/api/ra/chem2006" : "/api/ra/generic";
      const payload =
        raTemplate === "chem2006"
          ? { chemicals: confirmed }
          : {
              chemicals: confirmed.map((c) => ({
                ...c,
                ghs: ghsData[c.name]
                  ? {
                      signalWord: ghsData[c.name].signalWord,
                      pictograms: ghsData[c.name].pictograms,
                      hazardStatements: ghsData[c.name].hazardStatements,
                    }
                  : null,
              })),
              operationHazards: operationRisks,
              unitCode: "",
              experimentTitle: "",
            };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `RA export failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        raTemplate === "chem2006" ? "CHEM2006_RA_autofill.pdf" : "Risk_Assessment_draft.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message ?? "RA export failed");
    }
  }

  /* ------------------------- Derived ------------------------- */

  const operationRisks = useMemo(
    () => (analysis ? operationHazards(analysis.operations) : []),
    [analysis]
  );

  const unitLabel = unitSystem === "metric" ? "Metric (°C)" : "Imperial (°F)";

  const confirmedCount = useMemo(
    () =>
      (analysis?.chemicals ?? []).filter((c) => !!chemStates[c]?.confirmedCid).length,
    [analysis, chemStates]
  );

  const tableRows = useMemo(() => {
    const chems = analysis?.chemicals ?? [];
    return chems.map((c) => {
      const st = chemStates[c];
      const cid = st?.confirmedCid ?? null;
      const p = properties[c];
      const g = ghsData[c];
      return {
        chemical: c,
        cid,
        quantity: quantities[c] ?? "—",
        boiling: p ? displayTemp(p.boilingPoint, unitSystem) : "—",
        flash: p ? displayTemp(p.flashPoint, unitSystem) : "—",
        melting: p ? displayTemp(p.meltingOrFreezingPoint, unitSystem) : "—",
        ghs: shortGhs(g),
        g,
      };
    });
  }, [analysis, chemStates, properties, ghsData, quantities, unitSystem]);

  /* ------------------------- Render ------------------------- */

  const canAnalyse = procedure.trim().length >= 20;

  return (
    <main className="wrap">
      <header className="topbar">
        <div>
          <h1 className="title">Risk Assessment Wizard</h1>
          <p className="subtitle">
            Fast draft RA inputs from a procedure. You confirm accuracy; the app saves the boring lookups.
          </p>
        </div>

        <div className="unitBox">
          <label className="label">Units</label>
          <select
            className="select"
            value={unitSystem}
            onChange={(e) => setUnitSystem(e.target.value as UnitSystem)}
          >
            <option value="metric">Metric (°C)</option>
            <option value="imperial">Imperial (°F)</option>
          </select>
          <span className="muted">{unitLabel}</span>
        </div>
      </header>

      {restoreAvailable && (
        <div className="restoreBar">
          <span>
            You have unsaved work from{" "}
            {new Date(restoreAvailable.savedAt).toLocaleString()} — restore it?
          </span>
          <div className="restoreBtns">
            <button className="btn btnPrimary" onClick={restoreSession}>
              Restore session
            </button>
            <button className="btn btnGhost" onClick={dismissSession}>
              Start fresh
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="alert">
          <div className="alertTitle">Something went wrong</div>
          <pre className="alertBody">{error}</pre>
        </div>
      )}

      {notice && (
        <div className="noticeBar">
          <div className="noticeBody">{notice}</div>
          <button className="btn btnGhost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Step 1 */}
      <section className="card">
        <div className="cardHead">
          <div>
            <div className="step">Step 1</div>
            <h2 className="cardTitle">Paste procedure — or photograph it</h2>
            <p className="muted">
              Paste a lab method, or snap a photo of the lab manual page. We’ll extract likely
              chemicals + operations, then automatically look up PubChem matches for each.
            </p>
          </div>

          <div className="headActions">
            <button
              className="btn btnSecondary"
              onClick={() => photoInputRef.current?.click()}
              disabled={loading || photoBusy}
              title="Snap or upload a photo of the procedure (e.g. lab manual page)"
            >
              {photoBusy ? "Reading photo…" : "📷 Photo of procedure"}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void analysePhoto(f);
                e.target.value = "";
              }}
            />
            <button
              className={`btn ${canAnalyse ? "btnPrimary" : "btnDisabled"}`}
              onClick={analyseProcedure}
              disabled={!canAnalyse || loading}
              title={!canAnalyse ? "Paste a longer procedure first (20+ chars)" : ""}
            >
              {loading ? "Analysing…" : "Analyse procedure"}
            </button>
          </div>
        </div>

        <textarea
          className="textarea"
          rows={10}
          maxLength={MAX_PROCEDURE_CHARS}
          value={procedure}
          onChange={(e) => setProcedure(e.target.value)}
          placeholder="Example: Add ethanol (10 mL) to a round-bottom flask. Cool in an ice bath, then add acetic acid dropwise... Or use the photo button to snap your lab manual."
        />

        <div className="hintRow">
          <span className="pill">Tip: include quantities + key verbs (add, heat, reflux, quench, extract)</span>
          <span className="pill charCount">
            {procedure.length.toLocaleString()} / {MAX_PROCEDURE_CHARS.toLocaleString()}
          </span>
        </div>
      </section>

      {/* Step 2 */}
      <section className="card">
        <div className="cardHead">
          <div>
            <div className="step">Step 2</div>
            <h2 className="cardTitle">Review chemicals</h2>
            <p className="muted">
              Top PubChem matches are pre-selected. Check each one is the right compound, then confirm —
              properties + GHS load automatically on confirm.
            </p>
          </div>

          <div className="headActions">
            <button
              className={`btn btnGhost`}
              onClick={() => setShowChemicals((s) => !s)}
              disabled={!analysis}
            >
              {showChemicals ? "Collapse" : "Expand"}
            </button>
            <button
              className={`btn btnPrimary`}
              onClick={confirmAllSuggested}
              disabled={!analysis || !analysis?.chemicals?.length}
              title="Confirm the pre-selected match for every chemical and fetch all data"
            >
              Confirm all suggested
            </button>
            <button
              className={`btn btnSecondary`}
              onClick={fetchAllChemicals}
              disabled={!analysis || !confirmedCount}
              title="Re-fetch properties + GHS for confirmed chemicals"
            >
              Refresh all data
            </button>
          </div>
        </div>

        {!analysis ? (
          <div className="empty">Run “Analyse procedure” to see detected chemicals.</div>
        ) : !analysis.chemicals.length ? (
          <div className="empty">No chemicals detected. Try pasting more detail.</div>
        ) : showChemicals ? (
          <div className="chemGrid">
            {analysis.chemicals.map((c) => {
              const st = chemStates[c];
              const confirmed = st?.confirmedCid;
              const props = properties[c];
              const ghs = ghsData[c];
              const busy = !!busyChems[c];

              return (
                <div key={c} className="chemCard">
                  <div className="chemTop">
                    <div>
                      <div className="chemName">{c}</div>
                      <div className="chipRow">
                        {confirmed ? (
                          <span className="chip chipOk">Confirmed CID {confirmed}</span>
                        ) : st?.matches?.length ? (
                          <span className="chip chipWarn">Suggested — please confirm</span>
                        ) : (
                          <span className="chip chipWarn">No match yet</span>
                        )}
                        {quantities[c] ? (
                          <span className="chip chipQty" title="Quantity extracted from your procedure">
                            {quantities[c]}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="chemBtns">
                      <button className="btn btnGhost" onClick={() => findMatches(c)}>
                        Re-search
                      </button>
                      <button
                        className={`btn ${st?.selectedCid && !busy ? "btnPrimary" : "btnDisabled"}`}
                        onClick={() => confirmCid(c)}
                        disabled={!st?.selectedCid || busy}
                        title={!st?.selectedCid ? "Select a match first" : ""}
                      >
                        {busy ? "Loading…" : confirmed ? "Re-confirm" : "Confirm"}
                      </button>
                    </div>
                  </div>

                  <div className="row">
                    <label className="label">PubChem match</label>
                    <select
                      className="select"
                      value={st?.selectedCid ?? ""}
                      onChange={(e) =>
                        setChemStates((prev) => ({
                          ...prev,
                          [c]: { ...prev[c], selectedCid: e.target.value ? Number(e.target.value) : null },
                        }))
                      }
                      disabled={!st?.matches?.length}
                    >
                      {!st?.matches?.length ? (
                        <option value="">(Searching… or click “Re-search”)</option>
                      ) : (
                        st.matches.map((m) => (
                          <option key={m.cid} value={m.cid}>
                            {m.title} (CID {m.cid})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="twoCol">
                    <div className="miniCard">
                      <div className="miniTitle">Properties</div>
                      <div className="miniLine">
                        <span className="miniKey">Boiling</span>
                        <span className="miniVal">{props ? displayTemp(props.boilingPoint, unitSystem) : "—"}</span>
                      </div>
                      <div className="miniLine">
                        <span className="miniKey">Flash</span>
                        <span className="miniVal">{props ? displayTemp(props.flashPoint, unitSystem) : "—"}</span>
                      </div>
                      <div className="miniLine">
                        <span className="miniKey">Melt/Freeze</span>
                        <span className="miniVal">
                          {props ? displayTemp(props.meltingOrFreezingPoint, unitSystem) : "—"}
                        </span>
                      </div>
                      <div className="miniFoot">
                        {props?.source ? (
                          <a className="link" href={props.source} target="_blank" rel="noreferrer">
                            Source: PubChem
                          </a>
                        ) : (
                          <span className="muted">Source: —</span>
                        )}
                      </div>
                    </div>

                    <div className="miniCard">
                      <div className="miniTitle">GHS</div>

                      <div className="miniLine">
                        <span className="miniKey">Signal</span>
                        <span className="miniVal">{ghs?.signalWord ?? "—"}</span>
                      </div>

                      <div className="miniLine">
                        <span className="miniKey">Pictograms</span>

                        {ghs?.pictograms?.length && ghs?.pictogramUrls ? (
                          <div className="pictos">
                            {ghs.pictograms.map((p) => (
                              <img
                                key={p}
                                className="pictoImg"
                                src={ghs.pictogramUrls?.[p] ?? ""}
                                alt={p}
                                title={p}
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="miniVal">—</span>
                        )}
                      </div>

                      <div className="miniFoot">
                        {ghs?.hazardStatements?.length ? (
                          <div className="muted">
                            {ghs.hazardStatements.slice(0, 4).map((h, i) => (
                              <div key={i} className="bullet">
                                • {h}
                              </div>
                            ))}
                            {ghs.hazardStatements.length > 4 ? (
                              <div className="bullet muted">
                                …plus {ghs.hazardStatements.length - 4} more (see PubChem)
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="muted">Hazard statements: —</span>
                        )}
                        <div className="sdsRow">
                          {ghs?.source ? (
                            <a className="link" href={ghs.source} target="_blank" rel="noreferrer">
                              GHS source
                            </a>
                          ) : null}
                          <a className="link" href={sdsSearchUrl(c)} target="_blank" rel="noreferrer">
                            Find SDS ↗
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {/* Step 3 */}
      <section className="card">
        <div className="cardHead">
          <div>
            <div className="step">Step 3</div>
            <h2 className="cardTitle">Operation hazards</h2>
            <p className="muted">Auto-suggested from detected operations (students still justify controls).</p>
          </div>

          <button className="btn btnGhost" onClick={() => setShowOps((s) => !s)} disabled={!analysis}>
            {showOps ? "Collapse" : "Expand"}
          </button>
        </div>

        {!analysis ? (
          <div className="empty">Run “Analyse procedure” first.</div>
        ) : showOps ? (
          operationRisks.length ? (
            <ul className="list">
              {operationRisks.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : (
            <div className="empty">No operation hazards detected.</div>
          )
        ) : null}
      </section>

      {/* Step 4 */}
      <section className="card">
        <div className="cardHead">
          <div>
            <div className="step">Step 4</div>
            <h2 className="cardTitle">Draft RA table</h2>
            <p className="muted">
              Auto-fills quantities, properties + GHS summary. Students fill controls/PPE/risk rating.
            </p>
          </div>
          <div className="headActions">
            <select
              className="select templateSelect"
              value={raTemplate}
              onChange={(e) => setRaTemplate(e.target.value as RaTemplate)}
              title="Which PDF layout to generate"
            >
              <option value="chem2006">CHEM2006 form</option>
              <option value="generic">Generic RA (any unit)</option>
            </select>
            <button
              className={`btn ${confirmedCount ? "btnPrimary" : "btnDisabled"}`}
              onClick={downloadRaPdf}
              disabled={!confirmedCount}
              title={!confirmedCount ? "Confirm at least one chemical first" : ""}
            >
              Download RA (PDF)
            </button>
            <button className="btn btnGhost" onClick={() => setShowTable((s) => !s)} disabled={!analysis}>
              {showTable ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>

        {!analysis ? (
          <div className="empty">Run “Analyse procedure” first.</div>
        ) : showTable ? (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Chemical</th>
                  <th>Quantity</th>
                  <th>Confirmed CID</th>
                  <th>Boiling</th>
                  <th>Flash</th>
                  <th>Melt/Freeze</th>
                  <th>GHS (auto)</th>
                  <th>Controls (student)</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.chemical}>
                    <td className="tdStrong">{r.chemical}</td>
                    <td>{r.quantity}</td>
                    <td>{r.cid ?? "—"}</td>
                    <td>{r.boiling}</td>
                    <td>{r.flash}</td>
                    <td>{r.melting}</td>
                    <td className="tdWide">
                      {r.g?.pictograms?.length && r.g?.pictogramUrls ? (
                        <div className="raGhs">
                          <div className="raPictos">
                            {r.g.pictograms.map((p) => (
                              <img key={p} className="raPictoImg" src={r.g!.pictogramUrls![p]} alt={p} title={p} />
                            ))}
                          </div>
                          <div className="raGhsText">{r.ghs}</div>
                        </div>
                      ) : (
                        r.ghs
                      )}
                    </td>
                    <td className="tdMuted">e.g., fume hood, PPE, spill kit, no ignition sources…</td>
                  </tr>
                ))}
                {!tableRows.length && (
                  <tr>
                    <td colSpan={8} className="tdMuted">
                      No data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* Styling */}
      <style jsx global>{`
        :root {
          --bg: #0b0f17;
          --card: #0f1623;
          --card2: #101a2a;
          --text: #0b0f17;
          --muted: rgba(0, 0, 0, 0.6);
          --border: rgba(15, 23, 42, 0.12);
          --shadow: 0 10px 30px rgba(2, 6, 23, 0.12);
          --radius: 16px;
        }

        .pictos {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          justify-content: flex-end;
        }

        .pictoImg {
          width: 34px;
          height: 34px;
          object-fit: contain;
          display: block;
          flex: 0 0 auto;
        }

        .raGhs {
          display: grid;
          gap: 6px;
        }

        .raPictos {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }

        .raPictoImg {
          width: 18px;
          height: 18px;
          object-fit: contain;
          display: block;
        }

        .raGhsText {
          line-height: 1.35;
        }

        body {
          background: #f6f7fb;
          color: #0b0f17;
          margin: 0;
        }

        .wrap {
          max-width: 1120px;
          margin: 28px auto 60px;
          padding: 0 18px;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji",
            "Segoe UI Emoji";
        }

        .topbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 18px;
        }

        .title {
          font-size: 34px;
          letter-spacing: -0.02em;
          margin: 0 0 6px 0;
        }

        .subtitle {
          margin: 0;
          color: rgba(2, 6, 23, 0.7);
          max-width: 62ch;
          line-height: 1.45;
        }

        .unitBox {
          display: grid;
          gap: 6px;
          justify-items: end;
          min-width: 200px;
        }

        .label {
          font-size: 12px;
          font-weight: 700;
          color: rgba(2, 6, 23, 0.65);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .muted {
          color: rgba(2, 6, 23, 0.62);
          font-size: 13px;
        }

        .card {
          background: white;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow);
          padding: 16px;
          margin: 14px 0;
        }

        .cardHead {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 10px;
        }

        .step {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(2, 6, 23, 0.55);
        }

        .cardTitle {
          margin: 4px 0 4px 0;
          font-size: 20px;
          letter-spacing: -0.01em;
        }

        .headActions {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        .textarea {
          width: 100%;
          border-radius: 14px;
          border: 1px solid rgba(2, 6, 23, 0.12);
          padding: 12px 12px;
          font-size: 14px;
          line-height: 1.45;
          outline: none;
          min-height: 180px;
          resize: vertical;
          background: #fbfbfe;
        }

        .textarea:focus {
          border-color: rgba(2, 6, 23, 0.25);
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
        }

        .hintRow {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 10px;
        }

        .charCount {
          font-variant-numeric: tabular-nums;
        }

        .templateSelect {
          width: auto;
          min-width: 170px;
        }

        .pill {
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(2, 6, 23, 0.06);
          color: rgba(2, 6, 23, 0.7);
        }

        .btn {
          border-radius: 12px;
          border: 1px solid rgba(2, 6, 23, 0.14);
          padding: 9px 12px;
          font-weight: 700;
          cursor: pointer;
          background: white;
          transition: transform 0.04s ease, box-shadow 0.1s ease, background 0.1s ease;
          user-select: none;
          font-size: 14px;
        }

        .btn:hover {
          box-shadow: 0 8px 18px rgba(2, 6, 23, 0.12);
        }

        .btn:active {
          transform: translateY(1px);
        }

        .btnPrimary {
          background: #111827;
          color: white;
          border-color: rgba(17, 24, 39, 0.3);
        }

        .btnSecondary {
          background: #f3f4f6;
          border-color: rgba(2, 6, 23, 0.14);
        }

        .btnGhost {
          background: transparent;
          border-color: rgba(2, 6, 23, 0.12);
        }

        .btnDisabled {
          background: #9ca3af;
          color: white;
          cursor: not-allowed;
          border-color: rgba(2, 6, 23, 0.1);
          box-shadow: none !important;
        }

        .select {
          width: 100%;
          border-radius: 12px;
          border: 1px solid rgba(2, 6, 23, 0.12);
          padding: 9px 10px;
          background: white;
          outline: none;
          font-size: 14px;
        }

        .select:focus {
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
          border-color: rgba(2, 6, 23, 0.25);
        }

        .alert {
          background: #fff3f3;
          border: 1px solid #ffbdbd;
          border-radius: 14px;
          padding: 12px 12px;
          margin: 12px 0;
        }

        .alertTitle {
          font-weight: 900;
          color: #7a0016;
          margin-bottom: 6px;
        }

        .alertBody {
          margin: 0;
          color: #7a0016;
          white-space: pre-wrap;
          font-weight: 650;
          font-size: 13px;
        }

        .noticeBar {
          background: #fffbeb;
          border: 1px solid #fcd34d;
          border-radius: 14px;
          padding: 12px 12px;
          margin: 12px 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .noticeBody {
          color: #92400e;
          font-weight: 650;
          font-size: 13px;
          line-height: 1.45;
        }

        .restoreBar {
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 14px;
          padding: 12px 12px;
          margin: 12px 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          font-size: 14px;
          color: #1e3a8a;
          font-weight: 650;
        }

        .restoreBtns {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .empty {
          padding: 10px 0 0;
          color: rgba(2, 6, 23, 0.62);
        }

        .chemGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 10px;
        }

        .chemCard {
          border: 1px solid rgba(2, 6, 23, 0.1);
          border-radius: 16px;
          padding: 12px;
          background: #fbfbfe;
        }

        .chemTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: flex-start;
        }

        .chemName {
          font-size: 18px;
          font-weight: 900;
          letter-spacing: -0.01em;
          margin-bottom: 6px;
        }

        .chipRow {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .chip {
          display: inline-block;
          padding: 5px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
        }

        .chipOk {
          background: rgba(16, 185, 129, 0.14);
          color: rgb(5, 122, 85);
          border: 1px solid rgba(16, 185, 129, 0.25);
        }

        .chipWarn {
          background: rgba(245, 158, 11, 0.16);
          color: rgb(146, 64, 14);
          border: 1px solid rgba(245, 158, 11, 0.25);
        }

        .chipQty {
          background: rgba(59, 130, 246, 0.12);
          color: rgb(29, 78, 216);
          border: 1px solid rgba(59, 130, 246, 0.25);
        }

        .chemBtns {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .row {
          margin-top: 10px;
          display: grid;
          gap: 6px;
        }

        .twoCol {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .miniCard {
          background: white;
          border: 1px solid rgba(2, 6, 23, 0.1);
          border-radius: 14px;
          padding: 10px;
        }

        .miniTitle {
          font-weight: 900;
          margin-bottom: 8px;
          letter-spacing: -0.01em;
        }

        .miniLine {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 4px 0;
          font-size: 13px;
          align-items: center;
        }

        .miniKey {
          color: rgba(2, 6, 23, 0.6);
          font-weight: 700;
        }

        .miniVal {
          font-weight: 800;
        }

        .miniFoot {
          margin-top: 8px;
          font-size: 12px;
        }

        .sdsRow {
          display: flex;
          gap: 12px;
          margin-top: 6px;
          flex-wrap: wrap;
        }

        .bullet {
          margin: 2px 0;
        }

        .link {
          color: #111827;
          font-weight: 800;
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        .list {
          margin: 8px 0 0;
          padding-left: 18px;
          line-height: 1.5;
        }

        .tableWrap {
          overflow-x: auto;
          margin-top: 10px;
        }

        .table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1040px;
        }

        .table th {
          text-align: left;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(2, 6, 23, 0.65);
          padding: 10px 10px;
          border-bottom: 2px solid rgba(2, 6, 23, 0.1);
          background: #fafafa;
          position: sticky;
          top: 0;
          z-index: 1;
        }

        .table td {
          padding: 10px 10px;
          border-bottom: 1px solid rgba(2, 6, 23, 0.08);
          vertical-align: top;
          font-size: 13px;
        }

        .tdStrong {
          font-weight: 900;
        }

        .tdWide {
          max-width: 420px;
        }

        .tdMuted {
          color: rgba(2, 6, 23, 0.6);
        }

        @media (max-width: 920px) {
          .topbar {
            flex-direction: column;
            align-items: stretch;
          }
          .unitBox {
            justify-items: start;
          }
          .chemGrid {
            grid-template-columns: 1fr;
          }
          .twoCol {
            grid-template-columns: 1fr;
          }
          .table {
            min-width: 900px;
          }
        }

        /* Phone-first tweaks: QR-code users arrive on mobile */
        @media (max-width: 640px) {
          .wrap {
            margin: 14px auto 40px;
            padding: 0 12px;
          }
          .title {
            font-size: 26px;
          }
          .card {
            padding: 12px;
          }
          .cardHead {
            flex-direction: column;
            align-items: stretch;
          }
          .headActions {
            justify-content: stretch;
          }
          .headActions .btn,
          .headActions .select {
            flex: 1 1 auto;
          }
          .chemBtns .btn {
            padding: 9px 10px;
            font-size: 13px;
          }
          .table {
            min-width: 720px;
            font-size: 12px;
          }
          .textarea {
            min-height: 140px;
          }
        }
      `}</style>
    </main>
  );
}
