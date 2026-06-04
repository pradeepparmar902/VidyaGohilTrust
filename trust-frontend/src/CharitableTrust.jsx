import { useState, useEffect, useRef } from "react";

// ── FIREBASE CONFIG ───────────────────────────────────────────────────────────
const FB = {
  apiKey:    "AIzaSyD8S_dRHVNlmUnRV-AfOXocqR0EoPUh8k4",
  projectId: "vdiyagohilcharitable",
  bucket:    "vdiyagohilcharitable.firebasestorage.app",
};
const FS_URL  = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/content/main`;
const AUTH_URL= `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB.apiKey}`;
const STG_URL = `https://firebasestorage.googleapis.com/v0/b/${FB.bucket}/o`;

// ── FIREBASE HELPERS ──────────────────────────────────────────────────────────
// Firestore stores everything as one JSON string field for simplicity
const fbLoad = async () => {
  try {
    const res = await fetch(FS_URL);
    if (!res.ok) return null;
    const doc = await res.json();
    const raw = doc?.fields?.data?.stringValue;
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const fbSave = async (content, idToken) => {
  const res = await fetch(
    `${FS_URL}?updateMask.fieldPaths=data&updateMask.fieldPaths=savedAt`,
    {
      method: "PATCH",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${idToken}` },
      body: JSON.stringify({
        fields: {
          data:    { stringValue: JSON.stringify(content) },
          savedAt: { timestampValue: new Date().toISOString() },
        }
      })
    }
  );
  if (!res.ok) { const e = await res.json(); throw new Error(e?.error?.message || "Save failed"); }
  return true;
};

const fbSubmitRegistration = async (registrationData) => {
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${FB.proj}/databases/(default)/documents/registrations`;
  const res = await fetch(REG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        data: { stringValue: JSON.stringify(registrationData) },
        submittedAt: { timestampValue: new Date().toISOString() }
      }
    })
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e?.error?.message || "Submission failed");
  }
  return true;
};

const fbLogin = async (email, password) => {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message.replace(/_/g," "));
  return { idToken: data.idToken, email: data.email, expiresIn: data.expiresIn };
};

const fbUploadLogo = async (file, idToken) => {
  const ext  = file.name.split(".").pop();
  const name = encodeURIComponent(`logos/logo_${Date.now()}.${ext}`);
  const res  = await fetch(`${STG_URL}?uploadType=media&name=${name}`, {
    method: "POST",
    headers: { "Content-Type": file.type, "Authorization": `Bearer ${idToken}` },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return `${STG_URL}/${name}?alt=media&token=${data.downloadTokens}`;
};

const fbUploadPhoto = async (file, idToken) => {
  const ext  = file.name.split(".").pop();
  const name = encodeURIComponent(`gallery/photo_${Date.now()}.${ext}`);
  const res  = await fetch(`${STG_URL}?uploadType=media&name=${name}`, {
    method: "POST",
    headers: { "Content-Type": file.type, "Authorization": `Bearer ${idToken}` },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return `${STG_URL}/${name}?alt=media&token=${data.downloadTokens}`;
};



function useW() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return w;
}

const G = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Yatra+One&family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--sf:#E8650A;--sflt:#F9A14E;--gd:#C8860A;--dt:#0D4B5E;--tm:#1A6B87;--tl:#E8F4F8;--cr:#FDF8F0;--ww:#FFFBF4;--tx:#1C1C1C;--tm2:#4A4A4A;--mu:#888;--bd:#E8DDD0}
    html{scroll-behavior:smooth}body{font-family:'DM Sans',sans-serif;background:var(--cr);color:var(--tx);overflow-x:hidden}
    ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--sflt);border-radius:10px}
    @keyframes fadeUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes oin{from{opacity:0}to{opacity:1}}
    @keyframes pin{from{transform:translateX(100%)}to{transform:translateX(0)}}
    .fu{animation:fadeUp .6s ease both}.fl{animation:float 3s ease-in-out infinite}.sp{animation:spin 20s linear infinite}
    .hbg{background:linear-gradient(135deg,#0D4B5E 0%,#1A6B87 40%,#0D4B5E 70%,#C8860A22 100%);position:relative;overflow:hidden}
    .ch{transition:transform .3s,box-shadow .3s}.ch:hover{transform:translateY(-4px);box-shadow:0 20px 40px rgba(0,0,0,.12)}
    .bs{background:linear-gradient(135deg,var(--sf),var(--gd));color:white;border:none;cursor:pointer;transition:all .3s}
    .bs:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(232,101,10,.4)}
    .bt{background:linear-gradient(135deg,var(--dt),var(--tm));color:white;border:none;cursor:pointer;transition:all .3s}
    .bt:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(13,75,94,.4)}
    .sb{background:linear-gradient(135deg,rgba(255,255,255,.15),rgba(255,255,255,.05));backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.2)}
    .sh::after{content:'';display:block;width:56px;height:3px;background:linear-gradient(90deg,var(--sf),var(--gd));margin:10px auto 0;border-radius:2px}
    .sh.l::after{margin-left:0}
    .ap{border:2px solid var(--bd);background:white;cursor:pointer;transition:all .2s;border-radius:10px}
    .ap.a{border-color:var(--sf);background:#FFF4EC;color:var(--sf);font-weight:600}
    .gi{overflow:hidden;border-radius:12px;cursor:pointer}
    .tt th{background:var(--tl);color:var(--dt);font-weight:600}.tt tr:hover td{background:#F5FBFF}
    .as{background:linear-gradient(180deg,#0A3545,#0D4B5E 50%,#0A3545)}
    .ac{background:white;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.06);border:1px solid var(--bd)}
    .mdr{position:fixed;top:0;left:0;right:0;bottom:0;z-index:500}
    .mdo{position:absolute;inset:0;background:rgba(0,0,0,.5);animation:oin .25s ease}
    .mdp{position:absolute;top:0;right:0;width:280px;height:100%;background:white;box-shadow:-8px 0 40px rgba(0,0,0,.15);animation:pin .25s ease;display:flex;flex-direction:column;overflow-y:auto}
    input:focus,select:focus,textarea:focus{outline:none;border-color:var(--sf)!important;box-shadow:0 0 0 3px rgba(232,101,10,.1)}
    .cf{margin-bottom:16px}
    .cl{font-size:.75rem;font-weight:700;color:var(--mu);text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:6px}
    .ci{width:100%;padding:10px 13px;border-radius:8px;border:1.5px solid var(--bd);font-size:.875rem;font-family:inherit;color:var(--tx);transition:all .2s;background:white;resize:vertical}
    .ci:focus{border-color:var(--sf);box-shadow:0 0 0 3px rgba(232,101,10,.08);outline:none}
    .csc{background:white;border-radius:16px;border:1px solid var(--bd);box-shadow:0 2px 12px rgba(0,0,0,.05);margin-bottom:14px;overflow:hidden}
    .csh{padding:14px 18px;background:var(--tl);border-bottom:1px solid #B8D8E8;display:flex;align-items:center;gap:10px;cursor:pointer}
    .csb{padding:18px 20px}
    .lt{padding:6px 14px;border-radius:6px;border:1px solid var(--bd);background:white;cursor:pointer;font-size:.78rem;font-weight:600;transition:all .2s}
    .lt.a{background:var(--dt);color:white;border-color:var(--dt)}
    .toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1A7A3E;color:white;padding:12px 24px;border-radius:50px;font-size:.875rem;font-weight:600;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.2);animation:fadeUp .4s ease}
  `}</style>
);

const DC = {
  trust:{name:"Vidya Gohil Charitable Trust",nameGu:"વિદ્યા ગોહિલ સખાવત ટ્રસ્ટ",phone:"+91 98765 43210",email:"info@vidyagohiltrust.org",address:"12, Gokuldham Society, Near Sardar Bridge, Ahmedabad – 380 006, Gujarat",hours:"Mon–Sat: 9:00 AM – 6:00 PM",estd:"2004",reg80G:"CIT(E)/12A/2004/123",panNo:"AACVG1234E",cin:"U85300GJ2004NPL045678",
    logo:{
      visible:  true,
      type:     "text",       // "text" | "image"
      text:     "Om",         // shown when type=text
      url:      "",           // image URL when type=image
      size:     42,           // px — applies to both types
      shape:    "circle",     // "circle" | "rounded" | "square"
      bgColor:  "gradient",   // "gradient" | "white" | "transparent"
    }
  },
  hero:{badge:"ESTD. 2004 · REGISTERED TRUST",title:"Empowering Lives Through Education & Compassion",titleGu:"શિક્ષણ અને કરુણા દ્વારા જીવન સશક્ત",subtitle:"For over 20 years, we have been uplifting underprivileged communities through education, healthcare, and sustainable development.",subtitleGu:"20 વર્ષોથી, અમે શિક્ષણ, આરોગ્ય અને ટકાઉ વિકાસ દ્વારા સમુદાયોને ઉપર ઉઠાવ્યા છે.",cta1:"Donate Now",cta1Gu:"દાન આપો",cta2:"Our Programs",cta2Gu:"અમારા કાર્યક્રમો",badge1:"80G Certified",badge2:"FCRA Registered",badge3:"ISO Audited"},
  stats:[{num:"12,400+",label:"Lives Impacted",labelGu:"જીવો પ્રભાવિત"},{num:"Rs.2.8 Cr",label:"Funds Raised",labelGu:"ભંડોળ એકત્ર"},{num:"340+",label:"Volunteers",labelGu:"સ્વયંસેવકો"},{num:"28",label:"Active Programs",labelGu:"સક્રિય કાર્યક્રમો"}],
  about:{heading:"Rooted in Compassion, Driven by Purpose",headingGu:"કરુણામાં મૂળ, ઉદ્દેશ્ય દ્વારા ચાલિત",body1:"The Vidya Gohil Charitable Trust was founded in 2004 by Vidyaben Gohil with a vision to create a dignified life for every individual regardless of caste, creed, or economic status.",body1Gu:"વિદ્યા ગોહિલ સખાવત ટ્રસ્ટ 2004 માં વિદ્યાબેન ગોહિલ દ્વારા સ્થાપિત કરવામાં આવ્યો હતો.",body2:"Our work spans education, healthcare, women's empowerment, environmental conservation, and disaster relief through community participation and transparent governance.",body2Gu:"અમારું કાર્ય શિક્ષણ, આરોગ્ય, મહિલા સશક્તિકરણ, પર્યાવરણ સંરક્ષણ અને આપત્તિ રાહત સુધી ફેલાયેલું છે.",points:["Transparent Governance","Community-Led Programs","Annual Public Audit","Zero Admin Fee Policy"],yearsLabel:"Years of Service",cta:"Read Our Story"},
  programs:[{icon:"📚",title:"Education for All",sub:"Scholarships and learning centers for underprivileged children",color:"#FFF4EC",border:"#FDDBB8"},{icon:"🏥",title:"Health and Wellness",sub:"Free medical camps, medicines and health awareness drives",color:"#E8F4F8",border:"#B8D8E8"},{icon:"🌾",title:"Livelihood Support",sub:"Skill development and micro-finance for rural communities",color:"#EDFAF1",border:"#B8E8CC"},{icon:"🤝",title:"Women Empowerment",sub:"Self-help groups, vocational training and legal aid",color:"#F9F0FF",border:"#D8B8E8"},{icon:"🌊",title:"Disaster Relief",sub:"Rapid response support for flood and earthquake victims",color:"#FEF9EC",border:"#F5E8B8"},{icon:"🌱",title:"Environment",sub:"Tree plantation drives and clean water initiatives",color:"#EDFAF1",border:"#B8E8CC"}],
  events:[{date:"Jun 15",month:"2025",title:"Annual Blood Donation Camp",location:"Ahmedabad Community Hall",tag:"Health",color:"#E8F4F8"},{date:"Jul 04",month:"2025",title:"Monsoon Tree Plantation Drive",location:"Sabarmati Riverfront",tag:"Environment",color:"#EDFAF1"},{date:"Aug 20",month:"2025",title:"Scholarship Distribution Ceremony",location:"Sardar Patel Hall, Surat",tag:"Education",color:"#FFF4EC"},{date:"Sep 10",month:"2025",title:"Womens Skill Fair 2025",location:"Vadodara Exhibition Ground",tag:"Empowerment",color:"#F9F0FF"}],
  donate:{heading:"Your Donation Changes Lives",subtext:"100% of donations go directly to programs. Tax exemption under 80G available.",note:"Secured by Razorpay - 256-bit SSL encryption - 80G receipt auto-generated",recurringLabel:"Monthly Recurring Donation",recurringNote:"Auto-deducted each month. Cancel anytime."},
  contact:{volunteerHeading:"Become a Volunteer",volunteerSub:"Your time and skills can transform lives. Join 340+ active volunteers across Gujarat.",contactHeading:"Contact Us",socials:["WhatsApp","Facebook","Instagram","YouTube"]},
  nav:[
    {label:"Home",      labelGu:"ઘર",           sectionId:"home",     icon:"🏠", visible:true},
    {label:"About",     labelGu:"અમારા વિશે",    sectionId:"about",    icon:"ℹ️", visible:true},
    {label:"Programs",  labelGu:"કાર્યક્રમો",     sectionId:"programs", icon:"📋", visible:true},
    {label:"Gallery",   labelGu:"ગૅલેરી",         sectionId:"gallery",  icon:"🖼️", visible:true},
    {label:"Events",    labelGu:"ઘટનાઓ",          sectionId:"events",   icon:"📅", visible:true},
    {label:"Donate",    labelGu:"દાન",            sectionId:"donate",   icon:"❤️", visible:true},
    {label:"Contact",   labelGu:"સંપર્ક",          sectionId:"contact",  icon:"📞", visible:true},
  ],
  builtinSections:{
    hero:true, about:true, programs:true,
    gallery:true, events:true, donate:true, contact:true,
  },
  customSections:[],
  galleryItems:[],
};

const EMOJIS = ["📚","🏥","🌾","🤝","🌊","🌱","🏛️","💡","🎓","🏃","🌍","⭐","❤️","🎯","🔬","🎨"];
const COLORS = [{c:"#FFF4EC",b:"#FDDBB8"},{c:"#E8F4F8",b:"#B8D8E8"},{c:"#EDFAF1",b:"#B8E8CC"},{c:"#F9F0FF",b:"#D8B8E8"},{c:"#FEF9EC",b:"#F5E8B8"},{c:"#FFF0F0",b:"#F5B8B8"}];
const SIDS = ["home","about","programs","gallery","events","donate","contact"];
const DDATA = [
  {id:"DON001",name:"Ramesh Patel",amount:5000,date:"2025-05-20",program:"Education",status:"Verified",receipt:true},
  {id:"DON002",name:"Kiran Shah",amount:11000,date:"2025-05-18",program:"Healthcare",status:"Verified",receipt:true},
  {id:"DON003",name:"Anita Mehta",amount:2100,date:"2025-05-17",program:"General",status:"Pending",receipt:false},
  {id:"DON004",name:"Suresh Desai",amount:25000,date:"2025-05-15",program:"Education",status:"Verified",receipt:true},
  {id:"DON005",name:"Priya Joshi",amount:500,date:"2025-05-12",program:"Relief",status:"Verified",receipt:true},
  {id:"DON006",name:"Vijay Nair",amount:7500,date:"2025-05-10",program:"Women",status:"Pending",receipt:false},
];
const VOLS = [
  {name:"Anjali Patel",role:"Education Coordinator",joined:"2022-03",events:14,status:"Active"},
  {name:"Mihir Trivedi",role:"Medical Volunteer",joined:"2023-01",events:9,status:"Active"},
  {name:"Hetal Shah",role:"Field Coordinator",joined:"2021-06",events:31,status:"Active"},
  {name:"Ravi Solanki",role:"IT Support",joined:"2024-01",events:5,status:"Inactive"},
];
const GITEMS = [
  {id:1,category:"Events",color:"#0D4B5E",emoji:"🎓",label:"Scholarship Ceremony 2024"},
  {id:2,category:"Health",color:"#1A7A3E",emoji:"🏥",label:"Medical Camp Kutch"},
  {id:3,category:"Environment",color:"#C8860A",emoji:"🌱",label:"5000 Trees Planted"},
  {id:4,category:"Women",color:"#7B2D8B",emoji:"🤝",label:"Women Skill Fair"},
  {id:5,category:"Education",color:"#E8650A",emoji:"📚",label:"Computer Lab Opening"},
  {id:6,category:"Relief",color:"#C0392B",emoji:"🌊",label:"Flood Relief 2023"},
];


// ── LOGO MARK — shared by Navbar and Footer ───────────────────────────────────
function LogoMark({ logo, mob }) {
  if (!logo || !logo.visible) return null;
  const size = mob ? Math.max(30, (logo.size || 42) - 6) : (logo.size || 42);
  const radius = logo.shape === "circle" ? "50%" : logo.shape === "rounded" ? "30%" : "8px";
  const bg = logo.bgColor === "white" ? "white"
    : logo.bgColor === "transparent" ? "transparent"
    : "linear-gradient(135deg,var(--sf),var(--gd))";
  const border = logo.bgColor === "transparent" ? "2px solid rgba(232,101,10,.4)" : "none";

  return (
    <div style={{width:size, height:size, borderRadius:radius, background:bg, border,
      display:"flex", alignItems:"center", justifyContent:"center",
      boxShadow: logo.bgColor==="transparent" ? "none" : "0 4px 12px rgba(232,101,10,.3)",
      overflow:"hidden", flexShrink:0, transition:"all .3s"}}>
      {logo.type === "image" && logo.url
        ? <img src={logo.url} alt="logo" style={{width:"100%", height:"100%", objectFit:"cover"}}
            onError={e => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }}/>
        : null}
      {/* Fallback text — always rendered, hidden when image loads */}
      <span style={{
        display: logo.type === "image" && logo.url ? "none" : "flex",
        alignItems:"center", justifyContent:"center",
        color: logo.bgColor === "white" ? "var(--sf)" : "white",
        fontWeight:700, fontSize: size * 0.38,
        fontFamily:"'Playfair Display',serif", lineHeight:1
      }}>
        {logo.text || "T"}
      </span>
    </div>
  );
}

// ── NAVBAR ────────────────────────────────────────────────────────────────────
function Navbar({ C, lang, setLang, setPage, auth, onShowLogin }) {
  const [scrolled, setScrolled] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const w = useW(); const mob = w < 900;
  const visibleNav = (C.nav || []).filter(n => n.visible);
  useEffect(() => { const f = () => setScrolled(window.scrollY > 40); window.addEventListener("scroll", f); return () => window.removeEventListener("scroll", f); }, []);
  useEffect(() => { if (!mob) setDrawer(false); }, [mob]);
  const go = (sectionId) => { setDrawer(false); setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({behavior:"smooth"}), 80); };

  return (
    <>
      {w >= 600 && (
        <div style={{background:"var(--dt)",color:"white",fontSize:".72rem",padding:"6px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
          <span>Tel: {C.trust.phone} | Email: {C.trust.email}</span>
          <div style={{display:"flex",gap:16,alignItems:"center"}}>
            <span>80G Tax Exemption Available</span>
            <div style={{width:1,height:12,background:"rgba(255,255,255,.3)"}}/>
            <button onClick={()=>setLang(lang==="en"?"gu":"en")} style={{background:"transparent",border:"none",color:"white",cursor:"pointer",fontSize:".75rem",fontWeight:700}}>{lang==="en"?"ગુજરાતી":"English"}</button>
            
            {auth?.email ? (
              <button onClick={()=>setPage("admin")} style={{background:"transparent",border:"none",color:"white",fontWeight:700,fontSize:".75rem",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:18,height:18,borderRadius:"50%",background:"var(--sf)",color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".6rem"}}>{auth.email[0].toUpperCase()}</span> Admin Panel
              </button>
            ) : (
              <button onClick={onShowLogin} style={{background:"transparent",border:"none",color:"rgba(255,255,255,.8)",fontWeight:600,fontSize:".75rem",cursor:"pointer",transition:"all .2s"}} onMouseEnter={e=>e.currentTarget.style.color="white"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,.8)"}>
                🔑 Login
              </button>
            )}
          </div>
        </div>
      )}
      <nav style={{position:"sticky",top:0,zIndex:300,background:scrolled?"rgba(255,251,244,.97)":"var(--ww)",borderBottom:`1px solid ${scrolled?"var(--bd)":"transparent"}`,backdropFilter:"blur(12px)",boxShadow:scrolled?"0 2px 20px rgba(0,0,0,.08)":"none",transition:"all .3s",padding:mob?"0 16px":"0 28px",display:"flex",alignItems:"center",justifyContent:"space-between",height:mob?56:64,gap:8}}>

        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",flexShrink:0}} onClick={()=>go("home")}>
          <LogoMark logo={C.trust.logo} mob={mob}/>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,fontSize:mob?".85rem":".95rem",color:"var(--dt)",lineHeight:1.2}}>{lang==="en"?C.trust.name:C.trust.nameGu}</div>
            {!mob && <div style={{fontSize:".6rem",color:"var(--mu)",letterSpacing:"1px",textTransform:"uppercase"}}>Charitable Trust</div>}
          </div>
        </div>

        {/* Desktop nav links */}
        {!mob && (
          <div style={{display:"flex",gap:2,flex:1,justifyContent:"center",flexWrap:"nowrap",overflow:"hidden"}}>
            {visibleNav.map((item,i) => (
              <button key={i} onClick={()=>go(item.sectionId)}
                style={{background:"none",border:"none",cursor:"pointer",padding:"7px 10px",fontSize:".82rem",fontWeight:500,color:"var(--tm2)",borderRadius:6,transition:"all .2s",whiteSpace:"nowrap"}}
                onMouseEnter={e=>{e.target.style.color="var(--sf)";e.target.style.background="#FFF4EC"}}
                onMouseLeave={e=>{e.target.style.color="var(--tm2)";e.target.style.background="none"}}>
                {lang==="en" ? item.label : item.labelGu}
              </button>
            ))}
          </div>
        )}

        {/* Right controls */}
        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
          {mob && <button onClick={()=>setLang(lang==="en"?"gu":"en")} style={{background:"var(--tl)",border:"1px solid #B8D8E8",color:"var(--dt)",padding:"5px 10px",borderRadius:20,cursor:"pointer",fontSize:".78rem",fontWeight:700}}>{lang==="en"?"Gu":"EN"}</button>}
          
          <button className="bs" onClick={()=>go("donate")} style={{padding:mob?"7px 12px":"8px 24px",borderRadius:8,fontSize:mob?".78rem":".85rem",fontWeight:700}}>Donate Now</button>

          {mob && <button onClick={()=>setDrawer(true)} style={{background:"none",border:"1px solid var(--bd)",borderRadius:8,width:36,height:36,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",padding:0}}>{[0,1,2].map(i=><span key={i} style={{display:"block",width:16,height:2,background:"var(--dt)",borderRadius:2}}/>)}</button>}
        </div>
      </nav>

      {/* Mobile Drawer */}
      {drawer && (
        <div className="mdr">
          <div className="mdo" onClick={()=>setDrawer(false)}/>
          <div className="mdp">
            <div style={{padding:"18px 18px 14px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,fontSize:".9rem",color:"var(--dt)"}}>{C.trust.name}</div>
              <button onClick={()=>setDrawer(false)} style={{background:"none",border:"1px solid var(--bd)",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:"1rem",color:"var(--mu)"}}>✕</button>
            </div>

            {/* Nav links */}
            <div style={{padding:"10px 8px",flex:1}}>
              {visibleNav.map((item,i) => (
                <button key={i} onClick={()=>go(item.sectionId)}
                  style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:"none",border:"none",borderRadius:10,cursor:"pointer",fontSize:".92rem",fontWeight:500,color:"var(--tx)",marginBottom:2,textAlign:"left"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="#FFF4EC";e.currentTarget.style.color="var(--sf)"}}
                  onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color="var(--tx)"}}>
                  <span>{item.icon}</span>
                  {lang==="en" ? item.label : item.labelGu}
                </button>
              ))}
            </div>

            {/* Bottom action buttons */}
            <div style={{padding:"14px 14px 28px",borderTop:"1px solid var(--bd)",display:"flex",flexDirection:"column",gap:10}}>
              <button className="bs" onClick={()=>go("donate")} style={{padding:"12px",borderRadius:10,fontWeight:700,fontSize:".9rem"}}>
                Donate Now
              </button>

              {/* Login / Account row */}
              {auth?.email ? (
                <div style={{background:"#EDFAF1",border:"1px solid #B8E8CC",borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:700,flexShrink:0}}>
                    {auth.email[0].toUpperCase()}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:".8rem",fontWeight:700,color:"#1A7A3E"}}>Logged in</div>
                    <div style={{fontSize:".72rem",color:"#4A7A5E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{auth.email}</div>
                  </div>
                  <button onClick={()=>{setDrawer(false);setPage("admin");}} style={{padding:"6px 12px",borderRadius:8,background:"var(--dt)",border:"none",color:"white",fontWeight:600,fontSize:".75rem",cursor:"pointer",flexShrink:0}}>
                    Admin
                  </button>
                </div>
              ) : (
                <button onClick={()=>{setDrawer(false); onShowLogin();}}
                  style={{padding:"12px",borderRadius:10,background:"white",border:"2px solid var(--bd)",color:"var(--dt)",fontWeight:700,fontSize:".9rem",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontFamily:"inherit",transition:"all .2s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--sf)";e.currentTarget.style.color="var(--sf)"}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd)";e.currentTarget.style.color="var(--dt)"}}>
                  🔑 Login to Firebase
                </button>
              )}

              <button onClick={()=>{setDrawer(false);setPage("admin");}}
                style={{padding:"11px",borderRadius:10,background:"var(--tl)",border:"1px solid #B8D8E8",color:"var(--dt)",fontWeight:600,fontSize:".88rem",cursor:"pointer",fontFamily:"inherit"}}>
                ⚙️ Admin Panel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── HERO ──────────────────────────────────────────────────────────────────────
function Hero({ C, lang }) {
  const w = useW(); const mob = w < 768; const h = C.hero;
  return (
    <section id="home" className="hbg" style={{minHeight:mob?"auto":"88vh",display:"flex",alignItems:"center",position:"relative",paddingBottom:mob?60:80}}>
      <div style={{position:"absolute",top:"10%",right:"5%",width:200,height:200,borderRadius:"50%",border:"1px solid rgba(200,134,10,.15)",opacity:.4}} className="sp"/>
      <div style={{maxWidth:1200,margin:"0 auto",padding:mob?"40px 20px 60px":"60px 32px",display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:mob?32:56,alignItems:"center",width:"100%"}}>
        <div className="fu">
          <div style={{display:"inline-flex",alignItems:"center",gap:8,background:"rgba(200,134,10,.2)",border:"1px solid rgba(200,134,10,.4)",borderRadius:20,padding:"5px 14px",marginBottom:20}}>
            <span style={{color:"#F9A14E",fontSize:".75rem",fontWeight:600,letterSpacing:1}}>{h.badge}</span>
          </div>
          {lang==="gu"
            ? <h1 style={{fontFamily:"'Yatra One',cursive",fontSize:mob?"1.8rem":"2.4rem",color:"white",lineHeight:1.35,marginBottom:18}}>{h.titleGu}</h1>
            : <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.9rem":"2.8rem",color:"white",lineHeight:1.25,marginBottom:18,fontWeight:700}}>{h.title}</h1>}
          <p style={{color:"rgba(255,255,255,.8)",fontSize:mob?".9rem":"1rem",lineHeight:1.75,marginBottom:28}}>{lang==="en"?h.subtitle:h.subtitleGu}</p>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <button className="bs" onClick={()=>document.getElementById("donate")?.scrollIntoView({behavior:"smooth"})} style={{padding:mob?"12px 22px":"14px 28px",borderRadius:10,fontSize:mob?".9rem":"1rem",fontWeight:700}}>{lang==="en"?h.cta1:h.cta1Gu}</button>
            <button onClick={()=>document.getElementById("programs")?.scrollIntoView({behavior:"smooth"})} style={{padding:mob?"12px 22px":"14px 28px",borderRadius:10,fontSize:mob?".9rem":"1rem",fontWeight:600,background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.3)",color:"white",cursor:"pointer"}}>{lang==="en"?h.cta2:h.cta2Gu}</button>
          </div>
          <div style={{display:"flex",gap:20,marginTop:28,flexWrap:"wrap"}}>
            {[h.badge1,h.badge2,h.badge3].map(b=><div key={b} style={{display:"flex",alignItems:"center",gap:6,color:"rgba(255,255,255,.7)",fontSize:".78rem"}}><span style={{color:"#F9A14E"}}>✓</span>{b}</div>)}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {C.stats.map((s,i)=><div key={i} className="sb" style={{borderRadius:16,padding:mob?"20px 16px":"26px 22px",textAlign:"center"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.6rem":"2rem",fontWeight:700,color:"#F9A14E",marginBottom:6}}>{s.num}</div>
            <div style={{color:"rgba(255,255,255,.75)",fontSize:mob?".78rem":".85rem",lineHeight:1.3}}>{lang==="en"?s.label:s.labelGu}</div>
          </div>)}
        </div>
      </div>
      <svg style={{position:"absolute",bottom:0,left:0,width:"100%",height:50}} viewBox="0 0 1440 50" preserveAspectRatio="none"><path d="M0,30 C360,60 1080,0 1440,30 L1440,50 L0,50 Z" fill="var(--cr)"/></svg>
    </section>
  );
}

// ── PROGRAMS ──────────────────────────────────────────────────────────────────
function Programs({ C }) {
  const w = useW(); const cols = w<640?"1fr":w<960?"1fr 1fr":"1fr 1fr 1fr";
  return (
    <section id="programs" style={{padding:w<640?"56px 16px":"80px 32px",background:"var(--cr)"}}>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:48}}>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>What We Do</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:w<640?"1.7rem":"2.2rem",color:"var(--dt)",marginTop:8,fontWeight:700}} className="sh">Our Programs</h2>
        </div>
        <div style={{display:"grid",gridTemplateColumns:cols,gap:18}}>
          {C.programs.map((p,i)=><div key={i} className="ch" style={{background:p.color,border:`1px solid ${p.border}`,borderRadius:16,padding:"24px 20px",cursor:"pointer"}}>
            <div style={{fontSize:"2rem",marginBottom:12}}>{p.icon}</div>
            <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1rem",fontWeight:700,color:"var(--dt)",marginBottom:7}}>{p.title}</h3>
            <p style={{fontSize:".85rem",color:"var(--tm2)",lineHeight:1.6}}>{p.sub}</p>
            <div style={{marginTop:14,color:"var(--sf)",fontSize:".8rem",fontWeight:600}}>Learn more</div>
          </div>)}
        </div>
      </div>
    </section>
  );
}

// ── ABOUT ─────────────────────────────────────────────────────────────────────
function About({ C, lang }) {
  const w = useW(); const mob = w<768; const a = C.about;
  return (
    <section id="about" style={{padding:mob?"56px 16px":"80px 32px",background:"var(--ww)"}}>
      <div style={{maxWidth:1200,margin:"0 auto",display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:mob?32:60,alignItems:"center"}}>
        {!mob && <div style={{position:"relative"}}>
          <div style={{width:"100%",aspectRatio:"4/3",borderRadius:20,background:"linear-gradient(135deg,var(--dt),var(--tm))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"6rem",boxShadow:"0 24px 60px rgba(13,75,94,.2)"}}>🙏</div>
          <div style={{position:"absolute",bottom:-20,right:-16,background:"white",borderRadius:16,padding:"18px 22px",boxShadow:"0 12px 40px rgba(0,0,0,.1)",border:"1px solid var(--bd)"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:"1.8rem",fontWeight:700,color:"var(--sf)"}}>20+</div>
            <div style={{fontSize:".78rem",color:"var(--tm2)"}}>{a.yearsLabel}</div>
          </div>
        </div>}
        <div>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>About the Trust</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.6rem":"2rem",color:"var(--dt)",marginTop:8,marginBottom:18,fontWeight:700}} className="sh l">{lang==="en"?a.heading:a.headingGu}</h2>
          <p style={{color:"var(--tm2)",lineHeight:1.8,marginBottom:14,fontSize:".93rem"}}>{lang==="en"?a.body1:a.body1Gu}</p>
          <p style={{color:"var(--tm2)",lineHeight:1.8,marginBottom:24,fontSize:".93rem"}}>{lang==="en"?a.body2:a.body2Gu}</p>
          <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:10,marginBottom:24}}>
            {a.points.map(v=><div key={v} style={{display:"flex",alignItems:"center",gap:8,fontSize:".875rem"}}><span style={{color:"var(--sf)"}}>✓</span>{v}</div>)}
          </div>
          <button className="bt" style={{padding:"11px 22px",borderRadius:10,fontWeight:600,fontSize:".875rem"}}>{a.cta}</button>
        </div>
      </div>
    </section>
  );
}


// ── DONATION ──────────────────────────────────────────────────────────────────
function Donate({ C, lang }) {
  const [amt, setAmt] = useState(1100); const [cAmt, setCamt] = useState(""); const [prog, setProg] = useState("General");
  const [rec, setRec] = useState(false); const [step, setStep] = useState(1); const [form, setForm] = useState({name:"",phone:"",email:"",pan:""});
  const w = useW(); const mob = w<640; const presets = [500,1100,2100,5100,11000,25000];
  const final = cAmt ? parseInt(cAmt)||0 : amt; const d = C.donate;
  const go = () => step===1 ? setStep(2) : setTimeout(()=>setStep(3),600);
  return (
    <section id="donate" style={{padding:mob?"56px 16px":"80px 32px",background:"linear-gradient(135deg,#0D4B5E,#1A6B87)",position:"relative"}}>
      <div style={{maxWidth:820,margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <span style={{color:"var(--sflt)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>Make a Difference</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.6rem":"2.1rem",color:"white",marginTop:8,fontWeight:700}}>{d.heading}</h2>
          <p style={{color:"rgba(255,255,255,.7)",marginTop:8,fontSize:".9rem"}}>{d.subtext}</p>
        </div>
        <div style={{background:"white",borderRadius:20,padding:mob?"24px 18px":"36px 40px",boxShadow:"0 32px 80px rgba(0,0,0,.2)"}}>
          {step===3 ? (
            <div style={{textAlign:"center",padding:"32px 16px"}}>
              <div style={{fontSize:"3.5rem",marginBottom:16}}>🎉</div>
              <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.6rem",color:"var(--dt)",marginBottom:10}}>Thank You, {form.name||"Donor"}!</h3>
              <p style={{color:"var(--tm2)",marginBottom:6}}>Your donation of <strong style={{color:"var(--sf)"}}>Rs.{final.toLocaleString()}</strong> has been received.</p>
              <p style={{color:"var(--tm2)",fontSize:".85rem",marginBottom:22}}>An 80G receipt will be emailed within 24 hours.</p>
              <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
                <button className="bs" style={{padding:"10px 20px",borderRadius:8}} onClick={()=>{setStep(1);setForm({name:"",phone:"",email:"",pan:""});setCamt("");}}>Donate Again</button>
                <button style={{padding:"10px 20px",borderRadius:8,background:"var(--tl)",border:"none",color:"var(--dt)",fontWeight:600,cursor:"pointer"}}>Download Receipt</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:28}}>
                {["Choose Amount","Your Details"].map((s,i)=>(
                  <div key={s} style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:26,height:26,borderRadius:"50%",background:step>i?"var(--sf)":step===i+1?"var(--dt)":"var(--bd)",color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".78rem",fontWeight:700,transition:"all .3s"}}>{step>i+1?"✓":i+1}</div>
                    <span style={{fontSize:".82rem",fontWeight:step===i+1?600:400,color:step===i+1?"var(--dt)":"var(--mu)"}}>{s}</span>
                    {i<1 && <span style={{color:"var(--bd)"}}>---</span>}
                  </div>
                ))}
              </div>
              {step===1 && <>
                <div style={{marginBottom:18}}>
                  <label style={{fontSize:".82rem",fontWeight:600,color:"var(--tx)",marginBottom:8,display:"block"}}>Donate to Program</label>
                  <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                    {["General","Education","Healthcare","Women","Environment","Relief"].map(p=><button key={p} onClick={()=>setProg(p)} style={{padding:"5px 12px",borderRadius:20,fontSize:".78rem",fontWeight:500,background:prog===p?"var(--dt)":"var(--tl)",color:prog===p?"white":"var(--dt)",border:`1px solid ${prog===p?"var(--dt)":"var(--bd)"}`,cursor:"pointer",transition:"all .2s"}}>{p}</button>)}
                  </div>
                </div>
                <div style={{marginBottom:18}}>
                  <label style={{fontSize:".82rem",fontWeight:600,color:"var(--tx)",marginBottom:10,display:"block"}}>Select Amount</label>
                  <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":"repeat(3,1fr)",gap:9}}>
                    {presets.map(a=><div key={a} className={`ap ${!cAmt&&amt===a?"a":""}`} onClick={()=>{setAmt(a);setCamt("");}} style={{padding:"12px",textAlign:"center",fontSize:".9rem",fontWeight:500,border:`2px solid ${!cAmt&&amt===a?"var(--sf)":"var(--bd)"}`,background:!cAmt&&amt===a?"#FFF4EC":"white",color:!cAmt&&amt===a?"var(--sf)":"var(--tx)",cursor:"pointer",borderRadius:10,transition:"all .2s"}}>Rs.{a.toLocaleString()}</div>)}
                  </div>
                </div>
                <div style={{marginBottom:18}}>
                  <label style={{fontSize:".82rem",fontWeight:600,color:"var(--tx)",marginBottom:7,display:"block"}}>Or Enter Custom Amount</label>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:"var(--mu)",fontWeight:600}}>Rs.</span>
                    <input type="number" value={cAmt} onChange={e=>setCamt(e.target.value)} placeholder="Enter amount" style={{width:"100%",padding:"11px 13px 11px 36px",borderRadius:10,border:"2px solid var(--bd)",fontSize:".95rem",fontFamily:"inherit"}}/>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:22,padding:"12px 14px",background:"var(--tl)",borderRadius:10,border:"1px solid #B8D8E8"}}>
                  <div onClick={()=>setRec(!rec)} style={{width:38,height:20,borderRadius:10,background:rec?"var(--sf)":"#ccc",position:"relative",cursor:"pointer",transition:"background .3s",flexShrink:0}}>
                    <div style={{position:"absolute",top:2,left:rec?19:2,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .3s"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:".85rem",fontWeight:600,color:"var(--dt)"}}>{d.recurringLabel}</div>
                    <div style={{fontSize:".72rem",color:"var(--mu)"}}>{d.recurringNote}</div>
                  </div>
                </div>
              </>}
              {step===2 && <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:14}}>
                {[{label:"Full Name *",key:"name",type:"text",span:false},{label:"Phone Number *",key:"phone",type:"tel",span:false},{label:"Email Address *",key:"email",type:"email",span:true},{label:"PAN Number (for 80G)",key:"pan",type:"text",span:false}].map(f=>(
                  <div key={f.key} style={{gridColumn:f.span||mob?"1/-1":"auto"}}>
                    <label style={{fontSize:".8rem",fontWeight:600,color:"var(--tx)",marginBottom:5,display:"block"}}>{f.label}</label>
                    <input type={f.type} value={form[f.key]} onChange={e=>setForm({...form,[f.key]:e.target.value})} style={{width:"100%",padding:"10px 13px",borderRadius:8,border:"2px solid var(--bd)",fontSize:".875rem",fontFamily:"inherit"}}/>
                  </div>
                ))}
                <div style={{gridColumn:"1/-1",background:"var(--tl)",borderRadius:12,padding:"14px",border:"1px solid #B8D8E8"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:".83rem",color:"var(--tm2)"}}>Program</span><span style={{fontWeight:600,color:"var(--dt)"}}>{prog}</span></div>
                  <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:".83rem",color:"var(--tm2)"}}>Amount</span><span style={{fontWeight:700,color:"var(--sf)",fontSize:"1.05rem"}}>Rs.{final.toLocaleString()}</span></div>
                </div>
              </div>}
              <div style={{display:"flex",gap:10,marginTop:22}}>
                {step===2 && <button onClick={()=>setStep(1)} style={{padding:"13px 18px",borderRadius:10,border:"2px solid var(--bd)",background:"white",cursor:"pointer",fontWeight:600,color:"var(--mu)",flexShrink:0}}>Back</button>}
                <button className="bs" onClick={go} style={{flex:1,padding:"13px",borderRadius:10,fontSize:mob?".88rem":".95rem",fontWeight:700}}>
                  {step===1?`Proceed - Rs.${final.toLocaleString()}`:`Pay Rs.${final.toLocaleString()} via Razorpay`}
                </button>
              </div>
              <p style={{textAlign:"center",fontSize:".72rem",color:"var(--mu)",marginTop:10}}>{d.note}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Events({ C }) {
  const w = useW(); const mob = w<700;
  const [selectedEvent, setSelectedEvent] = useState(null); // { type: 'register' | 'details', event }
  const [formData, setFormData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const getForm = (id) => C.forms?.find(f => f.id === id) || { fields: [] };

  const submitForm = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Option B: Save to Firebase (fails gracefully if Security Rules aren't set)
      try {
        await fbSubmitRegistration({
          eventId: selectedEvent.event.title,
          eventTitle: selectedEvent.event.title,
          formData: formData
        });
      } catch (fbErr) {
        console.warn("Firebase save skipped (Update Security Rules to enable database logging). Proceeding to WhatsApp.");
      }
      // Option A: WhatsApp redirection
      let msg = `*New Registration: ${selectedEvent.event.title}*\n\n`;
      Object.entries(formData).forEach(([k,v]) => {
        const displayV = typeof v === 'string' ? v.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim() : v;
        msg += `*${k}:* ${displayV}\n`;
      });
      const waLink = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(waLink, '_blank');
      setDone(true);
    } catch(err) {
      alert("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="events" style={{padding:mob?"56px 16px":"80px 32px",background:"var(--ww)",position:"relative"}}>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:mob?"flex-start":"flex-end",flexDirection:mob?"column":"row",gap:16,marginBottom:36}}>
          <div><span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>Calendar</span>
            <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.6rem":"2rem",color:"var(--dt)",marginTop:8,fontWeight:700}} className="sh l">Upcoming Events</h2>
          </div>
          <button className="bt" style={{padding:"9px 18px",borderRadius:8,fontWeight:600,fontSize:".85rem",flexShrink:0}}>View All</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:16}}>
          {C.events.map((ev,i)=>(
            <div key={i} className="ch" style={{background:"white",borderRadius:16,border:"1px solid var(--bd)",overflow:"hidden",display:"flex"}}>
              <div style={{background:"linear-gradient(180deg,var(--dt),var(--tm))",color:"white",padding:"18px 16px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minWidth:72,flexShrink:0}}>
                <div style={{fontSize:"1.6rem",fontWeight:700,fontFamily:"'Playfair Display',serif",lineHeight:1}}>{ev.date?.split(" ")[0]}</div>
                <div style={{fontSize:".7rem",opacity:.8,marginTop:3}}>{ev.date?.split(" ")[1]}</div>
                <div style={{fontSize:".65rem",opacity:.6}}>{ev.month}</div>
              </div>
              <div style={{padding:"16px",flex:1,minWidth:0}}>
                <span style={{fontSize:".7rem",fontWeight:700,padding:"3px 9px",borderRadius:20,display:"inline-block",marginBottom:8,background:ev.color,color:"var(--dt)",border:"1px solid var(--bd)"}}>{ev.tag}</span>
                <h4 style={{fontFamily:"'Playfair Display',serif",fontSize:".95rem",fontWeight:700,color:"var(--dt)",marginBottom:5}}>{ev.title}</h4>
                <p style={{fontSize:".78rem",color:"var(--mu)",marginBottom:12}}>{ev.location}</p>
                <div style={{display:"flex",gap:7}}>
                  {ev.formId ? (
                    <button onClick={()=>setSelectedEvent({type:'register', event:ev})} className="bs" style={{padding:"5px 12px",borderRadius:6,fontSize:".75rem",fontWeight:600}}>Register</button>
                  ) : (
                    <button disabled style={{padding:"5px 12px",borderRadius:6,fontSize:".75rem",fontWeight:600,background:"#F5F5F5",color:"#CCC",border:"none"}}>No Registration</button>
                  )}
                  <button onClick={()=>setSelectedEvent({type:'details', event:ev})} style={{padding:"5px 12px",borderRadius:6,fontSize:".75rem",background:"var(--tl)",border:"none",color:"var(--dt)",cursor:"pointer",fontWeight:600}}>Details</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedEvent && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="ac" style={{background:"white",width:"100%",maxWidth:500,padding:24,borderRadius:12,maxHeight:"90vh",overflowY:"auto",position:"relative"}}>
            <button onClick={()=>{setSelectedEvent(null);setDone(false);setFormData({});}} style={{position:"absolute",top:16,right:16,background:"#F5F5F5",border:"none",fontSize:"1.2rem",cursor:"pointer",width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--mu)"}}>✕</button>
            
            {selectedEvent.type === 'details' && (
              <div>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.4rem",color:"var(--dt)",marginBottom:10,fontWeight:700,paddingRight:30}}>{selectedEvent.event.title}</h3>
                <div style={{display:"flex",gap:10,marginBottom:16}}>
                   <span style={{fontSize:".75rem",fontWeight:600,padding:"4px 10px",borderRadius:20,background:selectedEvent.event.color||"var(--tl)",color:"var(--dt)"}}>{selectedEvent.event.tag}</span>
                   <span style={{fontSize:".75rem",fontWeight:600,padding:"4px 10px",borderRadius:20,background:"#F5F5F5",color:"var(--mu)"}}>{selectedEvent.event.date} {selectedEvent.event.month}</span>
                </div>
                <p style={{fontSize:".9rem",color:"var(--tm2)",lineHeight:1.6}}>Join us at <strong>{selectedEvent.event.location}</strong> for this incredible event. We look forward to seeing you there!</p>
              </div>
            )}

            {selectedEvent.type === 'register' && (
              <div>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.4rem",color:"var(--dt)",marginBottom:4,fontWeight:700,paddingRight:30}}>Register</h3>
                <p style={{fontSize:".85rem",color:"var(--mu)",marginBottom:20}}>{selectedEvent.event.title}</p>
                {done ? (
                  <div style={{textAlign:"center",padding:"30px 0"}}>
                    <div style={{fontSize:"3rem",marginBottom:10}}>✅</div>
                    <h4 style={{color:"#1A7A3E",fontWeight:700,marginBottom:6}}>Registration Successful!</h4>
                    <p style={{fontSize:".85rem",color:"var(--mu)"}}>Redirecting to WhatsApp to send your confirmation...</p>
                  </div>
                ) : (
                  <form onSubmit={submitForm} style={{display:"flex",flexDirection:"column",gap:12}}>
                    {getForm(selectedEvent.event.formId).fields.length === 0 && <p style={{fontSize:".85rem",color:"var(--mu)",fontStyle:"italic"}}>This form has no fields. You can still register to send a blank confirmation.</p>}
                    {getForm(selectedEvent.event.formId).fields.map((f, idx) => {
                      const fKey = f.label?.trim() || `Field ${idx + 1}`;
                      return (
                      <div key={idx}>
                        <label style={{display:"block",fontSize:".75rem",fontWeight:600,color:"var(--mu)",marginBottom:4}}>{fKey} {f.required&&<span style={{color:"red"}}>*</span>}</label>
                        {f.type === 'address' ? (
                          <textarea required={f.required} value={formData[fKey]||""} onChange={e=>setFormData({...formData, [fKey]:e.target.value})} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem",minHeight:80,resize:"vertical"}}/>
                        ) : f.type === 'gender' ? (
                          <select required={f.required} value={formData[fKey]||""} onChange={e=>setFormData({...formData, [fKey]:e.target.value})} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem"}}>
                            <option value="">-- Select Gender --</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        ) : f.type === 'fullname' ? (
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                            <input placeholder="First" required={f.required} value={(formData[fKey]?.split("|")[0])||""} onChange={e=>{
                              const parts = (formData[fKey]||"||").split("|"); parts[0] = e.target.value; setFormData({...formData, [fKey]:parts.join("|")});
                            }} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem"}}/>
                            <input placeholder="Middle" value={(formData[fKey]?.split("|")[1])||""} onChange={e=>{
                              const parts = (formData[fKey]||"||").split("|"); parts[1] = e.target.value; setFormData({...formData, [fKey]:parts.join("|")});
                            }} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem"}}/>
                            <input placeholder="Last" required={f.required} value={(formData[fKey]?.split("|")[2])||""} onChange={e=>{
                              const parts = (formData[fKey]||"||").split("|"); parts[2] = e.target.value; setFormData({...formData, [fKey]:parts.join("|")});
                            }} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem"}}/>
                          </div>
                        ) : (
                          <input type={f.type} required={f.required} value={formData[fKey]||""} onChange={e=>setFormData({...formData, [fKey]:e.target.value})} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem"}}/>
                        )}
                      </div>
                    )})}
                    <button type="submit" className="bs" style={{padding:"12px",borderRadius:8,fontWeight:700,marginTop:10,opacity:submitting?0.5:1}} disabled={submitting}>
                      {submitting ? "Submitting..." : "Submit Registration"}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── GALLERY ───────────────────────────────────────────────────────────────────
function Gallery({ C }) {
  const [active, setActive] = useState("All"); const w = useW();
  const items = C.galleryItems || [];
  const cats = ["All", ...new Set(items.map(g=>g.category).filter(Boolean))];
  const filtered = active==="All" ? items : items.filter(g=>g.category===active);
  return (
    <section id="gallery" style={{padding:w<640?"56px 16px":"80px 32px",background:"var(--cr)"}}>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>Our Work</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:w<640?"1.6rem":"2rem",color:"var(--dt)",marginTop:8,fontWeight:700}} className="sh">Gallery</h2>
        </div>
        <div style={{display:"flex",gap:7,justifyContent:"center",flexWrap:"wrap",marginBottom:28}}>
          {cats.map(c=><button key={c} onClick={()=>setActive(c)} style={{padding:"7px 14px",borderRadius:20,fontSize:".78rem",fontWeight:600,cursor:"pointer",background:active===c?"var(--dt)":"white",color:active===c?"white":"var(--tm2)",border:`1px solid ${active===c?"var(--dt)":"var(--bd)"}`}}>{c}</button>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:w<640?"1fr 1fr":"repeat(3,1fr)",gap:12}}>
          {filtered.length === 0 && <div style={{gridColumn:"1/-1",textAlign:"center",padding:40,color:"var(--mu)"}}>No photos uploaded yet.</div>}
          {filtered.map(g=>(
            <div key={g.id} className="gi ch" style={{aspectRatio:"4/3",background:"#eee",backgroundImage:`url(${g.url})`,backgroundSize:"cover",backgroundPosition:"center",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative",borderRadius:12,overflow:"hidden"}}>
              <div style={{position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(to top,rgba(0,0,0,.7),transparent)",padding:"24px 12px 10px",color:"white"}}>
                <div style={{fontSize:".85rem",fontWeight:600}}>{g.title}</div>
                <div style={{fontSize:".7rem",opacity:.9}}>{g.category}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── CONTACT ───────────────────────────────────────────────────────────────────
function Contact({ C }) {
  const w = useW(); const mob = w<768; const ct = C.contact; const tr = C.trust;
  return (
    <section id="contact" style={{padding:mob?"56px 16px":"80px 32px",background:"var(--ww)"}}>
      <div style={{maxWidth:1200,margin:"0 auto",display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:mob?36:48}}>
        <div>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>Join Us</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.5rem":"1.8rem",color:"var(--dt)",marginTop:8,marginBottom:14,fontWeight:700}}>{ct.volunteerHeading}</h2>
          <p style={{color:"var(--tm2)",lineHeight:1.7,marginBottom:20,fontSize:".9rem"}}>{ct.volunteerSub}</p>
          {[{f:"Full Name",t:"text"},{f:"Email",t:"email"},{f:"Phone",t:"tel"},{f:"City",t:"text"}].map(i=><div key={i.f} style={{marginBottom:10}}><input type={i.t} placeholder={i.f} style={{width:"100%",padding:"10px 13px",borderRadius:8,border:"2px solid var(--bd)",fontSize:".875rem",fontFamily:"inherit"}}/></div>)}
          <select style={{width:"100%",padding:"10px 13px",borderRadius:8,border:"2px solid var(--bd)",fontSize:".875rem",fontFamily:"inherit",marginBottom:14,color:"var(--mu)"}}>
            <option>Select Area of Interest</option>
            <option>Education</option><option>Healthcare</option><option>Field Work</option><option>IT and Digital</option><option>Fundraising</option>
          </select>
          <button className="bs" style={{width:"100%",padding:"12px",borderRadius:10,fontSize:".92rem",fontWeight:700}}>Apply to Volunteer</button>
        </div>
        <div>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>Get in Touch</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.5rem":"1.8rem",color:"var(--dt)",marginTop:8,marginBottom:20,fontWeight:700}}>{ct.contactHeading}</h2>
          {[{icon:"📍",label:"Address",val:tr.address},{icon:"📞",label:"Phone",val:tr.phone},{icon:"✉️",label:"Email",val:tr.email},{icon:"🕐",label:"Hours",val:tr.hours}].map(c=>(
            <div key={c.label} style={{display:"flex",gap:14,marginBottom:14,padding:"14px",background:"var(--tl)",borderRadius:12,border:"1px solid #B8D8E8"}}>
              <div style={{fontSize:"1.3rem"}}>{c.icon}</div>
              <div>
                <div style={{fontSize:".7rem",fontWeight:700,color:"var(--tm)",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{c.label}</div>
                <div style={{fontSize:".85rem",color:"var(--tx)"}}>{c.val}</div>
              </div>
            </div>
          ))}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {ct.socials.map(s=><button key={s} style={{padding:"7px 12px",borderRadius:8,background:"white",border:"1px solid var(--bd)",fontSize:".78rem",fontWeight:600,cursor:"pointer",color:"var(--tm2)",transition:"all .2s"}} onMouseEnter={e=>{e.target.style.borderColor="var(--sf)";e.target.style.color="var(--sf)"}} onMouseLeave={e=>{e.target.style.borderColor="var(--bd)";e.target.style.color="var(--tm2)"}}>{s}</button>)}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── CUSTOM SECTION RENDERER ───────────────────────────────────────────────────
const BG_MAP = {cream:"var(--cr)",white:"var(--ww)",teal:"var(--tl)",saffron:"#FFF4EC"};
const BG_LABEL = {cream:"Cream",white:"White",teal:"Light Teal",saffron:"Light Saffron"};

function CustomSection({ sec, lang }) {
  const w = useW(); const mob = w < 768;
  const bg = BG_MAP[sec.bg] || "var(--cr)";
  const title = lang==="en" ? sec.title : (sec.titleGu || sec.title);
  const subtitle = lang==="en" ? sec.subtitle : (sec.subtitleGu || sec.subtitle);
  const content = lang==="en" ? sec.content : (sec.contentGu || sec.content);

  return (
    <section id={sec.id} style={{padding:mob?"56px 16px":"80px 32px",background:bg}}>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        {/* Heading */}
        <div style={{textAlign:"center",marginBottom:40}}>
          {sec.icon && <div style={{fontSize:"2.5rem",marginBottom:12}}>{sec.icon}</div>}
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.7rem":"2.1rem",color:"var(--dt)",fontWeight:700,marginBottom:12}}>{title}</h2>
          {subtitle && <p style={{color:"var(--tm2)",fontSize:".95rem",maxWidth:600,margin:"0 auto",lineHeight:1.7}}>{subtitle}</p>}
        </div>

        {/* Layout: text */}
        {sec.layout==="text" && content && (
          <div style={{maxWidth:780,margin:"0 auto",color:"var(--tm2)",fontSize:".95rem",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{content}</div>
        )}

        {/* Layout: two-col */}
        {sec.layout==="two-col" && (
          <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:32,alignItems:"center"}}>
            <div style={{background:"linear-gradient(135deg,var(--dt),var(--tm))",borderRadius:16,aspectRatio:"4/3",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"5rem"}}>{sec.icon||"🏛️"}</div>
            <div style={{color:"var(--tm2)",fontSize:".95rem",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{content}</div>
          </div>
        )}

        {/* Layout: cards */}
        {sec.layout==="cards" && (sec.cards||[]).length>0 && (
          <div style={{display:"grid",gridTemplateColumns:mob?"1fr":w<960?"1fr 1fr":"repeat(3,1fr)",gap:18}}>
            {(sec.cards||[]).map((card,i)=>(
              <div key={i} className="ch" style={{background:"white",borderRadius:16,padding:"24px 20px",border:"1px solid var(--bd)",boxShadow:"0 2px 12px rgba(0,0,0,.05)"}}>
                {card.icon && <div style={{fontSize:"2rem",marginBottom:12}}>{card.icon}</div>}
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1rem",fontWeight:700,color:"var(--dt)",marginBottom:8}}>{card.title}</h3>
                <p style={{fontSize:".85rem",color:"var(--tm2)",lineHeight:1.6}}>{card.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* Layout: faq */}
        {sec.layout==="faq" && (sec.faqs||[]).length>0 && (
          <div style={{maxWidth:780,margin:"0 auto"}}>
            {(sec.faqs||[]).map((faq,i)=>(
              <details key={i} style={{marginBottom:12,background:"white",borderRadius:12,border:"1px solid var(--bd)",overflow:"hidden"}}>
                <summary style={{padding:"16px 20px",cursor:"pointer",fontWeight:700,color:"var(--dt)",fontSize:".95rem",listStyle:"none",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  {faq.q} <span style={{color:"var(--sf)",flexShrink:0,marginLeft:8}}>+</span>
                </summary>
                <div style={{padding:"0 20px 16px",color:"var(--tm2)",fontSize:".9rem",lineHeight:1.7}}>{faq.a}</div>
              </details>
            ))}
          </div>
        )}

        {/* Layout: testimonials */}
        {sec.layout==="testimonials" && (sec.testimonials||[]).length>0 && (
          <div style={{display:"grid",gridTemplateColumns:mob?"1fr":w<960?"1fr 1fr":"repeat(3,1fr)",gap:18}}>
            {(sec.testimonials||[]).map((t,i)=>(
              <div key={i} style={{background:"white",borderRadius:16,padding:"24px",border:"1px solid var(--bd)",boxShadow:"0 2px 12px rgba(0,0,0,.05)"}}>
                <div style={{fontSize:"1.5rem",color:"var(--sf)",marginBottom:10}}>"</div>
                <p style={{fontSize:".88rem",color:"var(--tm2)",lineHeight:1.7,marginBottom:14,fontStyle:"italic"}}>{t.quote}</p>
                <div style={{fontWeight:700,color:"var(--dt)",fontSize:".85rem"}}>{t.name}</div>
                <div style={{fontSize:".75rem",color:"var(--mu)"}}>{t.role}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── FOOTER ────────────────────────────────────────────────────────────────────
function Footer({ C }) {
  const w = useW(); const mob = w<640;
  return (
    <footer style={{background:"#071E2A",color:"rgba(255,255,255,.75)",padding:mob?"36px 16px 20px":"48px 32px 24px"}}>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":w<900?"2fr 1fr 1fr":"2fr 1fr 1fr 1fr",gap:mob?24:36,marginBottom:32}}>
          <div style={{gridColumn:mob?"1/-1":"auto"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <LogoMark logo={C.trust.logo} mob={false}/>
              <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,color:"white",fontSize:".9rem"}}>{C.trust.name}</div>
            </div>
            <p style={{fontSize:".82rem",lineHeight:1.7,marginBottom:12}}>Serving humanity with compassion since {C.trust.estd}. Registered under Gujarat Public Trust Act. 80G and FCRA Certified.</p>
            <div style={{fontSize:".72rem",color:"rgba(255,255,255,.4)"}}>CIN: {C.trust.cin}</div>
          </div>
          {[{title:"Quick Links",items:["About Us","Programs","Events","Gallery","Annual Reports","Contact"]},{title:"Programs",items:["Education","Healthcare","Women Empowerment","Environment","Disaster Relief","Livelihood"]},...(w>=900?[{title:"Legal",items:["Privacy Policy","Terms of Use","Donation Policy","Volunteer Policy","Grievance"]}]:[])].map(col=>(
            <div key={col.title}>
              <h4 style={{color:"white",fontWeight:700,marginBottom:14,fontSize:".82rem"}}>{col.title}</h4>
              {col.items.map(item=><div key={item} style={{fontSize:".78rem",marginBottom:8,cursor:"pointer"}} onMouseEnter={e=>e.target.style.color="var(--sflt)"} onMouseLeave={e=>e.target.style.color="rgba(255,255,255,.75)"}>{item}</div>)}
            </div>
          ))}
        </div>
        <div style={{borderTop:"1px solid rgba(255,255,255,.1)",paddingTop:18,display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{fontSize:".75rem"}}>2025 {C.trust.name}. All rights reserved.</div>
          <div style={{fontSize:".75rem"}}>Designed with love for humanity</div>
        </div>
      </div>
    </footer>
  );
}


// Standalone blur-commit input — prevents parent re-render while typing
function BlurInput({ value, onCommit, className, style }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <input
      className={className} style={style}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
    />
  );
}

// ── CONTENT EDITOR ────────────────────────────────────────────────────────────
function ContentEditor({ C, setC, setPage, auth }) {
  const [draft, setDraft] = useState(()=>JSON.parse(JSON.stringify(C)));
  const [toast,    setToast]    = useState(null); // null | "saving" | "saved" | "error"
  const [toastMsg, setToastMsg] = useState("");
  const [exp, setExp] = useState({sections:true,nav:true,trust:true,hero:true,stats:true,about:true,programs:true,events:true,donate:true,contact:true});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();
  const w = useW(); const mob = w<768;

  useEffect(()=>{ setDraft(JSON.parse(JSON.stringify(C))); },[C]);

  const showToast = (type, msg) => { setToast(type); setToastMsg(msg); setTimeout(()=>setToast(null),3500); };

  const save = async () => {
    const saved = JSON.parse(JSON.stringify(draft));
    setC(saved); // apply locally immediately
    if (!auth?.idToken) { showToast("warn","Changes applied locally. Login to save to database."); return; }
    showToast("saving","Saving to Firebase...");
    try {
      await fbSave(saved, auth.idToken);
      showToast("saved","Saved to Firebase successfully!");
    } catch(e) {
      showToast("error", e.message || "Save failed. Check your connection.");
    }
  };

  const reset = () => {
    if (!window.confirm("Reset all content to defaults?")) return;
    const d = JSON.parse(JSON.stringify(DC));
    setC(d); setDraft(d);
  };

  // ── Logo file upload to Firebase Storage ──────────────────────────────────
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!auth?.idToken) { showToast("error","Please login to upload images."); return; }
    setUploading(true);
    try {
      const url = await fbUploadLogo(file, auth.idToken);
      upd("trust.logo.url", url);
      upd("trust.logo.type", "image");
      showToast("saved","Logo uploaded successfully!");
    } catch(e) {
      showToast("error","Upload failed: " + e.message);
    } finally { setUploading(false); }
  };

  const upd = (path, value) => {
    setDraft(prev=>{
      const next=JSON.parse(JSON.stringify(prev));
      const keys=path.split("."); let obj=next;
      for(let i=0;i<keys.length-1;i++){const k=isNaN(keys[i])?keys[i]:parseInt(keys[i]);obj=obj[k];}
      const lk=isNaN(keys[keys.length-1])?keys[keys.length-1]:parseInt(keys[keys.length-1]);
      obj[lk]=value; return next;
    });
  };

  const gv = (path) => path.split(".").reduce((o,k)=>o?.[isNaN(k)?k:parseInt(k)],draft)??"";

  // ── Array helpers ──────────────────────────────────────────────────────────
  const getArr = (next, path) => {
    const keys = path.split(".");
    let o = next;
    for (const k of keys) o = o[isNaN(k)?k:parseInt(k)];
    return o;
  };
  const addItem = (arrPath, newItem) => {
    setDraft(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      getArr(next, arrPath).push(newItem);
      return next;
    });
  };
  const delItem = (arrPath, idx) => {
    setDraft(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      getArr(next, arrPath).splice(idx, 1);
      return next;
    });
  };
  const moveItem = (arrPath, idx, dir) => {
    setDraft(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const arr = getArr(next, arrPath);
      const to = idx + dir;
      if (to < 0 || to >= arr.length) return prev;
      [arr[idx], arr[to]] = [arr[to], arr[idx]];
      return next;
    });
  };

  // ── Reusable row toolbar: move up/down + delete ────────────────────────────
  const RowBar = ({ arrPath, idx, total, label }) => (
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
      <span style={{flex:1,fontSize:".7rem",fontWeight:700,color:"var(--tm)",textTransform:"uppercase",letterSpacing:.5}}>{label} {idx+1}</span>
      <button onClick={()=>moveItem(arrPath,idx,-1)} disabled={idx===0}
        style={{padding:"4px 9px",borderRadius:6,border:"1px solid var(--bd)",background:idx===0?"#f5f5f5":"white",cursor:idx===0?"not-allowed":"pointer",fontSize:".8rem",color:idx===0?"#ccc":"var(--dt)",fontWeight:600}}>↑</button>
      <button onClick={()=>moveItem(arrPath,idx,1)} disabled={idx===total-1}
        style={{padding:"4px 9px",borderRadius:6,border:"1px solid var(--bd)",background:idx===total-1?"#f5f5f5":"white",cursor:idx===total-1?"not-allowed":"pointer",fontSize:".8rem",color:idx===total-1?"#ccc":"var(--dt)",fontWeight:600}}>↓</button>
      <button onClick={()=>{ if(window.confirm(`Delete ${label} ${idx+1}?`)) delItem(arrPath,idx); }}
        style={{padding:"4px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".8rem",color:"#C0392B",fontWeight:600}}>Delete</button>
    </div>
  );

  // ── Add button ─────────────────────────────────────────────────────────────
  const AddBtn = ({ label, onClick }) => (
    <button onClick={onClick}
      style={{width:"100%",padding:"12px",borderRadius:10,border:"2px dashed var(--sf)",background:"#FFF4EC",color:"var(--sf)",fontWeight:700,fontSize:".88rem",cursor:"pointer",transition:"all .2s",marginTop:6}}
      onMouseEnter={e=>e.currentTarget.style.background="#FFE8D6"}
      onMouseLeave={e=>e.currentTarget.style.background="#FFF4EC"}>
      + Add {label}
    </button>
  );

  // Field uses LOCAL state so typing never re-renders parent (fixes mobile keyboard dismiss).
  // Value syncs to parent draft only on onBlur (when user leaves the field).
  const F = ({label, path, ta, hint}) => {
    const initVal = gv(path);
    const [local, setLocal] = useState(initVal);
    // Sync if parent resets
    useEffect(() => { setLocal(gv(path)); }, [path, draft]);
    const commit = () => upd(path, local);
    return (
      <div className="cf">
        <label className="cl">{label}{hint&&<span style={{color:"var(--tm)",marginLeft:6,fontWeight:400,textTransform:"none",fontSize:".7rem"}}>({hint})</span>}</label>
        {ta
          ? <textarea className="ci" rows={3} value={local} onChange={e=>setLocal(e.target.value)} onBlur={commit}/>
          : <input    className="ci"          value={local} onChange={e=>setLocal(e.target.value)} onBlur={commit}/>
        }
      </div>
    );
  };

  const Sec = ({id, icon, label, children, onAdd, addLabel}) => (
    <div className="csc">
      <div className="csh" style={{userSelect:"none"}}>
        {/* Clicking the left part toggles open/close */}
        <div onClick={()=>setExp(e=>({...e,[id]:!e[id]}))} style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
          <span style={{fontSize:"1.2rem",flexShrink:0}}>{icon}</span>
          <span style={{fontFamily:"'Playfair Display',serif",fontWeight:700,color:"var(--dt)",fontSize:".95rem",flex:1}}>{label}</span>
          <span style={{color:"var(--tm)",fontSize:".8rem",flexShrink:0,marginRight:8}}>{exp[id]?"▲":"▼"}</span>
        </div>
        {/* Add button always visible in header */}
        {onAdd && (
          <button
            onClick={e=>{ e.stopPropagation(); onAdd(); if(!exp[id]) setExp(e=>({...e,[id]:true})); }}
            style={{flexShrink:0,padding:"5px 12px",borderRadius:8,border:"2px solid var(--sf)",background:"#FFF4EC",color:"var(--sf)",fontWeight:700,fontSize:".75rem",cursor:"pointer",whiteSpace:"nowrap",transition:"all .2s"}}
            onMouseEnter={e=>e.currentTarget.style.background="#FFE8D6"}
            onMouseLeave={e=>e.currentTarget.style.background="#FFF4EC"}>
            + {addLabel||"Add"}
          </button>
        )}
      </div>
      {exp[id] && <div className="csb">{children}</div>}
    </div>
  );

  const G2 = ({children}) => <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 16px"}}>{children}</div>;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.3rem",color:"var(--dt)",fontWeight:700}}>Content Editor</h2>
          <p style={{fontSize:".8rem",color:"var(--mu)",marginTop:3}}>
            {auth?.email ? <span style={{color:"#1A7A3E",fontWeight:600}}>Connected: {auth.email}</span> : <span style={{color:"#C0392B"}}>Not connected — changes are local only</span>}
          </p>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <button onClick={reset} style={{padding:"9px 14px",borderRadius:8,background:"white",border:"1px solid var(--bd)",cursor:"pointer",fontSize:".8rem",fontWeight:600,color:"var(--mu)"}}>Reset</button>
          <button onClick={()=>setPage("public")} style={{padding:"9px 14px",borderRadius:8,background:"var(--tl)",border:"1px solid #B8D8E8",cursor:"pointer",fontSize:".8rem",fontWeight:600,color:"var(--dt)"}}>Preview</button>
          <button className="bs" onClick={save} disabled={toast==="saving"} style={{padding:"10px 22px",borderRadius:8,fontWeight:700,fontSize:".9rem",opacity:toast==="saving"?.7:1}}>
            {toast==="saving" ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div style={{background:"linear-gradient(135deg,#E8F4F8,#FFF4EC)",border:"1px solid #B8D8E8",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:"1.4rem"}}>💡</span>
        <div>
          <div style={{fontWeight:700,color:"var(--dt)",fontSize:".875rem"}}>Expand any section to edit content</div>
          <div style={{color:"var(--mu)",fontSize:".78rem",marginTop:2}}>Changes apply live when you click Save. Use Preview Site to see the result.</div>
        </div>
      </div>

      {/* ══ SECTIONS MANAGER ══════════════════════════════════════════════ */}
      <Sec id="sections" icon="📄" label="Page Sections Manager"
        onAdd={()=>{
          const id = "custom_" + Date.now();
          addItem("customSections",{id,title:"New Section",titleGu:"નવો વિભાગ",subtitle:"",subtitleGu:"",content:"Add your content here.",contentGu:"",layout:"text",bg:"white",icon:"",visible:true,cards:[],faqs:[],testimonials:[]});
        }} addLabel="Add New Section">

        {/* ── Built-in sections visibility ─────────────────────────── */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:".72rem",fontWeight:700,color:"var(--mu)",textTransform:"uppercase",letterSpacing:.8,marginBottom:10}}>Built-in Sections — Show / Hide</div>
          <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:8}}>
            {[
              {key:"hero",     label:"Hero / Banner",    icon:"🌟"},
              {key:"about",    label:"About Section",    icon:"ℹ️"},
              {key:"programs", label:"Programs",          icon:"📋"},
              {key:"gallery",  label:"Gallery",           icon:"🖼️"},
              {key:"events",   label:"Events",            icon:"📅"},
              {key:"donate",   label:"Donation Section",  icon:"❤️"},
              {key:"contact",  label:"Contact & Volunteer",icon:"📞"},
            ].map(sec=>{
              const on = draft.builtinSections[sec.key] !== false;
              return (
                <div key={sec.key} onClick={()=>upd(`builtinSections.${sec.key}`, !on)}
                  style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:10,border:`1.5px solid ${on?"var(--bd)":"#F5B8B8"}`,background:on?"white":"#FFF5F5",cursor:"pointer",transition:"all .2s",userSelect:"none"}}>
                  <div style={{width:36,height:20,borderRadius:10,background:on?"var(--dt)":"#ddd",position:"relative",transition:"background .3s",flexShrink:0}}>
                    <div style={{position:"absolute",top:3,left:on?18:3,width:14,height:14,borderRadius:"50%",background:"white",transition:"left .3s"}}/>
                  </div>
                  <span style={{fontSize:"1rem"}}>{sec.icon}</span>
                  <span style={{fontWeight:600,fontSize:".85rem",color:on?"var(--dt)":"#C0392B",flex:1}}>{sec.label}</span>
                  <span style={{fontSize:".72rem",fontWeight:700,color:on?"#1A7A3E":"#C0392B",background:on?"#EDFAF1":"#FEF0EF",padding:"2px 8px",borderRadius:10}}>{on?"Visible":"Hidden"}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Custom sections ──────────────────────────────────────── */}
        <div style={{borderTop:"1px solid var(--bd)",paddingTop:16}}>
          <div style={{fontSize:".72rem",fontWeight:700,color:"var(--mu)",textTransform:"uppercase",letterSpacing:.8,marginBottom:10}}>
            Custom Sections — {draft.customSections.length === 0 ? "None yet. Click + Add New Section above." : `${draft.customSections.length} section(s)`}
          </div>

          {draft.customSections.map((sec,i)=>(
            <div key={sec.id} style={{border:`1.5px solid ${sec.visible?"#B8D8E8":"#F5B8B8"}`,borderRadius:14,padding:"16px",marginBottom:14,background:sec.visible?"#FAFAFA":"#FFF5F5"}}>

              {/* Header row */}
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                {/* Visible toggle */}
                <div onClick={()=>upd(`customSections.${i}.visible`,!sec.visible)}
                  style={{width:40,height:22,borderRadius:11,background:sec.visible?"var(--dt)":"#ccc",position:"relative",cursor:"pointer",transition:"background .3s",flexShrink:0}}>
                  <div style={{position:"absolute",top:3,left:sec.visible?19:3,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .3s"}}/>
                </div>
                <span style={{fontSize:".7rem",fontWeight:700,padding:"2px 8px",borderRadius:10,background:sec.visible?"#EDFAF1":"#FEF0EF",color:sec.visible?"#1A7A3E":"#C0392B"}}>{sec.visible?"Visible":"Hidden"}</span>
                <span style={{fontWeight:700,color:"var(--dt)",fontSize:".9rem",flex:1,minWidth:0}}>{sec.title}</span>
                <button onClick={()=>moveItem("customSections",i,-1)} disabled={i===0}
                  style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--bd)",background:i===0?"#f5f5f5":"white",cursor:i===0?"not-allowed":"pointer",fontSize:".78rem",color:i===0?"#ccc":"var(--dt)",fontWeight:600}}>↑</button>
                <button onClick={()=>moveItem("customSections",i,1)} disabled={i===draft.customSections.length-1}
                  style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--bd)",background:i===draft.customSections.length-1?"#f5f5f5":"white",cursor:i===draft.customSections.length-1?"not-allowed":"pointer",fontSize:".78rem",color:i===draft.customSections.length-1?"#ccc":"var(--dt)",fontWeight:600}}>↓</button>
                <button onClick={()=>{ if(window.confirm(`Delete "${sec.title}"?`)) delItem("customSections",i); }}
                  style={{padding:"4px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".78rem",color:"#C0392B",fontWeight:600}}>Delete</button>
              </div>

              {/* Section fields */}
              <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
                <F label="Section Title" path={`customSections.${i}.title`} hint="English"/>
                <F label="Section Title" path={`customSections.${i}.titleGu`} hint="Gujarati"/>
                <F label="Subtitle / Tagline" path={`customSections.${i}.subtitle`} hint="English"/>
                <F label="Subtitle / Tagline" path={`customSections.${i}.subtitleGu`} hint="Gujarati"/>

                {/* Layout picker */}
                <div className="cf" style={{gridColumn:mob?"auto":"1/-1"}}>
                  <label className="cl">Section Layout</label>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {[
                      {v:"text",        label:"Text Block",    desc:"Heading + paragraphs"},
                      {v:"two-col",     label:"Two Column",    desc:"Image + text side by side"},
                      {v:"cards",       label:"Cards Grid",    desc:"Multiple info cards"},
                      {v:"faq",         label:"FAQ",           desc:"Expandable Q&A"},
                      {v:"testimonials",label:"Testimonials",  desc:"Quotes from people"},
                    ].map(l=>(
                      <button key={l.v} onClick={()=>upd(`customSections.${i}.layout`,l.v)}
                        style={{padding:"8px 14px",borderRadius:8,border:`2px solid ${sec.layout===l.v?"var(--sf)":"var(--bd)"}`,background:sec.layout===l.v?"#FFF4EC":"white",color:sec.layout===l.v?"var(--sf)":"var(--tm2)",fontWeight:700,cursor:"pointer",fontSize:".75rem",fontFamily:"inherit",transition:"all .2s",textAlign:"center"}}>
                        <div>{l.label}</div>
                        <div style={{fontSize:".65rem",fontWeight:400,opacity:.7,marginTop:2}}>{l.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Background */}
                <div className="cf">
                  <label className="cl">Background</label>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {Object.entries(BG_MAP).map(([k,v])=>(
                      <div key={k} onClick={()=>upd(`customSections.${i}.bg`,k)}
                        style={{width:36,height:36,borderRadius:8,background:v,border:`3px solid ${sec.bg===k?"var(--sf)":"var(--bd)"}`,cursor:"pointer",boxShadow:sec.bg===k?"0 0 0 2px var(--sf)":"none",transition:"all .2s"}}
                        title={BG_LABEL[k]}/>
                    ))}
                  </div>
                </div>

                {/* Icon */}
                <div className="cf">
                  <label className="cl">Section Icon (optional)</label>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {["","🤝","🏅","💬","❓","⭐","🌍","🎯","📰","🏆","💡","🎓","📷","🔬","🌺"].map(em=>(
                      <div key={em||"none"} onClick={()=>upd(`customSections.${i}.icon`,em)}
                        style={{width:34,height:34,borderRadius:8,border:`2px solid ${sec.icon===em?"var(--sf)":"var(--bd)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:em?"1.1rem":".65rem",cursor:"pointer",background:sec.icon===em?"#FFF4EC":"white",color:sec.icon===em?"var(--sf)":"var(--mu)",transition:"all .2s"}}>
                        {em||"None"}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Layout-specific content fields */}
              {(sec.layout==="text"||sec.layout==="two-col") && (
                <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
                  <F label="Content" path={`customSections.${i}.content`} ta hint="English"/>
                  <F label="Content" path={`customSections.${i}.contentGu`} ta hint="Gujarati"/>
                </div>
              )}

              {sec.layout==="cards" && (
                <div style={{marginTop:8}}>
                  <div style={{fontSize:".72rem",fontWeight:700,color:"var(--mu)",textTransform:"uppercase",letterSpacing:.8,marginBottom:8}}>Cards</div>
                  {(sec.cards||[]).map((card,ci)=>(
                    <div key={ci} style={{border:"1px solid var(--bd)",borderRadius:10,padding:"12px",marginBottom:10,background:"white",display:"grid",gridTemplateColumns:mob?"1fr":"auto 1fr 1fr",gap:8,alignItems:"start"}}>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {["📚","🏥","🤝","⭐","🎯","💡","🌍","🏆","📷"].map(em=>(
                          <div key={em} onClick={()=>upd(`customSections.${i}.cards.${ci}.icon`,em)} style={{width:28,height:28,borderRadius:6,border:`2px solid ${card.icon===em?"var(--sf)":"var(--bd)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:".85rem",cursor:"pointer",background:card.icon===em?"#FFF4EC":"white"}}>{em}</div>
                        ))}
                      </div>
                      <BlurInput className="ci" value={card.title||""} onCommit={v=>upd(`customSections.${i}.cards.${ci}.title`,v)} style={{marginBottom:0}} placeholder="Card Title"/>
                      <div style={{display:"flex",gap:6}}>
                        <BlurInput className="ci" value={card.body||""} onCommit={v=>upd(`customSections.${i}.cards.${ci}.body`,v)} style={{flex:1,marginBottom:0}} placeholder="Card description"/>
                        <button onClick={()=>{ const cards=[...(sec.cards||[])]; cards.splice(ci,1); upd(`customSections.${i}.cards`,cards); }} style={{padding:"8px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".78rem",color:"#C0392B",fontWeight:600,flexShrink:0}}>Del</button>
                      </div>
                    </div>
                  ))}
                  <button onClick={()=>{ const cards=[...(sec.cards||[])]; cards.push({icon:"⭐",title:"New Card",body:"Description"}); upd(`customSections.${i}.cards`,cards); }}
                    style={{width:"100%",padding:"10px",borderRadius:8,border:"2px dashed var(--sf)",background:"#FFF4EC",color:"var(--sf)",fontWeight:700,fontSize:".82rem",cursor:"pointer"}}>+ Add Card</button>
                </div>
              )}

              {sec.layout==="faq" && (
                <div style={{marginTop:8}}>
                  <div style={{fontSize:".72rem",fontWeight:700,color:"var(--mu)",textTransform:"uppercase",letterSpacing:.8,marginBottom:8}}>FAQ Items</div>
                  {(sec.faqs||[]).map((faq,fi)=>(
                    <div key={fi} style={{border:"1px solid var(--bd)",borderRadius:10,padding:"12px",marginBottom:10,background:"white"}}>
                      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                        <BlurInput className="ci" value={faq.q||""} onCommit={v=>upd(`customSections.${i}.faqs.${fi}.q`,v)} style={{flex:1,marginBottom:0}} placeholder="Question"/>
                        <button onClick={()=>{ const faqs=[...(sec.faqs||[])]; faqs.splice(fi,1); upd(`customSections.${i}.faqs`,faqs); }} style={{padding:"8px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".78rem",color:"#C0392B",fontWeight:600,flexShrink:0}}>Del</button>
                      </div>
                      <BlurInput className="ci" value={faq.a||""} onCommit={v=>upd(`customSections.${i}.faqs.${fi}.a`,v)} style={{marginBottom:0}} placeholder="Answer"/>
                    </div>
                  ))}
                  <button onClick={()=>{ const faqs=[...(sec.faqs||[])]; faqs.push({q:"Question?",a:"Answer here."}); upd(`customSections.${i}.faqs`,faqs); }}
                    style={{width:"100%",padding:"10px",borderRadius:8,border:"2px dashed var(--sf)",background:"#FFF4EC",color:"var(--sf)",fontWeight:700,fontSize:".82rem",cursor:"pointer"}}>+ Add FAQ</button>
                </div>
              )}

              {sec.layout==="testimonials" && (
                <div style={{marginTop:8}}>
                  <div style={{fontSize:".72rem",fontWeight:700,color:"var(--mu)",textTransform:"uppercase",letterSpacing:.8,marginBottom:8}}>Testimonials</div>
                  {(sec.testimonials||[]).map((t,ti)=>(
                    <div key={ti} style={{border:"1px solid var(--bd)",borderRadius:10,padding:"12px",marginBottom:10,background:"white",display:"grid",gridTemplateColumns:"1fr auto",gap:8}}>
                      <div>
                        <BlurInput className="ci" value={t.quote||""} onCommit={v=>upd(`customSections.${i}.testimonials.${ti}.quote`,v)} style={{marginBottom:8}} placeholder="Quote / testimonial text"/>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                          <BlurInput className="ci" value={t.name||""} onCommit={v=>upd(`customSections.${i}.testimonials.${ti}.name`,v)} style={{marginBottom:0}} placeholder="Name"/>
                          <BlurInput className="ci" value={t.role||""} onCommit={v=>upd(`customSections.${i}.testimonials.${ti}.role`,v)} style={{marginBottom:0}} placeholder="Role / Organisation"/>
                        </div>
                      </div>
                      <button onClick={()=>{ const ts=[...(sec.testimonials||[])]; ts.splice(ti,1); upd(`customSections.${i}.testimonials`,ts); }} style={{padding:"8px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".78rem",color:"#C0392B",fontWeight:600,alignSelf:"start"}}>Del</button>
                    </div>
                  ))}
                  <button onClick={()=>{ const ts=[...(sec.testimonials||[])]; ts.push({quote:"",name:"",role:""}); upd(`customSections.${i}.testimonials`,ts); }}
                    style={{width:"100%",padding:"10px",borderRadius:8,border:"2px dashed var(--sf)",background:"#FFF4EC",color:"var(--sf)",fontWeight:700,fontSize:".82rem",cursor:"pointer"}}>+ Add Testimonial</button>
                </div>
              )}

            </div>
          ))}

          {draft.customSections.length === 0 && (
            <div style={{textAlign:"center",padding:"32px 16px",color:"var(--mu)",fontSize:".875rem",background:"white",borderRadius:12,border:"1.5px dashed var(--bd)"}}>
              No custom sections yet.<br/>
              <span style={{color:"var(--sf)",fontWeight:600}}>Click "+ Add New Section" in the header above to create one.</span>
            </div>
          )}
        </div>
      </Sec>
      {/* ══ END SECTIONS MANAGER ══════════════════════════════════════════ */}

      <Sec id="nav" icon="🔗" label="Navigation Menu"
        onAdd={()=>addItem("nav",{label:"New Page",labelGu:"નવું પૃષ્ઠ",sectionId:"home",icon:"⭐",visible:true})} addLabel="Add Menu Item">
        {/* Info strip */}
        <div style={{background:"#FFF4EC",border:"1px solid #FDDBB8",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:".8rem",color:"var(--sf)",fontWeight:500}}>
          Changes reflect live in the navbar. Hidden items disappear from menu but the page section still exists.
        </div>

        {/* Nav item rows */}
        {draft.nav.map((item, i) => (
          <div key={i} style={{border:`1.5px solid ${item.visible?"var(--bd)":"#F5B8B8"}`,borderRadius:12,padding:"14px 16px",marginBottom:10,background:item.visible?"#FAFAFA":"#FFF5F5",transition:"all .3s"}}>

            {/* Row header: visibility + label preview + controls */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:item.visible?14:0,flexWrap:"wrap"}}>

              {/* Eye toggle */}
              <div onClick={()=>upd(`nav.${i}.visible`,!item.visible)}
                style={{width:44,height:24,borderRadius:12,background:item.visible?"var(--dt)":"#ddd",position:"relative",cursor:"pointer",transition:"background .3s",flexShrink:0}}>
                <div style={{position:"absolute",top:3,left:item.visible?22:3,width:18,height:18,borderRadius:"50%",background:"white",transition:"left .3s",boxShadow:"0 1px 4px rgba(0,0,0,.2)"}}/>
              </div>

              {/* Status badge */}
              <span style={{fontSize:".7rem",fontWeight:700,padding:"2px 8px",borderRadius:10,background:item.visible?"#EDFAF1":"#FEF0EF",color:item.visible?"#1A7A3E":"#C0392B",flexShrink:0}}>
                {item.visible ? "Visible" : "Hidden"}
              </span>

              {/* Icon + label preview */}
              <span style={{fontSize:"1rem"}}>{item.icon}</span>
              <span style={{fontWeight:700,color:"var(--dt)",fontSize:".88rem",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.label}</span>

              {/* Move up / down */}
              <button onClick={()=>moveItem("nav",i,-1)} disabled={i===0}
                style={{padding:"4px 9px",borderRadius:6,border:"1px solid var(--bd)",background:i===0?"#f5f5f5":"white",cursor:i===0?"not-allowed":"pointer",fontSize:".78rem",color:i===0?"#ccc":"var(--dt)",fontWeight:600,flexShrink:0}}>↑</button>
              <button onClick={()=>moveItem("nav",i,1)} disabled={i===draft.nav.length-1}
                style={{padding:"4px 9px",borderRadius:6,border:"1px solid var(--bd)",background:i===draft.nav.length-1?"#f5f5f5":"white",cursor:i===draft.nav.length-1?"not-allowed":"pointer",fontSize:".78rem",color:i===draft.nav.length-1?"#ccc":"var(--dt)",fontWeight:600,flexShrink:0}}>↓</button>
              <button onClick={()=>{ if(window.confirm(`Remove "${item.label}" from navigation?`)) delItem("nav",i); }}
                style={{padding:"4px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".78rem",color:"#C0392B",fontWeight:600,flexShrink:0}}>Del</button>
            </div>

            {/* Editable fields — only show when visible or always allow editing */}
            {item.visible && (
              <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
                <F label="Menu Label" path={`nav.${i}.label`} hint="English"/>
                <F label="Menu Label" path={`nav.${i}.labelGu`} hint="Gujarati"/>
                <div className="cf">
                  <label className="cl">Section ID (scroll target)</label>
                  <select className="ci" value={item.sectionId} onChange={e=>upd(`nav.${i}.sectionId`,e.target.value)}>
                    {["home","about","programs","gallery","events","donate","contact"].map(s=><option key={s} value={s}>{s}</option>)}
                    <option value={item.sectionId}>{item.sectionId}</option>
                  </select>
                </div>
                <div className="cf">
                  <label className="cl">Icon (shows in mobile drawer)</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:4}}>
                    {["🏠","ℹ️","📋","🖼️","📅","❤️","📞","⭐","🌍","🎯","💡","🎓"].map(em=>(
                      <div key={em} onClick={()=>upd(`nav.${i}.icon`,em)}
                        style={{width:34,height:34,borderRadius:8,border:`2px solid ${item.icon===em?"var(--sf)":"var(--bd)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem",cursor:"pointer",background:item.icon===em?"#FFF4EC":"white",transition:"all .2s"}}>
                        {em}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Quick re-show button when hidden */}
            {!item.visible && (
              <button onClick={()=>upd(`nav.${i}.visible`,true)}
                style={{marginTop:10,padding:"6px 14px",borderRadius:8,border:"1px solid #B8D8E8",background:"var(--tl)",color:"var(--dt)",cursor:"pointer",fontSize:".78rem",fontWeight:600}}>
                Show in Menu
              </button>
            )}
          </div>
        ))}

        {/* Live preview strip */}
        <div style={{marginTop:16,padding:"12px 16px",background:"var(--dt)",borderRadius:12,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{color:"rgba(255,255,255,.5)",fontSize:".72rem",marginRight:4}}>Preview:</span>
          {draft.nav.filter(n=>n.visible).map((item,i)=>(
            <span key={i} style={{color:"white",fontSize:".8rem",fontWeight:500,padding:"3px 10px",borderRadius:20,background:"rgba(255,255,255,.1)"}}>
              {item.icon} {item.label}
            </span>
          ))}
          {draft.nav.filter(n=>!n.visible).length>0 && (
            <span style={{color:"rgba(255,255,255,.35)",fontSize:".72rem",marginLeft:4}}>
              + {draft.nav.filter(n=>!n.visible).length} hidden
            </span>
          )}
        </div>
      </Sec>

      <Sec id="trust" icon="🏛️" label="Trust Information">

        {/* ── LOGO MANAGER ──────────────────────────────────────────── */}
        <div style={{border:"1.5px solid var(--bd)",borderRadius:14,padding:"18px",marginBottom:22,background:"#FAFAFA"}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,color:"var(--dt)",fontSize:".95rem",marginBottom:16}}>Logo Settings</div>

          {/* Live preview */}
          <div style={{display:"flex",alignItems:"center",gap:14,padding:"14px 18px",background:"var(--ww)",borderRadius:10,border:"1px solid var(--bd)",marginBottom:18}}>
            <LogoMark logo={draft.trust.logo} mob={false}/>
            <div>
              <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,fontSize:".9rem",color:"var(--dt)"}}>{draft.trust.name}</div>
              <div style={{fontSize:".6rem",color:"var(--mu)",textTransform:"uppercase",letterSpacing:1}}>Live Preview</div>
            </div>
          </div>

          {/* Visible toggle */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,padding:"10px 14px",background:"var(--tl)",borderRadius:10,border:"1px solid #B8D8E8"}}>
            <div onClick={()=>upd("trust.logo.visible",!draft.trust.logo.visible)}
              style={{width:44,height:24,borderRadius:12,background:draft.trust.logo.visible?"var(--dt)":"#ccc",position:"relative",cursor:"pointer",transition:"background .3s",flexShrink:0}}>
              <div style={{position:"absolute",top:3,left:draft.trust.logo.visible?22:3,width:18,height:18,borderRadius:"50%",background:"white",transition:"left .3s"}}/>
            </div>
            <div>
              <div style={{fontSize:".85rem",fontWeight:700,color:"var(--dt)"}}>Logo Visible</div>
              <div style={{fontSize:".72rem",color:"var(--mu)"}}>{draft.trust.logo.visible ? "Showing in navbar and footer" : "Logo is hidden"}</div>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 16px"}}>

            {/* Type selector */}
            <div className="cf">
              <label className="cl">Logo Type</label>
              <div style={{display:"flex",gap:8}}>
                {["text","image"].map(t=>(
                  <button key={t} onClick={()=>upd("trust.logo.type",t)}
                    style={{flex:1,padding:"9px",borderRadius:8,border:`2px solid ${draft.trust.logo.type===t?"var(--sf)":"var(--bd)"}`,background:draft.trust.logo.type===t?"#FFF4EC":"white",color:draft.trust.logo.type===t?"var(--sf)":"var(--tm2)",fontWeight:700,cursor:"pointer",fontSize:".82rem",transition:"all .2s",fontFamily:"inherit",textTransform:"capitalize"}}>
                    {t==="text" ? "Text / Symbol" : "Image / URL"}
                  </button>
                ))}
              </div>
            </div>

            {/* Text or URL/Upload input */}
            {draft.trust.logo.type === "text"
              ? <F label="Logo Text / Symbol" path="trust.logo.text" hint="e.g. Om, VG, T"/>
              : (
                <div className="cf">
                  <label className="cl">Image — Upload or Paste URL</label>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <BlurInput className="ci" value={draft.trust.logo.url||""} onCommit={v=>upd("trust.logo.url",v)} placeholder="Paste https://... image URL" style={{marginBottom:0}}/>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontSize:".75rem",color:"var(--mu)"}}>or</span>
                      <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleLogoUpload}/>
                      <button onClick={()=>fileRef.current?.click()} disabled={uploading||!auth?.idToken}
                        style={{padding:"7px 14px",borderRadius:8,border:"2px solid var(--sf)",background:"#FFF4EC",color:"var(--sf)",fontWeight:700,fontSize:".78rem",cursor:!auth?.idToken||uploading?"not-allowed":"pointer",opacity:!auth?.idToken?.5:1,fontFamily:"inherit"}}>
                        {uploading?"Uploading...":"Upload from Device"}
                      </button>
                      {!auth?.idToken && <span style={{fontSize:".72rem",color:"#C0392B"}}>Login required</span>}
                    </div>
                  </div>
                </div>
              )
            }

            {/* Size slider */}
            <div className="cf">
              <label className="cl">Logo Size — {draft.trust.logo.size}px</label>
              <input type="range" min={28} max={80} value={draft.trust.logo.size}
                onChange={e=>upd("trust.logo.size", parseInt(e.target.value))}
                style={{width:"100%",accentColor:"var(--sf)",height:4,cursor:"pointer"}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:".68rem",color:"var(--mu)",marginTop:4}}>
                <span>Small (28)</span><span>Large (80)</span>
              </div>
            </div>

            {/* Shape */}
            <div className="cf">
              <label className="cl">Logo Shape</label>
              <div style={{display:"flex",gap:8}}>
                {[{v:"circle",label:"Circle"},{v:"rounded",label:"Rounded"},{v:"square",label:"Square"}].map(s=>(
                  <button key={s.v} onClick={()=>upd("trust.logo.shape",s.v)}
                    style={{flex:1,padding:"8px 6px",borderRadius:s.v==="circle"?"50px":s.v==="rounded"?"10px":"6px",border:`2px solid ${draft.trust.logo.shape===s.v?"var(--sf)":"var(--bd)"}`,background:draft.trust.logo.shape===s.v?"#FFF4EC":"white",color:draft.trust.logo.shape===s.v?"var(--sf)":"var(--tm2)",fontWeight:700,cursor:"pointer",fontSize:".75rem",fontFamily:"inherit",transition:"all .2s"}}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Background */}
            <div className="cf" style={{gridColumn:mob?"auto":"1/-1"}}>
              <label className="cl">Background Color</label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {[
                  {v:"gradient", label:"Saffron Gradient", bg:"linear-gradient(135deg,#E8650A,#C8860A)", tc:"white"},
                  {v:"white",    label:"White",            bg:"white",                                    tc:"var(--sf)", bd:"1px solid var(--bd)"},
                  {v:"transparent",label:"Transparent",   bg:"transparent",                              tc:"var(--dt)", bd:"2px dashed #ccc"},
                ].map(b=>(
                  <button key={b.v} onClick={()=>upd("trust.logo.bgColor",b.v)}
                    style={{padding:"8px 16px",borderRadius:8,background:b.bg,color:b.tc,border:b.bd||(draft.trust.logo.bgColor===b.v?"3px solid var(--sf)":"2px solid transparent"),fontWeight:700,cursor:"pointer",fontSize:".78rem",fontFamily:"inherit",boxShadow:draft.trust.logo.bgColor===b.v?"0 0 0 2px var(--sf)":"none",transition:"all .2s"}}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Image URL warning */}
          {draft.trust.logo.type === "image" && (
            <div style={{marginTop:8,padding:"10px 14px",background:"#FEF9EC",borderRadius:8,border:"1px solid #F5E8B8",fontSize:".78rem",color:"#6B5900"}}>
              Paste a direct image link (ending in .png, .jpg, .svg). If the image fails to load, the text fallback will show automatically.
              {draft.trust.logo.url && (
                <div style={{marginTop:8}}>
                  <img src={draft.trust.logo.url} alt="preview" style={{height:48,borderRadius:8,border:"1px solid var(--bd)",objectFit:"contain",background:"white",padding:4}}
                    onError={e=>e.target.style.opacity=0.2}/>
                </div>
              )}
            </div>
          )}
        </div>
        {/* ── END LOGO MANAGER ─────────────────────────────────────── */}
        <G2>
          <F label="Trust Name (English)" path="trust.name"/>
          <F label="Trust Name (Gujarati)" path="trust.nameGu"/>
          <F label="Phone Number" path="trust.phone"/>
          <F label="Email Address" path="trust.email"/>
          <F label="Office Hours" path="trust.hours"/>
          <F label="Established Year" path="trust.estd"/>
          <F label="PAN Number" path="trust.panNo"/>
          <F label="80G Certificate No." path="trust.reg80G"/>
          <F label="CIN Number" path="trust.cin"/>
        </G2>
        <F label="Full Office Address" path="trust.address" ta/>
      </Sec>

      <Sec id="hero" icon="🌟" label="Hero Section">
        <G2>
          <F label="Hero Title" path="hero.title" ta hint="English"/>
          <F label="Hero Title" path="hero.titleGu" ta hint="Gujarati"/>
          <F label="Subtitle" path="hero.subtitle" ta hint="English"/>
          <F label="Subtitle" path="hero.subtitleGu" ta hint="Gujarati"/>
          <F label="Primary Button" path="hero.cta1" hint="English"/>
          <F label="Primary Button" path="hero.cta1Gu" hint="Gujarati"/>
          <F label="Secondary Button" path="hero.cta2" hint="English"/>
          <F label="Secondary Button" path="hero.cta2Gu" hint="Gujarati"/>
          <F label="Badge Text" path="hero.badge"/>
          <F label="Trust Badge 1" path="hero.badge1"/>
          <F label="Trust Badge 2" path="hero.badge2"/>
          <F label="Trust Badge 3" path="hero.badge3"/>
        </G2>
      </Sec>

      <Sec id="stats" icon="📊" label="Impact Statistics"
        onAdd={()=>addItem("stats",{num:"0+",label:"New Stat",labelGu:"નવી સ્ટેટ"})} addLabel="Add Stat">
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:14}}>
          {draft.stats.map((s,i)=>(
            <div key={i} style={{background:"var(--tl)",borderRadius:10,padding:"14px 16px",border:"1px solid #B8D8E8"}}>
              <RowBar arrPath="stats" idx={i} total={draft.stats.length} label="Stat"/>
              <F label="Number / Value" path={`stats.${i}.num`}/>
              <F label="Label" path={`stats.${i}.label`} hint="English"/>
              <F label="Label" path={`stats.${i}.labelGu`} hint="Gujarati"/>
            </div>
          ))}
        </div>
      </Sec>

      <Sec id="about" icon="ℹ️" label="About Section">
        <G2>
          <F label="Section Heading" path="about.heading" hint="English"/>
          <F label="Section Heading" path="about.headingGu" hint="Gujarati"/>
          <F label="Paragraph 1" path="about.body1" ta hint="English"/>
          <F label="Paragraph 1" path="about.body1Gu" ta hint="Gujarati"/>
          <F label="Paragraph 2" path="about.body2" ta hint="English"/>
          <F label="Paragraph 2" path="about.body2Gu" ta hint="Gujarati"/>
        </G2>
        <F label="Years Label" path="about.yearsLabel"/>
        <F label="CTA Button Text" path="about.cta"/>
        <div className="cf">
          <label className="cl">Key Bullet Points</label>
          {draft.about.points.map((pt,i)=>(
            <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              <BlurInput className="ci" style={{flex:1,marginBottom:0}} value={pt} onCommit={v=>upd(`about.points.${i}`,v)}/>
              <button onClick={()=>moveItem("about.points",i,-1)} disabled={i===0}
                style={{padding:"8px 10px",borderRadius:6,border:"1px solid var(--bd)",background:i===0?"#f5f5f5":"white",cursor:i===0?"not-allowed":"pointer",fontSize:".8rem",color:i===0?"#ccc":"var(--dt)",flexShrink:0}}>↑</button>
              <button onClick={()=>moveItem("about.points",i,1)} disabled={i===draft.about.points.length-1}
                style={{padding:"8px 10px",borderRadius:6,border:"1px solid var(--bd)",background:i===draft.about.points.length-1?"#f5f5f5":"white",cursor:i===draft.about.points.length-1?"not-allowed":"pointer",fontSize:".8rem",color:i===draft.about.points.length-1?"#ccc":"var(--dt)",flexShrink:0}}>↓</button>
              <button onClick={()=>delItem("about.points",i)}
                style={{padding:"8px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".8rem",color:"#C0392B",flexShrink:0,fontWeight:700}}>Del</button>
            </div>
          ))}
          <AddBtn label="Bullet Point" onClick={()=>addItem("about.points","New point")}/>
        </div>
      </Sec>

      <Sec id="programs" icon="📋" label="Programs"
        onAdd={()=>addItem("programs",{icon:"📌",title:"New Program",sub:"Description here",color:"#FFF4EC",border:"#FDDBB8"})} addLabel="Add Program">
        {draft.programs.map((p,i)=>(
          <div key={i} style={{border:"1px solid var(--bd)",borderRadius:12,padding:"16px",marginBottom:14,background:"#FAFAFA"}}>
            <RowBar arrPath="programs" idx={i} total={draft.programs.length} label="Program"/>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <div style={{width:40,height:40,borderRadius:10,background:p.color,border:`1px solid ${p.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem",flexShrink:0}}>{p.icon}</div>
              <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,color:"var(--dt)",fontSize:".9rem"}}>{p.title||`Program ${i+1}`}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
              <div className="cf">
                <label className="cl">Icon Emoji</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {EMOJIS.map(em=><div key={em} onClick={()=>upd(`programs.${i}.icon`,em)} style={{width:36,height:36,borderRadius:8,border:`2px solid ${p.icon===em?"var(--sf)":"var(--bd)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.2rem",cursor:"pointer",background:p.icon===em?"#FFF4EC":"white",transition:"all .2s"}}>{em}</div>)}
                </div>
              </div>
              <div className="cf">
                <label className="cl">Card Color</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {COLORS.map(c=><div key={c.c} onClick={()=>{upd(`programs.${i}.color`,c.c);upd(`programs.${i}.border`,c.b);}} style={{width:32,height:32,borderRadius:8,background:c.c,border:`3px solid ${p.color===c.c?"var(--sf)":"var(--bd)"}`,cursor:"pointer",transition:"all .2s"}}/>)}
                </div>
              </div>
              <F label="Program Title" path={`programs.${i}.title`}/>
              <F label="Short Description" path={`programs.${i}.sub`}/>
            </div>
          </div>
        ))}
      </Sec>

      <Sec id="events" icon="📅" label="Events"
        onAdd={()=>addItem("events",{date:"Jan 01",month:"2025",title:"New Event",location:"Location",tag:"Health",color:"#E8F4F8"})} addLabel="Add Event">
        {draft.events.map((ev,i)=>(
          <div key={i} style={{border:"1px solid var(--bd)",borderRadius:12,padding:"16px",marginBottom:14,background:"#FAFAFA"}}>
            <RowBar arrPath="events" idx={i} total={draft.events.length} label="Event"/>
            <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
              <F label="Event Title" path={`events.${i}.title`}/>
              <F label="Location" path={`events.${i}.location`}/>
              <F label="Date (e.g. Jun 15)" path={`events.${i}.date`}/>
              <F label="Year" path={`events.${i}.month`}/>
              <div className="cf">
                <label className="cl">Category</label>
                <select className="ci" value={ev.tag} onChange={e=>upd(`events.${i}.tag`,e.target.value)}>
                  {["Health","Education","Environment","Empowerment","Relief","Community"].map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>
        ))}
      </Sec>

      <Sec id="donate" icon="❤️" label="Donation Section">
        <F label="Section Heading" path="donate.heading"/>
        <F label="Subtext" path="donate.subtext" ta/>
        <F label="Security Note" path="donate.note"/>
        <F label="Recurring Toggle Label" path="donate.recurringLabel"/>
        <F label="Recurring Note" path="donate.recurringNote"/>
      </Sec>

      <Sec id="contact" icon="📞" label="Contact and Volunteer">
        <F label="Volunteer Heading" path="contact.volunteerHeading"/>
        <F label="Volunteer Sub-text" path="contact.volunteerSub" ta/>
        <F label="Contact Heading" path="contact.contactHeading"/>
        <div className="cf">
          <label className="cl">Social Links</label>
          {draft.contact.socials.map((s,i)=>(
            <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              <BlurInput className="ci" style={{flex:1,marginBottom:0}} value={s} onCommit={v=>upd(`contact.socials.${i}`,v)}/>
              <button onClick={()=>delItem("contact.socials",i)}
                style={{padding:"8px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".8rem",color:"#C0392B",flexShrink:0,fontWeight:700}}>Del</button>
            </div>
          ))}
          <AddBtn label="Social Link" onClick={()=>addItem("contact.socials","New Link")}/>
        </div>
      </Sec>

      <div style={{position:"sticky",bottom:16,background:"white",border:"1px solid var(--bd)",borderRadius:16,padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 8px 32px rgba(0,0,0,.1)",marginTop:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:".82rem",color:"var(--mu)"}}>
          {auth?.idToken ? <span style={{color:"#1A7A3E",fontWeight:600}}>Firebase connected — saves go live instantly.</span> : <span style={{color:"#C0392B"}}>Not logged in — changes are local only.</span>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setPage("public")} style={{padding:"9px 16px",borderRadius:8,background:"var(--tl)",border:"none",cursor:"pointer",fontWeight:600,fontSize:".82rem",color:"var(--dt)"}}>Preview</button>
          <button className="bs" onClick={save} disabled={toast==="saving"} style={{padding:"9px 22px",borderRadius:8,fontWeight:700,fontSize:".9rem",opacity:toast==="saving"?.7:1}}>
            {toast==="saving" ? "Saving..." : "Save to Firebase"}
          </button>
        </div>
      </div>
      {toast && toast !== "saving" && (
        <div className="toast" style={{
          background: toast==="saved"?"#1A7A3E": toast==="error"?"#C0392B": toast==="warn"?"#C8860A":"#1A7A3E"
        }}>
          {toast==="saved"  && "✅ " + toastMsg}
          {toast==="error"  && "❌ " + toastMsg}
          {toast==="warn"   && "⚠️ " + toastMsg}
        </div>
      )}
    </div>
  );
}


// ── ADMIN DASHBOARD ───────────────────────────────────────────────────────────
const ANAV = [
  {id:"content",icon:"✏️",label:"Content Editor"},
  {id:"overview",icon:"📊",label:"Overview"},
  {id:"donations",icon:"💰",label:"Donations"},
  {id:"events",icon:"📅",label:"Events"},
  {id:"volunteers",icon:"🤝",label:"Volunteers"},
  {id:"gallery",icon:"🖼️",label:"Gallery"},
  {id:"settings",icon:"⚙️",label:"Settings"},
];

function Admin({ C, setC, setPage, auth, onLogout, onShowLogin }) {
  const [tab, setTab] = useState("content");
  const [open, setOpen] = useState(true);
  const w = useW(); const mob = w<768;
  useEffect(()=>{ if(mob) setOpen(false); else setOpen(true); },[mob]);
  const sw = open?(mob?240:220):56;

  return (
    <div style={{display:"flex",minHeight:"100vh",background:"#F0F4F7"}}>
      {mob && open && <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:199}}/>}
      <div className="as" style={{width:sw,transition:"width .3s",position:"fixed",top:0,left:0,bottom:0,zIndex:200,overflowX:"hidden",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"16px 12px",borderBottom:"1px solid rgba(255,255,255,.1)",display:"flex",alignItems:"center",gap:10,justifyContent:open?"flex-start":"center"}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem",flexShrink:0}}>Om</div>
          {open && <div style={{fontFamily:"'Playfair Display',serif",color:"white",fontWeight:700,fontSize:".82rem",whiteSpace:"nowrap"}}>Trust Admin</div>}
        </div>
        <div style={{flex:1,padding:"10px 6px",overflowY:"auto"}}>
          {ANAV.map(item=>(
            <div key={item.id} onClick={()=>{setTab(item.id);if(mob)setOpen(false);}}
              style={{display:"flex",alignItems:"center",gap:10,padding:"10px 10px",borderRadius:10,cursor:"pointer",marginBottom:3,background:tab===item.id?"rgba(232,101,10,.25)":"transparent",borderLeft:tab===item.id?"3px solid var(--sf)":"3px solid transparent",transition:"all .2s",justifyContent:open?"flex-start":"center"}}
              onMouseEnter={e=>{if(tab!==item.id)e.currentTarget.style.background="rgba(255,255,255,.07)"}}
              onMouseLeave={e=>{if(tab!==item.id)e.currentTarget.style.background="transparent"}}>
              <span style={{fontSize:"1.05rem",flexShrink:0}}>{item.icon}</span>
              {open && <span style={{color:tab===item.id?"var(--sflt)":"rgba(255,255,255,.8)",fontSize:".85rem",fontWeight:tab===item.id?600:400,whiteSpace:"nowrap"}}>{item.label}</span>}
              {open && item.id==="content" && <span style={{marginLeft:"auto",background:"var(--sf)",color:"white",fontSize:".6rem",fontWeight:700,padding:"2px 6px",borderRadius:8}}>NEW</span>}
            </div>
          ))}
        </div>
        <div style={{padding:"10px 6px",borderTop:"1px solid rgba(255,255,255,.1)"}}>
          <div onClick={()=>setPage("public")} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",cursor:"pointer",color:"rgba(255,255,255,.6)",borderRadius:10,justifyContent:open?"flex-start":"center"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.07)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span>🌐</span>{open&&<span style={{fontSize:".8rem",whiteSpace:"nowrap"}}>View Website</span>}
          </div>

          {/* Login / Logout in sidebar */}
          {auth?.email ? (
            <div onClick={onLogout} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",cursor:"pointer",borderRadius:10,justifyContent:open?"flex-start":"center",background:"rgba(192,57,43,.15)"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(192,57,43,.25)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(192,57,43,.15)"}>
              <span style={{fontSize:"1rem",flexShrink:0}}>🚪</span>
              {open && <div style={{minWidth:0}}>
                <div style={{fontSize:".75rem",color:"rgba(255,255,255,.8)",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{auth.email}</div>
                <div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)"}}>Tap to logout</div>
              </div>}
            </div>
          ) : (
            <div onClick={onShowLogin} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",cursor:"pointer",borderRadius:10,justifyContent:open?"flex-start":"center",background:"rgba(232,101,10,.2)"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(232,101,10,.35)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(232,101,10,.2)"}>
              <span style={{fontSize:"1rem",flexShrink:0}}>🔑</span>
              {open && <div>
                <div style={{fontSize:".78rem",color:"var(--sflt)",fontWeight:700,whiteSpace:"nowrap"}}>Login to Firebase</div>
                <div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)"}}>Save content online</div>
              </div>}
            </div>
          )}

          <div onClick={()=>setOpen(!open)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",cursor:"pointer",color:"rgba(255,255,255,.45)",borderRadius:10,justifyContent:open?"flex-start":"center"}}>
            <span style={{fontSize:".85rem"}}>{open?"◀":"▶"}</span>{open&&<span style={{fontSize:".78rem"}}>Collapse</span>}
          </div>
        </div>
      </div>

      <div style={{marginLeft:sw,flex:1,transition:"margin-left .3s",minHeight:"100vh",minWidth:0}}>
        <div style={{background:"white",borderBottom:"1px solid var(--bd)",padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:100,gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {mob && <button onClick={()=>setOpen(true)} style={{background:"none",border:"1px solid var(--bd)",borderRadius:8,width:34,height:34,cursor:"pointer",fontSize:"1rem"}}>☰</button>}
            <div>
              <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.15rem",color:"var(--dt)",fontWeight:700}}>{ANAV.find(n=>n.id===tab)?.icon} {ANAV.find(n=>n.id===tab)?.label}</h1>
              {!mob && <p style={{fontSize:".72rem",color:"var(--mu)",marginTop:2}}>Vidya Gohil Charitable Trust</p>}
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {!mob && <input placeholder="Search..." style={{padding:"7px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".8rem",width:170,fontFamily:"inherit"}}/>}

            {auth?.email ? (
              <>
                {!mob && <span style={{fontSize:".75rem",color:"var(--mu)",maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{auth.email}</span>}
                <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:700,fontSize:".85rem"}} title={auth.email}>
                  {auth.email[0].toUpperCase()}
                </div>
                <button onClick={onLogout} style={{padding:"6px 12px",borderRadius:8,background:"#FEF0EF",border:"1px solid #F5B8B8",color:"#C0392B",fontWeight:600,fontSize:".75rem",cursor:"pointer",whiteSpace:"nowrap"}}>
                  {mob ? "Out" : "Logout"}
                </button>
              </>
            ) : (
              <>
                <button onClick={onShowLogin} style={{padding:"7px 14px",borderRadius:8,background:"linear-gradient(135deg,var(--sf),var(--gd))",border:"none",color:"white",fontWeight:700,fontSize:mob?".75rem":".78rem",cursor:"pointer",whiteSpace:"nowrap",boxShadow:"0 2px 8px rgba(232,101,10,.3)"}}>
                  {mob ? "🔑 Login" : "🔑 Login to Firebase"}
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{padding:mob?"16px":"24px"}}>
          {tab==="content"   && <ContentEditor C={C} setC={setC} setPage={setPage} auth={auth}/>}
          {tab==="overview"  && <Overview mob={mob} C={C}/>}
          {tab==="donations" && <Donations mob={mob}/>}
          {tab==="events"    && <AdminEvents mob={mob} C={C} setC={setC} auth={auth}/>}
          {tab==="volunteers"&& <Volunteers mob={mob}/>}
          {tab==="gallery"   && <AdminGallery mob={mob} C={C} setC={setC} auth={auth}/>}
          {tab==="settings"  && <Settings mob={mob} C={C}/>}
        </div>
      </div>
    </div>
  );
}

function Overview({ mob, C }) {
  const cards=[{l:"Total Donations",v:"Rs.14,23,500",ch:"+18%",up:true,ic:"💰",bg:"#FFF4EC",br:"#FDDBB8"},{l:"Active Volunteers",v:"347",ch:"+3",up:true,ic:"🤝",bg:"#E8F4F8",br:"#B8D8E8"},{l:"Upcoming Events",v:"4",ch:"",up:true,ic:"📅",bg:"#EDFAF1",br:"#B8E8CC"},{l:"Pending Receipts",v:"12",ch:"⚠️",up:false,ic:"📄",bg:"#FEF9EC",br:"#F5E8B8"}];
  const mn=[42,67,89,120,95,142]; const ms=["Jan","Feb","Mar","Apr","May","Jun"]; const mx=142;
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":"repeat(4,1fr)",gap:14,marginBottom:20}}>
        {cards.map((s,i)=>(
          <div key={i} className="ac" style={{padding:mob?"16px":"20px",background:s.bg,border:`1px solid ${s.br}`}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
              <span style={{fontSize:"1.4rem"}}>{s.ic}</span>
              {s.ch&&<span style={{fontSize:".72rem",fontWeight:700,color:s.up?"#1A7A3E":"#C0392B",background:s.up?"#EDFAF1":"#FEF0EF",padding:"2px 7px",borderRadius:12}}>{s.ch}</span>}
            </div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.3rem":"1.5rem",fontWeight:700,color:"var(--dt)",marginBottom:3}}>{s.v}</div>
            <div style={{fontSize:".72rem",color:"var(--mu)",fontWeight:600}}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"2fr 1fr",gap:16,marginBottom:16}}>
        <div className="ac" style={{padding:mob?"16px":"22px"}}>
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1rem",color:"var(--dt)",marginBottom:18,fontWeight:700}}>Monthly Donations</h3>
          <div style={{display:"flex",alignItems:"flex-end",gap:mob?8:12,height:150}}>
            {mn.map((v,i)=>(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                <div style={{fontSize:".6rem",color:"var(--mu)"}}>Rs.{v}k</div>
                <div style={{width:"100%",background:i===mn.length-1?"linear-gradient(to top,var(--sf),var(--gd))":"linear-gradient(to top,var(--dt),var(--tm))",borderRadius:"5px 5px 0 0",height:`${(v/mx)*120}px`}}/>
                <div style={{fontSize:".65rem",color:"var(--mu)"}}>{ms[i]}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="ac" style={{padding:mob?"16px":"22px"}}>
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1rem",color:"var(--dt)",marginBottom:18,fontWeight:700}}>By Program</h3>
          {[{p:"Education",v:38,c:"var(--sf)"},{p:"Healthcare",v:24,c:"var(--dt)"},{p:"Women",v:18,c:"#7B2D8B"},{p:"Environment",v:12,c:"#1A7A3E"},{p:"General",v:8,c:"var(--gd)"}].map(r=>(
            <div key={r.p} style={{marginBottom:11}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:".78rem"}}>{r.p}</span><span style={{fontSize:".78rem",fontWeight:700}}>{r.v}%</span></div>
              <div style={{height:7,borderRadius:4,background:"#EEE"}}><div style={{height:"100%",width:`${r.v}%`,background:r.c,borderRadius:4}}/></div>
            </div>
          ))}
        </div>
      </div>
      <div className="ac" style={{padding:mob?"16px":"22px"}}>
        <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1rem",color:"var(--dt)",marginBottom:14,fontWeight:700}}>Recent Donations</h3>
        <div style={{overflowX:"auto"}}>
          <table className="tt" style={{width:"100%",borderCollapse:"collapse",fontSize:".8rem",minWidth:500}}>
            <thead><tr>{["ID","Donor","Amount","Program","Date","Status"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
            <tbody>{DDATA.slice(0,4).map((r,i)=>(
              <tr key={i} style={{borderBottom:"1px solid var(--bd)"}}>
                <td style={{padding:"10px 12px",color:"var(--mu)",fontFamily:"monospace",fontSize:".75rem"}}>{r.id}</td>
                <td style={{padding:"10px 12px",fontWeight:600}}>{r.name}</td>
                <td style={{padding:"10px 12px",fontWeight:700,color:"var(--sf)"}}>Rs.{r.amount.toLocaleString()}</td>
                <td style={{padding:"10px 12px"}}><span style={{fontSize:".72rem",padding:"3px 9px",borderRadius:12,background:"var(--tl)",color:"var(--dt)",fontWeight:600}}>{r.program}</span></td>
                <td style={{padding:"10px 12px",color:"var(--mu)",fontSize:".78rem"}}>{r.date}</td>
                <td style={{padding:"10px 12px"}}><span style={{fontSize:".72rem",padding:"3px 9px",borderRadius:12,fontWeight:600,background:r.status==="Verified"?"#EDFAF1":"#FEF9EC",color:r.status==="Verified"?"#1A7A3E":"#C8860A"}}>{r.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Donations({ mob }) {
  const [q,setQ]=useState(""); const [f,setF]=useState("All");
  const rows=DDATA.filter(d=>(f==="All"||d.status===f)&&(d.name.toLowerCase().includes(q.toLowerCase())||d.id.includes(q)));
  return (
    <div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search..." style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit",flex:1,minWidth:140}}/>
        <div style={{display:"flex",gap:6}}>{["All","Verified","Pending"].map(v=><button key={v} onClick={()=>setF(v)} style={{padding:"8px 14px",borderRadius:8,background:f===v?"var(--dt)":"white",color:f===v?"white":"var(--tm2)",border:`1px solid ${f===v?"var(--dt)":"var(--bd)"}`,cursor:"pointer",fontWeight:600,fontSize:".8rem"}}>{v}</button>)}</div>
        <button className="bs" style={{padding:"8px 14px",borderRadius:8,fontWeight:600,fontSize:".8rem"}}>+ Add</button>
      </div>
      <div className="ac" style={{padding:16,overflowX:"auto"}}>
        <table className="tt" style={{width:"100%",borderCollapse:"collapse",fontSize:".8rem",minWidth:500}}>
          <thead><tr>{["ID","Donor","Amount","Program","Date","Status","Receipt"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r,i)=>(
            <tr key={i} style={{borderBottom:"1px solid var(--bd)"}}>
              <td style={{padding:"10px 12px",color:"var(--mu)",fontFamily:"monospace",fontSize:".75rem"}}>{r.id}</td>
              <td style={{padding:"10px 12px",fontWeight:600}}>{r.name}</td>
              <td style={{padding:"10px 12px",fontWeight:700,color:"var(--sf)"}}>Rs.{r.amount.toLocaleString()}</td>
              <td style={{padding:"10px 12px"}}><span style={{fontSize:".72rem",padding:"3px 9px",borderRadius:12,background:"var(--tl)",color:"var(--dt)",fontWeight:600}}>{r.program}</span></td>
              <td style={{padding:"10px 12px",color:"var(--mu)",fontSize:".78rem"}}>{r.date}</td>
              <td style={{padding:"10px 12px"}}><span style={{fontSize:".72rem",padding:"3px 9px",borderRadius:12,fontWeight:600,background:r.status==="Verified"?"#EDFAF1":"#FEF9EC",color:r.status==="Verified"?"#1A7A3E":"#C8860A"}}>{r.status}</span></td>
              <td style={{padding:"10px 12px"}}>{r.receipt?<button style={{padding:"4px 9px",borderRadius:6,background:"var(--tl)",border:"none",color:"var(--dt)",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>PDF</button>:<button style={{padding:"4px 9px",borderRadius:6,background:"#FFF4EC",border:"none",color:"var(--sf)",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>Generate</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {rows.length===0&&<div style={{textAlign:"center",padding:28,color:"var(--mu)"}}>No results found.</div>}
      </div>
    </div>
  );
}

function AdminForms({ C, setC, saveToFb, mob }) {
  const [forms, setForms] = useState(C.forms || []);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => setForms(C.forms || []), [C.forms]);

  const upd = (newForms) => {
    setForms(newForms);
    const newC = {...C, forms: newForms};
    setC(newC);
    saveToFb(newC);
  };

  const createForm = () => {
    const newForm = { id: "form_"+Date.now(), name: "New Form", fields: [] };
    upd([...forms, newForm]);
    setEditingId(newForm.id);
  };
  
  const updateForm = (id, newForm) => {
    upd(forms.map(f => f.id === id ? newForm : f));
  };

  const removeForm = (id) => {
    if (!window.confirm("Delete this form template?")) return;
    upd(forms.filter(f => f.id !== id));
  };

  return (
    <div style={{marginBottom: 30}}>
       <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
         <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.1rem",color:"var(--dt)",fontWeight:700}}>Registration Form Templates</h3>
         <button onClick={createForm} className="bs" style={{padding:"6px 12px",borderRadius:6,fontSize:".8rem",fontWeight:600}}>+ New Form</button>
       </div>
       {forms.length === 0 && <div style={{color:"var(--mu)",fontSize:".85rem",fontStyle:"italic"}}>No form templates created yet.</div>}
       <div style={{display:"flex",flexDirection:"column",gap:10}}>
         {forms.map(f => (
           <div key={f.id} className="ac" style={{padding: 14}}>
             {editingId === f.id ? (
               <div>
                 <input value={f.name} onChange={e=>updateForm(f.id, {...f, name: e.target.value})} style={{padding:"6px",border:"1px solid var(--bd)",borderRadius:6,marginBottom:10,fontWeight:600}} placeholder="Form Name"/>
                 <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
                   {f.fields.map((field, idx) => (
                     <div key={idx} style={{display:"flex",gap:8,alignItems:"center"}}>
                       <input value={field.label} onChange={e=>{
                         const newF = [...f.fields]; newF[idx].label = e.target.value; updateForm(f.id, {...f, fields:newF});
                       }} style={{padding:"4px 8px",border:"1px solid var(--bd)",borderRadius:4,flex:1}} placeholder="Field Name (e.g. Blood Group)"/>
                       <select value={field.type} onChange={e=>{
                         const newF = [...f.fields]; newF[idx].type = e.target.value; updateForm(f.id, {...f, fields:newF});
                       }} style={{padding:"4px",border:"1px solid var(--bd)",borderRadius:4}}>
                         <option value="text">Text</option>
                         <option value="number">Number</option>
                         <option value="email">Email</option>
                         <option value="tel">Phone</option>
                         <option value="date">Date</option>
                         <option value="fullname">Full Name (First, Middle, Last)</option>
                         <option value="address">Address (Textarea)</option>
                         <option value="gender">Gender (M/F)</option>
                       </select>
                       <label style={{fontSize:".75rem",display:"flex",alignItems:"center",gap:4}}><input type="checkbox" checked={field.required} onChange={e=>{
                         const newF = [...f.fields]; newF[idx].required = e.target.checked; updateForm(f.id, {...f, fields:newF});
                       }}/> Req</label>
                       <button onClick={()=>{
                         const newF = [...f.fields]; newF.splice(idx, 1); updateForm(f.id, {...f, fields:newF});
                       }} style={{background:"none",border:"none",color:"#C0392B",cursor:"pointer",fontSize:"1rem"}}>×</button>
                     </div>
                   ))}
                 </div>
                 <div style={{display:"flex",gap:8}}>
                   <button onClick={()=>{
                     updateForm(f.id, {...f, fields: [...f.fields, {label:"", type:"text", required:false}]});
                   }} style={{padding:"4px 10px",background:"var(--ww)",border:"1px dashed var(--bd)",borderRadius:6,cursor:"pointer",fontSize:".75rem"}}>+ Add Field</button>
                   <div style={{flex:1}}/>
                   <button onClick={()=>setEditingId(null)} className="bt" style={{padding:"4px 12px",borderRadius:6,fontWeight:600,fontSize:".75rem"}}>Done</button>
                 </div>
               </div>
             ) : (
               <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                 <div>
                   <div style={{fontWeight:600,fontSize:".9rem",color:"var(--dt)"}}>{f.name}</div>
                   <div style={{fontSize:".75rem",color:"var(--mu)"}}>{f.fields.length} fields</div>
                 </div>
                 <div style={{display:"flex",gap:6}}>
                   <button onClick={()=>setEditingId(f.id)} style={{padding:"4px 10px",background:"var(--tl)",border:"none",borderRadius:6,color:"var(--dt)",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>Edit</button>
                   <button onClick={()=>removeForm(f.id)} style={{padding:"4px 10px",background:"#FEF0EF",border:"none",borderRadius:6,color:"#C0392B",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>Delete</button>
                 </div>
               </div>
             )}
           </div>
         ))}
       </div>
       <hr style={{margin:"30px 0",border:"none",borderTop:"1px dashed var(--bd)"}}/>
    </div>
  );
}

function AdminEvents({ mob, C, setC, auth }) {
  const [items, setItems] = useState(C.events || []);
  const [saving, setSaving] = useState(false);
  const [editIdx, setEditIdx] = useState(null);

  useEffect(() => setItems(C.events || []), [C.events]);

  const saveToFb = async (newC) => {
    if (!auth?.idToken) { alert("Login required to save"); return; }
    setSaving(true);
    try {
      await fbSave(newC, auth.idToken);
    } catch(e) {
      alert("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const upd = (newItems) => {
    setItems(newItems);
    const newC = {...C, events: newItems};
    setC(newC);
    saveToFb(newC);
  };

  const addEvent = () => {
    const newItem = {
      title: "New Event",
      date: "Jun 15",
      month: "2025",
      location: "Event Location",
      tag: "General",
      color: "#E8F4F8",
      formId: ""
    };
    const newArr = [newItem, ...items];
    setItems(newArr);
    setEditIdx(0);
  };

  const remove = (idx) => {
    if (!window.confirm("Delete this event?")) return;
    const newArr = [...items];
    newArr.splice(idx, 1);
    upd(newArr);
    if (editIdx === idx) setEditIdx(null);
  };

  const updateItem = (idx, field, val) => {
    const newArr = [...items];
    newArr[idx] = { ...newArr[idx], [field]: val };
    setItems(newArr);
  };

  const saveEdit = () => {
    upd(items);
    setEditIdx(null);
  };

  const existingTags = [...new Set(items.map(e=>e.tag).filter(Boolean))];

  return (
    <div>
      <AdminForms C={C} setC={setC} saveToFb={saveToFb} mob={mob} />
      <datalist id="event-tags-list">
        {existingTags.map(t => <option key={t} value={t}/>)}
      </datalist>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.1rem",color:"var(--dt)",fontWeight:700}}>Events</h3>
        <button onClick={addEvent} className="bs" style={{padding:"9px 16px",borderRadius:8,fontWeight:600,fontSize:".85rem",opacity:saving?0.5:1}} disabled={saving}>
          {saving ? "Saving..." : "➕ Create Event"}
        </button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:14}}>
        {items.map((ev,i)=>(
          <div key={i} className="ac" style={{padding:18,borderLeft:editIdx===i?"4px solid var(--sf)":"none"}}>
            {editIdx === i ? (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600}}>Title</label>
                  <input type="text" value={ev.title} onChange={e=>updateItem(i,"title",e.target.value)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit"}}/>
                </div>
                <div>
                  <label style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600}}>Date (e.g. Jun 15)</label>
                  <input type="text" value={ev.date} onChange={e=>updateItem(i,"date",e.target.value)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit"}}/>
                </div>
                <div>
                  <label style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600}}>Year</label>
                  <input type="text" value={ev.month} onChange={e=>updateItem(i,"month",e.target.value)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit"}}/>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600}}>Location</label>
                  <input type="text" value={ev.location} onChange={e=>updateItem(i,"location",e.target.value)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit"}}/>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600}}>Category / Tag</label>
                  <input type="text" list="event-tags-list" value={ev.tag} onChange={e=>updateItem(i,"tag",e.target.value)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit"}}/>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600}}>Registration Form</label>
                  <select value={ev.formId || ""} onChange={e=>updateItem(i,"formId",e.target.value)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit"}}>
                    <option value="">-- No Form (Disabled) --</option>
                    {(C.forms||[]).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div style={{gridColumn:"1/-1",display:"flex",justifyContent:"flex-end",gap:7,marginTop:8}}>
                  <button onClick={saveEdit} className="bt" style={{padding:"6px 14px",borderRadius:6,fontWeight:600,fontSize:".75rem"}}>Save Changes</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div style={{flex:1,paddingRight:10}}>
                    <span style={{fontSize:".7rem",fontWeight:700,color:"var(--sf)",textTransform:"uppercase"}}>{ev.tag}</span>
                    <h4 style={{fontFamily:"'Playfair Display',serif",fontSize:".95rem",fontWeight:700,color:"var(--dt)",marginTop:3}}>{ev.title}</h4>
                  </div>
                  <div style={{background:"linear-gradient(135deg,var(--dt),var(--tm))",color:"white",borderRadius:10,padding:"7px 10px",textAlign:"center",flexShrink:0}}>
                    <div style={{fontSize:"1.1rem",fontWeight:700}}>{ev.date?.split(" ")[0]}</div>
                    <div style={{fontSize:".62rem",opacity:.8}}>{ev.date?.split(" ")[1]}</div>
                  </div>
                </div>
                <p style={{fontSize:".78rem",color:"var(--mu)",marginBottom:12}}>{ev.location}</p>
                <div style={{display:"flex",gap:7}}>
                  <button onClick={()=>setEditIdx(i)} style={{padding:"5px 11px",borderRadius:6,background:"var(--tl)",border:"none",color:"var(--dt)",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>Edit</button>
                  <button onClick={()=>remove(i)} style={{padding:"5px 11px",borderRadius:6,background:"#FEF0EF",border:"none",color:"#C0392B",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Volunteers({ mob }) {
  return (
    <div>
      <div style={{display:"flex",gap:10,marginBottom:16}}>
        <input placeholder="Search volunteers..." style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit",flex:1}}/>
        <button className="bs" style={{padding:"8px 14px",borderRadius:8,fontWeight:600,fontSize:".8rem"}}>+ Add</button>
      </div>
      <div className="ac" style={{padding:16,overflowX:"auto"}}>
        <table className="tt" style={{width:"100%",borderCollapse:"collapse",fontSize:".8rem",minWidth:460}}>
          <thead><tr>{["Name","Role","Joined","Events","Status","Actions"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
          <tbody>{VOLS.map((v,i)=>(
            <tr key={i} style={{borderBottom:"1px solid var(--bd)"}}>
              <td style={{padding:"11px 12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:9}}>
                  <div style={{width:30,height:30,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:700,fontSize:".78rem"}}>{v.name[0]}</div>
                  <span style={{fontWeight:600}}>{v.name}</span>
                </div>
              </td>
              <td style={{padding:"11px 12px",color:"var(--tm2)",fontSize:".8rem"}}>{v.role}</td>
              <td style={{padding:"11px 12px",color:"var(--mu)",fontSize:".78rem"}}>{v.joined}</td>
              <td style={{padding:"11px 12px",fontWeight:700,color:"var(--dt)"}}>{v.events}</td>
              <td style={{padding:"11px 12px"}}><span style={{fontSize:".72rem",padding:"3px 9px",borderRadius:12,fontWeight:600,background:v.status==="Active"?"#EDFAF1":"#F5F5F5",color:v.status==="Active"?"#1A7A3E":"var(--mu)"}}>{v.status}</span></td>
              <td style={{padding:"11px 12px"}}>
                <div style={{display:"flex",gap:5}}>
                  <button style={{padding:"4px 9px",borderRadius:6,background:"var(--tl)",border:"none",color:"var(--dt)",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>View</button>
                  <button style={{padding:"4px 9px",borderRadius:6,background:"#FFF4EC",border:"none",color:"var(--sf)",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>Edit</button>
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function AdminGallery({ mob, C, setC, auth }) {
  const [loading, setLoading] = useState(false);
  const items = C.galleryItems || [];

  const saveToFb = async (newC) => {
    if (!auth?.idToken) { alert("Login required to save"); return; }
    try {
      await fbSave(newC, auth.idToken);
    } catch(e) {
      alert("Save failed: " + e.message);
    }
  };

  const upd = (newItems) => {
    const newC = {...C, galleryItems: newItems};
    setC(newC);
    saveToFb(newC);
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!auth?.idToken) { alert("Please login to upload images."); return; }
    setLoading(true);
    try {
      const url = await fbUploadPhoto(file, auth.idToken);
      const newItem = { id: Date.now().toString(), url, title: "New Photo", category: "General" };
      upd([newItem, ...items]);
    } catch(err) {
      alert("Upload failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const remove = (id) => {
    if (!window.confirm("Delete this photo?")) return;
    upd(items.filter(g => g.id !== id));
  };

  const updateItem = (id, field, val) => {
    upd(items.map(g => g.id === id ? {...g, [field]: val} : g));
  };

  const existingCats = [...new Set(items.map(g=>g.category).filter(Boolean))];

  return (
    <div>
      <datalist id="gallery-categories">
        {existingCats.map(c => <option key={c} value={c}/>)}
      </datalist>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
        <label className="bs" style={{padding:"8px 14px",borderRadius:8,fontWeight:600,fontSize:".8rem",cursor:"pointer",opacity:loading?0.5:1}}>
          {loading ? "Uploading..." : "Upload Photo"}
          <input type="file" accept="image/*" style={{display:"none"}} onChange={uploadPhoto} disabled={loading}/>
        </label>
      </div>
      <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":"repeat(3,1fr)",gap:14}}>
        {items.map(g=>(
          <div key={g.id} className="ac" style={{overflow:"hidden",padding:0}}>
            <div style={{height:140,background:"#eee",backgroundImage:`url(${g.url})`,backgroundSize:"cover",backgroundPosition:"center"}}/>
            <div style={{padding:"12px"}}>
              <input type="text" value={g.title} onChange={e=>updateItem(g.id,"title",e.target.value)} placeholder="Photo Title" style={{width:"100%",padding:"4px 8px",marginBottom:6,border:"1px solid var(--bd)",borderRadius:6,fontSize:".82rem",fontFamily:"inherit"}}/>
              <input type="text" list="gallery-categories" value={g.category} onChange={e=>updateItem(g.id,"category",e.target.value)} placeholder="Category (e.g. Events)" style={{width:"100%",padding:"4px 8px",marginBottom:10,border:"1px solid var(--bd)",borderRadius:6,fontSize:".75rem",fontFamily:"inherit",color:"var(--mu)"}}/>
              <div style={{display:"flex",justifyContent:"flex-end"}}>
                <button onClick={()=>remove(g.id)} style={{padding:"4px 9px",borderRadius:6,background:"#FEF0EF",border:"none",color:"#C0392B",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>Delete</button>
              </div>
            </div>
          </div>
        ))}
        <label style={{border:"2px dashed var(--bd)",borderRadius:12,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:180,cursor:"pointer",color:"var(--mu)",gap:7,transition:"all .2s",opacity:loading?0.5:1}} onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--sf)";e.currentTarget.style.color="var(--sf)"}} onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd)";e.currentTarget.style.color="var(--mu)"}}>
          <span style={{fontSize:"1.8rem"}}>📤</span><span style={{fontSize:".82rem",fontWeight:600}}>Upload Photos</span>
          <input type="file" accept="image/*" style={{display:"none"}} onChange={uploadPhoto} disabled={loading}/>
        </label>
      </div>
    </div>
  );
}

function Settings({ mob, C }) {
  const secs=[{t:"Trust Profile",ic:"🏛️",fs:[{l:"Trust Name",v:C.trust.name},{l:"Reg No.",v:"GUJ/CHT/2004/045678"},{l:"PAN",v:C.trust.panNo},{l:"80G Cert",v:C.trust.reg80G}]},{t:"Razorpay",ic:"💳",fs:[{l:"Key ID",v:"rzp_live_..."},{l:"Webhook Secret",v:"..."},{l:"Receipt Prefix",v:"VGCT"},{l:"Currency",v:"INR"}]},{t:"Email/SMTP",ic:"✉️",fs:[{l:"SMTP Host",v:"smtp.gmail.com"},{l:"From Email",v:C.trust.email},{l:"Reply-To",v:C.trust.email},{l:"Admin CC",v:C.trust.email}]},{t:"SEO/Social",ic:"🔍",fs:[{l:"Meta Title",v:C.trust.name},{l:"Facebook",v:"fb.com/vidyagohiltrust"},{l:"Instagram",v:"@vidyagohiltrust"},{l:"GA ID",v:"G-XXXXXXXXXX"}]}];
  return (
    <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:16}}>
      {secs.map((s,i)=>(
        <div key={i} className="ac" style={{padding:mob?"16px":"22px"}}>
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:".95rem",color:"var(--dt)",marginBottom:14,fontWeight:700}}>{s.ic} {s.t}</h3>
          {s.fs.map(f=>(
            <div key={f.l} style={{marginBottom:10}}>
              <label style={{fontSize:".72rem",fontWeight:600,color:"var(--mu)",display:"block",marginBottom:4}}>{f.l}</label>
              <input defaultValue={f.v} style={{width:"100%",padding:"8px 11px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".82rem",fontFamily:"inherit"}}/>
            </div>
          ))}
          <button className="bt" style={{padding:"7px 14px",borderRadius:8,fontWeight:600,fontSize:".8rem",marginTop:6}}>Save</button>
        </div>
      ))}
    </div>
  );
}

// ── PUBLIC WRAPPER ────────────────────────────────────────────────────────────
function Public({ C, lang, setLang, setPage, auth, onShowLogin }) {
  const bs = C.builtinSections || {};
  const custom = (C.customSections || []).filter(s => s.visible);
  return (
    <div>
      <Navbar C={C} lang={lang} setLang={setLang} setPage={setPage} auth={auth} onShowLogin={onShowLogin}/>
      <Hero C={C} lang={lang}/>
      {bs.about    !== false && <About C={C} lang={lang}/>}
      {bs.programs !== false && <Programs C={C}/>}
      {bs.gallery  !== false && <Gallery C={C}/>}
      {bs.events   !== false && <Events C={C}/>}
      {bs.donate   !== false && <Donate C={C} lang={lang}/>}
      {/* Custom sections render here — before Contact */}
      {custom.map(sec => <CustomSection key={sec.id} sec={sec} lang={lang}/>)}
      {bs.contact  !== false && <Contact C={C}/>}
      <Footer C={C}/>
      <button className="bs" onClick={()=>document.getElementById("donate")?.scrollIntoView({behavior:"smooth"})} style={{position:"fixed",bottom:24,right:24,zIndex:999,width:52,height:52,borderRadius:"50%",fontSize:"1.3rem",boxShadow:"0 8px 28px rgba(232,101,10,.45)",display:"flex",alignItems:"center",justifyContent:"center",border:"none"}}>❤️</button>
    </div>
  );
}

// ── LOGIN SCREEN ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, onSkip }) {
  const [email, setEmail]   = useState("");
  const [pass,  setPass]    = useState("");
  const [err,   setErr]     = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const submit = async () => {
    if (!email || !pass) { setErr("Please enter email and password."); return; }
    setErr(""); setLoading(true);
    try {
      const auth = await fbLogin(email, pass);
      onLogin(auth);
    } catch(e) {
      setErr(e.message);
    } finally { setLoading(false); }
  };

  return (
    /* Overlay backdrop — click outside to dismiss */
    <div style={{position:"fixed",inset:0,background:"rgba(13,75,94,.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:1000,backdropFilter:"blur(4px)"}}
      onClick={e=>{ if(e.target===e.currentTarget && onSkip) onSkip(); }}>

      <div style={{background:"white",borderRadius:24,padding:"36px 32px",width:"100%",maxWidth:400,boxShadow:"0 32px 80px rgba(0,0,0,.3)",position:"relative"}}
        onClick={e=>e.stopPropagation()}>

        {/* Close / Skip button */}
        {onSkip && (
          <button onClick={onSkip}
            style={{position:"absolute",top:14,right:14,background:"none",border:"1px solid var(--bd)",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:"1rem",color:"var(--mu)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            ✕
          </button>
        )}

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{width:56,height:56,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.5rem",margin:"0 auto 12px",boxShadow:"0 6px 20px rgba(232,101,10,.3)"}}>Om</div>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.3rem",color:"var(--dt)",fontWeight:700}}>Login to Firebase</h2>
          <p style={{color:"var(--mu)",fontSize:".8rem",marginTop:4}}>Connect to save content to the database</p>
        </div>

        {/* Fields */}
        <div style={{marginBottom:12}}>
          <label style={{fontSize:".75rem",fontWeight:700,color:"var(--mu)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:.6}}>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&submit()}
            placeholder="admin@vidyagohiltrust.org"
            style={{width:"100%",padding:"11px 13px",borderRadius:10,border:"2px solid var(--bd)",fontSize:".875rem",fontFamily:"inherit"}}/>
        </div>
        <div style={{marginBottom:18}}>
          <label style={{fontSize:".75rem",fontWeight:700,color:"var(--mu)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:.6}}>Password</label>
          <div style={{position:"relative"}}>
            <input type={showPass?"text":"password"} value={pass} onChange={e=>setPass(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&submit()}
              placeholder="Your password"
              style={{width:"100%",padding:"11px 44px 11px 13px",borderRadius:10,border:"2px solid var(--bd)",fontSize:".875rem",fontFamily:"inherit"}}/>
            <button onClick={()=>setShowPass(!showPass)}
              style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--mu)",fontSize:".78rem",fontWeight:600}}>
              {showPass?"Hide":"Show"}
            </button>
          </div>
        </div>

        {err && (
          <div style={{background:"#FEF0EF",border:"1px solid #F5B8B8",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:".82rem",color:"#C0392B",fontWeight:500}}>{err}</div>
        )}

        {/* Login button */}
        <button onClick={submit} disabled={loading}
          style={{width:"100%",padding:"12px",borderRadius:10,background:"linear-gradient(135deg,var(--sf),var(--gd))",color:"white",border:"none",fontWeight:700,fontSize:".9rem",cursor:loading?"not-allowed":"pointer",opacity:loading?.7:1,transition:"all .3s",fontFamily:"inherit",marginBottom:10}}>
          {loading ? "Signing in..." : "Sign In"}
        </button>

        {/* Skip button */}
        {onSkip && (
          <button onClick={onSkip}
            style={{width:"100%",padding:"11px",borderRadius:10,background:"white",border:"2px solid var(--bd)",color:"var(--tm2)",fontWeight:600,fontSize:".88rem",cursor:"pointer",fontFamily:"inherit",transition:"all .2s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor="var(--dt)"}
            onMouseLeave={e=>e.currentTarget.style.borderColor="var(--bd)"}>
            Continue without login
          </button>
        )}

        <p style={{textAlign:"center",fontSize:".72rem",color:"var(--mu)",marginTop:12,lineHeight:1.6}}>
          Login only needed to save content to Firebase.
          <br/>You can still edit and preview without logging in.
        </p>
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [page,    setPage]    = useState("public");
  const [lang,    setLang]    = useState("en");
  const [C,       setC]       = useState(()=>JSON.parse(JSON.stringify(DC)));
  const [auth,    setAuth]    = useState(null);      // { idToken, email }
  const [fbState, setFbState] = useState("loading"); // loading | ready | error
  const [showLogin, setShowLogin] = useState(false);

  // ── Load content from Firestore on mount ─────────────────────────────────
  useEffect(() => {
    fbLoad().then(data => {
      if (data) setC(data);
      setFbState("ready");
    }).catch(() => setFbState("ready")); // fall back to defaults
  }, []);

  // ── Admin access — always open, login optional ───────────────────────────
  const goAdmin = () => setPage("admin");

  const handleLogin = (authData) => {
    setAuth(authData);
    setShowLogin(false);
  };

  const handleLogout = () => {
    setAuth(null);
  };

  // ── Loading splash ────────────────────────────────────────────────────────
  if (fbState === "loading") return (
    <>
      <G/>
      <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0D4B5E,#1A6B87)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
        <div style={{width:60,height:60,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.6rem"}}>Om</div>
        <div style={{color:"white",fontFamily:"'Playfair Display',serif",fontSize:"1.1rem"}}>Loading Vidya Gohil Trust...</div>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,.2)",overflow:"hidden"}}>
          <div style={{height:"100%",background:"var(--sf)",borderRadius:2,animation:"shimLoad 1.2s ease-in-out infinite"}}/>
        </div>
        <style>{`@keyframes shimLoad{0%{width:0%}100%{width:100%}}`}</style>
      </div>
    </>
  );

  return (
    <>
      <G/>
      {page === "public"
        ? <Public C={C} lang={lang} setLang={setLang} setPage={goAdmin} auth={auth} onShowLogin={()=>setShowLogin(true)}/>
        : <Admin  C={C} setC={setC} setPage={setPage} auth={auth} onLogout={handleLogout} onShowLogin={()=>setShowLogin(true)}/>}
      {/* Login modal — overlays whatever page is showing */}
      {showLogin && <LoginScreen onLogin={handleLogin} onSkip={()=>setShowLogin(false)}/>}
    </>
  );
}

