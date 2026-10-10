import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import ToothChart from '../components/ToothChart.jsx'

export default function PatientDetail({ me, id, onChat }) {
  const [chart, setChart] = useState(null)
  const [plans, setPlans] = useState([])
  const [planDetail, setPlanDetail] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [treatments, setTreatments] = useState([])
  const [msg, setMsg] = useState('')

  async function load() {
    const [c, pl, inv, tr] = await Promise.all([
      api.get(`/api/chart/${id}`), api.get(`/api/plans?patient_id=${id}`),
      api.get('/api/invoices'), api.get('/api/treatments')])
    setChart(c.data.data || null)
    setPlans(pl.data.data || [])
    setInvoices((inv.data.data || []).filter(i => i.patient_id === id))
    setTreatments(tr.data.data || [])
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [id])

  async function openPlan(planId) {
    const { data } = await api.get(`/api/plans/${planId}`)
    setPlanDetail(data.data || null)
  }
  async function doItem(planId, itemId, status) {
    const { status: code, data } = await api.patch(`/api/plans/${planId}/items/${itemId}`, { status })
    setMsg(code === 200 ? `Item marked ${data.data.status}.` : (data.message || 'Failed.'))
    await load(); if (planDetail) openPlan(planId)
  }
  async function pay(invId, full) {
    const inv = invoices.find(i => i.id === invId)
    const amount = full ? (inv.amount - inv.discount) : Math.round((inv.amount - inv.discount) / 2)
    const { data } = await api.patch(`/api/invoices/${invId}`, { paid_amount: amount })
    setMsg(data.data ? `Invoice #${invId} is now ${data.data.status}.` : (data.message || 'Failed.'))
    await load()
  }

  if (!chart) return <div className="view center">Loading…</div>
  const p = chart.patient
  return (
    <div className="view">
      <div className="topbar">
        <a className="mini linkbtn" href="#/dashboard">← Dashboard</a>
        <span className="who">{p.name} {p.dob ? `· b. ${p.dob}` : ''}</span>
        {p.medical_notes && <span className="pill warnpill">⚠️ {p.medical_notes}</span>}
        <span className="spacer" />
        {me.role === 'dentist' && <button className="mini primary ask-era" onClick={onChat}>💬 Ask Era</button>}
      </div>

      <div className="panel">
        <h3>Dental chart (FDI)</h3>
        <ToothChart patientId={id} chart={{ ...chart, treatments }} onUpdated={load} />
      </div>

      <div className="grid2">
        <section className="panel">
          <h3>Treatment plans</h3>
          {plans.length === 0 && <p className="empty">No plans yet.</p>}
          <ul className="list">
            {plans.map(pl => (
              <li key={pl.id}>
                <a href="#" onClick={e => { e.preventDefault(); openPlan(pl.id) }}><b>#{pl.id} {pl.title}</b></a>
                <span className="muted"> · {pl.status} · est ₹{pl.total_estimate}</span>
              </li>
            ))}
          </ul>
          {planDetail && (
            <div className="toothpanel">
              <h4>#{planDetail.plan.id} {planDetail.plan.title}</h4>
              <ul className="list">
                {planDetail.items.map(it => (
                  <li key={it.id}>
                    Visit {it.visit_no}: {it.treatment_name || 'Item'}{it.tooth_fdi ? ` (tooth ${it.tooth_fdi})` : ''} · ₹{it.cost} · <b>{it.status}</b>
                    {me.role === 'dentist' && it.status === 'planned' && (
                      <span className="rowgap"> <button className="mini" onClick={() => doItem(planDetail.plan.id, it.id, 'done')}>mark done</button>
                      <button className="mini" onClick={() => doItem(planDetail.plan.id, it.id, 'cancelled')}>cancel</button></span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel">
          <h3>Invoices</h3>
          {invoices.length === 0 && <p className="empty">No invoices.</p>}
          <ul className="list">
            {invoices.map(i => (
              <li key={i.id}>
                <b>#{i.id}</b> ₹{i.amount}{i.discount ? ` − ₹${i.discount}` : ''} · paid ₹{i.paid_amount} · <b>{i.status}</b>
                {i.status !== 'paid' && me.role !== 'reception' && (
                  <span className="rowgap"> <button className="mini" onClick={() => pay(i.id, true)}>mark fully paid</button>
                  {i.status === 'unpaid' && <button className="mini" onClick={() => pay(i.id, false)}>half payment</button>}</span>
                )}
              </li>
            ))}
          </ul>
          {msg && <p className="authmsg ok">{msg}</p>}
        </section>
      </div>
    </div>
  )
}
