import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import './App.css'
import {
  activityFeed,
  agentTeam,
  analytics,
  launchSteps,
  navItems,
  providerAdapters,
} from './platformData'
import {
  buildPublishedSite,
  getHashRoute,
  readPublishedSites,
  readStoredDraft,
  siteUrl,
  writePublishedSites,
  writeStoredDraft,
} from './siteEngine'

const statusMeta = {
  ready: { label: 'Ready', className: 'status-ready', icon: Check },
  review: { label: 'Needs approval', className: 'status-review', icon: ShieldCheck },
  pending: { label: 'Guided setup', className: 'status-pending', icon: Clock3 },
}

function App() {
  const [business, setBusiness] = useState(readStoredDraft)
  const [publishedSites, setPublishedSites] = useState(readPublishedSites)
  const [route, setRoute] = useState(getHashRoute)
  const [activeStep, setActiveStep] = useState('domain')
  const [published, setPublished] = useState(false)
  const [agentRuns, setAgentRuns] = useState(3)

  const readyCount = useMemo(
    () => launchSteps.filter((step) => step.status === 'ready').length,
    [],
  )

  const publishProgress = published ? 100 : Math.round((readyCount / launchSteps.length) * 100)
  const latestSite = useMemo(() => {
    const sites = Object.values(publishedSites)
    return sites.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).at(-1) || null
  }, [publishedSites])

  useEffect(() => {
    const syncRoute = () => setRoute(getHashRoute())
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useEffect(() => {
    writeStoredDraft(business)
  }, [business])

  useEffect(() => {
    writePublishedSites(publishedSites)
  }, [publishedSites])

  function updateBusiness(field, value) {
    setBusiness((current) => ({ ...current, [field]: value }))
  }

  function runAgentUpdate() {
    setAgentRuns((current) => current + 1)
    setBusiness((current) => ({
      ...current,
      offer: current.offer.includes('same-week')
        ? current.offer
        : `${current.offer} Now with same-week booking and WhatsApp confirmations.`,
    }))
  }

  function publishDraft() {
    const site = buildPublishedSite(business)
    setPublishedSites((current) => ({ ...current, [site.slug]: site }))
    setPublished(true)
    window.location.hash = `/site/${site.slug}`
  }

  function copySiteUrl(slug) {
    const url = siteUrl(slug)
    navigator.clipboard?.writeText(url)
  }

  if (route.type === 'site') {
    return (
      <PublishedSite
        onBack={() => {
          window.location.hash = '/'
          setRoute({ type: 'dashboard' })
        }}
        site={publishedSites[route.slug]}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Launch Desk navigation">
        <div className="brand-lockup">
          <div className="brand-mark">LD</div>
          <div>
            <strong>Launch Desk</strong>
            <span>AI business ops</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item, index) => {
            const Icon = item.icon
            return (
              <button
                className={index === 0 ? 'nav-item active' : 'nav-item'}
                key={item.label}
                type="button"
              >
                <Icon size={17} strokeWidth={2.1} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="trust-strip">
          <LockKeyhole size={17} />
          <div>
            <strong>Approval-first agents</strong>
            <span>Domains, payments, WhatsApp blasts, and deletes require sign-off.</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Launch Desk</h1>
            <p>One guided flow to put a South African business online and keep it updated.</p>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button" onClick={runAgentUpdate}>
              <Sparkles size={16} />
              AI update
            </button>
            {latestSite ? (
              <button className="ghost-button" type="button" onClick={() => copySiteUrl(latestSite.slug)}>
                <Copy size={16} />
                Copy site link
              </button>
            ) : null}
            <button className="primary-button" type="button" onClick={publishDraft}>
              <Play size={16} fill="currentColor" />
              {published ? 'Publish update' : 'Publish draft'}
            </button>
          </div>
        </header>

        <section className="readiness-band" aria-label="Launch readiness">
          <div>
            <span>Readiness</span>
            <strong>{publishProgress}%</strong>
          </div>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${publishProgress}%` }} />
          </div>
          <p>
            {published
              ? 'The launch bundle is packaged for deployment with approvals preserved.'
              : 'Five systems are ready; domain and email need owner approval before automation proceeds.'}
          </p>
        </section>

        <section className="launch-grid">
          <BusinessProfile business={business} updateBusiness={updateBusiness} />
          <SitePreview business={business} latestSite={latestSite} />
          <LaunchChecklist
            activeStep={activeStep}
            published={published}
            setActiveStep={setActiveStep}
          />
        </section>

        <section className="lower-grid">
          <AnalyticsPanel />
          <AgentOps agentRuns={agentRuns} />
          <ArchitecturePanel />
        </section>
      </main>
    </div>
  )
}

function PublishedSite({ onBack, site }) {
  if (!site) {
    return (
      <main className="published-shell missing-site">
        <button className="ghost-button back-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to Launch Desk
        </button>
        <section className="missing-site-panel">
          <h1>Site not found</h1>
          <p>Publish the business profile again to generate a fresh site route.</p>
        </section>
      </main>
    )
  }

  const publishedDate = new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(site.publishedAt))
  const whatsappHref = `https://wa.me/${site.whatsapp.replace(/\D/g, '')}`

  return (
    <main className="published-shell">
      <header className="published-header">
        <button className="ghost-button back-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          Launch Desk
        </button>
        <nav aria-label="Published site sections">
          <a href="#services">Services</a>
          <a href="#trust">Trust</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>

      <section className="public-hero">
        <div className="public-hero-copy">
          <span>{site.industry}</span>
          <h1>{site.name}</h1>
          <p>{site.offer}</p>
          <div className="public-actions">
            <a className="public-primary" href={whatsappHref} rel="noreferrer" target="_blank">
              WhatsApp us
            </a>
            <a className="public-secondary" href={`mailto:${site.email}`}>
              Send email
            </a>
          </div>
        </div>
        <div className="public-visual" aria-label={`${site.name} visual identity`}>
          <div>
            <strong>{site.name.split(' ').slice(0, 2).map((word) => word[0]).join('')}</strong>
            <span>{site.location}</span>
          </div>
        </div>
      </section>

      <section className="public-section" id="services">
        <div className="public-section-heading">
          <h2>Services</h2>
          <p>Clear, AI-readable service pages become the foundation for Google, WhatsApp, and future agent answers.</p>
        </div>
        <div className="public-service-grid">
          {site.servicesList.map((service) => (
            <article key={service}>
              <strong>{service}</strong>
              <p>Request availability, a quote, or a deposit link through WhatsApp.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-proof-band" id="trust">
        <div>
          <strong>POPIA-ready lead form</strong>
          <span>Consent-aware inquiry capture</span>
        </div>
        <div>
          <strong>Secure payment links</strong>
          <span>No card data stored by Launch Desk</span>
        </div>
        <div>
          <strong>AI update history</strong>
          <span>Published {publishedDate}</span>
        </div>
      </section>

      <section className="public-contact" id="contact">
        <div>
          <h2>Ready to book?</h2>
          <p>{site.name} serves {site.location}. Reach out and we will respond from {site.email}.</p>
        </div>
        <div className="public-contact-actions">
          <a className="public-primary" href={whatsappHref} rel="noreferrer" target="_blank">
            Start WhatsApp chat
          </a>
          <a className="public-secondary" href={`https://${site.domain}`} rel="noreferrer" target="_blank">
            {site.domain}
          </a>
        </div>
      </section>
    </main>
  )
}

function BusinessProfile({ business, updateBusiness }) {
  return (
    <section className="panel profile-panel">
      <div className="section-heading">
        <div>
          <h2>Business Profile</h2>
          <p>The customer answers this in plain language. The platform turns it into site data.</p>
        </div>
        <span className="quiet-tag">Step 1</span>
      </div>

      <div className="field-grid">
        <label>
          Business name
          <input
            value={business.name}
            onChange={(event) => updateBusiness('name', event.target.value)}
          />
        </label>
        <label>
          Industry
          <input
            value={business.industry}
            onChange={(event) => updateBusiness('industry', event.target.value)}
          />
        </label>
        <label>
          City or service area
          <input
            value={business.location}
            onChange={(event) => updateBusiness('location', event.target.value)}
          />
        </label>
        <label>
          WhatsApp number
          <input
            value={business.whatsapp}
            onChange={(event) => updateBusiness('whatsapp', event.target.value)}
          />
        </label>
        <label>
          Preferred domain
          <input
            value={business.domain}
            onChange={(event) => updateBusiness('domain', event.target.value)}
          />
        </label>
        <label>
          Business email
          <input
            value={business.email}
            onChange={(event) => updateBusiness('email', event.target.value)}
          />
        </label>
      </div>

      <label className="wide-field">
        What do you offer?
        <textarea
          rows="3"
          value={business.offer}
          onChange={(event) => updateBusiness('offer', event.target.value)}
        />
      </label>

      <label className="wide-field">
        Services or products
        <textarea
          rows="3"
          value={business.services}
          onChange={(event) => updateBusiness('services', event.target.value)}
        />
      </label>
    </section>
  )
}

function SitePreview({ business, latestSite }) {
  const serviceList = business.services
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)

  return (
    <section className="panel preview-panel">
      <div className="section-heading">
        <div>
          <h2>Site Preview</h2>
          <p>Structured content becomes a fast, AI-readable website draft.</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Open preview"
          disabled={!latestSite}
          onClick={() => {
            if (latestSite) window.location.hash = `/site/${latestSite.slug}`
          }}
        >
          <ExternalLink size={16} />
        </button>
      </div>

      <div className="browser-frame">
        <div className="browser-bar">
          <span />
          <span />
          <span />
          <strong>{business.domain || 'starter.launchdesk.africa'}</strong>
        </div>
        <div className="website-preview">
          <div className="site-nav">
            <strong>{business.name || 'Your Business'}</strong>
            <span>{business.location || 'South Africa'}</span>
          </div>
          <div className="site-hero">
            <div>
              <h3>{business.name || 'Your Business'}</h3>
              <p>{business.offer || 'Tell customers what you do and why they should trust you.'}</p>
              <div className="site-actions">
                <button type="button">WhatsApp</button>
                <button type="button">Pay deposit</button>
              </div>
            </div>
            <div className="photo-tile" aria-hidden="true">
              <span>ZA</span>
            </div>
          </div>
          <div className="service-row">
            {serviceList.map((service) => (
              <span key={service}>{service}</span>
            ))}
          </div>
          <div className="trust-row">
            <span>POPIA-ready form</span>
            <span>Secure payment links</span>
            <span>Same-day replies</span>
          </div>
        </div>
      </div>
      {latestSite ? (
        <div className="published-route">
          <span>Live route</span>
          <button type="button" onClick={() => { window.location.hash = `/site/${latestSite.slug}` }}>
            #/site/{latestSite.slug}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function LaunchChecklist({ activeStep, published, setActiveStep }) {
  const selected = launchSteps.find((step) => step.id === activeStep) || launchSteps[0]
  const SelectedIcon = selected.icon

  return (
    <section className="panel checklist-panel">
      <div className="section-heading">
        <div>
          <h2>Ready to publish</h2>
          <p>Every integration is a provider adapter with audit and approval gates.</p>
        </div>
        <span className={published ? 'quiet-tag success' : 'quiet-tag'}>{published ? 'Packaged' : 'Draft'}</span>
      </div>

      <div className="checklist">
        {launchSteps.map((step) => {
          const Icon = step.icon
          const StatusIcon = statusMeta[step.status].icon
          return (
            <button
              className={step.id === activeStep ? 'check-row selected' : 'check-row'}
              key={step.id}
              type="button"
              onClick={() => setActiveStep(step.id)}
            >
              <span className="check-icon">
                <Icon size={18} />
              </span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.provider}</small>
              </span>
              <span className={`status-dot ${statusMeta[step.status].className}`}>
                <StatusIcon size={13} />
                {statusMeta[step.status].label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="selected-step">
        <SelectedIcon size={20} />
        <div>
          <strong>{selected.title}</strong>
          <p>{selected.detail}</p>
        </div>
        <ChevronRight size={18} />
      </div>
    </section>
  )
}

function AnalyticsPanel() {
  return (
    <section className="panel analytics-panel">
      <div className="section-heading">
        <div>
          <h2>Analytics</h2>
          <p>Plain-language growth signals, not a maze of charts.</p>
        </div>
      </div>
      <div className="metric-grid">
        {analytics.map((item) => (
          <div className={`metric-card metric-${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.change} this month</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function AgentOps({ agentRuns }) {
  return (
    <section className="panel agent-panel">
      <div className="section-heading">
        <div>
          <h2>AI Updates</h2>
          <p>A single customer assistant, backed by specialist internal agents.</p>
        </div>
        <span className="quiet-tag">{agentRuns} runs</span>
      </div>
      <div className="agent-list">
        {agentTeam.map((agent) => {
          const Icon = agent.icon
          return (
            <article key={agent.title}>
              <Icon size={18} />
              <div>
                <strong>{agent.title}</strong>
                <p>{agent.body}</p>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ArchitecturePanel() {
  return (
    <section className="panel architecture-panel">
      <div className="section-heading">
        <div>
          <h2>System Spine</h2>
          <p>Fast MVP now, enterprise adapters later.</p>
        </div>
      </div>
      <div className="adapter-cloud">
        {providerAdapters.map((adapter) => (
          <span key={adapter}>{adapter}</span>
        ))}
      </div>
      <div className="activity-feed">
        {activityFeed.map((item) => (
          <div key={item}>
            <ArrowUpRight size={14} />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default App
