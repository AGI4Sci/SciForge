type PageIntroProps = {
  eyebrow: string;
  title: string;
  lead: string;
  meta?: string;
};

export function PageIntro({ eyebrow, title, lead, meta }: PageIntroProps) {
  return (
    <section className="page-intro">
      <div className="shell page-intro-grid">
        <div>
          <p className="eyebrow eyebrow-light">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <div className="page-intro-copy">
          <p>{lead}</p>
          {meta ? <span>{meta}</span> : null}
        </div>
      </div>
    </section>
  );
}
