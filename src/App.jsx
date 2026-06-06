import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, update, onValue, off, push, serverTimestamp }
  from "firebase/database";

// ─── HOOKS ───────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 640 : false);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 640);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
const STARTING_BALANCE = 1000;
const LS = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};
const genCode = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6).padEnd(6,"X");
const genId   = () => Math.random().toString(36).slice(2,10);
const fmt     = (n) => Number(n||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2});

// ─── FIREBASE INIT ────────────────────────────────────────────────────────────
let firebaseApp = null;
let firebaseDb  = null;

function initFirebase(cfg) {
  try {
    if (firebaseApp) return firebaseDb;
    firebaseApp = initializeApp(cfg);
    firebaseDb  = getDatabase(firebaseApp);
    return firebaseDb;
  } catch(e) {
    console.error("Firebase init error", e);
    return null;
  }
}

// ─── TWITCH OAUTH ─────────────────────────────────────────────────────────────
const REDIRECT_URI = typeof window !== "undefined"
  ? window.location.origin + window.location.pathname : "";

function buildTwitchURL(clientId) {
  const state = genId();
  LS.set("bv_state", state);
  return `https://id.twitch.tv/oauth2/authorize?` + new URLSearchParams({
    client_id: clientId, redirect_uri: REDIRECT_URI,
    response_type: "token", scope: "user:read:email",
    state, force_verify: "true",
  });
}

async function fetchTwitchUser(token, clientId) {
  const r = await fetch("https://api.twitch.tv/helix/users", {
    headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId },
  });
  if (!r.ok) throw new Error("Twitch API error");
  const d = await r.json();
  return d.data[0];
}

// ═════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [config, setConfig]       = useState(() => LS.get("bv_config") || { twitchClientId:"", firebaseConfig:"" });
  const [twitchUser, setTwitchUser] = useState(() => LS.get("bv_user") || null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError]   = useState("");
  const [view, setView]             = useState("home");
  const [sessionCode, setSessionCode] = useState(null);
  const [session, setSession]       = useState(null);   // live firebase data
  const [toast, setToast]           = useState(null);
  const dbRef = useRef(null);
  const unsub = useRef(null);

  const db = useCallback(() => {
    if (firebaseDb) return firebaseDb;
    try { const cfg = JSON.parse(config.firebaseConfig); return initFirebase(cfg); }
    catch { return null; }
  }, [config.firebaseConfig]);

  // ── Persist config ──
  useEffect(() => { LS.set("bv_config", config); }, [config]);

  // ── OAuth callback ──
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("access_token")) return;
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get("access_token");
    const state = params.get("state");
    window.history.replaceState({}, "", window.location.pathname);
    if (!token || state !== LS.get("bv_state")) { setAuthError("Auth échouée."); return; }
    LS.del("bv_state");
    const cid = LS.get("bv_config")?.twitchClientId;
    if (!cid) { setAuthError("Client ID manquante."); return; }
    setAuthLoading(true);
    fetchTwitchUser(token, cid).then(u => {
      const user = { id: u.id, login: u.login, displayName: u.display_name, avatar: u.profile_image_url, token };
      setTwitchUser(user); LS.set("bv_user", user); setAuthLoading(false);
    }).catch(() => { setAuthError("Profil Twitch introuvable."); setAuthLoading(false); });
  }, []);

  // ── ?join= URL param ──
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const j = p.get("join");
    if (j) { LS.set("bv_pending_join", j.toUpperCase()); window.history.replaceState({}, "", window.location.pathname); }
  }, []);
  useEffect(() => {
    if (!twitchUser) return;
    const pending = LS.get("bv_pending_join");
    if (pending) { LS.del("bv_pending_join"); handleJoin(pending); }
  }, [twitchUser]);

  // ── Subscribe to Firebase session ──
  function subscribeSession(code) {
    const database = db();
    if (!database) return;
    if (unsub.current) unsub.current();
    const r = ref(database, `sessions/${code}`);
    unsub.current = onValue(r, snap => {
      const val = snap.val();
      if (val) setSession(val);
    });
  }
  useEffect(() => () => { if (unsub.current) unsub.current(); }, []);

  function showToast(msg, type="ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── CREATE SESSION (streamer) ──
  async function handleCreate() {
    const database = db();
    if (!database) return showToast("Configure Firebase d'abord.", "err");
    const code = genCode();
    const link = `${window.location.origin}${window.location.pathname}?join=${code}`;
    const data = {
      code, link,
      streamerLogin: twitchUser.login,
      streamerName: twitchUser.displayName,
      streamerAvatar: twitchUser.avatar,
      status: "lobby",
      createdAt: Date.now(),
      participants: {
        [twitchUser.login]: {
          login: twitchUser.login,
          displayName: twitchUser.displayName,
          avatar: twitchUser.avatar,
          balance: STARTING_BALANCE,
          joinedAt: Date.now(),
        }
      },
      markets: {},
    };
    await set(ref(database, `sessions/${code}`), data);
    setSessionCode(code);
    subscribeSession(code);
    setView("streamer");
    showToast(`Session créée ! Code : ${code}`);
  }

  // ── JOIN SESSION (viewer) ──
  async function handleJoin(code) {
    const database = db();
    if (!database) return showToast("Configure Firebase d'abord.", "err");
    const snap = await get(ref(database, `sessions/${code}`));
    if (!snap.exists()) return showToast("Code introuvable.", "err");
    const data = snap.val();
    if (data.status === "ended") return showToast("Session terminée.", "err");
    // Register viewer
    if (!data.participants?.[twitchUser.login]) {
      await set(ref(database, `sessions/${code}/participants/${twitchUser.login}`), {
        login: twitchUser.login,
        displayName: twitchUser.displayName,
        avatar: twitchUser.avatar,
        balance: STARTING_BALANCE,
        joinedAt: Date.now(),
      });
    }
    setSessionCode(code);
    subscribeSession(code);
    setView(data.streamerLogin === twitchUser.login ? "streamer" : "viewer");
    showToast(`Rejoint la session ${code} !`);
  }

  // ── STREAMER: start live ──
  async function handleStartLive() {
    await update(ref(db(), `sessions/${sessionCode}`), { status: "live" });
    showToast("Le live a démarré !");
  }

  // ── STREAMER: end session ──
  async function handleEndSession() {
    await update(ref(db(), `sessions/${sessionCode}`), { status: "ended" });
    setView("results");
  }

  // ── STREAMER: create market ──
  async function handleCreateMarket(title, options) {
    const id = genId();
    const opts = {};
    options.forEach(label => { const oid = genId(); opts[oid] = { id: oid, label, pool: 0, bettors: {} }; });
    const market = { id, title, options: opts, status: "open", createdAt: Date.now(), totalPool: 0, winner: null };
    await set(ref(db(), `sessions/${sessionCode}/markets/${id}`), market);
    showToast("Marché ouvert !");
  }

  // ── STREAMER: close market ──
  async function handleCloseMarket(marketId) {
    await update(ref(db(), `sessions/${sessionCode}/markets/${marketId}`), { status: "closed" });
    showToast("Paris fermés.");
  }

  // ── STREAMER: resolve market ──
  async function handleResolveMarket(marketId, winningOptionId) {
    const database = db();
    const snap = await get(ref(database, `sessions/${sessionCode}`));
    const s = snap.val();
    const market = s.markets?.[marketId];
    if (!market) return;
    const winOpt = market.options?.[winningOptionId];
    const winPool = winOpt?.pool || 0;
    const total = market.totalPool || 0;
    const updates = {};
    updates[`sessions/${sessionCode}/markets/${marketId}/status`] = "resolved";
    updates[`sessions/${sessionCode}/markets/${marketId}/winner`] = winningOptionId;
    // Distribute winnings
    Object.values(market.options || {}).forEach(opt => {
      Object.entries(opt.bettors || {}).forEach(([login, amount]) => {
        if (opt.id === winningOptionId && winPool > 0) {
          const payout = (amount / winPool) * total;
          const current = s.participants?.[login]?.balance || 0;
          updates[`sessions/${sessionCode}/participants/${login}/balance`] = +(current + payout).toFixed(2);
        }
      });
    });
    await update(ref(database), updates);
    showToast("🏆 Gains distribués !");
  }

  // ── VIEWER: place bet ──
  async function handleBet(marketId, optionId, amount) {
    const database = db();
    const snap = await get(ref(database, `sessions/${sessionCode}`));
    const s = snap.val();
    const participant = s.participants?.[twitchUser.login];
    if (!participant) return showToast("Participant introuvable.", "err");
    if (amount > participant.balance) return showToast("Solde insuffisant.", "err");
    const market = s.markets?.[marketId];
    if (!market || market.status !== "open") return showToast("Paris fermés.", "err");
    const alreadyBet = Object.values(market.options||{}).some(o => o.bettors?.[twitchUser.login]);
    if (alreadyBet) return showToast("Tu as déjà parié sur ce marché.", "err");
    const updates = {};
    const opt = market.options[optionId];
    updates[`sessions/${sessionCode}/markets/${marketId}/options/${optionId}/pool`] = (opt.pool||0) + amount;
    updates[`sessions/${sessionCode}/markets/${marketId}/options/${optionId}/bettors/${twitchUser.login}`] = amount;
    updates[`sessions/${sessionCode}/markets/${marketId}/totalPool`] = (market.totalPool||0) + amount;
    updates[`sessions/${sessionCode}/participants/${twitchUser.login}/balance`] = +(participant.balance - amount).toFixed(2);
    await update(ref(database), updates);
    showToast(`Pari de ${fmt(amount)} ₿ placé !`);
  }

  function logout() { LS.del("bv_user"); setTwitchUser(null); setView("home"); setSession(null); setSessionCode(null); if (unsub.current) unsub.current(); }

  const isStreamer = session?.streamerLogin === twitchUser?.login;
  const configReady = config.twitchClientId?.trim() && config.firebaseConfig?.trim();

  return (
    <div style={S.root}>
      <style>{CSS}</style>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <Nav
        user={twitchUser} onLogout={logout} onConfig={() => setView("config")}
        onHome={() => { setView("home"); }}
        session={session} isStreamer={isStreamer}
        onDash={() => setView(isStreamer ? "streamer" : "viewer")}
      />

      <main style={S.main}>
        {authLoading && <Loader text="Connexion Twitch…" />}
        {authError  && <ErrorBanner msg={authError} onDismiss={() => setAuthError("")} />}

        {view === "config" && <ConfigPage config={config} setConfig={setConfig} onBack={() => setView("home")} />}

        {view === "home" && !authLoading && (
          <HomePage
            user={twitchUser} configReady={configReady}
            onLogin={() => { window.location.href = buildTwitchURL(config.twitchClientId); }}
            onCreate={handleCreate} onJoin={handleJoin}
            onGoConfig={() => setView("config")}
          />
        )}

        {view === "streamer" && session && (
          <StreamerDash
            session={session} user={twitchUser}
            onCreateMarket={handleCreateMarket}
            onCloseMarket={handleCloseMarket}
            onResolveMarket={handleResolveMarket}
            onStartLive={handleStartLive}
            onEndSession={handleEndSession}
          />
        )}

        {view === "viewer" && session && (
          <ViewerDash session={session} user={twitchUser} onBet={handleBet} />
        )}

        {view === "results" && session && (
          <ResultsPage session={session} user={twitchUser} onHome={() => { setView("home"); setSession(null); setSessionCode(null); }} />
        )}
      </main>
    </div>
  );
}

// ─── NAV ──────────────────────────────────────────────────────────────────────
function Nav({ user, onLogout, onConfig, onHome, session, isStreamer, onDash }) {
  const mobile = useIsMobile();
  return (
    <nav style={{...S.nav, padding: mobile ? "10px 14px" : S.nav.padding}}>
      <div style={{...S.navBrand, gap:12, cursor:"pointer"}} onClick={onHome}>
        <img src="https://raw.githubusercontent.com/ogkdecoy/Betterviewer/main/public/logo.png.PNG" alt="BETterviewer" style={S.navLogo} />
        {session && (
          <div style={S.sessionPill}>
            {session.status === "live"
              ? <><span style={S.liveDot} />LIVE</>
              : session.status === "lobby" ? "LOBBY" : "TERMINÉ"}
            <span style={S.pillDivider}>·</span>
            <span style={S.pillCode}>{session.code}</span>
          </div>
        )}
      </div>
      <div style={S.navRight}>
        {session && <button style={S.navBtn} onClick={onDash}>{isStreamer ? "Dashboard" : "Ma session"}</button>}
        <button style={S.iconBtn} onClick={onConfig} title="Config">⚙</button>
        {user ? (
          <div style={S.userChip}>
            <img src={user.avatar} style={S.ava} alt="" />
            <span style={S.uname}>{user.displayName}</span>
            <button style={S.logoutBtn} onClick={onLogout} title="Déconnexion">↩</button>
          </div>
        ) : <span style={S.guestTxt}>Non connecté</span>}
      </div>
    </nav>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function HomePage({ user, configReady, onLogin, onCreate, onJoin, onGoConfig }) {
  const [code, setCode] = useState("");
  const mobile = useIsMobile();
  return (
    <div style={S.homeWrap}>
      <div style={S.hero}>
        <div style={S.heroBlob} />
        <div style={S.heroBlob2} />
        <div style={S.heroInner}>
          <div style={S.heroBadge}>🎮 Twitch · Paris en direct</div>
          <h1 style={{...S.heroTitle, fontSize: mobile ? "clamp(28px, 10vw, 42px)" : "64px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace: mobile ? "normal" : "nowrap"}}>
            <span style={S.heroTitleBet}>BET</span>
            <span style={S.heroTitleTer}>ter</span>
            <span style={S.heroTitleViewer}>viewer</span>
          </h1>
          <p style={S.heroSub}>Engage tes viewers avec des paris factices en direct.<br/>Le meilleur gagne le giveaway.</p>
        </div>
      </div>

      {!configReady && (
        <div style={S.alertBar}>
          <span>⚠ Configuration manquante (Twitch + Firebase)</span>
          <button style={S.alertBtn} onClick={onGoConfig}>Configurer →</button>
        </div>
      )}

      {!user ? (
        <div style={S.loginBox}>
          <p style={S.loginHint}>Connecte-toi pour créer ou rejoindre une session</p>
          <button
            style={{ ...S.twitchBtn, ...(!configReady ? S.disabled : {}) }}
            onClick={configReady ? onLogin : undefined}
            disabled={!configReady}
          >
            <TwitchSVG /> Se connecter avec Twitch
          </button>
        </div>
      ) : (
        <div className="cards2" style={S.cards2}>
          <div style={S.roleCard}>
            <div style={S.roleIcon}>🎙</div>
            <div style={S.roleLabel}>Streamer</div>
            <p style={S.roleDesc}>Lance une session, crée les marchés, désigne le gagnant.</p>
            <button style={S.primaryBtn} onClick={onCreate}>Créer une session</button>
          </div>
          <div className="roleDivider" style={S.roleDivider}>ou</div>
          <div style={S.roleCard}>
            <div style={S.roleIcon}>👁</div>
            <div style={S.roleLabel}>Viewer</div>
            <p style={S.roleDesc}>Entre le code partagé en stream pour participer.</p>
            <div style={S.joinRow}>
              <input
                style={S.codeInput} placeholder="A3FX9K" maxLength={6}
                value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && onJoin(code)}
              />
              <button style={S.joinBtn} onClick={() => onJoin(code)}>GO</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
function ConfigPage({ config, setConfig, onBack }) {
  const [twitchId, setTwitchId]   = useState(config.twitchClientId || "");
  const [fbConfig, setFbConfig]   = useState(config.firebaseConfig || "");
  const [fbError, setFbError]     = useState("");

  function save() {
    if (fbConfig.trim()) {
      try { JSON.parse(fbConfig); } catch { setFbError("JSON invalide."); return; }
    }
    setFbError("");
    setConfig({ twitchClientId: twitchId.trim(), firebaseConfig: fbConfig.trim() });
    onBack();
  }

  return (
    <div style={S.formWrap}>
      <button style={S.backBtn} onClick={onBack}>← Retour</button>
      <h1 style={S.pageTitle}>Configuration</h1>

      <div style={S.card}>
        <h3 style={S.cardH}>🟣 Twitch OAuth</h3>
        <ol style={S.ol}>
          <li>Va sur <a href="https://dev.twitch.tv/console/apps" target="_blank" style={S.a}>dev.twitch.tv/console/apps</a> → <b>Register Your Application</b></li>
          <li>Catégorie : <b>Website Integration</b></li>
          <li>OAuth Redirect URL → <code style={S.inlineCode}>{typeof window!=="undefined" ? window.location.origin+window.location.pathname : "ton-url"}</code></li>
          <li>Copie le <b>Client ID</b></li>
        </ol>
        <label style={S.label}>Client ID Twitch</label>
        <input style={S.input} placeholder="xxxxxxxxxxxxxxxxxxxxxxxx" value={twitchId} onChange={e => setTwitchId(e.target.value)} />
      </div>

      <div style={{ ...S.card, marginTop: 20 }}>
        <h3 style={S.cardH}>🔥 Firebase Realtime Database</h3>
        <ol style={S.ol}>
          <li>Va sur <a href="https://console.firebase.google.com" target="_blank" style={S.a}>console.firebase.google.com</a> → Nouveau projet</li>
          <li><b>Build → Realtime Database</b> → Créer (mode test)</li>
          <li><b>Project Settings ⚙ → General</b> → "Your apps" → &lt;/&gt; Web → Enregistre</li>
          <li>Copie l'objet <code style={S.inlineCode}>firebaseConfig</code> et colle-le ci-dessous en JSON</li>
        </ol>
        <label style={S.label}>firebaseConfig (JSON)</label>
        <textarea
          style={{ ...S.input, height: 130, resize: "vertical", fontFamily: "'DM Mono', monospace", fontSize: 12 }}
          placeholder={`{\n  "apiKey": "...",\n  "databaseURL": "https://xxx.firebaseio.com",\n  ...\n}`}
          value={fbConfig} onChange={e => setFbConfig(e.target.value)}
        />
        {fbError && <div style={S.fieldErr}>{fbError}</div>}
      </div>

      <button style={{ ...S.primaryBtn, width:"100%", marginTop:20, padding:"13px" }} onClick={save}>
        Enregistrer la configuration
      </button>
    </div>
  );
}

// ─── STREAMER DASH ────────────────────────────────────────────────────────────
function StreamerDash({ session, user, onCreateMarket, onCloseMarket, onResolveMarket, onStartLive, onEndSession }) {
  const [tab, setTab]   = useState("markets");
  const [title, setTitle] = useState("");
  const [opts, setOpts]   = useState(["Oui","Non"]);
  const [copied, setCopied] = useState("");

  const markets = Object.values(session.markets || {}).sort((a,b) => b.createdAt - a.createdAt);
  const participants = Object.values(session.participants || {}).sort((a,b) => b.balance - a.balance);

  function copy(val, key) {
    navigator.clipboard.writeText(val);
    setCopied(key); setTimeout(() => setCopied(""), 2000);
  }
  function submit() {
    if (!title.trim()) return;
    const o = opts.filter(x => x.trim());
    if (o.length < 2) return;
    onCreateMarket(title, o); setTitle(""); setOpts(["Oui","Non"]);
  }

  const mobile = useIsMobile();
  return (
    <div style={S.dashWrap}>
      {/* Top bar */}
      <div style={{...S.topBar, flexDirection: mobile?"column":"row"}}>
        <div>
          <div style={{...S.topCode, fontSize: mobile?"26px":"38px"}}>{session.code}</div>
          <div style={S.topMeta}>{participants.length} viewers · {markets.length} marchés</div>
        </div>
        <div style={{...S.topActions, width: mobile?"100%":"auto"}}>
          <button style={S.ghostBtn} onClick={() => copy(session.link, "link")}>
            {copied==="link" ? "✓ Lien copié" : "🔗 Lien"}
          </button>
          <button style={S.ghostBtn} onClick={() => copy(session.code, "code")}>
            {copied==="code" ? "✓ Copié" : "📋 Code"}
          </button>
          {session.status === "lobby" && <button style={S.goLiveBtn} onClick={onStartLive}>▶ Go Live</button>}
          {session.status === "live"  && <button style={S.endBtn}    onClick={onEndSession}>■ Terminer</button>}
        </div>
      </div>

      <div style={S.tabs}>
        {[["markets","📊 Marchés"],["create","➕ Créer"],["lb","🏆 Classement"]].map(([k,l]) => (
          <button key={k} style={{...S.tab,...(tab===k?S.tabOn:{})}} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab==="markets" && (
        <div>
          {markets.length===0 && <Empty msg="Aucun marché." action="Créer le premier →" onAction={()=>setTab("create")} />}
          {markets.map(m => <AdminMarketCard key={m.id} market={m} onClose={onCloseMarket} onResolve={onResolveMarket} />)}
        </div>
      )}

      {tab==="create" && (
        <div style={S.card}>
          <h3 style={S.cardH}>Nouveau marché</h3>
          <label style={S.label}>Question</label>
          <input style={S.input} placeholder="Ex: Qui va gagner le prochain duel ?" value={title} onChange={e=>setTitle(e.target.value)} />
          <label style={S.label}>Options</label>
          {opts.map((o,i) => (
            <div key={i} style={{display:"flex",gap:8,marginBottom:8}}>
              <input style={{...S.input,flex:1,marginBottom:0}} value={o} placeholder={`Option ${i+1}`}
                onChange={e=>{const a=[...opts];a[i]=e.target.value;setOpts(a);}} />
              {opts.length>2 && <button style={S.rmBtn} onClick={()=>setOpts(opts.filter((_,j)=>j!==i))}>✕</button>}
            </div>
          ))}
          {opts.length<5 && <button style={S.addBtn} onClick={()=>setOpts([...opts,""])}>+ Option</button>}
          <button style={{...S.primaryBtn,width:"100%",marginTop:20}} onClick={submit}>Ouvrir le marché</button>
        </div>
      )}

      {tab==="lb" && <Leaderboard participants={participants} />}
    </div>
  );
}

function AdminMarketCard({ market, onClose, onResolve }) {
  const opts = Object.values(market.options || {});
  const total = market.totalPool || 0;
  return (
    <div style={S.mCard}>
      <div style={S.mTop}>
        <span style={S.mTitle}>{market.title}</span>
        <StatusBadge status={market.status} />
      </div>
      <div style={S.optGrid}>
        {opts.map(opt => {
          const pct = total>0 ? Math.round((opt.pool/total)*100) : Math.round(100/opts.length);
          return (
            <div key={opt.id} style={{...S.optRow,...(market.winner===opt.id?S.optWinner:{})}}>
              <div style={S.optTop}><span>{opt.label}</span><b style={S.optPct}>{pct}%</b></div>
              <div style={S.progWrap}><div style={{...S.progBar,width:`${pct}%`}} /></div>
              <div style={S.optSub}>{fmt(opt.pool)} ₿ · {Object.keys(opt.bettors||{}).length} paris</div>
            </div>
          );
        })}
      </div>
      <div style={S.mFoot}>
        <span style={S.mTotal}>Total : {fmt(total)} ₿</span>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {market.status==="open" && <button style={S.closeBtn} onClick={()=>onClose(market.id)}>Fermer les paris</button>}
          {market.status==="closed" && opts.map(opt=>(
            <button key={opt.id} style={S.resolveBtn} onClick={()=>onResolve(market.id,opt.id)}>✓ {opt.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── VIEWER DASH ──────────────────────────────────────────────────────────────
function ViewerDash({ session, user, onBet }) {
  const [tab, setTab] = useState("markets");
  const mobile = useIsMobile();
  const me = session.participants?.[user.login];
  const participants = Object.values(session.participants || {}).sort((a,b) => b.balance - a.balance);
  const rank = participants.findIndex(p => p.login === user.login) + 1;
  const markets = Object.values(session.markets || {}).sort((a,b) => b.createdAt - a.createdAt);

  return (
    <div style={S.dashWrap}>
      <div style={{...S.viewerTopBar, flexDirection: mobile?"column":"row"}}>
        <div style={S.viewerLeft}>
          <img src={user.avatar} style={S.bigAva} alt="" />
          <div>
            <div style={S.viewerName}>{user.displayName}</div>
            <div style={S.viewerSub}>Session de <b>{session.streamerName}</b></div>
          </div>
        </div>
        <div style={{...S.statsRow, width: mobile?"100%":"auto", justifyContent: mobile?"space-around":"flex-end"}}>
          <Stat val={`${fmt(me?.balance ?? STARTING_BALANCE)} ₿`} label="Solde" accent />
          <Stat val={`#${rank}`} label="Rang" />
          <Stat val={participants.length} label="Joueurs" />
        </div>
      </div>

      {session.status === "lobby" && (
        <div style={S.lobbyBanner}>⏳ En attente du démarrage…</div>
      )}

      <div style={S.tabs}>
        {[["markets","📊 Paris"],["lb","🏆 Classement"]].map(([k,l]) => (
          <button key={k} style={{...S.tab,...(tab===k?S.tabOn:{})}} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab==="markets" && (
        <div>
          {markets.length===0 && <Empty msg="Aucun marché pour l'instant." />}
          {markets.map(m => <ViewerMarketCard key={m.id} market={m} user={user} balance={me?.balance??0} onBet={onBet} />)}
        </div>
      )}
      {tab==="lb" && <Leaderboard participants={participants} highlightLogin={user.login} />}
    </div>
  );
}

function ViewerMarketCard({ market, user, balance, onBet }) {
  const [sel, setSel]     = useState(null);
  const [amount, setAmount] = useState("");
  const opts  = Object.values(market.options || {});
  const total = market.totalPool || 0;
  const myBetOpt = opts.find(o => o.bettors?.[user.login]);
  const canBet = market.status === "open" && !myBetOpt;

  function submit() {
    const a = parseFloat(amount);
    if (!sel || !a || a<=0) return;
    onBet(market.id, sel, a);
    setSel(null); setAmount("");
  }

  return (
    <div style={S.mCard}>
      <div style={S.mTop}>
        <span style={S.mTitle}>{market.title}</span>
        <StatusBadge status={market.status} />
      </div>
      <div style={S.optGrid}>
        {opts.map(opt => {
          const pct = total>0 ? Math.round((opt.pool/total)*100) : Math.round(100/opts.length);
          const isMine = myBetOpt?.id === opt.id;
          const isWin  = market.winner === opt.id;
          return (
            <div key={opt.id}
              style={{...S.optRow,...(sel===opt.id?S.optSel:{}),...(isWin?S.optWinner:{}),...(isMine?S.optMine:{}),cursor:canBet?"pointer":"default"}}
              onClick={() => canBet && setSel(opt.id)}
            >
              <div style={S.optTop}>
                <span>{opt.label}{isMine?" ← Mon pari":""}{isWin?" 🏆":""}</span>
                <b style={S.optPct}>{pct}%</b>
              </div>
              <div style={S.progWrap}><div style={{...S.progBar,width:`${pct}%`}} /></div>
              <div style={S.optSub}>
                ×{total>0&&opt.pool>0?(total/opt.pool).toFixed(2):"∞"}
                {isMine && <span style={{color:"#9146ff",marginLeft:8}}>{fmt(myBetOpt.bettors[user.login])} ₿ misés</span>}
              </div>
            </div>
          );
        })}
      </div>
      {canBet && sel && (
        <div style={S.betArea}>
          <input style={{...S.input}} type="number" placeholder="Montant ₿" min="1" max={balance}
            value={amount} onChange={e=>setAmount(e.target.value)} />
          <div style={{display:"flex",gap:6}}>
            {[10,50,100,250].map(v=>(
              <button key={v} style={S.quickBtn} onClick={()=>setAmount(String(Math.min(v,balance)))}>{v}</button>
            ))}
          </div>
          <button style={{...S.primaryBtn, width:"100%"}} onClick={submit}>Parier</button>
        </div>
      )}
      {myBetOpt && market.status==="open" && (
        <div style={S.myBetNote}>Tu as parié <b>{fmt(myBetOpt.bettors[user.login])} ₿</b> sur <b>{myBetOpt.label}</b></div>
      )}
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
function Leaderboard({ participants, highlightLogin }) {
  return (
    <div style={S.card}>
      <h3 style={S.cardH}>Classement</h3>
      {participants.map((p,i) => (
        <div key={p.login} style={{...S.lbRow,...(p.login===highlightLogin?S.lbMe:{})}}>
          <span style={S.lbRank}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</span>
          <img src={p.avatar} style={S.lbAva} alt="" onError={e=>e.target.style.display="none"} />
          <span style={S.lbName}>{p.displayName}</span>
          <span style={S.lbBal}>{fmt(p.balance)} ₿</span>
          <span style={{fontSize:11,color:p.balance>=STARTING_BALANCE?"#4ade80":"#f87171"}}>
            {p.balance>=STARTING_BALANCE?"▲":"▼"} {fmt(Math.abs(p.balance-STARTING_BALANCE))}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── RESULTS ─────────────────────────────────────────────────────────────────
function ResultsPage({ session, user, onHome }) {
  const sorted = Object.values(session.participants || {}).sort((a,b) => b.balance - a.balance);
  const winner = sorted[0];
  const myRank = sorted.findIndex(p => p.login === user?.login) + 1;
  return (
    <div style={S.resultsWrap}>
      <div style={S.resGlow} />
      <h1 style={S.resTitle}>🏆 Stream terminé !</h1>
      <p style={S.resSub}>Session <b style={{color:"#9146ff"}}>{session.code}</b> · {sorted.length} joueurs</p>
      {winner && (
        <div style={S.winCard}>
          <div style={{fontSize:48,marginBottom:8}}>👑</div>
          <img src={winner.avatar} style={S.winAva} alt="" />
          <div style={S.winName}>{winner.displayName}</div>
          <div style={S.winBal}>{fmt(winner.balance)} ₿</div>
          <div style={S.winLabel}>GAGNANT DU GIVEAWAY</div>
        </div>
      )}
      {myRank>0 && <p style={S.myRank}>Ton classement : <b style={{color:"#9146ff"}}>#{myRank}</b> / {sorted.length}</p>}
      <div style={{maxWidth:500,margin:"24px auto"}}><Leaderboard participants={sorted} highlightLogin={user?.login} /></div>
      <button style={{...S.primaryBtn,margin:"0 auto 60px",display:"block"}} onClick={onHome}>← Retour à l'accueil</button>
    </div>
  );
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (status==="open")     return <span style={S.badgeOpen}>● Ouvert</span>;
  if (status==="closed")   return <span style={S.badgeClosed}>⏸ Fermé</span>;
  if (status==="resolved") return <span style={S.badgeResolved}>✓ Résolu</span>;
  return null;
}
function Stat({ val, label, accent }) {
  return <div style={S.statBox}><div style={{...S.statVal,...(accent?{color:"#9146ff"}:{})}}>{val}</div><div style={S.statLab}>{label}</div></div>;
}
function Empty({ msg, action, onAction }) {
  return <div style={S.empty}>{msg} {action && <span style={S.emptyLink} onClick={onAction}>{action}</span>}</div>;
}
function Loader({ text }) {
  return <div style={S.loader}><span className="spin">◈</span> {text}</div>;
}
function ErrorBanner({ msg, onDismiss }) {
  return <div style={S.errBanner}>⚠ {msg} <button style={S.errClose} onClick={onDismiss}>✕</button></div>;
}
function TwitchSVG() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="white" style={{marginRight:8,flexShrink:0}}>
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
  </svg>;
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  root:{ minHeight:"100vh", background:"#07070f", color:"#f0f0f8", fontFamily:"'Syne','Trebuchet MS',sans-serif" },

  // NAV
  nav:{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 28px", borderBottom:"1px solid #18182a", background:"rgba(7,7,15,0.97)", position:"sticky", top:0, zIndex:100, backdropFilter:"blur(16px)", gap:12, flexWrap:"wrap" },
  navBrand:{ display:"flex", alignItems:"center", gap:12, cursor:"pointer" },
  navLogo:{ height:36, width:"auto", objectFit:"contain" },
  navLogoAccent:{ color:"#9146ff" },
  sessionPill:{ display:"flex", alignItems:"center", gap:6, fontSize:11, background:"#18182a", padding:"3px 12px", borderRadius:20, color:"#9ca3af", letterSpacing:"0.06em" },
  liveDot:{ width:7, height:7, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 8px #4ade80", display:"inline-block" },
  pillDivider:{ opacity:0.4 },
  pillCode:{ fontFamily:"'DM Mono',monospace", fontWeight:700, color:"#9146ff" },
  navRight:{ display:"flex", alignItems:"center", gap:10 },
  navBtn:{ background:"#18182a", border:"1px solid #2a2a3e", color:"#d1d5db", padding:"6px 16px", borderRadius:6, cursor:"pointer", fontSize:13 },
  iconBtn:{ background:"none", border:"none", color:"#6b7280", cursor:"pointer", fontSize:18, padding:"4px 8px" },
  userChip:{ display:"flex", alignItems:"center", gap:8, background:"#18182a", border:"1px solid #2a2a3e", borderRadius:24, padding:"3px 12px 3px 3px" },
  ava:{ width:30, height:30, borderRadius:"50%", objectFit:"cover", border:"2px solid #9146ff" },
  uname:{ fontSize:13, fontWeight:700 },
  logoutBtn:{ background:"none", border:"none", color:"#6b7280", cursor:"pointer", fontSize:15, padding:0 },
  guestTxt:{ fontSize:13, color:"#4b5563" },

  // MAIN
  main:{ maxWidth:960, margin:"0 auto", padding:"clamp(16px, 4vw, 40px) clamp(12px, 3vw, 20px)" },

  // HOME
  homeWrap:{ maxWidth:680, margin:"0 auto" },
  hero:{ position:"relative", textAlign:"center", padding:"60px 20px 48px", overflow:"hidden" },
  heroBlob:{ position:"absolute", top:"10%", left:"20%", width:320, height:180, background:"radial-gradient(ellipse,rgba(145,70,255,.18) 0%,transparent 70%)", pointerEvents:"none" },
  heroBlob2:{ position:"absolute", bottom:0, right:"15%", width:240, height:160, background:"radial-gradient(ellipse,rgba(79,209,197,.1) 0%,transparent 70%)", pointerEvents:"none" },
  heroInner:{ position:"relative" },
  heroBadge:{ display:"inline-block", fontSize:12, background:"rgba(145,70,255,.12)", border:"1px solid rgba(145,70,255,.3)", color:"#a78bfa", padding:"5px 14px", borderRadius:20, marginBottom:20, letterSpacing:"0.05em" },
  heroTitle:{ fontSize:64, fontWeight:900, margin:"0 0 16px", letterSpacing:"-0.03em", lineHeight:1 },
  heroTitleBet:{ color:"#f0f0f8" },
  heroTitleTer:{ color:"#9146ff" },
  heroTitleViewer:{ color:"#f0f0f8" },
  heroSub:{ fontSize:16, color:"#6b7280", lineHeight:1.7, margin:0 },
  alertBar:{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#1c1400", border:"1px solid #78350f", borderRadius:10, padding:"12px 18px", marginBottom:24, gap:12 },
  alertBtn:{ background:"none", border:"1px solid #78350f", color:"#fcd34d", padding:"6px 14px", borderRadius:6, cursor:"pointer", fontSize:12, whiteSpace:"nowrap" },
  loginBox:{ textAlign:"center", padding:"40px 0" },
  loginHint:{ color:"#6b7280", fontSize:14, marginBottom:20 },
  twitchBtn:{ display:"inline-flex", alignItems:"center", background:"#9146ff", color:"#fff", border:"none", borderRadius:8, padding:"13px 30px", fontSize:15, fontWeight:800, cursor:"pointer" },
  disabled:{ opacity:0.4, cursor:"not-allowed" },
  cards2:{ display:"grid", gridTemplateColumns:"1fr auto 1fr", alignItems:"center", gap:16 },
  roleCard:{ background:"#0d0d1a", border:"1px solid #18182a", borderRadius:14, padding:28 },
  roleDivider:{ textAlign:"center", color:"#2a2a3e", fontSize:13, fontWeight:700 },
  roleIcon:{ fontSize:36, marginBottom:12 },
  roleLabel:{ fontSize:18, fontWeight:800, marginBottom:8, color:"#f0f0f8" },
  roleDesc:{ fontSize:13, color:"#6b7280", marginBottom:20, lineHeight:1.6 },
  primaryBtn:{ background:"linear-gradient(135deg,#6d28d9,#9146ff)", border:"none", color:"#fff", borderRadius:8, padding:"11px 24px", fontSize:14, fontWeight:800, cursor:"pointer", letterSpacing:"0.02em" },
  joinRow:{ display:"flex", gap:8 },
  codeInput:{ background:"#18182a", border:"1px solid #2a2a3e", borderRadius:8, color:"#f0f0f8", padding:"11px 14px", fontSize:18, fontFamily:"'DM Mono',monospace", letterSpacing:"0.2em", outline:"none", flex:1, width:0, textTransform:"uppercase" },
  joinBtn:{ background:"#9146ff", border:"none", color:"#fff", borderRadius:8, padding:"11px 20px", cursor:"pointer", fontWeight:900, fontSize:15 },

  // CONFIG
  formWrap:{ maxWidth:580, margin:"0 auto" },
  backBtn:{ background:"none", border:"none", color:"#6b7280", cursor:"pointer", fontSize:14, marginBottom:20, padding:0 },
  pageTitle:{ fontSize:26, fontWeight:900, marginBottom:24 },
  card:{ background:"#0d0d1a", border:"1px solid #18182a", borderRadius:14, padding:26 },
  cardH:{ fontSize:15, fontWeight:800, marginBottom:16, margin:"0 0 16px" },
  ol:{ color:"#9ca3af", fontSize:13, paddingLeft:20, lineHeight:2, margin:"0 0 16px" },
  a:{ color:"#9146ff" },
  label:{ display:"block", fontSize:11, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6, marginTop:14 },
  input:{ width:"100%", background:"#07070f", border:"1px solid #2a2a3e", borderRadius:8, color:"#f0f0f8", padding:"10px 14px", fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" },
  inlineCode:{ fontFamily:"'DM Mono',monospace", background:"#18182a", padding:"2px 6px", borderRadius:4, fontSize:12, wordBreak:"break-all" },
  fieldErr:{ color:"#f87171", fontSize:12, marginTop:6 },

  // DASH
  dashWrap:{ maxWidth:720, margin:"0 auto" },
  topBar:{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#0d0d1a", border:"1px solid #18182a", borderRadius:14, padding:"20px 26px", marginBottom:24, flexWrap:"wrap", gap:16 },
  topCode:{ fontSize:38, fontWeight:900, color:"#9146ff", fontFamily:"'DM Mono',monospace", letterSpacing:"0.18em" },
  topMeta:{ fontSize:13, color:"#6b7280", marginTop:4 },
  topActions:{ display:"flex", gap:10, flexWrap:"wrap" },
  ghostBtn:{ background:"#18182a", border:"1px solid #2a2a3e", color:"#d1d5db", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:13 },
  goLiveBtn:{ background:"#14532d", border:"1px solid #16a34a", color:"#4ade80", padding:"8px 20px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:800 },
  endBtn:{ background:"#7f1d1d", border:"1px solid #b91c1c", color:"#f87171", padding:"8px 20px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:800 },
  tabs:{ display:"flex", gap:2, borderBottom:"1px solid #18182a", marginBottom:20 },
  tab:{ background:"none", border:"none", color:"#6b7280", padding:"10px 18px", cursor:"pointer", fontSize:14, borderBottom:"2px solid transparent", marginBottom:-1 },
  tabOn:{ color:"#9146ff", borderBottom:"2px solid #9146ff" },

  // MARKET CARDS
  mCard:{ background:"#0d0d1a", border:"1px solid #18182a", borderRadius:12, padding:20, marginBottom:14 },
  mTop:{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, gap:12 },
  mTitle:{ fontSize:15, fontWeight:700, flex:1, lineHeight:1.4 },
  optGrid:{ display:"grid", gap:8 },
  optRow:{ background:"#07070f", border:"1px solid #18182a", borderRadius:8, padding:"10px 14px", transition:"border-color .15s" },
  optSel:{ border:"1px solid #9146ff", background:"#150d2e" },
  optWinner:{ border:"1px solid #4ade80", background:"#052e16" },
  optMine:{ borderColor:"#6d28d9" },
  optTop:{ display:"flex", justifyContent:"space-between", fontSize:14, color:"#f0f0f8", marginBottom:6 },
  optPct:{ color:"#9146ff", fontWeight:800 },
  progWrap:{ height:4, background:"#18182a", borderRadius:2, overflow:"hidden", marginBottom:6 },
  progBar:{ height:"100%", background:"linear-gradient(90deg,#6d28d9,#9146ff)", borderRadius:2, transition:"width .4s" },
  optSub:{ fontSize:11, color:"#4b5563" },
  mFoot:{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14, flexWrap:"wrap", gap:8 },
  mTotal:{ fontSize:12, color:"#6b7280" },
  closeBtn:{ background:"#1c1400", border:"1px solid #b45309", color:"#fbbf24", padding:"6px 14px", borderRadius:6, cursor:"pointer", fontSize:12 },
  resolveBtn:{ background:"#052e16", border:"1px solid #16a34a", color:"#4ade80", padding:"6px 14px", borderRadius:6, cursor:"pointer", fontSize:12 },
  rmBtn:{ background:"#18182a", border:"1px solid #2a2a3e", color:"#f87171", borderRadius:6, padding:"0 12px", cursor:"pointer" },
  addBtn:{ background:"none", border:"1px dashed #2a2a3e", color:"#6b7280", padding:8, borderRadius:8, cursor:"pointer", width:"100%", fontSize:13, marginTop:4 },
  badgeOpen:{ fontSize:11, color:"#4ade80", background:"rgba(74,222,128,.1)", padding:"3px 10px", borderRadius:20, whiteSpace:"nowrap" },
  badgeClosed:{ fontSize:11, color:"#fbbf24", background:"rgba(251,191,36,.1)", padding:"3px 10px", borderRadius:20, whiteSpace:"nowrap" },
  badgeResolved:{ fontSize:11, color:"#9ca3af", background:"#18182a", padding:"3px 10px", borderRadius:20, whiteSpace:"nowrap" },
  betArea:{ display:"flex", gap:8, marginTop:14, flexDirection:"column", alignItems:"stretch" },
  quickBtn:{ background:"#18182a", border:"1px solid #2a2a3e", color:"#d1d5db", borderRadius:6, padding:"9px 10px", cursor:"pointer", fontSize:12, flex:1 },
  myBetNote:{ marginTop:12, fontSize:13, color:"#a78bfa", background:"rgba(145,70,255,.08)", border:"1px solid rgba(145,70,255,.2)", borderRadius:6, padding:"8px 14px" },

  // VIEWER BAR
  viewerTopBar:{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#0d0d1a", border:"1px solid #18182a", borderRadius:14, padding:"18px 24px", marginBottom:24, flexWrap:"wrap", gap:16 },
  viewerLeft:{ display:"flex", alignItems:"center", gap:14 },
  bigAva:{ width:52, height:52, borderRadius:"50%", border:"2px solid #9146ff" },
  viewerName:{ fontSize:20, fontWeight:900 },
  viewerSub:{ fontSize:13, color:"#6b7280", marginTop:2 },
  statsRow:{ display:"flex", gap:24 },
  statBox:{ textAlign:"center" },
  statVal:{ fontSize:22, fontWeight:900 },
  statLab:{ fontSize:11, color:"#4b5563", textTransform:"uppercase", letterSpacing:"0.08em" },
  lobbyBanner:{ background:"rgba(145,70,255,.08)", border:"1px solid rgba(145,70,255,.2)", borderRadius:8, padding:"12px 18px", fontSize:14, color:"#a78bfa", textAlign:"center", marginBottom:20 },

  // LEADERBOARD
  lbRow:{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid #18182a" },
  lbMe:{ background:"rgba(145,70,255,.07)", borderRadius:8, padding:"10px 10px", margin:"0 -10px" },
  lbRank:{ fontSize:16, width:32, textAlign:"center", flexShrink:0 },
  lbAva:{ width:32, height:32, borderRadius:"50%", objectFit:"cover" },
  lbName:{ flex:1, fontSize:14, fontWeight:700 },
  lbBal:{ fontSize:15, fontWeight:800, color:"#9146ff" },

  // RESULTS
  resultsWrap:{ maxWidth:560, margin:"0 auto", textAlign:"center" },
  resGlow:{ position:"fixed", top:0, left:"50%", transform:"translateX(-50%)", width:600, height:300, background:"radial-gradient(ellipse,rgba(145,70,255,.2) 0%,transparent 70%)", pointerEvents:"none" },
  resTitle:{ fontSize:48, fontWeight:900, margin:"40px 0 8px" },
  resSub:{ fontSize:15, color:"#6b7280", marginBottom:36 },
  winCard:{ background:"linear-gradient(135deg,#150d2e,#0a1a0a)", border:"2px solid #9146ff", borderRadius:20, padding:"36px 24px", marginBottom:28 },
  winAva:{ width:80, height:80, borderRadius:"50%", border:"3px solid #9146ff", marginBottom:12 },
  winName:{ fontSize:28, fontWeight:900, marginBottom:8 },
  winBal:{ fontSize:32, fontWeight:900, color:"#9146ff", marginBottom:8 },
  winLabel:{ fontSize:12, color:"#4ade80", letterSpacing:"0.15em", textTransform:"uppercase" },
  myRank:{ fontSize:16, color:"#9ca3af", marginBottom:8 },

  // MISC
  empty:{ textAlign:"center", color:"#4b5563", padding:"40px 0", fontSize:14 },
  emptyLink:{ color:"#9146ff", cursor:"pointer", marginLeft:4 },
  loader:{ textAlign:"center", color:"#9146ff", padding:60, fontSize:18 },
  errBanner:{ background:"#2d0a0a", border:"1px solid #b91c1c", borderRadius:8, padding:"12px 18px", color:"#f87171", fontSize:14, marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center" },
  errClose:{ background:"none", border:"none", color:"#f87171", cursor:"pointer", fontSize:16 },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;}body{margin:0;}
  input:focus,textarea:focus{border-color:#9146ff!important;box-shadow:0 0 0 2px rgba(145,70,255,.15);}
  button:hover{filter:brightness(1.12);}
  a{color:#9146ff;}
  .toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:14px;font-family:'Syne',sans-serif;z-index:9999;animation:fadeUp .2s ease;max-width:340px;line-height:1.5;}
  .toast-ok{background:#052e16;border:1px solid #4ade80;color:#4ade80;}
  .toast-err{background:#2d0a0a;border:1px solid #f87171;color:#f87171;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .spin{display:inline-block;animation:spin 1s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg)}}
  ::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:#07070f;}::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:3px;}
  @media(max-width:640px){
    .cards2 { grid-template-columns: 1fr !important; }
    .roleDivider { display: none !important; }
  }
`;
