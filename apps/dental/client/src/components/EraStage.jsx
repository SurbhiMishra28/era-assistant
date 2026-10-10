import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import './EraStage.css'

// EraStage — the FULL Era experience, not a chat widget (mirrors the root Era app's #face stage):
//   • Character: a still portrait on the assistant stage
//   • Voice OUT: every reply auto-speaks with NVIDIA Sofia (EN-US / HI-IN auto-picked) via /api/assistant/tts
//   • Voice IN:  🎤 Web Speech API (en-IN) — press to talk, interim text in the input, auto-sends on stop
//   • Brain:     /api/assistant/chat (doctor-scoped server tools) — same contract as the drawer
//   • History:   per-day conversations as tag chips (server-persisted)
const VOICE_EN = 'Magpie-Multilingual.EN-US.Sofia'
const VOICE_HI = 'Magpie-Multilingual.HI-IN.Sofia'
const FEMALE_DEVICE_VOICE = /\b(female|samantha|ava|victoria|karen|moira|fiona|tessa|susan|zira|hazel|jenny|aria|sara|sonia|natasha|heera|priya|raveena|neerja|aarti|swara|kavya|aditi|veena|lata|allison|joanna|emma|michelle|lucy|serena)\b/i
const isDevanagari = t => /[\u0900-\u097F]/.test(t)
const isHinglish = t => /\b(namaste|namaskar|kaise|kaisi|kya|hai|hain|nahi|aap|aapka|aapki|aapke|aapko|mera|meri|mere|dawai|dawa|bukhar|sehat|kripya|karein|mein|din|raat|subah|shaam|khana|pani|paani|bimari|ilaj|shukriya|dhanyavad|theek|thik)\b/i.test(t)
const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

const SUGGESTIONS = [
  'My appointments today',
  'Appointments tomorrow',
  'Free slots tomorrow',
  'Unpaid invoices',
  'My patients',
  'Root canal cost'
]

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const dayLabel = d => {
  const y = new Date(); y.setDate(y.getDate() - 1)
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`
  if (d === today()) return 'Today'
  if (d === yStr) return 'Yesterday'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '')
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : d
}

export default function EraStage({ me, onClose, greetOnOpen = false }) {
  const [convList, setConvList] = useState([])
  const [active, setActive] = useState('today')
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [log, setLog] = useState([]) // {role:'user'|'era'|'err', text, badge?}
  const logRef = useRef(null)
  const inputRef = useRef(null)

  // ---- face + voice state ----
  const [faceState, setFaceState] = useState('idle') // idle | listening | speaking | denied
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem('dentera_voice_manual') !== '0')
  const [voiceFallback, setVoiceFallback] = useState(false)
  const [playingIdx, setPlayingIdx] = useState(-1)
  const [micOn, setMicOn] = useState(false)
  const [micNote, setMicNote] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const audioRef = useRef(null)
  const recRef = useRef(null)
  const fallbackGen = useRef(0)
  const speakSeq = useRef(0) // generation token: new speech cancels in-flight playback

  const scrollDown = () => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }
  useEffect(scrollDown, [log, thinking])

  function stopSpeak() {
    speakSeq.current++
    if (audioRef.current) {
      audioRef.current.pause()
      URL.revokeObjectURL(audioRef.current.src)
      audioRef.current = null
    }
    window.speechSynthesis?.cancel()
    setPlayingIdx(-1)
    if (faceState === 'speaking') setFaceState('idle')
  }
  useEffect(() => () => { // unmount: stop everything
    speakSeq.current++
    audioRef.current?.pause()
    window.speechSynthesis?.cancel()
    try { recRef.current?.stop() } catch { /* not recording */ }
  }, [])

  // Escape closes
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    inputRef.current?.focus()
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  // ---- Sofia voice out (EN-US default, HI-IN for Devanagari / Hinglish replies) ----
  const pickVoice = t => (isDevanagari(t) || isHinglish(t)) ? VOICE_HI : VOICE_EN
  async function deviceVoices(synth) {
    const available = synth.getVoices()
    if (available.length) return available
    return new Promise(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        synth.removeEventListener('voiceschanged', onVoicesChanged)
        resolve(synth.getVoices())
      }
      const onVoicesChanged = () => {
        if (synth.getVoices().length) finish()
      }
      const timer = setTimeout(finish, 1200)
      synth.addEventListener('voiceschanged', onVoicesChanged)
    })
  }
  async function speakWithDevice(gen, index, text) {
    if (gen !== speakSeq.current || fallbackGen.current === gen) return
    if (audioRef.current) {
      audioRef.current.pause()
      URL.revokeObjectURL(audioRef.current.src)
      audioRef.current = null
    }
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setMicNote('Voice playback is unavailable in this browser. You can still read Era’s reply.')
      setPlayingIdx(-1)
      setFaceState('idle')
      return
    }
    fallbackGen.current = gen
    setVoiceFallback(true)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = isDevanagari(text) || isHinglish(text) ? 'hi-IN' : 'en-IN'
    const voices = await deviceVoices(window.speechSynthesis)
    if (gen !== speakSeq.current) return
    const languageVoices = voices.filter(candidate =>
      candidate.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2)))
    const voice = languageVoices.find(candidate => FEMALE_DEVICE_VOICE.test(candidate.name))
      || voices.find(candidate =>
        candidate.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2))
        && FEMALE_DEVICE_VOICE.test(candidate.name))
      || languageVoices[0]
      || voices.find(candidate => FEMALE_DEVICE_VOICE.test(candidate.name))
      || null
    if (voice) utterance.voice = voice
    utterance.pitch = 1.08
    utterance.onstart = () => {
      if (gen === speakSeq.current) setFaceState('speaking')
    }
    utterance.onend = utterance.onerror = () => {
      if (gen === speakSeq.current) {
        setPlayingIdx(-1)
        setFaceState('idle')
      }
    }
    setPlayingIdx(index)
    setFaceState('speaking')
    window.speechSynthesis.speak(utterance)
  }

  async function speak(i, text) {
    if (i >= 0 && playingIdx === i) { stopSpeak(); return }
    stopSpeak()
    const gen = ++speakSeq.current
    try {
      setPlayingIdx(i)
      const res = await fetch('/api/assistant/tts', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: pickVoice(text) })
      })
      if (gen !== speakSeq.current) return
      if (!res.ok) throw new Error('Voice service unavailable')
      const url = URL.createObjectURL(await res.blob())
      if (gen !== speakSeq.current) { URL.revokeObjectURL(url); return }
      const a = new Audio(url); audioRef.current = a
      a.onended = () => {
        if (gen === speakSeq.current) {
          URL.revokeObjectURL(url)
          audioRef.current = null
          setPlayingIdx(-1)
          setFaceState('idle')
        }
      }
      a.onerror = () => speakWithDevice(gen, i, text)
      setVoiceFallback(false)
      setFaceState('speaking')
      await a.play()
    } catch {
      speakWithDevice(gen, i, text)
    }
  }
  function toggleVoice() {
    if (voiceOn) stopSpeak()
    const next = !voiceOn
    setVoiceOn(next)
    localStorage.setItem('dentera_voice_manual', next ? '1' : '0')
  }
  // ---- voice in: 🎤 press to talk ----
  function toggleMic() {
    if (!SR) { setMicNote('Voice input needs Chrome or Edge — you can type instead.'); return }
    if (micOn) { try { recRef.current?.stop() } catch { /* noop */ } return }
    if (thinking) return
    stopSpeak(); setMicNote('')
    const rec = new SR()
    recRef.current = rec
    rec.lang = 'en-IN'; rec.interimResults = true; rec.maxAlternatives = 1
    let final = ''
    rec.onstart = () => { setMicOn(true); setFaceState('listening') }
    rec.onresult = e => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t + ' '; else interim += t
      }
      setText((final + interim).trim())
    }
    rec.onerror = e => {
      setMicOn(false)
      setFaceState('idle')
      setMicNote(e.error === 'not-allowed'
        ? 'Microphone access was blocked. Allow microphone access or type instead.'
        : 'Voice input stopped. You can try again or type instead.')
    }
    rec.onend = () => {
      setMicOn(false); setFaceState('idle')
      const said = final.trim()
      if (said) send(null, said)
    }
    try {
      rec.start()
    } catch {
      setMicOn(false)
      setFaceState('idle')
      setMicNote('Could not start the microphone. Allow microphone access or type instead.')
    }
  }

  // ---- conversation plumbing ----
  const welcome = () => [{
    role: 'era',
    text: `I'm Era, your dental assistant. I can help with appointments, patient charts, treatment plans, invoices, and common dental questions.`
  }]
  function emptyLog() { setLog(welcome()) }
  function renderMessages(msgs) {
    setLog(msgs.length ? msgs.map(m => ({ role: m.role === 'era' ? 'era' : 'user', text: m.text })) : welcome())
  }

  async function loadConvos(keepLog) {
    const { data } = await api.get('/api/assistant/conversations')
    const list = data.data || []
    setConvList(list)
    if (!keepLog) {
      const t = list.find(c => c.day === today())
      if (t) {
        const r = await api.get(`/api/assistant/conversations/${t.id}`)
        const msgs = r.data.data?.messages || []
        renderMessages(msgs)
      } else emptyLog()
    }
  }
  useEffect(() => {
    const greeting = `Hello ${me.name}, I’m Era. Ask me about your appointments, patient charts, treatment plans, or invoices. You can type or tap Talk to speak.`
    if (greetOnOpen) {
      setLog([...welcome(), { role: 'era', text: greeting }])
      if (voiceOn) speak(-1, greeting)
      loadConvos(true).catch(() => {
        setLog(messages => [...messages, { role: 'err', text: 'Conversation history could not be loaded. You can still ask Era a question.' }])
      })
    } else {
      loadConvos(false).catch(() => setLog([
        ...welcome(),
        { role: 'err', text: 'Conversation history could not be loaded. You can still ask Era a question.' }
      ]))
    }
  /* eslint-disable-line */ }, [])

  async function openConv(id) {
    setActive(String(id))
    try {
      const r = await api.get(`/api/assistant/conversations/${id}`)
      const msgs = r.data.data?.messages || []
      renderMessages(msgs)
    } catch {
      setLog(l => [...l, { role: 'err', text: 'That conversation could not be loaded. Please try again.' }])
    }
  }
  async function delConv(id, e) {
    e.stopPropagation()
    try {
      const { status } = await api.del(`/api/assistant/conversations/${id}`)
      if (status === 200) {
        const rest = convList.filter(c => c.id !== id)
        setConvList(rest)
        if (active === String(id)) { setActive('today'); emptyLog() }
      }
    } catch {
      setLog(l => [...l, { role: 'err', text: 'That conversation could not be deleted. Please try again.' }])
    }
  }

  function viewingToday() {
    return active === 'today' || (convList.find(c => String(c.id) === active) || {}).day === today()
  }
  async function send(e, preset) {
    e?.preventDefault()
    const message = String(preset ?? text).trim(); if (!message || thinking) return
    setText(''); setMicNote('')
    if (!viewingToday()) setLog([])
    setActive('today')
    setLog(l => [...l, { role: 'user', text: message }])
    setThinking(true); setFaceState('idle')
    try {
      const { status, data } = await api.post('/api/assistant/chat', { message })
      if (status === 200) {
        const reply = data.reply || 'Done.'
        setLog(l => [...l, { role: 'era', text: reply, badge: data.write ? 'Saved to your records ✓' : null }])
        if (voiceOn) speak(-1, reply)
      } else {
        setLog(l => [...l, { role: 'err', text: data.message || 'Something went wrong. Please try again.' }])
        setFaceState('denied')
      }
    } catch {
      setLog(l => [...l, { role: 'err', text: 'Could not reach the assistant. Check your connection and try again.' }])
      setFaceState('denied')
    } finally {
      setThinking(false)
      loadConvos(true).catch(() => {
        setLog(l => [...l, { role: 'err', text: 'Your reply is here, but conversation history could not be refreshed.' }])
      })
    }
  }

  const chips = [...convList]
  if (!chips.some(c => c.day === today())) chips.unshift({ id: 0, day: today(), messages: 0 })
  const showSuggestions = !thinking && active === 'today' && log.length <= 1 && log[0]?.role === 'era'
  const statusText = micOn ? 'Listening…' : faceState === 'speaking' ? 'Speaking…' : thinking ? 'Thinking…' : faceState === 'denied' ? 'Sorry — not available' : 'Ready'
  const stageClass = micOn ? 'listening' : faceState === 'speaking' ? 'speaking' : faceState === 'denied' ? 'denied' : 'idle'

  return (
    <div className="eraStageWrap" role="dialog" aria-label="Era — your AI dental assistant">
      <div className="eraScrim" onClick={onClose} aria-hidden="true" />
      <section className="eraStage" data-state={stageClass}>
        {/* ---- character stage ---- */}
        <div className="eraStageFace">
          <button className="mini eraClose" onClick={onClose} aria-label="Close assistant">✕</button>
          <div className="eraStageId">
            <h2>Era</h2>
            <span className={'facestatus ' + stageClass}>{statusText}</span>
          </div>

          <div className="stage">
            <div className="photoWrap">
              <img src="/era3d.png" alt="Era, your AI dental assistant" />
            </div>
          </div>

          <p className="eraWho">{me.name} · {me.role}{me.dentistId ? ` · dentist #${me.dentistId}` : ''}</p>

          <div className="ctrl">
            <button id="mic" className={micOn ? 'on' : ''} aria-pressed={micOn} onClick={toggleMic}
              title={SR ? (micOn ? 'Stop listening' : 'Talk to Era') : 'Voice input needs Chrome or Edge'}>
              🎤 {micOn ? 'Listening…' : 'Talk'}
            </button>
            <button className="ghostbtn" onClick={stopSpeak} title="Stop speaking">Stop</button>
            <button className="ghostbtn voicetoggle" onClick={toggleVoice} aria-pressed={voiceOn}
              title={voiceOn ? 'Mute Era' : 'Era speaks replies'}>
              {voiceOn ? '🔊 Voice on' : '🔇 Voice off'}
            </button>
            <button className="ghostbtn" onClick={() => setHistoryOpen(h => !h)} title="Conversation history" aria-expanded={historyOpen}>
              💬 {historyOpen ? 'Hide chats' : 'Chats'}
            </button>
          </div>

          <div className="row">
            <input ref={inputRef} value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(e)}
              placeholder={micOn ? 'Listening… speak now' : 'Ask Era — e.g. book Ravi tomorrow at 5pm'}
              aria-label="Message Era" />
            <button onClick={e => send(e)} disabled={thinking} aria-label="Send message">Send</button>
          </div>
          <p className="cpnote eraStageNote">
            {micNote ? micNote
              : voiceOn && voiceFallback ? '🔊 Era is speaking with your device voice · 🎤 to talk, or just type.'
              : voiceOn ? '🔊 Era speaks replies aloud · 🎤 to talk, or just type.'
              : '🔇 Voice is muted — tap “Voice off” to let Era speak.'}
          </p>
        </div>

        {/* ---- conversation ---- */}
        <div className={'eraStageChat' + (historyOpen ? ' wide' : '')}>
          <div className="cpTags" aria-label="Conversation days">
            {historyOpen && chips.map(c => (
              <span key={c.id || c.day} style={{ position: 'relative', display: 'inline-flex' }}>
                <button className={'chip' + ((active === String(c.id)) || (active === 'today' && c.day === today()) ? ' on' : '')}
                  onClick={() => c.id ? openConv(c.id) : (setActive('today'), emptyLog())}>
                  {dayLabel(c.day)}{c.messages ? ` · ${c.messages}` : ''}
                </button>
                {c.id ? <button className="chipdel" title="Delete this conversation" aria-label={`Delete ${dayLabel(c.day)} conversation`} onClick={e => delConv(c.id, e)}>×</button> : null}
              </span>
            ))}
            {!historyOpen && <span className="eraHint">💬 {chips.length} day(s) of history — tap <b>Chats</b> to browse</span>}
          </div>

          <div className="cpLog" ref={logRef} aria-live="polite">
            {log.map((m, i) => (
              <div key={i} className={'bub ' + m.role}>
                <p>{m.text}</p>
                {m.badge && <span className="bubbadge">{m.badge}</span>}
                {m.role === 'era' && m.text && (
                  <button className="tts" title={playingIdx === i ? 'Stop' : 'Play reply aloud'}
                    aria-label={playingIdx === i ? 'Stop voice' : 'Play reply as voice'} onClick={() => speak(i, m.text)}>
                    {playingIdx === i ? '⏹' : '🔊'}
                  </button>
                )}
              </div>
            ))}
            {thinking && (
              <div className="bub era" aria-label="Era is thinking">
                <span className="dots"><i /><i /><i /></span>
              </div>
            )}
            {showSuggestions && (
              <div className="sugs" role="list" aria-label="Suggested questions">
                {SUGGESTIONS.map(s => (
                  <button key={s} type="button" role="listitem" className="sug" onClick={e => send(e, s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
