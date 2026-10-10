import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import DentEraMark from '../components/DentEraMark.jsx'
import '../dashboard.css'

const fmt12 = t => { const [h, m] = (t || '').split(':').map(Number); if (Number.isNaN(h)) return t || ''
  const ap = h >= 12 ? 'PM' : 'AM'; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}` }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const prettyDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return iso
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) }
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }
const initial = n => (n || '?').replace(/^Dr\.?\s*/i, '').trim()[0]?.toUpperCase() || '?'
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN')

export default function Dashboard({ me, onChat, onLogout }) {
  const [appts, setAppts] = useState([])
  const [patients, setPatients] = useState([])
  const [patientTotal, setPatientTotal] = useState(0)
  const [invoices, setInvoices] = useState([])
  const [q, setQ] = useState('')
  const [date, setDate] = useState(today())
  const [msg, setMsg] = useState('')
  const [activeSection, setActiveSection] = useState('overview')

  // add-appointment / add-patient forms
  const [bookOpen, setBookOpen] = useState(false)
  const [book, setBook] = useState({ patient_id: '', patient_name: '', date: today(), time: '10:00', minutes: 30, reason: 'Consultation' })
  const [addOpen, setAddOpen] = useState(false)
  const [addPatient, setAddPatient] = useState({ name: '', phone: '', dob: '', gender: '', medical_notes: '' })

  async function load() {
    const [a, p, pt, i] = await Promise.all([
      api.get(`/api/appointments?date=${date}`), api.get(`/api/patients?q=${encodeURIComponent(q)}`),
      api.get('/api/patients?q='), api.get('/api/invoices?status=unpaid')])
    setAppts(a.data.data || []); setPatients(p.data.data || [])
    setPatientTotal((pt.data.data || []).length); setInvoices(i.data.data || [])
  }

  useEffect(() => {
    let live = true
    async function pull() { await load(); if (!live) return }
    pull(); const t = setInterval(pull, 60000)
    return () => { live = false; clearInterval(t) }
  }, [date, q]) // eslint-disable-line react-hooks/exhaustive-deps

  async function logout() { await api.post('/api/auth/logout'); onLogout(); location.hash = '#/' }

  const allInvoices = invoices
  const due = allInvoices.reduce((s, i) => s + (i.amount - i.discount - i.paid_amount), 0)
  const pageCopy = {
    overview: {
      eyebrow: 'CLINIC OVERVIEW',
      title: `${greet()}, ${me.name.replace(/^Dr\.?\s*/i, 'Dr. ')} 👋`,
      description: `${prettyDate(date)} — here's your clinic today.`
    },
    appointments: {
      eyebrow: 'YOUR SCHEDULE',
      title: 'Appointments',
      description: 'Review and manage your clinic schedule.'
    },
    patients: {
      eyebrow: 'YOUR CLINIC',
      title: 'Patient register',
      description: 'Find patient records and keep your clinic details up to date.'
    },
    billing: {
      eyebrow: 'PAYMENTS TO FOLLOW UP',
      title: 'Billing',
      description: 'Review outstanding invoices and update payment status.'
    }
  }[activeSection]

  async function bookAppt(e) {
    e.preventDefault(); setMsg('')
    const body = book.patient_id
      ? { patient_id: +book.patient_id, date: book.date, start_time: book.time, end_time: null, reason: book.reason }
      : { patient_name: book.patient_name, date: book.date, start_time: book.time, end_time: null, reason: book.reason }
    const { status, data } = await api.post('/api/appointments', body)
    if (status === 201) { setMsg('Appointment booked.'); setBookOpen(false); load() }
    else setMsg(data.message || 'Could not book — please try another time.')
  }

  async function setStatus(id, status) {
    setMsg('')
    const { status: code, data } = await api.patch(`/api/appointments/${id}`, { status })
    setMsg(code === 200 ? `Marked ${status.replace('_', ' ')}.` : (data.message || 'Failed.'))
    load()
  }

  async function cancelAppt(id) {
    setMsg('')
    const { data } = await api.del(`/api/appointments/${id}`)
    setMsg(data.ok ? 'Appointment cancelled.' : (data.message || 'Failed.'))
    load()
  }

  async function addNewPatient(e) {
    e.preventDefault(); setMsg('')
    const b = addPatient
    const { status, data } = await api.post('/api/patients', {
      name: b.name, phone: b.phone, dob: b.dob || null, gender: b.gender || null, medical_notes: b.medical_notes })
    if (status === 201 || status === 200) {
      setMsg(data.existing ? `Phone already on file — opened patient #${data.data.id}.` : `Patient added (#${data.data.id}).`)
      setAddOpen(false); setAddPatient({ name: '', phone: '', dob: '', gender: '', medical_notes: '' })
      q === '' ? load() : setQ('')
      if (data.existing) location.hash = `#/patients/${data.data.id}`
    } else setMsg(data.message || 'Could not add the patient.')
  }

  async function pay(invId, full) {
    const inv = allInvoices.find(i => i.id === invId)
    const amount = full ? (inv.amount - inv.discount) : Math.round((inv.amount - inv.discount) / 2)
    const { data } = await api.patch(`/api/invoices/${invId}`, { paid_amount: amount })
    setMsg(data.data ? `Invoice #${invId} → ${data.data.status}.` : (data.message || 'Failed.'))
    load()
  }

  return (
    <div className="view dashboard-page">
      <aside className="dashboard-sidebar" aria-label="Clinic navigation">
        <a className="brand dashboard-brand" href="#/" aria-label="DentEra home">
          <span className="brand-mark"><DentEraMark /></span>
          <span>DentEra<small>CLINIC WORKSPACE</small></span>
        </a>
        <nav className="dashboard-nav" aria-label="Dashboard sections">
          <button type="button" className={activeSection === 'overview' ? 'is-active' : ''} aria-current={activeSection === 'overview' ? 'page' : undefined} onClick={() => setActiveSection('overview')}><span aria-hidden="true">⌂</span>Overview</button>
          <button type="button" className={activeSection === 'appointments' ? 'is-active' : ''} aria-current={activeSection === 'appointments' ? 'page' : undefined} onClick={() => setActiveSection('appointments')}><span aria-hidden="true">▦</span>Appointments</button>
          <button type="button" className={activeSection === 'patients' ? 'is-active' : ''} aria-current={activeSection === 'patients' ? 'page' : undefined} onClick={() => setActiveSection('patients')}><span aria-hidden="true">♙</span>Patients</button>
          <button type="button" className={activeSection === 'billing' ? 'is-active' : ''} aria-current={activeSection === 'billing' ? 'page' : undefined} onClick={() => setActiveSection('billing')}><span aria-hidden="true">₹</span>Billing</button>
        </nav>
        <div className="dashboard-sidebar-note">
          <span className="dashboard-sidebar-note__icon" aria-hidden="true">✦</span>
          <div><b>Your clinic, connected.</b><span>Appointments, records and billing in one place.</span></div>
        </div>
      </aside>

      <main className="dashboard-main" id="overview">
      <div className="topbar dashboard-toolbar">
        <span className="doctor-identity">
          {me.role === 'dentist' && <span className="doctor-avatar" aria-hidden="true">{initial(me.name)}</span>}
          <span className="doctor-identity__text"><b>{me.name}</b><small>{me.role}{me.dentistId ? ` · dentist #${me.dentistId}` : ''}</small></span>
        </span>
        <span className="spacer" />
        {(me.role === 'admin' || me.role === 'reception') && <a className="mini" href="#/admin">🛡️ Admin panel</a>}
        <a className="mini" href="#/book">Public booking</a>
        {me.role === 'dentist' && <button className="mini primary ask-era" onClick={onChat}>💬 Ask Era</button>}
        <button className="mini" onClick={logout}>Sign out</button>
      </div>

      <div className="pagehead">
        <div>
          <span className="dashboard-eyebrow">{pageCopy.eyebrow}</span>
          <h1>{pageCopy.title}</h1>
          <p className="muted">{pageCopy.description}</p>
        </div>
        <div className="dashboard-actions">
          {(activeSection === 'overview' || activeSection === 'patients') && <button className="btn btn--ghost" onClick={() => setAddOpen(v => !v)}>＋ Add patient</button>}
          {(activeSection === 'overview' || activeSection === 'appointments') && <button className="btn" onClick={() => setBookOpen(v => !v)}>＋ New appointment</button>}
        </div>
      </div>

      {msg && <p className="authmsg ok" role="status" aria-live="polite">{msg}</p>}

      {activeSection === 'overview' && <div className="stats">
        <div className="stat">
          <span className="stat-icon" aria-hidden="true">▦</span>
          <span className="statlabel">APPOINTMENTS · {date === today() ? 'TODAY' : 'SELECTED DAY'}</span>
          <span className="statnum">{appts.length}</span>
          <span className="stat-foot">{date === today() ? 'Scheduled for today' : prettyDate(date)}</span>
        </div>
        <div className="stat">
          <span className="stat-icon" aria-hidden="true">♙</span>
          <span className="statlabel">PATIENTS IN REGISTER</span>
          <span className="statnum">{patientTotal}</span>
          <span className="stat-foot">Across your clinic</span>
        </div>
        <div className={'stat' + (invoices.length ? ' warn' : '')}>
          <span className="stat-icon" aria-hidden="true">₹</span>
          <span className="statlabel">OUTSTANDING BALANCE</span>
          <span className="statnum">{money(due)}</span>
          <span className="stat-foot">{invoices.length} unpaid invoice{invoices.length === 1 ? '' : 's'}</span>
        </div>
      </div>}

      {bookOpen && (activeSection === 'overview' || activeSection === 'appointments') && (
        <form className="panel rowForm" onSubmit={bookAppt} aria-label="Book an appointment">
          <h3>Book appointment {book.date ? `on ${prettyDate(book.date)}` : ''}</h3>
          <div className="rowForm grid3">
            {!book.patient_id && (
              <label>Walk-in name <input value={book.patient_name} onChange={e => setBook({ ...book, patient_name: e.target.value })} placeholder="e.g. Ravi Kumar" required /></label>
            )}
            <label>Registered patient
              <select value={book.patient_id} onChange={e => setBook({ ...book, patient_id: e.target.value })}>
                <option value="">— walk-in (type a name) —</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Date <input type="date" value={book.date} onChange={e => setBook({ ...book, date: e.target.value })} required /></label>
            <label>Start time <input type="time" value={book.time} onChange={e => setBook({ ...book, time: e.target.value })} required /></label>
            <label>Minutes
              <select value={book.minutes} onChange={e => setBook({ ...book, minutes: e.target.value })}>
                {[15, 30, 45, 60].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label>Reason <input value={book.reason} onChange={e => setBook({ ...book, reason: e.target.value })} /></label>
          </div>
          <button type="submit">Book it</button>
        </form>
      )}

      {addOpen && (activeSection === 'overview' || activeSection === 'patients') && (
        <form className="panel rowForm" onSubmit={addNewPatient} aria-label="Add patient">
          <h3>Add patient</h3>
          <div className="rowForm grid3">
            <label>Name <input value={addPatient.name} onChange={e => setAddPatient({ ...addPatient, name: e.target.value })} required /></label>
            <label>Phone <input value={addPatient.phone} onChange={e => setAddPatient({ ...addPatient, phone: e.target.value })} placeholder="+91…" /></label>
            <label>Date of birth <input type="date" value={addPatient.dob} onChange={e => setAddPatient({ ...addPatient, dob: e.target.value })} /></label>
            <label>Gender
              <select value={addPatient.gender} onChange={e => setAddPatient({ ...addPatient, gender: e.target.value })}>
                <option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
              </select>
            </label>
            <label className="wide">Medical notes / allergies <input value={addPatient.medical_notes} onChange={e => setAddPatient({ ...addPatient, medical_notes: e.target.value })} placeholder="e.g. Allergic to penicillin" /></label>
          </div>
          <button type="submit">Save patient</button>
        </form>
      )}

      {activeSection !== 'billing' && <div className={`grid2 dashboard-panels${activeSection === 'overview' ? '' : ' dashboard-panels--single'}`}>
        {(activeSection === 'overview' || activeSection === 'appointments') && <section className="panel" id="appointments">
          <div className="panelhead">
            <div><span className="panel-eyebrow">YOUR SCHEDULE</span><h3>Appointments</h3></div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Appointment date" />
          </div>
          {appts.length === 0 && <p className="empty">No appointments this day — enjoy the quiet. ☕</p>}
          <ul className="list">
            {appts.map(a => (
              <li key={a.id} className="appt">
                <span className="timechip">{fmt12(a.start_time)}<br /><small>{fmt12(a.end_time)}</small></span>
                <span className="apptbody">
                  <b>{a.patient_name || 'Walk-in'}</b>
                  {a.source === 'public' && <span className="badge">public</span>}
                  <span className="muted"> — {a.reason || 'Consultation'}</span>
                  <span className="rowgap">
                    {a.status === 'scheduled' && <button type="button" className="mini" onClick={() => setStatus(a.id, 'completed')}>✓ complete</button>}
                    {a.status === 'scheduled' && <button type="button" className="mini" onClick={() => setStatus(a.id, 'no_show')}>◐ no-show</button>}
                    {a.status === 'scheduled' && <button type="button" className="mini" onClick={() => cancelAppt(a.id)}>✕ cancel</button>}
                    {a.status !== 'scheduled' && <button type="button" className="mini" onClick={() => setStatus(a.id, 'scheduled')}>↺ reopen</button>}
                  </span>
                </span>
                <span className={'stchip st-' + a.status}>{a.status}</span>
              </li>
            ))}
          </ul>
        </section>}

        {(activeSection === 'overview' || activeSection === 'patients') && <section className="panel" id="patients">
          <div className="panelhead"><div><span className="panel-eyebrow">YOUR CLINIC</span><h3>Patient register</h3></div><span className="panel-count">{patientTotal}</span></div>
          <label className="patient-search">
            <span aria-hidden="true">⌕</span>
            <input placeholder="Search name or phone…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search patients" />
          </label>
          {patients.length === 0 && <p className="empty">No patients match “{q}”.</p>}
          <ul className="list">
            {patients.map(p => (
              <li key={p.id} className="ptrow">
                <span className="avatar" aria-hidden="true">{initial(p.name)}</span>
                <span className="apptbody">
                  <a href={`#/patients/${p.id}`}><b>{p.name}</b></a>
                  {p.medical_notes && <span className="warn" title={p.medical_notes}> ⚠️</span>}
                  <span className="muted"> {p.phone || ''}</span>
                </span>
                <a className="chev" href={`#/patients/${p.id}`} aria-label={`Open ${p.name}`}>›</a>
              </li>
            ))}
          </ul>
        </section>}
      </div>}

      {(activeSection === 'overview' || activeSection === 'billing') && <section className="panel dashboard-billing" id="billing">
        <div className="panelhead">
          <div><span className="panel-eyebrow">PAYMENTS TO FOLLOW UP</span><h3>Unpaid invoices</h3></div>
          <span className="billing-total">{money(due)} <small>outstanding</small></span>
        </div>
        {invoices.length === 0 && <p className="empty">All invoices are settled. 🎉</p>}
        <ul className="list">
          {invoices.map(i => (
            <li key={i.id} className="invrow">
              <span><b>#{i.id}</b> {money(i.amount)}{i.discount ? ` − ${money(i.discount)}` : ''} · paid {money(i.paid_amount)}</span>
              <span className="rowgap">
                <a className="mini" href={`#/patients/${i.patient_id}`}>patient</a>
                <a className="mini" href={`#/plans/${i.plan_id || ''}`} style={i.plan_id ? null : { visibility: 'hidden' }}>plan</a>
                <button className="mini" onClick={() => pay(i.id, true)}>mark fully paid</button>
                <button className="mini" onClick={() => pay(i.id, false)}>half payment</button>
              </span>
            </li>
          ))}
        </ul>
      </section>}
      </main>
    </div>
  )
}
