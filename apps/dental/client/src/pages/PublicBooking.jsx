import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// Public booking — a full page (not a cramped card): progress rail, dentist cards,
// roomy date/slot grids, then a summary + details. API contract unchanged.
const fmt12 = t => { const [h, m] = (t || '').split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}` }
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const parts = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3]) }
const dateLabel = iso => { if (iso === plusDays(1)) return 'Tomorrow'
  const d = parts(iso); return d ? d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : iso }
const dateSub = iso => { const d = parts(iso); return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '' }
const niceLong = iso => { const d = parts(iso); return d ? d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) : iso }
// Dentist 1 (general) works Mon–Fri, Dentist 2 (ortho) Tue–Sat — the booking
// picker must start on a day that at least one of them actually works.
const firstOpenDay = () => { const d = new Date(); d.setDate(d.getDate() + 1); while (d.getDay() === 0) d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

const DENTISTS = [
  { id: 1, name: 'Dr. Meera Iyer', spec: 'General Dentistry', room: 'OPD-1' },
  { id: 2, name: 'Dr. Arjun Shah', spec: 'Orthodontics', room: 'OPD-2' }
]
const STEPS = ['Dentist', 'Date', 'Slot', 'Details']

export default function PublicBooking() {
  const [step, setStep] = useState(1)
  const [dentist, setDentist] = useState(null)
  const [date, setDate] = useState(firstOpenDay())
  const [slots, setSlots] = useState([])
  const [slot, setSlot] = useState(null)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => { fetch('/api/health').catch(() => {}) }, [])

  async function pickDentist(d) { setDentist(d); setStep(2) }
  async function pickDate(d) {
    setDate(d); setErr(''); setSlots([]); setSlot(null)
    const { status, data } = await api.get(`/api/public/slots?dentist=${dentist.id}&date=${d}`)
    if (status === 200) { setSlots(data.data || []); setStep(3) }
    else setErr(data.message || 'Could not load slots.')
  }
  function pickSlot(t) { setSlot(t); setStep(4) }
  async function submit(e) {
    e.preventDefault(); setErr('')
    const { status, data } = await api.post('/api/public/booking', {
      dentist_id: dentist.id, date, time: slot, name: e.target.name.value.trim(),
      phone: e.target.phone.value.trim(), reason: e.target.reason.value.trim()
    })
    if (status === 201) setDone({ date, time: slot, name: e.target.name.value.trim() })
    else if (status === 409) { setErr(data.message || 'That slot was just taken.'); setSlots(s => s.filter(x => x.time !== slot)); setSlot(null); setStep(3) }
    else setErr(data.message || 'Booking failed.')
  }

  return (
    <div className="bookview">
      <div className="topbar">
        <a className="mini" href="#/">← Home</a>
        <span className="brand">🦷 DentEra</span>
        <span className="spacer" />
        <a className="mini" href="#/login">Doctor sign in</a>
      </div>

      {done ? (
        <div className="bookmain">
          <div className="panel center donecard">
            <div className="logo">🎉</div>
            <h2>Booked!</h2>
            <p className="donebig">See you <b>{done.date === plusDays(1) ? 'tomorrow' : niceLong(done.date)}</b> at <b>{fmt12(done.time)}</b>, {done.name}.</p>
            <p className="muted">A confirmation call will follow. Need to change plans? Just call the clinic.</p>
            <div className="hero-cta" style={{ justifyContent: 'center' }}>
              <a className="btn" href="#/">Back to home</a>
              <a className="btn ghost" href="#/book">Book another</a>
            </div>
          </div>
        </div>
      ) : (
        <div className="bookmain">
          <header className="bookhero">
            <h1>Book an appointment</h1>
            <p className="muted">No account needed — your phone number is used only for this appointment.</p>
          </header>

          <ol className="prosteps" aria-label="Booking steps">
            {STEPS.map((s, i) => (
              <li key={s} className={step > i + 1 ? 'done' : step === i + 1 ? 'on' : ''}>
                <span className="pronum">{step > i + 1 ? '✓' : i + 1}</span>
                <span className="proname">{s}</span>
              </li>
            ))}
          </ol>

          <section className="panel bookcard">
            {step === 1 && (
              <>
                <h3>Choose your dentist</h3>
                <div className="dentcards">
                  {DENTISTS.map(d => (
                    <button key={d.id} type="button" className="dentcard" onClick={() => pickDentist(d)}>
                      <span className="avatar big">{d.name.replace('Dr. ', '')[0]}</span>
                      <span className="dentbody">
                        <b>{d.name}</b>
                        <span className="muted">{d.spec} · {d.room}</span>
                      </span>
                      <span className="chev">›</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 2 && dentist && (
              <>
                <h3>Pick a day <span className="muted">· with {dentist.name}</span></h3>
                <div className="dategrid2">
                  {Array.from({ length: 14 }, (_, i) => plusDays(i + 1)).map(d => {
                    const sun = parts(d)?.getDay() === 0
                    return (
                      <button key={d} type="button" disabled={sun} className={'datecell' + (d === date ? ' on' : '')}
                        title={sun ? 'Clinic closed on Sunday' : undefined}
                        onClick={() => pickDate(d)}
                        style={sun ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>
                        <b>{d === firstOpenDay() ? 'Earliest' : parts(d)?.toLocaleDateString('en-IN', { weekday: 'short' })}</b>
                        <span>{dateSub(d)}</span>
                      </button>
                    )
                  })}
                </div>
                <button type="button" className="linkbtn" onClick={() => setStep(1)}>← change dentist</button>
              </>
            )}

            {step === 3 && (
              <>
                <h3>Pick a time <span className="muted">· {dateLabel(date)}</span></h3>
                {slots.length === 0 && <p className="empty">No free slots that day — try another date.</p>}
                <div className="slotgrid">
                  {slots.map(s => (
                    <button key={s.time} type="button" className={'slotcell' + (slot === s.time ? ' on' : '')} onClick={() => pickSlot(s.time)}>
                      {fmt12(s.time)}
                    </button>
                  ))}
                </div>
                <div className="rowgap">
                  <button type="button" className="linkbtn" onClick={() => setStep(2)}>← change date</button>
                </div>
              </>
            )}

            {step === 4 && dentist && slot && (
              <>
                <h3>Almost done — your details</h3>
                <div className="sumcard">
                  <span>🦷 <b>{dentist.name}</b> · {dentist.spec}</span>
                  <span>📅 <b>{dateLabel(date)}</b> ({niceLong(date)})</span>
                  <span>🕒 <b>{fmt12(slot)}</b></span>
                </div>
                <form onSubmit={submit} className="bookform">
                  <label>Your name<input name="name" placeholder="e.g. Ravi Kumar" required minLength={2} /></label>
                  <label>Phone<input name="phone" placeholder="e.g. 9810022223" required pattern="[0-9+\-\s]{7,15}" /></label>
                  <label>Reason (optional)<input name="reason" placeholder="e.g. tooth pain, checkup…" /></label>
                  <div className="rowgap">
                    <button type="submit">Confirm booking</button>
                    <button type="button" className="linkbtn" onClick={() => { setStep(3); setSlot(null) }}>← change slot</button>
                  </div>
                </form>
              </>
            )}
            {err && <p className="err">{err}</p>}
          </section>

          <p className="tiny footnote">🔒 Your details stay private — used only for this appointment.</p>
        </div>
      )}
    </div>
  )
}
