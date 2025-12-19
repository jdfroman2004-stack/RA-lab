"use client";

import { useMemo, useState } from "react";

type AnalysisResult = {
  chemicals: string[];
  operations: string[];
  extracted?: any;
};

type ChemicalProperties = {
  boilingPoint: string | null;
  flashPoint: string | null;
  meltingOrFreezingPoint: string | null;
  source: string;
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

function fToC(f: number) {
  return (f - 32) * (5 / 9);
}
function formatC(c: number) {
  return `${c.toFixed(1)} °C`;
}
function convertTempStringToMetric(s: string): string {
  const re = /(-?\d+(?:\.\d+)?)\s*°?\s*F\b/i;
  const m = s.match(re);
  if (!m) return s;
  const f = Number(m[1]);
  if (Number.isNaN(f)) return s;
  return s.replace(re, formatC(fToC(f)));
}
function displayValue(value: string | null | undefined, unitSystem: UnitSystem) {
  if (!value) return "—";
  if (unitSystem === "metric") {
    if (/°\s*F\b/i.test(value) || /\b°F\b/i.test(value)) return convertTempStringToMetric(value);
  }
  return value;
}

function normalizeOp(op: string) {
  return op.toLowerCase();
}

// Simple operation→hazard mapping (MVP rules)
function hazardsFromOperations(ops: string[]) {
  const hazards = new Set<string>();
  for (const op of ops) {
    const t = normalizeOp(op);

    if (t.includes("reflux") || t.includes("heat") || t.includes("hot")) {
      hazards.add("Heat / hot surfaces (burns)");
      hazards.add("Hot solvent vapours (inhalation / ignition risk)");
    }
    if (t.includes("ice bath") || t.includes("cool")) {
      hazards.add("Cold burns / thermal shock (ice bath / chilled glass)");
    }
    if (t.includes("quench") || t.includes("dropwise") || t.includes("gas evolution")) {
      hazards.add("Exothermic quench / splashing");
      hazards.add("Pressure build-up / gas evolution (venting required)");
    }
    if (t.includes("separatory") || t.includes("extract") || t.includes("wash")) {
      hazards.add("Pressure in separatory funnel (vent frequently)");
      hazards.add("Solvent exposure during liquid-liquid extraction");
    }
    if (t.includes("distill") || t.includes("evaporat") || t.includes("rotavap") || t.includes("reduced pressure")) {
      hazards.add("Vacuum / glass implosion risk");
      hazards.add("Concentrated solvent vapours");
    }
    if (t.includes("chromatograph") || t.includes("column") || t.includes("silica")) {
      hazards.add("Flammable solvent exposure during chromatography");
      hazards.add("Silica dust/skin irritation (handling dry silica)");
    }
    if (t.includes("filter") || t.includes("vacuum filtration")) {
      hazards.add("Vacuum filtration / glassware breakage risk");
    }
  }
  return Array.from(hazards);
}

export default function Wizard() {
  const [procedure, setProcedure] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [properties, setProperties] = useState<Record<string, ChemicalProperties>>({});
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric");

  // NEW: per-chemical mapping state
  const [chemStates, setChemStates] = useState<Record<string, ChemState>>({});

  async function analyseProcedure() {
    setLoading(true);
    setErrorMsg(null);
    setResult(null);
    setProperties({});
    setChemStates({});

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
        setErrorMsg(msg);
        return;
      }

      const chemicals = Array.isArray(data.chemicals) ? data.chemicals : [];
      const operations = Array.isArray(data.operations) ? data.operations : [];

      setResult({
        chemicals,
        operations,
        extracted: data.extracted,
      });

      // Initialize chem states
      const init: Record<string, ChemState> = {};
      for (const name of chemicals) {
        init[name] = {
          name,
          matches: [],
          selectedCid: null,
          confirmedCid: null,
        };
      }
      setChemStates(init);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // NEW: find top PubChem matches for a chemical name
  async function findMatches(name: string) {
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/chem/search?q=${encodeURIComponent(name)}`);
      const data = await res.json().catch(() => ({}));
      const matches: PubChemMatch[] = Array.isArray(data?.results) ? data.results : [];

      setChemStates((prev) => {
        const cur = prev[name];
        if (!cur) return prev;
        return {
          ...prev,
          [name]: {
            ...cur,
            matches,
            selectedCid: matches[0]?.cid ?? null,
          },
        };
      });
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Match lookup failed");
    }
  }

  // NEW: confirm/lock selection
  function confirmCid(name: string) {
    setChemStates((prev) => {
      const cur = prev[name];
      if (!cur) return prev;
      return {
        ...prev,
        [name]: {
          ...cur,
          confirmedCid: cur.selectedCid,
        },
      };
    });
  }

  // Updated: get properties uses confirmed CID if available
  async function fetchProperties(name: string) {
    setErrorMsg(null);

    try {
      const state = chemStates[name];
      const cid =
        state?.confirmedCid ??
        state?.selectedCid ??
        null;

      // If no CID selected yet, fetch matches first
      if (!cid) {
        await findMatches(name);
        return;
      }

      const propRes = await fetch(`/api/chem/properties?cid=${encodeURIComponent(cid)}`);
      const propData = await propRes.json().catch(() => ({}));

      if (!propRes.ok || propData?.error) {
        setErrorMsg(propData?.error ? String(propData.error) : `Failed to fetch properties for "${name}"`);
        return;
      }

      setProperties((prev) => ({
        ...prev,
        [name]: propData,
      }));
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Property fetch failed");
    }
  }

  const chemicals = result?.chemicals ?? [];
  const operations = result?.operations ?? [];

  const opHazards = useMemo(() => hazardsFromOperations(operations), [operations]);

  // RA table rows (MVP skeleton)
  const raRows = useMemo(() => {
    return chemicals.map((chem) => {
      const s = chemStates[chem];
      const cid = s?.confirmedCid ?? null;
      const p = properties[chem];

      return {
        chem,
        cid,
        boiling: p ? displayValue(p.boilingPoint, unitSystem) : "—",
        flash: p ? displayValue(p.flashPoint, unitSystem) : "—",
        melting: p ? displayValue(p.meltingOrFreezingPoint, unitSystem) : "—",
      };
    });
  }, [chemicals, chemStates, properties, unitSystem]);

  const unitLabel = useMemo(
    () => (unitSystem === "metric" ? "Metric (°C)" : "Imperial (°F)"),
    [unitSystem]
  );

  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 20, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Risk Assessment Wizard</h1>

      {/* Units */}
      <section style={{ marginTop: 12 }}>
        <label style={{ fontWeight: 700, marginRight: 10 }}>Units:</label>
        <select
          value={unitSystem}
          onChange={(e) => setUnitSystem(e.target.value as UnitSystem)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}
        >
          <option value="metric">Metric (°C)</option>
          <option value="imperial">Imperial (°F)</option>
        </select>
        <span style={{ marginLeft: 10, color: "#555" }}>{unitLabel}</span>
      </section>

      {/* Step 1 */}
      <section style={{ marginTop: 20 }}>
        <h2>Step 1 — Paste Procedure</h2>

        <textarea
          value={procedure}
          onChange={(e) => setProcedure(e.target.value)}
          rows={12}
          placeholder="Paste your laboratory procedure here..."
          style={{ width: "100%", marginTop: 10, padding: 12, borderRadius: 8, border: "1px solid #ccc", fontSize: 14 }}
        />

        <button
          onClick={analyseProcedure}
          disabled={procedure.trim().length < 20 || loading}
          style={{
            marginTop: 16,
            padding: "12px 18px",
            borderRadius: 8,
            border: "none",
            backgroundColor: procedure.trim().length < 20 ? "#999" : "#111",
            color: "#fff",
            fontWeight: 700,
            cursor: procedure.trim().length < 20 ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Analysing..." : "Analyse Procedure"}
        </button>

        {errorMsg && (
          <pre style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "#fff3f3", border: "1px solid #ffbdbd", color: "#8a0000", whiteSpace: "pre-wrap", fontWeight: 600 }}>
            {errorMsg}
          </pre>
        )}
      </section>

      {/* Step 2 */}
      {result && (
        <section style={{ marginTop: 30 }}>
          <h2>Step 2 — Review Extracted Information</h2>

          <h3 style={{ marginTop: 12 }}>Chemicals</h3>

          {chemicals.length ? (
            chemicals.map((chem, i) => {
              const st = chemStates[chem];
              const confirmed = st?.confirmedCid;
              const selected = st?.selectedCid;
              const matches = st?.matches ?? [];

              return (
                <div key={`${chem}-${i}`} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ minWidth: 140 }}>{chem}</strong>

                    <button
                      onClick={() => findMatches(chem)}
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc", cursor: "pointer" }}
                    >
                      Find matches
                    </button>

                    <select
                      value={selected ?? ""}
                      onChange={(e) =>
                        setChemStates((prev) => ({
                          ...prev,
                          [chem]: { ...prev[chem], selectedCid: e.target.value ? Number(e.target.value) : null },
                        }))
                      }
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc", minWidth: 340 }}
                      disabled={!matches.length}
                    >
                      {!matches.length ? (
                        <option value="">(click “Find matches”)</option>
                      ) : (
                        matches.map((m) => (
                          <option key={m.cid} value={m.cid}>
                            {m.title} (CID {m.cid})
                          </option>
                        ))
                      )}
                    </select>

                    <button
                      onClick={() => confirmCid(chem)}
                      disabled={!selected}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #111",
                        background: selected ? "#111" : "#999",
                        color: "#fff",
                        cursor: selected ? "pointer" : "not-allowed",
                      }}
                    >
                      Confirm
                    </button>

                    <button
                      onClick={() => fetchProperties(chem)}
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc", cursor: "pointer" }}
                    >
                      Get properties
                    </button>

                    <span style={{ color: confirmed ? "#0a7a2f" : "#777", fontWeight: 600 }}>
                      {confirmed ? `Confirmed CID: ${confirmed}` : "Not confirmed yet"}
                    </span>
                  </div>

                  {properties[chem] && (
                    <ul style={{ marginTop: 8 }}>
                      <li>Boiling point: {displayValue(properties[chem].boilingPoint, unitSystem)}</li>
                      <li>Flash point: {displayValue(properties[chem].flashPoint, unitSystem)}</li>
                      <li>Melting/freezing point: {displayValue(properties[chem].meltingOrFreezingPoint, unitSystem)}</li>
                      <li>
                        Source:{" "}
                        <a href={properties[chem].source} target="_blank" rel="noreferrer">
                          PubChem
                        </a>
                      </li>
                    </ul>
                  )}
                </div>
              );
            })
          ) : (
            <p>No chemicals detected.</p>
          )}

          <h3 style={{ marginTop: 20 }}>Operations</h3>
          {operations.length ? (
            <ul>
              {operations.map((op, i) => (
                <li key={`${op}-${i}`}>{op}</li>
              ))}
            </ul>
          ) : (
            <p>No operations detected.</p>
          )}

          {/* Step 3 - Operation-linked hazards */}
          <h3 style={{ marginTop: 20 }}>Suggested Hazards From Operations</h3>
          {opHazards.length ? (
            <ul>
              {opHazards.map((h, i) => (
                <li key={`${h}-${i}`}>{h}</li>
              ))}
            </ul>
          ) : (
            <p>No operation hazards detected.</p>
          )}

          {/* RA Skeleton */}
          <h2 style={{ marginTop: 28 }}>Step 3 — Draft Risk Assessment Table (MVP)</h2>
          <p style={{ color: "#555", marginTop: 6 }}>
            This is a starter table. Students still fill in controls/PPE/risk rating — but the app pre-fills the time-wasting bits.
          </p>

          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Chemical", "Confirmed CID", "Boiling", "Flash", "Melting/Freezing", "Hazards (student edits)", "Controls (student fills)"].map((h) => (
                    <th key={h} style={{ textAlign: "left", borderBottom: "2px solid #ddd", padding: "10px 8px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {raRows.map((r) => (
                  <tr key={r.chem}>
                    <td style={{ borderBottom: "1px solid #eee", padding: "10px 8px", fontWeight: 700 }}>{r.chem}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "10px 8px" }}>{r.cid ?? "—"}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "10px 8px" }}>{r.boiling}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "10px 8px" }}>{r.flash}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "10px 8px" }}>{r.melting}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "10px 8px", color: "#555" }}>
                      (e.g., flammable, corrosive, toxic…)
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "10px 8px", color: "#555" }}>
                      (e.g., fume hood, PPE, spill kit, no ignition sources…)
                    </td>
                  </tr>
                ))}
                {!raRows.length && (
                  <tr>
                    <td colSpan={7} style={{ padding: 12, color: "#777" }}>
                      Run “Analyse Procedure” first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
