import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import PatientDetail from './pages/PatientDetail.jsx'
import PublicBooking from './pages/PublicBooking.jsx'
import Landing from './pages/Landing.jsx'
import Admin from './pages/Admin.jsx'
import EraStage from './components/EraStage.jsx'

export default function App() {
  const [route, setRoute] = useState(() => location.hash.startsWith('#/') ? location.hash : '#/')
  const [me, setMe] = useState(undefined) // undefined = loading, null = signed out (guest)
  const [chatOpen, setChatOpen] = useState(false)
  const [greetEra, setGreetEra] = useState(false)
  useEffect(() => {
    const onHash = () => {
      const hash = location.hash || '#/'
      if (hash.startsWith('#/')) setRoute(hash)
    }
    addEventListener('hashchange', onHash)
    api.get('/api/auth/me').then(({ data }) => setMe(data.user || null))
    return () => removeEventListener('hashchange', onHash)
  }, [])

  function onLoginDone(user) {
    setMe(user)
  }

  function openEra() {
    setGreetEra(true)
    setChatOpen(true)
  }

  const path = route.replace('#', '')
  const isPublic = path.startsWith('/book')
  const isGuestHome = path === '' || path === '/' || path === '/home'
  const isAdminArea = me && (me.role === 'admin' || me.role === 'reception')

  let page
  if (isPublic) page = <PublicBooking />
  else if (isGuestHome) page = me ? (me.role === 'admin' ? <Admin me={me} /> : <Dashboard me={me} onChat={openEra} onLogout={() => setMe(null)} />) : <Landing />
  else if (me === undefined) page = <div className="center">Loading…</div>
  else if (!me) page = <Login onDone={onLoginDone} />
  else if (path.startsWith('/login')) page = me.role === 'admin' ? <Admin me={me} /> : <Dashboard me={me} onChat={openEra} onLogout={() => setMe(null)} />
  else if (path.startsWith('/admin')) page = isAdminArea ? <Admin me={me} /> : <Dashboard me={me} onChat={openEra} onLogout={() => setMe(null)} />
  else if (path.startsWith('/patients/')) page = <PatientDetail me={me} id={+path.split('/')[2]} onChat={openEra} />
  else page = me.role === 'admin' ? <Admin me={me} /> : <Dashboard me={me} onChat={openEra} onLogout={() => setMe(null)} />

  return (
    <div className="shell">
      {page}
      {me && chatOpen && <EraStage me={me} greetOnOpen={greetEra} onClose={() => { setChatOpen(false); setGreetEra(false) }} />}
    </div>
  )
}
