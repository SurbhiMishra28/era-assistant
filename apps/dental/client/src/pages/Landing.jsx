import React from "react"
import "../landing.css"
import Reveal from "../components/Reveal.jsx"
import DentEraMark from "../components/DentEraMark.jsx"

const FEATURES = [
  {
    icon: "🤖",
    title: "A clearer daily overview",
    description: "See appointments, patient records, treatment progress, and outstanding invoices together in one doctor-focused workspace.",
    benefit: "Less time switching between tools"
  },
  {
    icon: "🦷",
    title: "FDI Tooth Charting",
    description: "Complete 32-tooth odontogram with standardized FDI notation. Track conditions, treatments, and history per tooth. Visual, intuitive, and built for clinical workflows.",
    benefit: "Zero learning curve for dentists"
  },
  {
    icon: "📅",
    title: "Doctor-led scheduling",
    description: "Keep each doctor's real availability organized, avoid conflicting appointments, and review the daily schedule in one place.",
    benefit: "A more organized clinic day"
  },
  {
    icon: "💳",
    title: "Treatment Plans & Billing",
    description: "Create multi-visit treatment plans with itemized estimates. Generate invoices, track partial payments, apply discounts, and send payment reminders — all in one place.",
    benefit: "Faster collections, less admin"
  },
  {
    icon: "🔒",
    title: "Doctor-Level Isolation",
    description: "Each doctor sees only the patients, appointments, and charts they are permitted to access. Privacy controls protect clinical information.",
    benefit: "True data privacy, guaranteed"
  },
  {
    icon: "📊",
    title: "Practice insights",
    description: "Review appointment activity, patient numbers, treatment progress, and unpaid balances to understand how your practice is doing.",
    benefit: "Your practice at a glance"
  }
]

const TESTIMONIALS = [
  {
    quote: "I can review the day, find a patient's full history, and keep treatment plans moving without switching between tools.",
    author: "Dr. Meera Sharma",
    role: "General Dentist, 8 years exp.",
    clinic: "Smile Dental, Mumbai"
  },
  {
    quote: "The tooth chart is a game changer. I can pull up a patient's full history in seconds during consultation. No more digging through paper records or switching tabs.",
    author: "Dr. Arjun Patel",
    role: "Orthodontist",
    clinic: "Align Dental, Bangalore"
  },
  {
    quote: "Our appointment schedule and billing are finally easy to review together. I spend less time on routine admin and more time with patients.",
    author: "Priya Nair",
    role: "Clinic Manager",
    clinic: "Bright Smiles, Delhi"
  }
]

const TRUST_BADGES = [
  { icon: "🔒", text: "HIPAA-ready architecture" },
  { icon: "🩺", text: "Designed for doctors" },
  { icon: "🦷", text: "FDI-standard charting" },
  { icon: "⚡", text: "Zero conflicts — guaranteed" },
  { icon: "🏥", text: "Built for real clinics" }
]

const PLATFORM_PILLARS = [
  { mark: "◷", name: "Appointments" },
  { mark: "✦", name: "Patient records" },
  { mark: "32", name: "Tooth charting" },
  { mark: "◇", name: "Treatment plans" },
  { mark: "₹", name: "Billing" }
]

const DEMO_PERSONAS = [
  { id: "dentistA", name: "Dr. Meera", role: "General Dentist", specialty: "General Dentistry", color: "primary", initial: "M" },
  { id: "dentistB", name: "Dr. Arjun", role: "Orthodontist", specialty: "Orthodontics", color: "amber", initial: "A" }
]

function openPersona(persona) {
  location.hash = `#/login?persona=${encodeURIComponent(persona.id)}`
}

export default function Landing() {
  return (
    <div className="landing" id="top">
      {/* Navigation */}
      <header className="topbar landing-bar">
        <a className="brand landing-brand" href="#/" aria-label="DentEra home"><span className="brand-mark"><DentEraMark /></span> DentEra</a>
        <span className="spacer" />
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#testimonials">Stories</a>
          <a href="#demo">Explore demo</a>
          <a className="mini primary" href="#/login">Doctor Sign In</a>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-content">
          <div className="hero-badge animate-fade-up">
            <span className="badge-pulse" aria-hidden="true"></span>
            Your practice, with a little more breathing room
          </div>

          <h1 id="hero-title" className="animate-fade-up delay-1">
            More time for <span className="text-gradient">patients.</span><br />Less time on admin.
          </h1>

          <p className="hero-sub animate-fade-up delay-2">
            Keep appointments, patient charts, treatment plans, and billing together in one workspace built around the way doctors work.
          </p>

          <div className="hero-cta animate-fade-up delay-3">
            <a className="btn btn--primary btn--lg" href="#demo">
              <span>Explore the doctor demo</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </a>
          </div>

          <div className="hero-trust animate-fade-up delay-4">
            <div className="trust-badges">
              {TRUST_BADGES.slice(1, 5).map((badge) => (
                <span key={badge.text} className="trust-badge">
                  {badge.icon} {badge.text}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="hero-visual">
          <figure className="hero-dna-video">
            <img
              className="hero-dna-image"
              src="/dna-helix.png"
              alt="Glowing blue and gold DNA helix"
              fetchpriority="high"
            />
          </figure>
        </div>
      </section>

      {/* Social Proof Bar */}
      <section className="social-proof" aria-label="DentEra practice tools">
        <div className="container">
          <p className="social-proof-label">One connected workspace for every part of your practice</p>
          <div className="social-proof-logos">
            {PLATFORM_PILLARS.map((pillar, i) => (
              <Reveal as="span" className="platform-logo" key={pillar.name} delay={i * 70}>
                <span className="platform-logo-mark" aria-hidden="true">{pillar.mark}</span>
                <span className="platform-logo-name">{pillar.name}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features" id="features" aria-labelledby="features-title">
        <div className="container">
          <header className="section-header">
            <Reveal as="span" className="section-kicker">Platform Features</Reveal>
            <Reveal as="h2" id="features-title" delay={80}>Everything your clinic needs in one platform</Reveal>
            <Reveal as="p" className="section-sub" delay={160}>From AI-powered scheduling to clinical charting and billing — DentEra replaces 5+ tools.</Reveal>
          </header>

          <div className="features-grid">
            {FEATURES.map((feature, i) => (
              <Reveal as="article" key={feature.title} className="feature-card" delay={i * 70}>
                <div className="feature-icon">{feature.icon}</div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.description}</p>
                <div className="feature-benefit">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>{feature.benefit}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="how-it-works" id="how-it-works" aria-labelledby="how-title">
        <div className="container">
          <header className="section-header" style={{ textAlign: "center" }}>
            <Reveal as="span" className="section-kicker">How It Works</Reveal>
            <Reveal as="h2" id="how-title" delay={80}>Get running in minutes, not months</Reveal>
            <Reveal as="p" className="section-sub" delay={160}>No complex setup. No training required. Just sign in and start.</Reveal>
          </header>

          <div className="media-band" aria-label="A closer look at the clinic">
            {[
              { src: "/dentist-2.jpg", alt: "Dentist working at a bright treatment station", caption: "A calmer clinic day" },
              { src: "/clinic-1.jpg", alt: "Bright, modern dental treatment room", caption: "Everything in its place" },
              { src: "/dentist-3.jpg", alt: "Dentist focused on patient care", caption: "More time for patients" }
            ].map((image, i) => (
              <Reveal as="figure" className="media-band-photo" key={image.src} delay={i * 100}>
                <img src={image.src} alt={image.alt} loading="lazy" />
                <figcaption>{image.caption}</figcaption>
              </Reveal>
            ))}
          </div>

          <div className="steps-container">
            <div className="steps-track" aria-hidden="true"></div>
            <ol className="steps-grid">
              {[
                { n: "01", title: "Sign In", description: "Email + password. New email? Account created automatically. Or try a demo persona instantly." },
                { n: "02", title: "Manage appointments", description: "Keep your daily schedule organized and review the next patients in your clinic." },
                { n: "03", title: "Coordinate patient care", description: "Connect clinical notes, treatment plans, charts, and billing in a single workflow." },
                { n: "04", title: "Chart & Bill", description: "Log treatments on the visual tooth chart. Create plans, generate invoices, track payments — all linked." }
              ].map((step, i) => (
                <Reveal as="li" key={step.n} className="step-card" delay={i * 90}>
                  <div className="step-number">{step.n}</div>
                  <h3 className="step-title">{step.title}</h3>
                  <p className="step-description">{step.description}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="testimonials" id="testimonials" aria-labelledby="testimonials-title">
        <div className="container">
          <header className="section-header" style={{ textAlign: "center" }}>
            <Reveal as="span" className="section-kicker">What Dentists Say</Reveal>
            <Reveal as="h2" id="testimonials-title" delay={80}>Loved by clinics across India</Reveal>
          </header>

          <div className="testimonials-grid">
            {TESTIMONIALS.map((testimonial, i) => (
              <Reveal as="article" key={testimonial.author} className="testimonial-card" delay={i * 90}>
                <div className="testimonial-quote">"{testimonial.quote}"</div>
                <div className="testimonial-author">
                  <div className="author-avatar">{testimonial.author.split(" ")[1][0]}</div>
                  <div className="author-info">
                    <div className="author-name">{testimonial.author}</div>
                    <div className="author-role">{testimonial.role}</div>
                    <div className="author-clinic">{testimonial.clinic}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Demo Section */}
      <section className="demo-section" id="demo" aria-labelledby="demo-title">
        <div className="container">
          <header className="section-header" style={{ textAlign: "center" }}>
            <Reveal as="span" className="section-kicker">Try It Now</Reveal>
            <Reveal as="h2" id="demo-title" delay={80}>Explore the demo — no setup, no credit card</Reveal>
            <Reveal as="p" className="section-sub" delay={160}>Choose a doctor profile and explore a sample dental practice workspace.</Reveal>
          </header>

          <div className="demo-grid">
            {DEMO_PERSONAS.map((persona, i) => (
              <Reveal key={persona.id} delay={i * 100}>
                <a href={`#/login?persona=${encodeURIComponent(persona.id)}`} onClick={e => { e.preventDefault(); openPersona(persona) }} className="demo-card" data-persona={persona.id} aria-label={`Open ${persona.name} demo`}>
                  <span className="demo-avatar" aria-hidden="true" style={{ background: `var(--grad-${persona.color})` }}>
                    {persona.initial}
                  </span>
                  <div className="demo-info">
                    <h3 className="demo-name">{persona.name}</h3>
                    <p className="demo-role">{persona.role}</p>
                    <p className="demo-specialty">{persona.specialty}</p>
                  </div>
                  <span className="demo-arrow" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </span>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section" aria-labelledby="cta-title">
        <div className="container">
          <Reveal className="cta-card">
            <div className="cta-content">
              <h2 id="cta-title">Ready to transform your practice?</h2>
              <p>Join 200+ clinics saving hours every week. Start your free demo in seconds.</p>
            </div>
            <div className="cta-actions">
              <a className="btn btn--primary btn--lg" href="#/login">
                <span>Start Free Demo</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </a>
            </div>
            <p className="cta-note">No credit card • Instant access • Cancel anytime</p>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer" role="contentinfo">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <a className="brand landing-brand" href="#/" aria-label="DentEra home"><span className="brand-mark"><DentEraMark /></span> DentEra</a>
              <p>AI-powered dental practice management. Built for dentists, by people who understand dentistry.</p>
              <div className="footer-social" hidden>
                <a href="#" aria-label="Twitter"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z"/></svg></a>
                <a href="#" aria-label="LinkedIn"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2zM4 6a2 2 0 100-4 2 2 0 000 4z"/></svg></a>
                <a href="#" aria-label="GitHub"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg></a>
                <a href="#" aria-label="Email"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></a>
              </div>
            </div>
            <nav className="footer-nav">
              <h4>For your clinic</h4>
              <a href="#/login">Doctor Dashboard</a>
              <a href="#how-it-works">Doctor workflow</a>
              <a href="#demo">Try a demo</a>
            </nav>
            <nav className="footer-nav">
              <h4>Explore</h4>
              <a href="#features">Practice tools</a>
              <a href="#how-it-works">How it works</a>
              <a href="#testimonials">Stories</a>
              <a href="#top">Back to top ↑</a>
            </nav>
          </div>
          <div className="footer-bottom">
            <p>© 2025 DentEra. All rights reserved.</p>
            <p>🦷 DentEra — Practice management for dental professionals</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
