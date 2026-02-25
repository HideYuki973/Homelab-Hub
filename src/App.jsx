import { useEffect, useMemo, useRef, useState } from 'react'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { Ellipsis, LogOut, Plus, Search } from 'lucide-react'
import './App.css'
import { auth, db, isFirebaseConfigured } from './firebase'

const FIXED_USER = {
  username: 'admin',
  password: 'q',
}

const DEFAULT_SITES = []

const STORAGE_KEY = 'homelab_hub_sites'
const LOCAL_USER_ID = 'local-user'
const SITE_CHECK_INTERVAL_MS = 60000
const SITE_CHECK_TIMEOUT_MS = 8000

function areSitesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function getHubDocRef(userId) {
  return doc(db, 'users', userId, 'hubs', 'default')
}

function getHostname(url) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace('www.', '')
  } catch {
    return url
  }
}

function getSiteKey(site, index) {
  return `${site.url}-${index}`
}

async function checkSiteReachability(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SITE_CHECK_TIMEOUT_MS)

  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return 'online'
  } catch {
    return 'offline'
  } finally {
    clearTimeout(timeoutId)
  }
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState('')
  const [currentUserId, setCurrentUserId] = useState(null)

  const [timeBerlin, setTimeBerlin] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const [sites, setSites] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      return DEFAULT_SITES
    }

    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
      return DEFAULT_SITES
    } catch {
      return DEFAULT_SITES
    }
  })
  const [isCloudReady, setIsCloudReady] = useState(!isFirebaseConfigured)
  const [syncError, setSyncError] = useState('')
  const [siteStatuses, setSiteStatuses] = useState({})
  const sitesRef = useRef(sites)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newIconUrl, setNewIconUrl] = useState('')
  const [addError, setAddError] = useState('')
  const [editIndex, setEditIndex] = useState(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editIconUrl, setEditIconUrl] = useState('')
  const [editError, setEditError] = useState('')

  const berlinFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('de-DE', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  )

  useEffect(() => {
    const tick = () => setTimeBerlin(berlinFormatter.format(new Date()))
    tick()
    const interval = setInterval(tick, 1000)

    return () => clearInterval(interval)
  }, [berlinFormatter])

  useEffect(() => {
    sitesRef.current = sites
  }, [sites])

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sites))
      return
    }

    if (!isCloudReady || !isLoggedIn || !currentUserId) {
      return
    }

    const hubDocRef = getHubDocRef(currentUserId)
    setDoc(
      hubDocRef,
      {
        sites,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {
      setSyncError('Cloud-Sync fehlgeschlagen. Änderungen sind lokal gespeichert.')
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sites))
    })
  }, [currentUserId, isCloudReady, isLoggedIn, sites])

  useEffect(() => {
    if (!isFirebaseConfigured || !db || !isLoggedIn || !currentUserId) {
      return
    }

    setIsCloudReady(false)
    const hubDocRef = getHubDocRef(currentUserId)

    const unsubscribe = onSnapshot(
      hubDocRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setDoc(
            hubDocRef,
            {
              sites: DEFAULT_SITES,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          ).catch(() => {
            setSyncError('Cloud-Dokument konnte nicht erstellt werden.')
          })
          setIsCloudReady(true)
          return
        }

        const data = snapshot.data()
        if (Array.isArray(data.sites) && !areSitesEqual(data.sites, sitesRef.current)) {
          setSites(data.sites)
        }
        setSyncError('')
        setIsCloudReady(true)
      },
      () => {
        setSyncError('Cloud-Sync nicht erreichbar. Es wird lokal weitergespeichert.')
        setIsCloudReady(true)
      },
    )

    return () => unsubscribe()
  }, [currentUserId, isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) {
      setSiteStatuses({})
      return
    }

    let isCancelled = false

    const updateStatusWithCurrentSites = () => {
      setSiteStatuses((prev) => {
        const next = {}
        sites.forEach((site, index) => {
          const key = getSiteKey(site, index)
          next[key] = prev[key] ?? 'checking'
        })
        return next
      })
    }

    const runChecks = async () => {
      const checks = await Promise.all(
        sites.map(async (site, index) => {
          const status = await checkSiteReachability(site.url)
          return { key: getSiteKey(site, index), status }
        }),
      )

      if (isCancelled) {
        return
      }

      setSiteStatuses((prev) => {
        const next = { ...prev }
        checks.forEach(({ key, status }) => {
          next[key] = status
        })
        return next
      })
    }

    updateStatusWithCurrentSites()
    runChecks()
    const interval = setInterval(runChecks, SITE_CHECK_INTERVAL_MS)

    return () => {
      isCancelled = true
      clearInterval(interval)
    }
  }, [isLoggedIn, sites])

  const getStatusLabel = (status) => {
    if (status === 'online') {
      return 'Erreichbar'
    }

    if (status === 'offline') {
      return 'Nicht erreichbar'
    }

    return 'Wird geprüft'
  }

  const handleLogin = async (event) => {
    event.preventDefault()

    if (isFirebaseConfigured && auth) {
      try {
        const credentials = await signInWithEmailAndPassword(auth, loginUser.trim(), loginPass)
        setCurrentUserId(credentials.user.uid)
        setIsLoggedIn(true)
        setLoginError('')
        return
      } catch {
        setLoginError('Firebase-Login fehlgeschlagen. Prüfe E-Mail und Passwort.')
        return
      }
    }

    if (loginUser === FIXED_USER.username && loginPass === FIXED_USER.password) {
      setCurrentUserId(LOCAL_USER_ID)
      setIsLoggedIn(true)
      setLoginError('')
      return
    }

    setLoginError('Benutzername oder Passwort ist falsch.')
  }

  const handleLogout = async () => {
    if (isFirebaseConfigured && auth) {
      try {
        await signOut(auth)
      } catch {
        setSyncError('Abmelden aus Firebase fehlgeschlagen.')
      }
    }

    setIsLoggedIn(false)
    setCurrentUserId(null)
    setLoginPass('')
    setLoginError('')
  }

  const handleSearch = (event) => {
    event.preventDefault()

    const query = searchTerm.trim()
    if (!query) {
      return
    }

    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`
    window.open(googleUrl, '_blank', 'noopener,noreferrer')
  }

  const handleAddWebsite = (event) => {
    event.preventDefault()

    const cleanedName = newName.trim()
    const cleanedUrl = newUrl.trim()
    const cleanedIcon = newIconUrl.trim()

    if (!cleanedUrl || !cleanedIcon) {
      setAddError('Bitte URL und Icon-URL angeben.')
      return
    }

    try {
      const parsedUrl = new URL(cleanedUrl)
      const parsedIcon = new URL(cleanedIcon)

      setSites((prevSites) => [
        ...prevSites,
        { url: parsedUrl.href, iconUrl: parsedIcon.href, name: cleanedName },
      ])

      setNewName('')
      setNewUrl('')
      setNewIconUrl('')
      setAddError('')
      setShowAddForm(false)
    } catch {
      setAddError('Bitte gültige URLs eintragen (inkl. https://).')
    }
  }

  const closeAddWebsiteModal = () => {
    setShowAddForm(false)
    setAddError('')
  }

  const startEditWebsite = (site, index) => {
    setEditIndex(index)
    setEditName(site.name ?? '')
    setEditUrl(site.url)
    setEditIconUrl(site.iconUrl)
    setEditError('')
  }

  const cancelEditWebsite = () => {
    setEditIndex(null)
    setEditName('')
    setEditUrl('')
    setEditIconUrl('')
    setEditError('')
  }

  const saveEditWebsite = (event, index) => {
    event.preventDefault()

    const cleanedName = editName.trim()
    const cleanedUrl = editUrl.trim()
    const cleanedIcon = editIconUrl.trim()

    if (!cleanedUrl || !cleanedIcon) {
      setEditError('Bitte URL und Icon-URL angeben.')
      return
    }

    try {
      const parsedUrl = new URL(cleanedUrl)
      const parsedIcon = new URL(cleanedIcon)

      setSites((prevSites) =>
        prevSites.map((site, currentIndex) =>
          currentIndex === index
            ? { ...site, name: cleanedName, url: parsedUrl.href, iconUrl: parsedIcon.href }
            : site,
        ),
      )

      cancelEditWebsite()
    } catch {
      setEditError('Bitte gültige URLs eintragen (inkl. https://).')
    }
  }

  const deleteWebsite = (index) => {
    if (editIndex === index) {
      cancelEditWebsite()
    }

    setSites((prevSites) => prevSites.filter((_, currentIndex) => currentIndex !== index))
  }

  if (!isLoggedIn) {
    return (
      <main className="app app--centered">
        <section className="panel login-panel">
          <h1>HomeLab Login</h1>
         

          <form onSubmit={handleLogin} className="form">
            <label htmlFor="username">{isFirebaseConfigured ? 'E-Mail' : 'Benutzername'}</label>
            <input
              id="username"
              type={isFirebaseConfigured ? 'email' : 'text'}
              value={loginUser}
              onChange={(event) => setLoginUser(event.target.value)}
              autoComplete={isFirebaseConfigured ? 'email' : 'username'}
              required
            />

            <label htmlFor="password">Passwort</label>
            <input
              id="password"
              type="password"
              value={loginPass}
              onChange={(event) => setLoginPass(event.target.value)}
              autoComplete="current-password"
              required
            />

            {loginError && <p className="error">{loginError}</p>}

            <button type="submit">Anmelden</button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="app">
      <header className="panel top-area">
        <div className="section-head">
          <div />
          <button type="button" onClick={handleLogout} className="icon-button" aria-label="Abmelden" title="Abmelden">
            <LogOut aria-hidden="true" />
          </button>
        </div>
        <h1 className="clock">{timeBerlin}</h1>
        <p className="hint">Berlin</p>

        <form className="search-form" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Auf Google suchen..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <button type="submit" className="icon-button" aria-label="Suchen" title="Suchen">
            <Search aria-hidden="true" />
          </button>
        </form>

        {syncError ? (
          <p className="error">{syncError}</p>
        ) : (
          <p className="hint">{isFirebaseConfigured ? 'Cloud-Sync aktiv' : 'Nur lokale Speicherung aktiv'}</p>
        )}
      </header>

      <section className="panel sites-area">
        <div className="section-head">
          <h2>Webseiten-Hub</h2>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="icon-button"
            aria-label="Webseite hinzufügen"
            title="Webseite hinzufügen"
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

        <div className="card-grid">
          {sites.map((site, index) => (
            <article key={getSiteKey(site, index)} className="site-card">
              <div className="site-card-actions">
                <button
                  type="button"
                  className="menu-btn"
                  onClick={() => startEditWebsite(site, index)}
                  aria-label="Webseite bearbeiten"
                >
                  <Ellipsis aria-hidden="true" />
                </button>
              </div>

              <a href={site.url} target="_blank" rel="noopener noreferrer" className="site-link">
                <img src={site.iconUrl} alt={getHostname(site.url)} loading="lazy" />
                <span>{site.name?.trim() || getHostname(site.url)}</span>
                <span className={`site-status site-status--${siteStatuses[getSiteKey(site, index)] ?? 'checking'}`}>
                  {getStatusLabel(siteStatuses[getSiteKey(site, index)])}
                </span>
              </a>
            </article>
          ))}
        </div>
      </section>

      {showAddForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Webseite hinzufügen">
          <section className="modal-card">
            <h3>Webseite hinzufügen</h3>
            <form className="add-form" onSubmit={handleAddWebsite}>
              <input
                type="text"
                placeholder="Name (optional)"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <input
                type="url"
                placeholder="URL (z.B. https://example.com)"
                value={newUrl}
                onChange={(event) => setNewUrl(event.target.value)}
                required
              />
              <input
                type="url"
                placeholder="Icon-URL"
                value={newIconUrl}
                onChange={(event) => setNewIconUrl(event.target.value)}
                required
              />
              <div className="modal-actions">
                <button type="submit">Speichern</button>
                <button type="button" onClick={closeAddWebsiteModal}>
                  Abbrechen
                </button>
              </div>
              {addError && <p className="error">{addError}</p>}
            </form>
          </section>
        </div>
      )}

      {editIndex !== null && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Webseite bearbeiten">
          <section className="modal-card">
            <h3>Webseite bearbeiten</h3>
            <form className="add-form" onSubmit={(event) => saveEditWebsite(event, editIndex)}>
              <input
                type="text"
                placeholder="Name (optional)"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
              <input
                type="url"
                placeholder="URL"
                value={editUrl}
                onChange={(event) => setEditUrl(event.target.value)}
                required
              />
              <input
                type="url"
                placeholder="Icon-URL"
                value={editIconUrl}
                onChange={(event) => setEditIconUrl(event.target.value)}
                required
              />
              <div className="modal-actions">
                <button type="submit">Speichern</button>
                <button type="button" onClick={cancelEditWebsite}>
                  Abbrechen
                </button>
                <button type="button" onClick={() => deleteWebsite(editIndex)}>
                  Löschen
                </button>
              </div>
              {editError && <p className="error">{editError}</p>}
            </form>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
