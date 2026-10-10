import React, { useEffect, useState } from "react"
import { api } from "../api.js"

// Admin panel — clinic-wide view for role "admin" (and "reception", who share
// the same read scope on the server). Read-only: invoice payments reuse the
// existing /api/invoices PATCH, everything else comes from /api/admin/*.
const fmt12 = t => { const [h, m] = (t || "").split(":").map(Number); if (Number.isNaN(h)) return t || ""
  const ap = h >= 12 ? "PM" : "AM"; return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ap}` }
const money = n => "₹" + Number(n || 0).toLocaleString("en-IN")
const niceDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); if (!m) return s
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) }

const TABS = [
  ["overview", "📊 Overview"],
  ["appointments", "🗓️ Appointments"],
  ["patients", "👥 Patients"],
  ["invoices", "💳 Invoices"],
  ["audit", "🛡️ Audit trail"]
]

// Animated number component
function StatNumber({ value, prefix = "", suffix = "", delay = 0 }) {
  const [displayValue, setDisplayValue] = useState(0)
  useEffect(() => {
    const target = Number(value) || 0
    const duration = 800
    const startTime = Date.now() + delay
    const animate = () => {
      const elapsed = Date.now() - startTime
      if (elapsed >= duration) {
        setDisplayValue(target)
        return
      }
      const progress = elapsed / duration
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(Math.floor(target * eased))
      requestAnimationFrame(animate)
    }
    if (delay > 0) {
      setTimeout(animate, delay)
    } else {
      animate()
    }
  }, [value, delay])
  return <span className="statnum">{prefix}{displayValue.toLocaleString("en-IN")}{suffix}</span>
}

export default function Admin({ me }) {
  const [tab, setTab] = useState("overview")
  const [ov, setOv] = useState(null)
  const [appts, setAppts] = useState([])
  const [patients, setPatients] = useState([])
  const [invoices, setInvoices] = useState([])
  const [auditRows, setAuditRows] = useState([])
  const [msg, setMsg] = useState("")

  async function loadInvoices() {
    const { data } = await api.get("/api/invoices")
    setInvoices(data.data || [])
  }
  useEffect(() => {
    ;(async () => {
      const [o, a, p, au] = await Promise.all([
        api.get("/api/admin/overview"), api.get("/api/admin/appointments?days=7"),
        api.get("/api/admin/patients"), api.get("/api/admin/audit")])
      setOv(o.data.data || null); setAppts(a.data.data || [])
      setPatients(p.data.data || []); setAuditRows(au.data.data || [])
      await loadInvoices()
    })()
  }, [])

  async function pay(invId, full) {
    const inv = invoices.find(i => i.id === invId)
    const amount = full ? (inv.amount - inv.discount) : Math.round((inv.amount - inv.discount) / 2)
    const { data } = await api.patch(`/api/invoices/${invId}`, { paid_amount: amount })
    setMsg(data.data ? `Invoice #${invId} → ${data.data.status}.` : (data.message || "Failed."))
    await loadInvoices()
  }

  // keep dentist-name display simple (no extra transform needed)
  const who = nm => nm

  const statConfig = ov ? [
    { key: "appts_today", label: "appointments today", icon: "📅", color: "mint", delay: 0 },
    { key: "appts_week", label: "next 7 days", icon: "📆", color: "mint", delay: 100 },
    { key: "patients", label: "patients", icon: "👥", color: "amber", delay: 200 },
    { key: "unpaid_due", label: "unpaid revenue", icon: "💰", color: "error", delay: 300, money: true },
    { key: "plans_active", label: "active plans", icon: "📋", color: "info", delay: 400 },
    { key: "public_bookings", label: "public bookings", icon: "🌐", color: "success", delay: 500 },
    { key: "dentists", label: "dentists / users", icon: "👨‍⚕️", color: "mint", delay: 600, custom: `${ov.dentists}/${ov.users}` },
    { key: "treatments", label: "treatments", icon: "🦷", color: "amber", delay: 700 },
  ] : []

  return (
    <div className="view">
      <div className="topbar">
        <span className="brand"><span className="brand-mark" aria-hidden="true">D</span> DentEra <span className="roletag">Admin</span></span>
        <span className="who">{me.name} · {me.role}</span>
        <span className="spacer" />
        <a className="mini" href="#/book">Public booking</a>
        <a className="mini" href="#/dashboard">Doctor dashboard</a>
      </div>

      {/* Enhanced Hero Section */}
      <header className="admin-hero animate-slide-up">
        <div className="admin-hero-content">
          <h1>Clinic Administration</h1>
          <p className="muted">Complete practice overview — appointments, patients, revenue, and Era's activity trail.</p>
          <div className="admin-quick-actions">
            <a href="#/book" className="btn btn--ghost btn--sm">🌐 Public Booking</a>
            <a href="#/dashboard" className="btn btn--ghost btn--sm">👨‍⚕️ Doctor Dashboard</a>
            <button className="btn btn--amber btn--sm" onClick={() => window.location.reload()}>🔄 Refresh Data</button>
          </div>
        </div>
        <div className="admin-hero-stats" aria-label="Key metrics">
          {statConfig.map((s, i) => (
            <div key={s.key} className={`stat stat--${s.color} animate-slide-up`} style={{ animationDelay: `${s.delay}ms` }}>
              <span className="stat-icon" aria-hidden="true">{s.icon}</span>
              <div className="stat-content">
                {s.custom ? (
                  <span className="statnum">{s.custom}</span>
                ) : s.money ? (
                  <StatNumber value={ov[s.key]} prefix="₹" delay={s.delay} />
                ) : (
                  <StatNumber value={ov[s.key]} delay={s.delay} />
                )}
                <span className="statlabel">{s.label}</span>
              </div>
            </div>
          ))}
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={"tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === "overview" && ov && (
        <section className="panel animate-slide-up" style={{ animationDelay: "200ms" }}>
          <h3>Recent Activity</h3>
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>Tool</th><th>Result</th><th>Detail</th></tr></thead>
              <tbody>
                {auditRows.slice(0, 10).map(r => (
                  <tr key={r.id}>
                    <td className="muted">{(r.created_at || "").replace("T", " ").slice(0, 16)}</td>
                    <td>{r.user || "—"}</td>
                    <td>{r.action}</td>
                    <td className="muted">{r.tool_name || "—"}</td>
                    <td><span className={"stchip " + (r.success ? "st-scheduled" : "st-cancelled")}>{r.success ? "ok" : "failed"}</span></td>
                    <td className="muted">{r.detail || ""}</td>
                  </tr>
                ))}
                {auditRows.length === 0 && <tr><td colSpan="6" className="empty">No events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "appointments" && (
        <section className="panel animate-slide-up" style={{ animationDelay: "200ms" }}>
          <div className="panelhead">
            <h3>Appointments — next 7 days</h3>
          </div>
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>When</th><th>Dentist</th><th>Patient</th><th>Reason</th><th>Source</th><th>Status</th></tr></thead>
              <tbody>
                {appts.map(a => (
                  <tr key={a.id}>
                    <td><b>{niceDate(a.appointment_date)}</b><br /><span className="muted">{fmt12(a.start_time)}–{fmt12(a.end_time)}</span></td>
                    <td>{who(a.dentist)}</td>
                    <td>{a.registered_patient || a.patient_name || "Walk-in"}</td>
                    <td className="muted">{a.reason || "—"}</td>
                    <td>{a.source === "public" ? <span className="badge">public</span> : <span className="badge blue">doctor</span>}</td>
                    <td><span className={"stchip st-" + a.status}>{a.status}</span></td>
                  </tr>
                ))}
                {appts.length === 0 && <tr><td colSpan="6" className="empty">Nothing booked this week.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "patients" && (
        <section className="panel animate-slide-up" style={{ animationDelay: "200ms" }}>
          <h3>Patient register — all dentists</h3>
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Dentists</th><th>Visits</th><th>Alerts</th></tr></thead>
              <tbody>
                {patients.map(p => (
                  <tr key={p.id}>
                    <td className="muted">{p.id}</td>
                    <td><a href={`#/patients/${p.id}`}><b>{p.name}</b></a>{p.gender ? <span className="muted"> · {p.gender}</span> : ""}</td>
                    <td>{p.phone || "—"}</td>
                    <td className="muted">{p.dentists || "—"}</td>
                    <td>{p.visits}</td>
                    <td>{p.medical_notes ? <span className="warnpill pill">⚠️ {p.medical_notes}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "invoices" && (
        <section className="panel animate-slide-up" style={{ animationDelay: "200ms" }}>
          <div className="panelhead">
            <h3>Invoices — whole clinic</h3>
          </div>
          {msg && <p className="authmsg ok">{msg}</p>}
          <ul className="list">
            {invoices.map(i => (
              <li key={i.id} className="invrow">
                <span><b>#{i.id}</b> {money(i.amount)}{i.discount ? ` − ${money(i.discount)}` : ""} · paid {money(i.paid_amount)}</span>
                <span className="rowgap">
                  <span className={"stchip st-" + i.status}>{i.status}</span>
                  {i.status !== "paid" && <button className="mini" onClick={() => pay(i.id, true)}>mark fully paid</button>}
                  {i.status === "unpaid" && <button className="mini" onClick={() => pay(i.id, false)}>half payment</button>}
                </span>
              </li>
            ))}
            {invoices.length === 0 && <p className="empty">No invoices on file.</p>}
          </ul>
        </section>
      )}

      {tab === "audit" && (
        <section className="panel animate-slide-up" style={{ animationDelay: "200ms" }}>
          <h3>Assistant & access trail — last 40 events</h3>
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>Tool</th><th>Result</th><th>Detail</th></tr></thead>
              <tbody>
                {auditRows.map(r => (
                  <tr key={r.id}>
                    <td className="muted">{(r.created_at || "").replace("T", " ").slice(0, 16)}</td>
                    <td>{r.user || "—"}</td>
                    <td>{r.action}</td>
                    <td className="muted">{r.tool_name || "—"}</td>
                    <td><span className={"stchip " + (r.success ? "st-scheduled" : "st-cancelled")}>{r.success ? "ok" : "failed"}</span></td>
                    <td className="muted">{r.detail || ""}</td>
                  </tr>
                ))}
                {auditRows.length === 0 && <tr><td colSpan="6" className="empty">No events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
