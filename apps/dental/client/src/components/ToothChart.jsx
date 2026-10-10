import React, { useMemo, useState } from 'react'
import { api } from '../api.js'

const COLORS = {
  healthy: '#e8f6f4', decayed: '#fdecec', filled: '#e3eef3', root_canal: '#f4e9ff',
  crowned: '#fff4dd', missing: '#eeeeee', implant: '#dff0ff'
}
const LABEL = {
  healthy: 'Healthy', decayed: 'Decayed', filled: 'Filled', root_canal: 'Root canal',
  crowned: 'Crowned', missing: 'Missing', implant: 'Implant'
}
// current status per tooth = latest record's status (fallback healthy)
function latestByTooth(records) {
  const m = {}
  for (const r of records) m[r.tooth_fdi] = r // records come ordered by id
  return m
}

export default function ToothChart({ patientId, chart, onUpdated }) {
  const latest = useMemo(() => latestByTooth(chart.records || []), [chart])
  const [sel, setSel] = useState(null)      // selected tooth fdi
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save(fdi, { status, treatment_id, notes }) {
    setBusy(true); setErr('')
    const { status: code, data } = await api.post(`/api/chart/${patientId}`, {
      tooth_fdi: fdi, tooth_status: status, treatment_id: treatment_id || undefined, notes: notes || undefined
    })
    setBusy(false)
    if (code === 201) { setSel(null); onUpdated() }
    else setErr(data.message || 'Could not save.')
  }

  const Tooth = ({ fdi }) => {
    const rec = latest[fdi]
    const st = rec ? rec.tooth_status : 'healthy'
    return (
      <button
        className={'tooth' + (sel === fdi ? ' sel' : '')}
        style={{ background: COLORS[st] }}
        aria-label={`Tooth ${fdi} — ${LABEL[st]}`}
        title={`Tooth ${fdi} — ${LABEL[st]}`}
        onClick={() => setSel(sel === fdi ? null : fdi)}
      >{fdi}</button>
    )
  }

  const upper = Array.from({ length: 8 }, (_, i) => String(18 - i)).concat(Array.from({ length: 8 }, (_, i) => String(11 + i)))
  const lower = Array.from({ length: 8 }, (_, i) => String(48 - i)).concat(Array.from({ length: 8 }, (_, i) => String(41 + i)))
  const history = sel ? (chart.byTooth[sel] || []) : []

  return (
    <div className="chart">
      <div className="toothrow" role="group" aria-label="Upper teeth">{upper.map(f => <Tooth key={f} fdi={f} />)}</div>
      <div className="toothrow" role="group" aria-label="Lower teeth">{lower.map(f => <Tooth key={f} fdi={f} />)}</div>
      <div className="legend">
        {Object.keys(COLORS).map(k => <span key={k}><i style={{ background: COLORS[k] }} />{LABEL[k]}</span>)}
      </div>

      {sel && (
        <div className="toothpanel">
          <h4>Tooth {sel} — history</h4>
          {history.length === 0 && <p className="empty">No records — this tooth is healthy (assumed).</p>}
          <ul className="list">
            {history.map(h => (
              <li key={h.id}>
                <b>{LABEL[h.tooth_status]}</b>{h.treatment_name ? ` · ${h.treatment_name}` : ''}
                {h.visit_date ? <span className="muted"> · {h.visit_date}</span> : null}
                {h.cost ? <span className="muted"> · ₹{h.cost}</span> : null}
                {h.notes ? <div className="muted">{h.notes}</div> : null}
              </li>
            ))}
          </ul>
          <form className="toothform" onSubmit={e => { e.preventDefault(); save(sel, {
            status: e.target.status.value, treatment_id: e.target.treatment.value, notes: e.target.notes.value }) }}>
            <label>Status
              <select name="status" defaultValue="filled">
                {Object.keys(COLORS).map(k => <option key={k} value={k}>{LABEL[k]}</option>)}
              </select>
            </label>
            <label>Treatment
              <select name="treatment" defaultValue="">
                <option value="">— none —</option>
                {(chart.treatments || []).map(t => <option key={t.id} value={t.id}>{t.name} (₹{t.default_cost})</option>)}
              </select>
            </label>
            <label>Note<input name="notes" placeholder="Optional note" /></label>
            <button disabled={busy} type="submit">Save record</button>
            {err && <p className="err">{err}</p>}
          </form>
        </div>
      )}
    </div>
  )
}
