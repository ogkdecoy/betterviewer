import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, update, onValue } from "firebase/database";

// ─── FIREBASE CONFIG (hardcoded) ──────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC4N6lt83VhpAoD6Q9E06LG3RSLS6-uu2Y",
  authDomain: "betterviewer-d14fa.firebaseapp.com",
  databaseURL: "https://betterviewer-d14fa-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "betterviewer-d14fa",
  storageBucket: "betterviewer-d14fa.firebasestorage.app",
  messagingSenderId: "172679268105",
  appId: "1:172679268105:web:db06e2ecf16ed1661875d8"
};
const TWITCH_CLIENT_ID = "d3313alwndj6mxi27aehgh6swizpk3";

// ─── FIREBASE INIT ────────────────────────────────────────────────────────────
let _app = null, _db = null;
function getDb() {
  if (_db) return _db;
  _app = initializeApp(FIREBASE_CONFIG);
  _db = getDatabase(_app);
  return _db;
}

// ─── TRANSLATIONS ─────────────────────────────────────────────────────────────
const T = {
  fr: {
    tagline: "Twitch · Paris en direct",
    heroSub: "Engage tes viewers avec des paris factices en direct.\nLe meilleur gagne le giveaway.",
    loginHint: "Connecte-toi pour créer ou rejoindre une session",
    loginTwitch: "Se connecter avec Twitch",
    loginKick: "Rejoindre avec Kick",
    kickPlaceholder: "Ton pseudo Kick",
    kickJoin: "Rejoindre",
    streamer: "Streamer",
    streamerDesc: "Lance une session, crée les marchés, désigne le gagnant.",
    viewer: "Viewer",
    viewerDesc: "Entre le code partagé en stream pour participer.",
    createSession: "Créer une session",
    joinSession: "Rejoindre",
    codePlaceholder: "Ex: A3FX9K",
    markets: "Marchés",
    create: "Créer",
    leaderboard: "Classement",
    bets: "Paris",
    noMarket: "Aucun marché disponible pour l'instant.",
    noMarketAction: "Créer le premier →",
    question: "Question",
    questionPlaceholder: "Ex: Qui va gagner le prochain duel ?",
    options: "Options",
    openMarket: "Ouvrir le marché",
    closeBets: "Fermer les paris",
    goLive: "▶ Go Live",
    endSession: "■ Terminer",
    copyLink: "🔗 Lien",
    copyCode: "📋 Code",
    copied: "✓ Copié !",
    resolve: "✓",
    balance: "Solde",
    rank: "Rang",
    players: "Joueurs",
    lobby: "⏳ En attente du démarrage…",
    bet: "Parier",
    myBet: "← Mon pari",
    sessionOf: "Session de",
    streamEnded: "🏆 Stream terminé !",
    winner: "GAGNANT DU GIVEAWAY",
    myRank: "Ton classement",
    backHome: "← Retour à l'accueil",
    waitingLobby: "En attente du démarrage…",
    open: "● Ouvert",
    closed: "⏸ Fermé",
    resolved: "✓ Résolu",
    live: "LIVE",
    ended: "TERMINÉ",
    addOption: "+ Option",
    viewers: "viewers",
    totalPool: "Total",
    dashboard: "Dashboard",
    mySession: "Ma session",
  },
  en: {
    tagline: "Twitch · Live Betting",
    heroSub: "Engage your viewers with live fake bets.\nThe best player wins the giveaway.",
    loginHint: "Sign in to create or join a session",
    loginTwitch: "Sign in with Twitch",
    loginKick: "Join with Kick",
    kickPlaceholder: "Your Kick username",
    kickJoin: "Join",
    streamer: "Streamer",
    streamerDesc: "Start a session, create markets, pick the winner.",
    viewer: "Viewer",
    viewerDesc: "Enter the code shared in stream to participate.",
    createSession: "Create a session",
    joinSession: "Join",
    codePlaceholder: "Ex: A3FX9K",
    markets: "Markets",
    create: "Create",
    leaderboard: "Leaderboard",
    bets: "Bets",
    noMarket: "No markets available yet.",
    noMarketAction: "Create the first one →",
    question: "Question",
    questionPlaceholder: "Ex: Who will win the next duel?",
    options: "Options",
    openMarket: "Open market",
    closeBets: "Close bets",
    goLive: "▶ Go Live",
    endSession: "■ End stream",
    copyLink: "🔗 Link",
    copyCode: "📋 Code",
    copied: "✓ Copied!",
    resolve: "✓",
    balance: "Balance",
    rank: "Rank",
    players: "Players",
    lobby: "⏳ Waiting for stream to start…",
    bet: "Bet",
    myBet: "← My bet",
    sessionOf: "Session by",
    streamEnded: "🏆 Stream ended!",
    winner: "GIVEAWAY WINNER",
    myRank: "Your rank",
    backHome: "← Back to home",
    waitingLobby: "Waiting for stream to start…",
    open: "● Open",
    closed: "⏸ Closed",
    resolved: "✓ Resolved",
    live: "LIVE",
    ended: "ENDED",
    addOption: "+ Option",
    viewers: "viewers",
    totalPool: "Total",
    dashboard: "Dashboard",
    mySession: "My session",
  }
};

// ─── HOOKS ────────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 640 : false);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 640);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
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

// ─── TWITCH OAUTH ─────────────────────────────────────────────────────────────
const REDIRECT_URI = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";

function buildTwitchURL() {
  const state = genId();
  LS.set("bv_state", state);
  return `https://id.twitch.tv/oauth2/authorize?` + new URLSearchParams({
    client_id: TWITCH_CLIENT_ID, redirect_uri: REDIRECT_URI,
    response_type: "token", scope: "user:read:email", state, force_verify: "true",
  });
}
async function fetchTwitchUser(token) {
  const r = await fetch("https://api.twitch.tv/helix/users", {
    headers: { Authorization: `Bearer ${token}`, "Client-Id": TWITCH_CLIENT_ID },
  });
  if (!r.ok) throw new Error("Twitch API error");
  return (await r.json()).data[0];
}

// ═════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [lang, setLang]           = useState(() => LS.get("bv_lang") || "fr");
  const [twitchUser, setTwitchUser] = useState(() => LS.get("bv_user") || null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError]   = useState("");
  const [view, setView]             = useState("home");
  const [sessionCode, setSessionCode] = useState(null);
  const [session, setSession]       = useState(null);
  const [toast, setToast]           = useState(null);
  const unsub = useRef(null);
  const t = T[lang];

  // Init Firebase on load
  useEffect(() => { getDb(); }, []);

  // OAuth callback
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("access_token")) return;
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get("access_token");
    const state = params.get("state");
    window.history.replaceState({}, "", window.location.pathname);
    if (!token || state !== LS.get("bv_state")) { setAuthError("Auth échouée."); return; }
    LS.del("bv_state");
    setAuthLoading(true);
    fetchTwitchUser(token).then(u => {
      const user = { id: u.id, login: u.login, displayName: u.display_name, avatar: u.profile_image_url, token, platform: "twitch" };
      setTwitchUser(user); LS.set("bv_user", user); setAuthLoading(false);
    }).catch(() => { setAuthError("Profil Twitch introuvable."); setAuthLoading(false); });
  }, []);

  // ?join= param
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

  // Firebase subscription
  function subscribeSession(code) {
    if (unsub.current) unsub.current();
    const r = ref(getDb(), `sessions/${code}`);
    unsub.current = onValue(r, snap => { if (snap.val()) setSession(snap.val()); });
  }
  useEffect(() => () => { if (unsub.current) unsub.current(); }, []);

  function showToast(msg, type="ok") { setToast({msg,type}); setTimeout(()=>setToast(null),3500); }

  // ── Kick login ──
  function handleKickLogin(pseudo) {
    if (!pseudo.trim()) return;
    const user = {
      id: `kick_${pseudo.toLowerCase()}`,
      login: pseudo.toLowerCase(),
      displayName: pseudo,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(pseudo)}&background=53fc18&color=000&bold=true`,
      platform: "kick"
    };
    setTwitchUser(user); LS.set("bv_user", user);
  }

  // ── Create session ──
  async function handleCreate() {
    const code = genCode();
    const link = `${window.location.origin}${window.location.pathname}?join=${code}`;
    await set(ref(getDb(), `sessions/${code}`), {
      code, link,
      streamerLogin: twitchUser.login,
      streamerName: twitchUser.displayName,
      streamerAvatar: twitchUser.avatar,
      streamerPlatform: twitchUser.platform || "twitch",
      status: "lobby",
      createdAt: Date.now(),
      participants: {
        [twitchUser.login]: { login: twitchUser.login, displayName: twitchUser.displayName, avatar: twitchUser.avatar, balance: STARTING_BALANCE, joinedAt: Date.now() }
      },
      markets: {},
    });
    setSessionCode(code); subscribeSession(code); setView("streamer");
    showToast(`Session créée ! Code : ${code}`);
  }

  // ── Join session ──
  async function handleJoin(code) {
    const snap = await get(ref(getDb(), `sessions/${code}`));
    if (!snap.exists()) return showToast("Code introuvable.", "err");
    const data = snap.val();
    if (data.status === "ended") return showToast(lang==="fr"?"Session terminée.":"Session ended.", "err");
    if (!data.participants?.[twitchUser.login]) {
      await set(ref(getDb(), `sessions/${code}/participants/${twitchUser.login}`), {
        login: twitchUser.login, displayName: twitchUser.displayName,
        avatar: twitchUser.avatar, balance: STARTING_BALANCE, joinedAt: Date.now(),
      });
    }
    setSessionCode(code); subscribeSession(code);
    setView(data.streamerLogin === twitchUser.login ? "streamer" : "viewer");
    showToast(lang==="fr"?`Rejoint la session ${code} !`:`Joined session ${code}!`);
  }

  async function handleStartLive() { await update(ref(getDb(),`sessions/${sessionCode}`),{status:"live"}); showToast(lang==="fr"?"Le live a démarré !":"Stream started!"); }
  async function handleEndSession() { await update(ref(getDb(),`sessions/${sessionCode}`),{status:"ended"}); setView("results"); }

  async function handleCreateMarket(title, options) {
    const id = genId();
    const opts = {};
    options.forEach(label => { const oid=genId(); opts[oid]={id:oid,label,pool:0,bettors:{}}; });
    await set(ref(getDb(),`sessions/${sessionCode}/markets/${id}`),{id,title,options:opts,status:"open",createdAt:Date.now(),totalPool:0,winner:null});
    showToast(lang==="fr"?"Marché ouvert !":"Market opened!");
  }

  async function handleCloseMarket(marketId) { await update(ref(getDb(),`sessions/${sessionCode}/markets/${marketId}`),{status:"closed"}); }

  async function handleResolveMarket(marketId, winOptId) {
    const snap = await get(ref(getDb(),`sessions/${sessionCode}`));
    const s = snap.val();
    const market = s.markets?.[marketId];
    if (!market) return;
    const winPool = market.options?.[winOptId]?.pool||0;
    const total = market.totalPool||0;
    const updates = {};
    updates[`sessions/${sessionCode}/markets/${marketId}/status`]="resolved";
    updates[`sessions/${sessionCode}/markets/${marketId}/winner`]=winOptId;
    Object.values(market.options||{}).forEach(opt => {
      Object.entries(opt.bettors||{}).forEach(([login,amount]) => {
        if (opt.id===winOptId && winPool>0) {
          const payout=(amount/winPool)*total;
          const cur=s.participants?.[login]?.balance||0;
          updates[`sessions/${sessionCode}/participants/${login}/balance`]=+(cur+payout).toFixed(2);
        }
      });
    });
    await update(ref(getDb()),updates);
    showToast(lang==="fr"?"🏆 Gains distribués !":"🏆 Winnings distributed!");
  }

  async function handleBet(marketId, optionId, amount) {
    const snap = await get(ref(getDb(),`sessions/${sessionCode}`));
    const s = snap.val();
    const participant = s.participants?.[twitchUser.login];
    if (!participant) return showToast("Participant introuvable.","err");
    if (amount>participant.balance) return showToast(lang==="fr"?"Solde insuffisant.":"Insufficient balance.","err");
    const market = s.markets?.[marketId];
    if (!market||market.status!=="open") return showToast(lang==="fr"?"Paris fermés.":"Bets closed.","err");
    if (Object.values(market.options||{}).some(o=>o.bettors?.[twitchUser.login])) return showToast(lang==="fr"?"Tu as déjà parié.":"Already bet.","err");
    const opt = market.options[optionId];
    const updates = {};
    updates[`sessions/${sessionCode}/markets/${marketId}/options/${optionId}/pool`]=(opt.pool||0)+amount;
    updates[`sessions/${sessionCode}/markets/${marketId}/options/${optionId}/bettors/${twitchUser.login}`]=amount;
    updates[`sessions/${sessionCode}/markets/${marketId}/totalPool`]=(market.totalPool||0)+amount;
    updates[`sessions/${sessionCode}/participants/${twitchUser.login}/balance`]=+(participant.balance-amount).toFixed(2);
    await update(ref(getDb()),updates);
    showToast(`${lang==="fr"?"Pari de":"Bet of"} ${fmt(amount)} ₿ !`);
  }

  function logout() { LS.del("bv_user"); setTwitchUser(null); setView("home"); setSession(null); setSessionCode(null); if(unsub.current) unsub.current(); }
  function toggleLang() { const nl=lang==="fr"?"en":"fr"; setLang(nl); LS.set("bv_lang",nl); }

  const isStreamer = session?.streamerLogin === twitchUser?.login;

  return (
    <div style={S.root}>
      <style>{CSS}</style>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      <Nav user={twitchUser} onLogout={logout} onHome={()=>{setView("home");}} session={session} isStreamer={isStreamer} onDash={()=>setView(isStreamer?"streamer":"viewer")} lang={lang} onToggleLang={toggleLang} t={t} />
      <main style={S.main}>
        {authLoading && <Loader />}
        {authError && <ErrorBanner msg={authError} onDismiss={()=>setAuthError("")} />}
        {view==="home" && !authLoading && <HomePage user={twitchUser} t={t} onLogin={()=>{window.location.href=buildTwitchURL();}} onKickLogin={handleKickLogin} onCreate={handleCreate} onJoin={handleJoin} />}
        {view==="streamer" && session && <StreamerDash session={session} user={twitchUser} t={t} onCreateMarket={handleCreateMarket} onCloseMarket={handleCloseMarket} onResolveMarket={handleResolveMarket} onStartLive={handleStartLive} onEndSession={handleEndSession} />}
        {view==="viewer" && session && <ViewerDash session={session} user={twitchUser} t={t} onBet={handleBet} />}
        {view==="results" && session && <ResultsPage session={session} user={twitchUser} t={t} onHome={()=>{setView("home");setSession(null);setSessionCode(null);}} />}
      </main>
    </div>
  );
}

// ─── NAV ──────────────────────────────────────────────────────────────────────
function Nav({ user, onLogout, onHome, session, isStreamer, onDash, lang, onToggleLang, t }) {
  const mobile = useIsMobile();
  return (
    <nav style={{...S.nav, padding: mobile?"10px 14px":"14px 28px"}}>
      <div style={S.navBrand} onClick={onHome}>
        <img src="https://raw.githubusercontent.com/ogkdecoy/Betterviewer/main/public/logo.png.PNG" alt="BETterviewer" style={{height:mobile?28:36,width:"auto",objectFit:"contain"}} />
        {session && (
          <div style={S.sessionPill}>
            {session.status==="live" ? <><span style={S.liveDot}/>LIVE</> : session.status==="lobby"?"LOBBY":t.ended}
            <span style={{opacity:.4}}>·</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontWeight:700,color:"#9146ff"}}>{session.code}</span>
          </div>
        )}
      </div>
      <div style={S.navRight}>
        {session && <button style={S.navBtn} onClick={onDash}>{isStreamer?t.dashboard:t.mySession}</button>}
        <button style={{...S.iconBtn, fontSize:13, fontWeight:700, padding:"4px 10px", border:"1px solid #2a2a3e", borderRadius:6}} onClick={onToggleLang}>
          {lang==="fr"?"🇬🇧 EN":"🇫🇷 FR"}
        </button>
        {user ? (
          <div style={S.userChip}>
            <img src={user.avatar} style={{...S.ava, border: user.platform==="kick"?"2px solid #53fc18":"2px solid #9146ff"}} alt="" />
            <span style={S.uname}>{user.displayName}</span>
            {user.platform==="kick" && <span style={{fontSize:10,color:"#53fc18",background:"rgba(83,252,24,.15)",padding:"1px 6px",borderRadius:10}}>KICK</span>}
            <button style={S.logoutBtn} onClick={onLogout} title="Déconnexion">↩</button>
          </div>
        ) : <span style={S.guestTxt}>{lang==="fr"?"Non connecté":"Not signed in"}</span>}
      </div>
    </nav>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function HomePage({ user, t, onLogin, onKickLogin, onCreate, onJoin }) {
  const [code, setCode]     = useState("");
  const [kickPseudo, setKickPseudo] = useState("");
  const [showKick, setShowKick]     = useState(false);
  const mobile = useIsMobile();

  return (
    <div style={S.homeWrap}>
      <div style={S.hero}>
        <div style={S.heroBlob}/><div style={S.heroBlob2}/>
        <div style={{position:"relative"}}>
          <div style={S.heroBadge}>🎮 {t.tagline}</div>
          <img src="https://raw.githubusercontent.com/ogkdecoy/Betterviewer/main/public/logo.png.PNG" alt="BETterviewer"
            style={{width:"100%",maxWidth:mobile?"280px":"480px",margin:"16px auto",display:"block"}} />
          <p style={{...S.heroSub, whiteSpace:"pre-line"}}>{t.heroSub}</p>
        </div>
      </div>

      {!user ? (
        <div style={S.loginBox}>
          <p style={S.loginHint}>{t.loginHint}</p>
          <button style={S.twitchBtn} onClick={onLogin}><TwitchSVG />{t.loginTwitch}</button>
          <div style={{margin:"16px 0", color:"#4b5563", fontSize:13}}>— ou —</div>
          {!showKick ? (
            <button style={S.kickBtn} onClick={()=>setShowKick(true)}><KickSVG />{t.loginKick}</button>
          ) : (
            <div style={{display:"flex",gap:8,maxWidth:360,margin:"0 auto"}}>
              <input style={{...S.codeInput,flex:1,letterSpacing:"normal",fontSize:14}} placeholder={t.kickPlaceholder}
                value={kickPseudo} onChange={e=>setKickPseudo(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&onKickLogin(kickPseudo)} />
              <button style={S.kickBtn} onClick={()=>onKickLogin(kickPseudo)}>{t.kickJoin}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="cards2" style={{...S.cards2, gridTemplateColumns: mobile?"1fr":"1fr auto 1fr"}}>
          <div style={S.roleCard}>
            <div style={S.roleIcon}>🎙</div>
            <div style={S.roleLabel}>{t.streamer}</div>
            <p style={S.roleDesc}>{t.streamerDesc}</p>
            <button style={S.primaryBtn} onClick={onCreate}>{t.createSession}</button>
          </div>
          {!mobile && <div style={S.roleDivider}>ou</div>}
          <div style={S.roleCard}>
            <div style={S.roleIcon}>👁</div>
            <div style={S.roleLabel}>{t.viewer}</div>
            <p style={S.roleDesc}>{t.viewerDesc}</p>
            <div style={S.joinRow}>
              <input style={S.codeInput} placeholder={t.codePlaceholder} maxLength={6}
                value={code} onChange={e=>setCode(e.target.value.toUpperCase())}
                onKeyDown={e=>e.key==="Enter"&&onJoin(code)} />
              <button style={S.joinBtn} onClick={()=>onJoin(code)}>GO</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── STREAMER DASH ────────────────────────────────────────────────────────────
function StreamerDash({ session, user, t, onCreateMarket, onCloseMarket, onResolveMarket, onStartLive, onEndSession }) {
  const [tab, setTab]     = useState("markets");
  const [title, setTitle] = useState("");
  const [opts, setOpts]   = useState(["Oui","Non"]);
  const [copied, setCopied] = useState("");
  const mobile = useIsMobile();
  const markets = Object.values(session.markets||{}).sort((a,b)=>b.createdAt-a.createdAt);
  const participants = Object.values(session.participants||{}).sort((a,b)=>b.balance-a.balance);

  function copy(val,key){ navigator.clipboard.writeText(val); setCopied(key); setTimeout(()=>setCopied(""),2000); }
  function submit(){
    if(!title.trim()) return;
    const o=opts.filter(x=>x.trim());
    if(o.length<2) return;
    onCreateMarket(title,o); setTitle(""); setOpts(["Oui","Non"]);
  }

  return (
    <div style={S.dashWrap}>
      <div style={{...S.topBar, flexDirection:mobile?"column":"row"}}>
        <div>
          <div style={{...S.topCode,fontSize:mobile?"24px":"38px"}}>{session.code}</div>
          <div style={S.topMeta}>{participants.length} {t.viewers} · {markets.length} marchés</div>
        </div>
        <div style={{...S.topActions,width:mobile?"100%":"auto",flexWrap:"wrap"}}>
          <button style={S.ghostBtn} onClick={()=>copy(session.link,"link")}>{copied==="link"?t.copied:t.copyLink}</button>
          <button style={S.ghostBtn} onClick={()=>copy(session.code,"code")}>{copied==="code"?t.copied:t.copyCode}</button>
          {session.status==="lobby" && <button style={S.goLiveBtn} onClick={onStartLive}>{t.goLive}</button>}
          {session.status==="live"  && <button style={S.endBtn} onClick={onEndSession}>{t.endSession}</button>}
        </div>
      </div>

      <div style={S.tabs}>
        {[["markets",`📊 ${t.markets}`],["create",`➕ ${t.create}`],["lb",`🏆 ${t.leaderboard}`]].map(([k,l])=>(
          <button key={k} style={{...S.tab,...(tab===k?S.tabOn:{})}} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab==="markets" && (
        <div>
          {markets.length===0 && <Empty msg={t.noMarket} action={t.noMarketAction} onAction={()=>setTab("create")} />}
          {markets.map(m=><AdminMarketCard key={m.id} market={m} t={t} onClose={onCloseMarket} onResolve={onResolveMarket} />)}
        </div>
      )}
      {tab==="create" && (
        <div style={S.card}>
          <h3 style={S.cardH}>{t.create}</h3>
          <label style={S.label}>{t.question}</label>
          <input style={S.input} placeholder={t.questionPlaceholder} value={title} onChange={e=>setTitle(e.target.value)} />
          <label style={S.label}>{t.options}</label>
          {opts.map((o,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:8}}>
              <input style={{...S.input,flex:1,marginBottom:0}} value={o} placeholder={`Option ${i+1}`}
                onChange={e=>{const a=[...opts];a[i]=e.target.value;setOpts(a);}} />
              {opts.length>2 && <button style={S.rmBtn} onClick={()=>setOpts(opts.filter((_,j)=>j!==i))}>✕</button>}
            </div>
          ))}
          {opts.length<6 && <button style={S.addBtn} onClick={()=>setOpts([...opts,""])}>{t.addOption}</button>}
          <button style={{...S.primaryBtn,width:"100%",marginTop:20}} onClick={submit}>{t.openMarket}</button>
        </div>
      )}
      {tab==="lb" && <Leaderboard participants={participants} t={t} />}
    </div>
  );
}

function AdminMarketCard({ market, t, onClose, onResolve }) {
  const opts = Object.values(market.options||{});
  const total = market.totalPool||0;
  return (
    <div style={S.mCard}>
      <div style={S.mTop}><span style={S.mTitle}>{market.title}</span><StatusBadge status={market.status} t={t} /></div>
      <div style={S.optGrid}>
        {opts.map(opt=>{
          const pct=total>0?Math.round((opt.pool/total)*100):Math.round(100/opts.length);
          return (
            <div key={opt.id} style={{...S.optRow,...(market.winner===opt.id?S.optWinner:{})}}>
              <div style={S.optTop}><span>{opt.label}</span><b style={S.optPct}>{pct}%</b></div>
              <div style={S.progWrap}><div style={{...S.progBar,width:`${pct}%`}}/></div>
              <div style={S.optSub}>{fmt(opt.pool)} ₿ · {Object.keys(opt.bettors||{}).length} paris</div>
            </div>
          );
        })}
      </div>
      <div style={S.mFoot}>
        <span style={S.mTotal}>{t.totalPool}: {fmt(total)} ₿</span>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {market.status==="open" && <button style={S.closeBtn} onClick={()=>onClose(market.id)}>{t.closeBets}</button>}
          {market.status==="closed" && opts.map(opt=>(
            <button key={opt.id} style={S.resolveBtn} onClick={()=>onResolve(market.id,opt.id)}>{t.resolve} {opt.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── VIEWER DASH ──────────────────────────────────────────────────────────────
function ViewerDash({ session, user, t, onBet }) {
  const [tab, setTab] = useState("markets");
  const mobile = useIsMobile();
  const me = session.participants?.[user.login];
  const participants = Object.values(session.participants||{}).sort((a,b)=>b.balance-a.balance);
  const rank = participants.findIndex(p=>p.login===user.login)+1;
  const markets = Object.values(session.markets||{}).sort((a,b)=>b.createdAt-a.createdAt);

  return (
    <div style={S.dashWrap}>
      <div style={{...S.viewerTopBar, flexDirection:mobile?"column":"row"}}>
        <div style={S.viewerLeft}>
          <img src={user.avatar} style={S.bigAva} alt="" />
          <div>
            <div style={S.viewerName}>{user.displayName}</div>
            <div style={S.viewerSub}>{t.sessionOf} <b>{session.streamerName}</b></div>
          </div>
        </div>
        <div style={{...S.statsRow,width:mobile?"100%":"auto",justifyContent:mobile?"space-around":"flex-end"}}>
          <Stat val={`${fmt(me?.balance??STARTING_BALANCE)} ₿`} label={t.balance} accent />
          <Stat val={`#${rank}`} label={t.rank} />
          <Stat val={participants.length} label={t.players} />
        </div>
      </div>
      {session.status==="lobby" && <div style={S.lobbyBanner}>⏳ {t.waitingLobby}</div>}
      <div style={S.tabs}>
        {[["markets",`📊 ${t.bets}`],["lb",`🏆 ${t.leaderboard}`]].map(([k,l])=>(
          <button key={k} style={{...S.tab,...(tab===k?S.tabOn:{})}} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>
      {tab==="markets" && (
        <div>
          {markets.length===0 && <Empty msg={t.noMarket} />}
          {markets.map(m=><ViewerMarketCard key={m.id} market={m} user={user} balance={me?.balance??0} t={t} onBet={onBet} />)}
        </div>
      )}
      {tab==="lb" && <Leaderboard participants={participants} highlightLogin={user.login} t={t} />}
    </div>
  );
}

function ViewerMarketCard({ market, user, balance, t, onBet }) {
  const [sel, setSel]     = useState(null);
  const [amount, setAmount] = useState("");
  const opts  = Object.values(market.options||{});
  const total = market.totalPool||0;
  const myBetOpt = opts.find(o=>o.bettors?.[user.login]);
  const canBet = market.status==="open" && !myBetOpt;

  function submit(){
    const a=parseFloat(amount);
    if(!sel||!a||a<=0) return;
    onBet(market.id,sel,a); setSel(null); setAmount("");
  }

  return (
    <div style={S.mCard}>
      <div style={S.mTop}><span style={S.mTitle}>{market.title}</span><StatusBadge status={market.status} t={t} /></div>
      <div style={S.optGrid}>
        {opts.map(opt=>{
          const pct=total>0?Math.round((opt.pool/total)*100):Math.round(100/opts.length);
          const isMine=myBetOpt?.id===opt.id;
          const isWin=market.winner===opt.id;
          return (
            <div key={opt.id} style={{...S.optRow,...(sel===opt.id?S.optSel:{}),...(isWin?S.optWinner:{}),...(isMine?S.optMine:{}),cursor:canBet?"pointer":"default"}}
              onClick={()=>canBet&&setSel(opt.id)}>
              <div style={S.optTop}>
                <span>{opt.label}{isMine?` ${t.myBet}`:""}{isWin?" 🏆":""}</span>
                <b style={S.optPct}>{pct}%</b>
              </div>
              <div style={S.progWrap}><div style={{...S.progBar,width:`${pct}%`}}/></div>
              <div style={S.optSub}>
                ×{total>0&&opt.pool>0?(total/opt.pool).toFixed(2):"∞"}
                {isMine&&<span style={{color:"#9146ff",marginLeft:8}}>{fmt(myBetOpt.bettors[user.login])} ₿</span>}
              </div>
            </div>
          );
        })}
      </div>
      {canBet && sel && (
        <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:14}}>
          <input style={S.input} type="number" placeholder={`Montant ₿ (max ${fmt(balance)})`} min="1" max={balance}
            value={amount} onChange={e=>setAmount(e.target.value)} />
          <div style={{display:"flex",gap:6}}>
            {[10,50,100,250].map(v=>(
              <button key={v} style={{...S.quickBtn,flex:1}} onClick={()=>setAmount(String(Math.min(v,balance)))}>{v}</button>
            ))}
          </div>
          <button style={{...S.primaryBtn,width:"100%"}} onClick={submit}>{t.bet}</button>
        </div>
      )}
      {myBetOpt&&market.status==="open"&&(
        <div style={S.myBetNote}>{t.myBet.replace("←","")} <b>{fmt(myBetOpt.bettors[user.login])} ₿</b> → <b>{myBetOpt.label}</b></div>
      )}
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
function Leaderboard({ participants, highlightLogin, t }) {
  return (
    <div style={S.card}>
      <h3 style={S.cardH}>🏆 {t.leaderboard}</h3>
      {participants.map((p,i)=>(
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
function ResultsPage({ session, user, t, onHome }) {
  const sorted = Object.values(session.participants||{}).sort((a,b)=>b.balance-a.balance);
  const winner = sorted[0];
  const myRank = sorted.findIndex(p=>p.login===user?.login)+1;
  return (
    <div style={S.resultsWrap}>
      <div style={S.resGlow}/>
      <h1 style={S.resTitle}>{t.streamEnded}</h1>
      <p style={S.resSub}>{session.code} · {sorted.length} {t.players}</p>
      {winner && (
        <div style={S.winCard}>
          <div style={{fontSize:48,marginBottom:8}}>👑</div>
          <img src={winner.avatar} style={S.winAva} alt=""/>
          <div style={S.winName}>{winner.displayName}</div>
          <div style={S.winBal}>{fmt(winner.balance)} ₿</div>
          <div style={S.winLabel}>{t.winner}</div>
        </div>
      )}
      {myRank>0 && <p style={S.myRank}>{t.myRank} : <b style={{color:"#9146ff"}}>#{myRank}</b> / {sorted.length}</p>}
      <div style={{maxWidth:500,margin:"24px auto"}}><Leaderboard participants={sorted} highlightLogin={user?.login} t={t} /></div>
      <button style={{...S.primaryBtn,margin:"0 auto 60px",display:"block"}} onClick={onHome}>{t.backHome}</button>
    </div>
  );
}

// ─── SMALL COMPONENTS ────────────────────────────────────────────────────────
function StatusBadge({ status, t }) {
  if (status==="open")     return <span style={S.badgeOpen}>{t.open}</span>;
  if (status==="closed")   return <span style={S.badgeClosed}>{t.closed}</span>;
  if (status==="resolved") return <span style={S.badgeResolved}>{t.resolved}</span>;
  return null;
}
function Stat({ val, label, accent }) {
  return <div style={S.statBox}><div style={{...S.statVal,...(accent?{color:"#9146ff"}:{})}}>{val}</div><div style={S.statLab}>{label}</div></div>;
}
function Empty({ msg, action, onAction }) {
  return <div style={S.empty}>{msg} {action&&<span style={S.emptyLink} onClick={onAction}>{action}</span>}</div>;
}
function Loader() { return <div style={S.loader}><span className="spin">◈</span></div>; }
function ErrorBanner({ msg, onDismiss }) {
  return <div style={S.errBanner}>⚠ {msg} <button style={S.errClose} onClick={onDismiss}>✕</button></div>;
}
function TwitchSVG() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="white" style={{marginRight:8,flexShrink:0}}>
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
  </svg>;
}
function KickSVG() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{marginRight:8,flexShrink:0}}>
    <path d="M3 2h4v8l5-8h5l-6 9 6 11h-5l-5-9v9H3z"/>
  </svg>;
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S = {
  root:{ minHeight:"100vh", background:"#07070f", color:"#f0f0f8", fontFamily:"'Syne','Trebuchet MS',sans-serif" },
  nav:{ display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid #18182a", background:"rgba(7,7,15,0.97)", position:"sticky", top:0, zIndex:100, backdropFilter:"blur(16px)", gap:12, flexWrap:"wrap" },
  navBrand:{ display:"flex", alignItems:"center", gap:12, cursor:"pointer" },
  sessionPill:{ display:"flex", alignItems:"center", gap:6, fontSize:11, background:"#18182a", padding:"3px 12px", borderRadius:20, color:"#9ca3af", letterSpacing:"0.06em" },
  liveDot:{ width:7, height:7, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 8px #4ade80", display:"inline-block" },
  navRight:{ display:"flex", alignItems:"center", gap:8 },
  navBtn:{ background:"#18182a", border:"1px solid #2a2a3e", color:"#d1d5db", padding:"6px 14px", borderRadius:6, cursor:"pointer", fontSize:13 },
  iconBtn:{ background:"none", border:"none", color:"#6b7280", cursor:"pointer", fontSize:18, padding:"4px 8px" },
  userChip:{ display:"flex", alignItems:"center", gap:8, background:"#18182a", border:"1px solid #2a2a3e", borderRadius:24, padding:"3px 12px 3px 3px" },
  ava:{ width:30, height:30, borderRadius:"50%", objectFit:"cover" },
  uname:{ fontSize:13, fontWeight:700 },
  logoutBtn:{ background:"none", border:"none", color:"#6b7280", cursor:"pointer", fontSize:15, padding:0 },
  guestTxt:{ fontSize:13, color:"#4b5563" },
  main:{ maxWidth:960, margin:"0 auto", padding:"clamp(16px,4vw,40px) clamp(12px,3vw,20px)" },
  homeWrap:{ maxWidth:680, margin:"0 auto" },
  hero:{ position:"relative", textAlign:"center", padding:"48px 20px 40px", overflow:"hidden" },
  heroBlob:{ position:"absolute", top:"10%", left:"20%", width:320, height:180, background:"radial-gradient(ellipse,rgba(145,70,255,.18) 0%,transparent 70%)", pointerEvents:"none" },
  heroBlob2:{ position:"absolute", bottom:0, right:"15%", width:240, height:160, background:"radial-gradient(ellipse,rgba(83,252,24,.08) 0%,transparent 70%)", pointerEvents:"none" },
  heroBadge:{ display:"inline-block", fontSize:12, background:"rgba(145,70,255,.12)", border:"1px solid rgba(145,70,255,.3)", color:"#a78bfa", padding:"5px 14px", borderRadius:20, marginBottom:12, letterSpacing:"0.05em" },
  heroSub:{ fontSize:15, color:"#6b7280", lineHeight:1.7, margin:"12px 0 0" },
  loginBox:{ textAlign:"center", padding:"32px 0" },
  loginHint:{ color:"#6b7280", fontSize:14, marginBottom:20 },
  twitchBtn:{ display:"inline-flex", alignItems:"center", background:"#9146ff", color:"#fff", border:"none", borderRadius:8, padding:"13px 30px", fontSize:15, fontWeight:800, cursor:"pointer", marginBottom:8 },
  kickBtn:{ display:"inline-flex", alignItems:"center", background:"#53fc18", color:"#000", border:"none", borderRadius:8, padding:"13px 30px", fontSize:15, fontWeight:800, cursor:"pointer" },
  cards2:{ display:"grid", gap:20 },
  roleCard:{ background:"#0d0d1a", border:"1px solid #18182a", borderRadius:14, padding:28 },
  roleDivider:{ textAlign:"center", color:"#2a2a3e", fontSize:13, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" },
  roleIcon:{ fontSize:36, marginBottom:12 },
  roleLabel:{ fontSize:18, fontWeight:800, marginBottom:8 },
  roleDesc:{ fontSize:13, color:"#6b7280", marginBottom:20, lineHeight:1.6 },
  primaryBtn:{ background:"linear-gradient(135deg,#6d28d9,#9146ff)", border:"none", color:"#fff", borderRadius:8, padding:"11px 24px", fontSize:14, fontWeight:800, cursor:"pointer" },
  joinRow:{ display:"flex", gap:8 },
  codeInput:{ background:"#18182a", border:"1px solid #2a2a3e", borderRadius:8, color:"#f0f0f8", padding:"11px 14px", fontSize:18, fontFamily:"'DM Mono',monospace", letterSpacing:"0.2em", outline:"none", flex:1, width:0, textTransform:"uppercase" },
  joinBtn:{ background:"#9146ff", border:"none", color:"#fff", borderRadius:8, padding:"11px 20px", cursor:"pointer", fontWeight:900, fontSize:15 },
  dashWrap:{ maxWidth:720, margin:"0 auto" },
  topBar:{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#0d0d1a", border:"1px solid #18182a", borderRadius:14, padding:"20px 24px", marginBottom:24, gap:16 },
  topCode:{ fontWeight:900, color:"#9146ff", fontFamily:"'DM Mono',monospace", letterSpacing:"0.18em" },
  topMeta:{ fontSize:13, color:"#6b7280", marginTop:4 },
  topActions:{ display:"flex", gap:8 },
  ghostBtn:{ background:"#18182a", border:"1px solid #2a2a3e", color:"#d1d5db", padding:"8px 14px", borderRadius:8, cursor:"pointer", fontSize:12 },
  goLiveBtn:{ background:"#14532d", border:"1px solid #16a34a", color:"#4ade80", padding:"8px 18px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:800 },
  endBtn:{ background:"#7f1d1d", border:"1px solid #b91c1c", color:"#f87171", padding:"8px 18px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:800 },
  tabs:{ display:"flex", gap:2, borderBottom:"1px solid #18182a", marginBottom:20 },
  tab:{ background:"none", border:"none", color:"#6b7280", padding:"10px 16px", cursor:"pointer", fontSize:13, borderBottom:"2px solid transparent", marginBottom:-1 },
  tabOn:{ color:"#9146ff", borderBottom:"2px solid #9146ff" },
  card:{ background:"#0d0d1a", border:"1px solid #18182a", borderRadius:14, padding:"clamp(16px,4vw,26px)" },
  cardH:{ fontSize:15, fontWeight:800, marginBottom:16, margin:"0 0 16px" },
  label:{ display:"block", fontSize:11, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6, marginTop:14 },
  input:{ width:"100%", background:"#07070f", border:"1px solid #2a2a3e", borderRadius:8, color:"#f0f0f8", padding:"10px 14px", fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" },
  mCard:{ background:"#0d0d1a", border:"1px solid #18182a", borderRadius:12, padding:"clamp(14px,3vw,20px)", marginBottom:14 },
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
  closeBtn:{ background:"#1c1400", border:"1px solid #b45309", color:"#fbbf24", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:12 },
  resolveBtn:{ background:"#052e16", border:"1px solid #16a34a", color:"#4ade80", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:12 },
  rmBtn:{ background:"#18182a", border:"1px solid #2a2a3e", color:"#f87171", borderRadius:6, padding:"0 12px", cursor:"pointer" },
  addBtn:{ background:"none", border:"1px dashed #2a2a3e", color:"#6b7280", padding:8, borderRadius:8, cursor:"pointer", width:"100%", fontSize:13, marginTop:4 },
  badgeOpen:{ fontSize:11, color:"#4ade80", background:"rgba(74,222,128,.1)", padding:"3px 10px", borderRadius:20, whiteSpace:"nowrap" },
  badgeClosed:{ fontSize:11, color:"#fbbf24", background:"rgba(251,191,36,.1)", padding:"3px 10px", borderRadius:20, whiteSpace:"nowrap" },
  badgeResolved:{ fontSize:11, color:"#9ca3af", background:"#18182a", padding:"3px 10px", borderRadius:20, whiteSpace:"nowrap" },
  myBetNote:{ marginTop:12, fontSize:13, color:"#a78bfa", background:"rgba(145,70,255,.08)", border:"1px solid rgba(145,70,255,.2)", borderRadius:6, padding:"8px 14px" },
  viewerTopBar:{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#0d0d1a", border:"1px solid #18182a", borderRadius:14, padding:"18px 20px", marginBottom:24, gap:16 },
  viewerLeft:{ display:"flex", alignItems:"center", gap:14 },
  bigAva:{ width:48, height:48, borderRadius:"50%", border:"2px solid #9146ff", flexShrink:0 },
  viewerName:{ fontSize:18, fontWeight:900 },
  viewerSub:{ fontSize:13, color:"#6b7280", marginTop:2 },
  statsRow:{ display:"flex", gap:20 },
  statBox:{ textAlign:"center" },
  statVal:{ fontSize:20, fontWeight:900 },
  statLab:{ fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:"0.08em" },
  lobbyBanner:{ background:"rgba(145,70,255,.08)", border:"1px solid rgba(145,70,255,.2)", borderRadius:8, padding:"12px 18px", fontSize:14, color:"#a78bfa", textAlign:"center", marginBottom:20 },
  quickBtn:{ background:"#18182a", border:"1px solid #2a2a3e", color:"#d1d5db", borderRadius:6, padding:"9px 8px", cursor:"pointer", fontSize:12 },
  lbRow:{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:"1px solid #18182a" },
  lbMe:{ background:"rgba(145,70,255,.07)", borderRadius:8, padding:"10px 10px", margin:"0 -10px" },
  lbRank:{ fontSize:16, width:28, textAlign:"center", flexShrink:0 },
  lbAva:{ width:32, height:32, borderRadius:"50%", objectFit:"cover", flexShrink:0 },
  lbName:{ flex:1, fontSize:14, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  lbBal:{ fontSize:14, fontWeight:800, color:"#9146ff", whiteSpace:"nowrap" },
  resultsWrap:{ maxWidth:560, margin:"0 auto", textAlign:"center" },
  resGlow:{ position:"fixed", top:0, left:"50%", transform:"translateX(-50%)", width:600, height:300, background:"radial-gradient(ellipse,rgba(145,70,255,.2) 0%,transparent 70%)", pointerEvents:"none" },
  resTitle:{ fontSize:"clamp(32px,8vw,48px)", fontWeight:900, margin:"40px 0 8px" },
  resSub:{ fontSize:15, color:"#6b7280", marginBottom:36 },
  winCard:{ background:"linear-gradient(135deg,#150d2e,#0a1a0a)", border:"2px solid #9146ff", borderRadius:20, padding:"clamp(20px,5vw,36px) 24px", marginBottom:28 },
  winAva:{ width:80, height:80, borderRadius:"50%", border:"3px solid #9146ff", marginBottom:12 },
  winName:{ fontSize:"clamp(20px,5vw,28px)", fontWeight:900, marginBottom:8 },
  winBal:{ fontSize:"clamp(24px,6vw,32px)", fontWeight:900, color:"#9146ff", marginBottom:8 },
  winLabel:{ fontSize:12, color:"#4ade80", letterSpacing:"0.15em", textTransform:"uppercase" },
  myRank:{ fontSize:16, color:"#9ca3af", marginBottom:8 },
  empty:{ textAlign:"center", color:"#4b5563", padding:"40px 0", fontSize:14 },
  emptyLink:{ color:"#9146ff", cursor:"pointer", marginLeft:4 },
  loader:{ textAlign:"center", color:"#9146ff", padding:60, fontSize:24 },
  errBanner:{ background:"#2d0a0a", border:"1px solid #b91c1c", borderRadius:8, padding:"12px 18px", color:"#f87171", fontSize:14, marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center" },
  errClose:{ background:"none", border:"none", color:"#f87171", cursor:"pointer", fontSize:16 },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;}body{margin:0;}
  input:focus,textarea:focus{border-color:#9146ff!important;box-shadow:0 0 0 2px rgba(145,70,255,.15);}
  button:hover{filter:brightness(1.1);}
  a{color:#9146ff;}
  .toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:14px;font-family:'Syne',sans-serif;z-index:9999;animation:fadeUp .2s ease;max-width:340px;line-height:1.5;}
  .toast-ok{background:#052e16;border:1px solid #4ade80;color:#4ade80;}
  .toast-err{background:#2d0a0a;border:1px solid #f87171;color:#f87171;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .spin{display:inline-block;animation:spin 1s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg)}}
  ::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:#07070f;}::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:3px;}
  @media(max-width:640px){
    .cards2{grid-template-columns:1fr!important;}
  }
`;
