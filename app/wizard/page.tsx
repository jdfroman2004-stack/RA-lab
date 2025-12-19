"use client";

import { useMemo, useState } from "react";

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
  hazardStatements: string[];
  source: string;
};

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

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [chemStates, setChemStates] = useState<Record<string, ChemState>>({});
  const [properties, setProperties] = useState<Record<string, ChemicalProperties>>({});
  const [ghsData, setGhsData] = useState<Record<string, GhsData>>({});
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric");

  const [showChemicals, setShowChemicals] = useState(true);
  const [showOps, setShowOps] = useState(true);
  const [showTable, setShowTable] = useState(true);

  /* ------------------------- AI Parse ------------------------- */

  async function analyseProcedure() {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setChemStates({});
    setProperties({});
    setGhsData({});

    try {
      const res = await fetch("/api/ai/parse-procedure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ procedure }),
      });

      const data = await res.json().catch(() => ({}));

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

      setAnalysis({ chemicals, operations });

      const init: Record<string, ChemState> = {};
      chemicals.forEach((c) => {
        init[c] = { name: c, matches: [], selectedCid: null, confirmedCid: null };
      });
      setChemStates(init);

      setShowChemicals(true);
      setShowOps(true);
      setShowTable(true);
    } catch (e: any) {
      setError(e.message ?? "AI request failed");
    } finally {
      setLoading(false);
    }
  }

  /* ------------------------- PubChem ------------------------- */

  async function findMatches(name: string) {
    setError(null);
    try {
      const res = await fetch(`/api/chem/search?q=${encodeURIComponent(name)}`);
      const data = await res.json().catch(() => ({}));
      const matches: PubChemMatch[] = Array.isArray(data?.results) ? data.results : [];

      setChemStates((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          matches,
          selectedCid: matches?.[0]?.cid ?? null,
        },
      }));
    } catch (e: any) {
      setError(e.message ?? "Match lookup failed");
    }
  }

  function confirmCid(name: string) {
    setChemStates((prev) => ({
      ...prev,
      [name]: { ...prev[name], confirmedCid: prev[name].selectedCid },
    }));
  }

  async function fetchProperties(name: string) {
    setError(null);
    const cid = chemStates[name]?.confirmedCid;
    if (!cid) {
      setError(`Confirm CID first for "${name}".`);
      return;
    }

    try {
      const res = await fetch(`/api/chem/properties?cid=${encodeURIComponent(cid)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error ?? "Failed to fetch properties");

      setProperties((prev) => ({ ...prev, [name]: data }));
    } catch (e: any) {
      setError(e.message ?? "Property fetch failed");
    }
  }

  async function fetchGhs(name: string) {
    setError(null);
    const cid = chemStates[name]?.confirmedCid;
    if (!cid) {
      setError(`Confirm CID first for "${name}".`);
      return;
    }

    try {
      const res = await fetch(`/api/chem/ghs?cid=${encodeURIComponent(cid)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error ?? "Failed to fetch GHS");

      setGhsData((prev) => ({ ...prev, [name]: data }));
    } catch (e: any) {
      setError(e.message ?? "GHS fetch failed");
    }
  }

  async function fetchAllForChem(name: string) {
    await Promise.all([fetchProperties(name), fetchGhs(name)]);
  }

  async function fetchAllChemicals() {
    if (!analysis?.chemicals?.length) return;
    // Only fetch for confirmed CIDs, to avoid wrong picks
    const confirmed = analysis.chemicals.filter((c) => !!chemStates[c]?.confirmedCid);
    if (!confirmed.length) {
      setError("Confirm at least one CID first, then use Fetch all.");
      return;
    }
    for (const c of confirmed) {
      // sequential keeps it calmer on rate limits
      // (and avoids PubChem throttling)
      await fetchAllForChem(c);
    }
  }

  /* ------------------------- Derived ------------------------- */

  const operationRisks = useMemo(
    () => (analysis ? operationHazards(analysis.operations) : []),
    [analysis]
  );

  const unitLabel = unitSystem === "metric" ? "Metric (°C)" : "Imperial (°F)";

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
        boiling: p ? displayTemp(p.boilingPoint, unitSystem) : "—",
        flash: p ? displayTemp(p.flashPoint, unitSystem) : "—",
        melting: p ? displayTemp(p.meltingOrFreezingPoint, unitSystem) : "—",
        ghs: shortGhs(g),
      };
    });
  }, [analysis, chemStates, properties, ghsData, unitSystem]);

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

      {error && (
        <div className="alert">
          <div className="alertTitle">Something went wrong</div>
          <pre className="alertBody">{error}</pre>
        </div>
      )}

      {/* Step 1 */}
      <section className="card">
        <div className="cardHead">
          <div>
            <div className="step">Step 1</div>
            <h2 className="cardTitle">Paste procedure</h2>
            <p className="muted">
              Paste a lab method (paragraphs are best). We’ll extract likely chemicals + operations.
            </p>
          </div>

          <button
            className={`btn ${canAnalyse ? "btnPrimary" : "btnDisabled"}`}
            onClick={analyseProcedure}
            disabled={!canAnalyse || loading}
            title={!canAnalyse ? "Paste a longer procedure first (20+ chars)" : ""}
          >
            {loading ? "Analysing…" : "Analyse procedure"}
          </button>
        </div>

        <textarea
          className="textarea"
          rows={10}
          value={procedure}
          onChange={(e) => setProcedure(e.target.value)}
          placeholder="Example: Add ethanol (10 mL) to a round-bottom flask. Cool in an ice bath, then add acetic acid dropwise..."
        />

        <div className="hintRow">
          <span className="pill">Tip: include quantities + key verbs (add, heat, reflux, quench, extract)</span>
        </div>
      </section>

      {/* Step 2 */}
      <section className="card">
        <div className="cardHead">
          <div>
            <div className="step">Step 2</div>
            <h2 className="cardTitle">Review chemicals</h2>
            <p className="muted">
              Confirm the correct PubChem match (CID). This prevents “wrong picks”.
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
              className={`btn btnSecondary`}
              onClick={fetchAllChemicals}
              disabled={!analysis || !(analysis?.chemicals?.length)}
              title="Fetch properties + GHS for confirmed chemicals"
            >
              Fetch all (confirmed)
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

              return (
                <div key={c} className="chemCard">
                  <div className="chemTop">
                    <div>
                      <div className="chemName">{c}</div>
                      {confirmed ? (
                        <span className="chip chipOk">Confirmed CID {confirmed}</span>
                      ) : (
                        <span className="chip chipWarn">Not confirmed</span>
                      )}
                    </div>

                    <div className="chemBtns">
                      <button className="btn btnGhost" onClick={() => findMatches(c)}>
                        Find matches
                      </button>
                      <button
                        className={`btn ${st?.selectedCid ? "btnPrimary" : "btnDisabled"}`}
                        onClick={() => confirmCid(c)}
                        disabled={!st?.selectedCid}
                        title={!st?.selectedCid ? "Select a match first" : ""}
                      >
                        Confirm
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
                        <option value="">(Click “Find matches”)</option>
                      ) : (
                        st.matches.map((m) => (
                          <option key={m.cid} value={m.cid}>
                            {m.title} (CID {m.cid})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="chemActionRow">
                    <button
                      className={`btn btnSecondary`}
                      onClick={() => fetchProperties(c)}
                      disabled={!confirmed}
                      title={!confirmed ? "Confirm CID first" : ""}
                    >
                      Get properties
                    </button>
                    <button
                      className={`btn btnSecondary`}
                      onClick={() => fetchGhs(c)}
                      disabled={!confirmed}
                      title={!confirmed ? "Confirm CID first" : ""}
                    >
                      Get GHS
                    </button>
                    <button
                      className={`btn btnGhost`}
                      onClick={() => fetchAllForChem(c)}
                      disabled={!confirmed}
                      title={!confirmed ? "Confirm CID first" : ""}
                    >
                      Get both
                    </button>
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
                        <span className="miniVal">{ghs?.pictograms?.length ? ghs.pictograms.join(", ") : "—"}</span>
                      </div>
                      <div className="miniFoot">
                        {ghs?.hazardStatements?.length ? (
                          <div className="muted">
                            {ghs.hazardStatements.slice(0, 4).map((h, i) => (
                              <div key={i} className="bullet">
                                • {h}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">Hazard statements: —</span>
                        )}
                      </div>
                      <div className="miniFoot">
                        {ghs?.source ? (
                          <a className="link" href={ghs.source} target="_blank" rel="noreferrer">
                            Source: PubChem
                          </a>
                        ) : (
                          <span className="muted">Source: —</span>
                        )}
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
              Auto-fills properties + GHS summary. Students fill controls/PPE/risk rating.
            </p>
          </div>

          <button className="btn btnGhost" onClick={() => setShowTable((s) => !s)} disabled={!analysis}>
            {showTable ? "Collapse" : "Expand"}
          </button>
        </div>

        {!analysis ? (
          <div className="empty">Run “Analyse procedure” first.</div>
        ) : showTable ? (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Chemical</th>
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
                    <td>{r.cid ?? "—"}</td>
                    <td>{r.boiling}</td>
                    <td>{r.flash}</td>
                    <td>{r.melting}</td>
                    <td className="tdWide">{r.ghs}</td>
                    <td className="tdMuted">e.g., fume hood, PPE, spill kit, no ignition sources…</td>
                  </tr>
                ))}
                {!tableRows.length && (
                  <tr>
                    <td colSpan={7} className="tdMuted">
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
          justify-content: flex-start;
          margin-top: 10px;
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

        .chemActionRow {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 10px;
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
          min-width: 980px;
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
      `}</style>
    </main>
  );
}
