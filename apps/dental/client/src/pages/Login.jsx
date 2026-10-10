import React, { useState } from 'react'
import { api } from '../api.js'
import DentEraMark from '../components/DentEraMark.jsx'
import '../login.css'

const homeFor = u => (u && u.role === 'admin' ? '#/admin' : '#/dashboard')
const DEMO_PERSONAS = ['dentistA', 'dentistB']

export default function Login({ onDone }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [persona, setPersona] = useState(() => {
    const requested = new URLSearchParams(location.hash.split('?')[1] || '').get('persona')
    return DEMO_PERSONAS.includes(requested) ? requested : DEMO_PERSONAS[0]
  })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg('Signing you in…')
    try {
      const form = new FormData(e.currentTarget)
      const { status, data } = await api.post('/api/auth/login', {
        email: String(form.get('email') || '').trim(),
        password: String(form.get('password') || '')
      })
      if (status === 200 || status === 201) {
        onDone(data.user)
        location.hash = homeFor(data.user)
      } else {
        setMsg(data.message || 'Could not sign you in.')
      }
    } catch {
      setMsg('Unable to reach the clinic server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function demo(who) {
    setBusy(true)
    setMsg('Signing in with the demo account…')
    try {
      const { status, data } = await api.post('/api/auth/demo-login', { who })
      if (status === 200) {
        onDone(data.user)
        location.hash = homeFor(data.user)
      } else {
        setMsg(data.message || 'Demo login unavailable — please use the email form.')
      }
    } catch {
      setMsg('Unable to reach the clinic server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <header className="login-header">
        <a className="login-brand" href="#/" aria-label="DentEra home">
          <span className="brand-mark"><DentEraMark /></span>
          <span>DentEra</span>
        </a>
        <nav className="login-header-links" aria-label="Sign-in navigation">
          <a className="login-home" href="#/">Back to home</a>
        </nav>
      </header>

      <section className="login-layout" aria-label="Doctor sign in">
        <aside className="login-aside">
          <span className="login-aside-kicker">DENTAL PRACTICE WORKSPACE</span>
          <h1>Your clinic, in one place.</h1>
          <p>Spend less time switching between tools and more time focused on your patients.</p>
          <ul>
            <li><span aria-hidden="true">✦</span> Appointments and patient records</li>
            <li><span aria-hidden="true">✦</span> Treatment plans and clinical charting</li>
            <li><span aria-hidden="true">✦</span> Billing and payment tracking</li>
          </ul>
        </aside>

        <div className="loginform">
          <span className="login-eyebrow">DOCTOR PORTAL</span>
          <h2 id="login-title">Welcome back</h2>
          <p className="sub">Sign in to your clinic, or create an account with your email.</p>
          <form onSubmit={submit} id="loginF">
            <label htmlFor="login-email">Email address</label>
            <input id="login-email" name="email" type="email" placeholder="you@dental.local" autoComplete="username" required />
            <label htmlFor="login-password">Password</label>
            <input id="login-password" name="password" type="password" placeholder="At least 4 characters" autoComplete="current-password" minLength={4} required />
            <button disabled={busy} type="submit">{busy ? 'Please wait…' : 'Sign in / Sign up'}</button>
          </form>
          <p className="authmsg" role="status" aria-live="polite">{msg}</p>

          <div className="demobox">
            <span className="demolabel">Or explore a demo clinic</span>
            <div className="demorow">
              <select id="persona" value={persona} onChange={e => setPersona(e.target.value)} aria-label="Choose a demo persona" disabled={busy}>
                <option value="dentistA">Dr. Meera — Dentist 1</option>
                <option value="dentistB">Dr. Arjun — Dentist 2</option>
              </select>
              <button type="button" disabled={busy} onClick={() => demo(persona)}>Try demo</button>
            </div>
          </div>

          <p className="login-privacy">Your real clinic data is only available after you sign in.</p>
        </div>
      </section>
    </main>
  )
}
