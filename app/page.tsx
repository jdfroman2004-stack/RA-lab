import Link from "next/link";

export default function Home() {
  return (
    <main className="landing">
      <section className="hero">
        <div className="badge">Built by a Curtin student, for Curtin students</div>
        <h1>
          Lab risk assessments,
          <br />
          without the lookup grind.
        </h1>
        <p className="lede">
          Paste your procedure — or photograph the lab manual page — and RA-Lab finds the
          chemicals, pulls boiling / melting / flash points and GHS classifications from
          PubChem, and drops it all into your RA sheet ready to download.
        </p>
        <div className="ctaRow">
          <Link href="/wizard" className="cta">
            Start a risk assessment →
          </Link>
        </div>
        <p className="time">Takes about 2 minutes. Works on your phone.</p>
      </section>

      <section className="steps">
        <div className="stepCard">
          <div className="num">1</div>
          <h3>Paste or snap</h3>
          <p>Paste the procedure text, or take a photo of the lab manual page straight from your phone.</p>
        </div>
        <div className="stepCard">
          <div className="num">2</div>
          <h3>Confirm the matches</h3>
          <p>
            Each chemical is matched to PubChem with the top hit pre-selected. You sanity-check the
            match — this is the step that stops wrong-compound data.
          </p>
        </div>
        <div className="stepCard">
          <div className="num">3</div>
          <h3>Download your RA</h3>
          <p>
            Properties, quantities and GHS data auto-fill into the CHEM2006 form or a generic RA
            sheet. Print it, finish it, get it signed.
          </p>
        </div>
      </section>

      <section className="honest">
        <h2>What this tool deliberately doesn&apos;t do</h2>
        <p>
          RA-Lab does the <strong>lookups</strong>, not the <strong>thinking</strong>. It will never
          fill in your risk ratings, controls, PPE choices or emergency procedures — that&apos;s
          your assessment to make, and it&apos;s what your demonstrator signs off on. Always verify
          auto-filled values against the supplier SDS before starting work.
        </p>
      </section>

      <footer className="foot">
        <span>Data sourced live from PubChem (NIH).</span>
        <span>Questions or a wrong value? Talk to your unit coordinator or lab demonstrator.</span>
      </footer>
    </main>
  );
}
