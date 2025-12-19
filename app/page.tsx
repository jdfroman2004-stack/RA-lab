import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 900,
        margin: "60px auto",
        padding: 20,
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ fontSize: 36, fontWeight: 800 }}>
        Lab Risk Assessment Assistant
      </h1>

      <p style={{ marginTop: 16, fontSize: 18 }}>
        Paste your laboratory procedure, extract chemicals and operations,
        pull key safety-relevant properties, and build a structured risk
        assessment.
      </p>

      <ul style={{ marginTop: 20, fontSize: 16 }}>
        <li>✔ AI-assisted procedure parsing</li>
        <li>✔ Automatic boiling / flash / melting point lookup</li>
        <li>✔ Student-controlled risk reasoning</li>
      </ul>

      <Link
        href="/wizard"
        style={{
          display: "inline-block",
          marginTop: 30,
          padding: "14px 20px",
          borderRadius: 8,
          backgroundColor: "#111",
          color: "#fff",
          textDecoration: "none",
          fontWeight: 700,
        }}
      >
        Start Risk Assessment →
      </Link>
    </main>
  );
}
