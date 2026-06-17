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
  navItems,
  providerAdapters,
} from './platformData'
import { evaluateAdapters, readinessScore, STATUS } from './adapters'
import {
  buildBusinessSchema,
  buildPublishedSite,
  getHashRoute,
  readPublishedSites,
  readStoredDraft,
  siteUrl,
  writePublishedSites,
  writeStoredDraft,
} from './siteEngine'
import { initialsOf, isValidEmail, slugify, whatsappLink } from './format'

const statusMeta = {
  [STATUS.READY]: { label: 'Ready', className: 'status-ready', icon: Check },
  [STATUS.REVIEW]: { label: 'Needs approval', className: 'status-review', icon: ShieldCheck },
  [STATUS.PENDING]: { label: 'Guided setup', className: 'status-pending', icon: Clock3 },
}

function App() {
  const [business, setBusiness] = useState(readStoredDraft)
  const [publishedSites, setPublishedSites] = useState(readPublishedSites)
  const [route, setRoute] = useState(getHashRoute)
  const [activeStep, setActiveStep] = useState('profile')
  const [agentRuns, setAgentRuns] = useState(3)
  const [notice, setNotice] = useState('')

  const adapters = useMemo(() => evaluateAdapters(business), [business])
  const publishProgress = useMemo(() => readinessScore(business), [business])

  // "Published" is derived from saved sites, so it survives refresh instead of
  // being a transient flag that resets to a lower readiness on reload.
  const ownSlug = slugify(business.name)
  const published = Boolean(publishedSites[ownSlug])

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

  // Clear transient confirmations so they re-announce each time.
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

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
    setNotice('AI update drafted — review it in the preview before publishing.')
  }

  function publishDraft() {
    const site = buildPublishedSite(business, publishedSites)
    setPublishedSites((current) => ({ ...current, [site.slug]: site }))
    window.location.hash = `#/site/${site.slug}`
    setNotice(`Published to #/site/${site.slug}`)
  }

  async function copySiteUrl(slug) {
    const url = siteUrl(slug)
    try {
      await navigator.clipboard?.writeText(url)
      setNotice('Site link copied to clipboard.')
    } catch {
      setNotice(`Copy failed — here is your link: ${url}`)
    }
  }

  if (route.type === 'site') {
    return (
      <PublishedSite
        onBack={() => {
          window.location.hash = '#/'
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
            const isActive = index === 0
            return (
              <button
                className={isActive ? 'nav-item active' : 'nav-item'}
                key={item.label}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                aria-disabled={isActive ? undefined : true}
                title={isActive ? undefined : 'Available once the workspace is connected'}
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

        <p className="sr-status" role="status" aria-live="polite">
          {notice}
        </p>

        <section
          className="readiness-band"
          aria-label="Launch readiness"
          role="progressbar"
          aria-valuenow={publishProgress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div>
            <span>Readiness</span>
            <strong>{publishProgress}%</strong>
          </div>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${publishProgress}%` }} />
          </div>
          <p>
            {published
              ? 'Your site is live. Automated systems are ready; approval-gated steps are waiting on your sign-off.'
              : 'Fill in the profile and connect WhatsApp to raise readiness; domain, email, and payments need your approval before automation proceeds.'}
          </p>
        </section>

        <section className="launch-grid">
          <BusinessProfile business={business} updateBusiness={updateBusiness} />
          <SitePreview business={business} latestSite={latestSite} />
          <LaunchChecklist
            activeStep={activeStep}
            adapters={adapters}
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
  useEffect(() => {
    if (!site) return undefined
    const previous = document.title
    document.title = `${site.name} — ${site.location}`
    return () => {
      document.title = previous
    }
  }, [site])

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
  const chatHref = whatsappLink(site.whatsapp, `Hi ${site.name}, I found your website and would like to know more.`)
  const schema = buildBusinessSchema(site)

  const scrollTo = (id) => () => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="published-shell">
      {/* Local SEO: structured data so the business can surface in Google's Local Pack / Maps. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

      <header className="published-header">
        <button className="ghost-button back-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          Launch Desk
        </button>
        <nav aria-label="Published site sections">
          <button type="button" className="anchor-link" onClick={scrollTo('services')}>Services</button>
          <button type="button" className="anchor-link" onClick={scrollTo('trust')}>Trust</button>
          <button type="button" className="anchor-link" onClick={scrollTo('contact')}>Contact</button>
        </nav>
      </header>

      <section className="public-hero">
        <div className="public-hero-copy">
          <span>{site.industry}</span>
          <h1>{site.name}</h1>
          <p>{site.offer}</p>
          <div className="public-actions">
            <a className="public-primary" href={chatHref} rel="noreferrer" target="_blank">
              WhatsApp us
            </a>
            <a className="public-secondary" href={`mailto:${site.email}`}>
              Send email
            </a>
          </div>
        </div>
        <div className="public-visual" aria-label={`${site.name} visual identity`}>
          <div>
            <strong>{initialsOf(site.name)}</strong>
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
        <div className="public-contact-intro">
          <h2>Ready to book?</h2>
          <p>{site.name} serves {site.location}. Reach out and we will respond from {site.email}.</p>
          <div className="public-contact-actions">
            <a className="public-primary" href={chatHref} rel="noreferrer" target="_blank">
              Start WhatsApp chat
            </a>
            {site.domain ? (
              <a className="public-secondary" href={`https://${site.domain}`} rel="noreferrer" target="_blank">
                {site.domain}
              </a>
            ) : null}
          </div>
        </div>
        <LeadForm business={site.name} />
      </section>
    </main>
  )
}

// POPIA-by-default: a purpose statement, an un-ticked separate marketing opt-in,
// and explicit consent that must be given before the enquiry can be sent.
function LeadForm({ business }) {
  const [form, setForm] = useState({ name: '', contact: '', message: '', consent: false, marketing: false })
  const [sent, setSent] = useState(false)

  const update = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [field]: value }))
  }

  const onSubmit = (event) => {
    event.preventDefault()
    if (!form.consent) return
    setSent(true)
  }

  if (sent) {
    return (
      <form className="lead-form" aria-live="polite">
        <h3>Thank you</h3>
        <p className="lead-confirm">{business} has your enquiry and will reply soon. You can withdraw consent at any time.</p>
      </form>
    )
  }

  return (
    <form className="lead-form" onSubmit={onSubmit}>
      <h3>Send an enquiry</h3>
      <p className="lead-purpose">
        We use your details only to respond to this enquiry. We never sell your data, and you can opt out at any time
        (POPIA).
      </p>
      <label>
        Your name
        <input value={form.name} onChange={update('name')} required />
      </label>
      <label>
        Phone or email
        <input value={form.contact} onChange={update('contact')} required />
      </label>
      <label>
        How can we help?
        <textarea rows="3" value={form.message} onChange={update('message')} />
      </label>
      <label className="lead-check">
        <input type="checkbox" checked={form.consent} onChange={update('consent')} required />
        <span>I consent to {business} contacting me about this enquiry.</span>
      </label>
      <label className="lead-check">
        <input type="checkbox" checked={form.marketing} onChange={update('marketing')} />
        <span>Optional: send me occasional offers and updates.</span>
      </label>
      <button className="public-primary" type="submit" disabled={!form.consent}>
        Send enquiry
      </button>
    </form>
  )
}

function BusinessProfile({ business, updateBusiness }) {
  const emailInvalid = business.email.trim().length > 0 && !isValidEmail(business.email)

  return (
    <section className="panel profile-panel">
      <div className="section-heading">
        <div>
          <h2>Business Profile</h2>
          <p>The customer answers this in plain language. The platform turns it into site data.</p>
        </div>
        <span className="quiet-tag">Step 1</span>
      </div>

      <form className="field-grid" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="bp-name">
          Business name
          <input
            id="bp-name"
            value={business.name}
            onChange={(event) => updateBusiness('name', event.target.value)}
            required
          />
        </label>
        <label htmlFor="bp-industry">
          Industry
          <input
            id="bp-industry"
            value={business.industry}
            onChange={(event) => updateBusiness('industry', event.target.value)}
          />
        </label>
        <label htmlFor="bp-location">
          City or service area
          <input
            id="bp-location"
            value={business.location}
            onChange={(event) => updateBusiness('location', event.target.value)}
          />
        </label>
        <label htmlFor="bp-whatsapp">
          WhatsApp number
          <input
            id="bp-whatsapp"
            inputMode="tel"
            value={business.whatsapp}
            onChange={(event) => updateBusiness('whatsapp', event.target.value)}
          />
        </label>
        <label htmlFor="bp-domain">
          Preferred domain
          <input
            id="bp-domain"
            value={business.domain}
            onChange={(event) => updateBusiness('domain', event.target.value)}
          />
        </label>
        <label htmlFor="bp-email">
          Business email
          <input
            id="bp-email"
            type="email"
            value={business.email}
            onChange={(event) => updateBusiness('email', event.target.value)}
            aria-invalid={emailInvalid}
            aria-describedby={emailInvalid ? 'bp-email-error' : undefined}
          />
          {emailInvalid ? (
            <small id="bp-email-error" className="field-error">Enter a valid email address.</small>
          ) : null}
        </label>
      </form>

      <label className="wide-field" htmlFor="bp-offer">
        What do you offer?
        <textarea
          id="bp-offer"
          rows="3"
          value={business.offer}
          onChange={(event) => updateBusiness('offer', event.target.value)}
        />
      </label>

      <label className="wide-field" htmlFor="bp-services">
        Services or products
        <textarea
          id="bp-services"
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
            if (latestSite) window.location.hash = `#/site/${latestSite.slug}`
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
              <span>{initialsOf(business.name)}</span>
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
          <button type="button" onClick={() => { window.location.hash = `#/site/${latestSite.slug}` }}>
            #/site/{latestSite.slug}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function LaunchChecklist({ activeStep, adapters, published, setActiveStep }) {
  const selected = adapters.find((step) => step.key === activeStep) || adapters[0]
  const SelectedIcon = selected.icon

  return (
    <section className="panel checklist-panel">
      <div className="section-heading">
        <div>
          <h2>Ready to publish</h2>
          <p>Every integration is a provider adapter with audit and approval gates.</p>
        </div>
        <span className={published ? 'quiet-tag success' : 'quiet-tag'}>{published ? 'Live' : 'Draft'}</span>
      </div>

      <div className="checklist">
        {adapters.map((step) => {
          const Icon = step.icon
          const StatusIcon = statusMeta[step.status].icon
          return (
            <button
              className={step.key === activeStep ? 'check-row selected' : 'check-row'}
              key={step.key}
              type="button"
              onClick={() => setActiveStep(step.key)}
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
