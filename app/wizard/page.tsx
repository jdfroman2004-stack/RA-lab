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
  for (const op of ops.map(o => o.toLowerCase())) {
    if (op.includes("reflux") || op.includes("heat")) {
      hazards.add("Burn hazard from hot surfaces");
      hazards.add("Flammable vapour ignition risk");
    }
    if (op.includes("quench") || op.includes("dropwise")) {
      hazards.add("Exothermic reaction / splashing risk");
    }
    if (op.includes("rotavap") || op.includes("distill")) {
      hazards.add("Vacuum / glassware implosion risk");
    }
    if (op.includes("extract") || op.includes("separatory")) {
      hazards.add("Pressure build-up in separatory funnel");
    }
  }
  return Array.from(hazards);
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

      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "AI request failed");

      setAnalysis(data);

      const init: Record<string, ChemState> = {};
      data.chemicals.forEach((c: string) => {
        init[c] = { name: c, matches: [], selectedCid: null, confirmedCid: null };
      });
      setChemStates(init);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  /* ------------------------- PubChem ------------------------- */

  async function findMatches(name: string) {
    const res = await fetch(`/api/chem/search?q=${encodeURIComponent(name)}`);
    const data = await res.json();

    setChemStates(prev => ({
      ...prev,
      [name]: {
        ...prev[name],
        matches: data.results,
        selectedCid: data.results?.[0]?.cid ?? null,
      },
    }));
  }

  function confirmCid(name: string) {
    setChemStates(prev => ({
      ...prev,
      [name]: { ...prev[name], confirmedCid: prev[name].selectedCid },
    }));
  }

  async function fetchProperties(name: string) {
    const cid = chemStates[name]?.confirmedCid;
    if (!cid) return;

    const res = await fetch(`/api/chem/properties?cid=${cid}`);
    const data = await res.json();

    setProperties(prev => ({ ...prev, [name]: data }));
  }

  async function fetchGhs(name: string) {
    const cid = chemStates[name]?.confirmedCid;
    if (!cid) return;

    const res = await fetch(`/api/chem/ghs?cid=${cid}`);
    const data = await res.json();

    setGhsData(prev => ({ ...prev, [name]: data }));
  }

  /* ------------------------- Derived ------------------------- */

  const operationRisks = useMemo(
    () => (analysis ? operationHazards(analysis.operations) : []),
    [analysis]
  );

  /* ------------------------- Render ------------------------- */

  return (
    <main style={{ maxWidth: 1100, margin: "40px auto", padding: 20 }}>
      <h1>Risk Assessment Wizard</h1>

      <label>
        Units:&nbsp;
        <select value={unitSystem} onChange={e => setUnitSystem(e.target.value as UnitSystem)}>
          <option value="metric">Metric (°C)</option>
          <option value="imperial">Imperial (°F)</option>
        </select>
      </label>

      <h2>1. Paste Procedure</h2>
      <textarea
        rows={10}
        value={procedure}
        onChange={e => setProcedure(e.target.value)}
        style={{ width: "100%" }}
      />

      <button disabled={loading} onClick={analyseProcedure}>
        {loading ? "Analysing…" : "Analyse Procedure"}
      </button>

      {error && <pre style={{ color: "red" }}>{error}</pre>}

      {analysis && (
        <>
          <h2>2. Chemicals</h2>

          {analysis.chemicals.map(c => (
            <div key={c} style={{ borderBottom: "1px solid #ddd", marginBottom: 12 }}>
              <b>{c}</b>
              <br />

              <button onClick={() => findMatches(c)}>Find matches</button>

              <select
                value={chemStates[c].selectedCid ?? ""}
                onChange={e =>
                  setChemStates(prev => ({
                    ...prev,
                    [c]: { ...prev[c], selectedCid: Number(e.target.value) },
                  }))
                }
              >
                <option value="">—</option>
                {chemStates[c].matches.map(m => (
                  <option key={m.cid} value={m.cid}>
                    {m.title} (CID {m.cid})
                  </option>
                ))}
              </select>

              <button onClick={() => confirmCid(c)}>Confirm</button>
              <button onClick={() => fetchProperties(c)}>Get properties</button>
              <button onClick={() => fetchGhs(c)}>Get GHS</button>

              {properties[c] && (
                <ul>
                  <li>Boiling: {displayTemp(properties[c].boilingPoint, unitSystem)}</li>
                  <li>Flash: {displayTemp(properties[c].flashPoint, unitSystem)}</li>
                  <li>Melting: {displayTemp(properties[c].meltingOrFreezingPoint, unitSystem)}</li>
                </ul>
              )}

              {ghsData[c] && (
                <div>
                  <b>GHS:</b>
                  <div>Signal word: {ghsData[c].signalWord ?? "—"}</div>
                  <div>Pictograms: {ghsData[c].pictograms.join(", ") || "—"}</div>
                  <ul>
                    {ghsData[c].hazardStatements.slice(0, 6).map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}

          <h2>3. Operation Hazards</h2>
          <ul>
            {operationRisks.map(h => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
