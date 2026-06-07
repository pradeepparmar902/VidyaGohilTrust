import { useState, useEffect, useRef, createContext, useContext } from "react";
import { jsPDF } from "jspdf";

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

const fbSubmitRegistration = async (registrationData, idToken) => {
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/registrations`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  
  // Inject Transaction ID and default status
  const txId = "VG-" + Math.random().toString(36).substring(2, 8).toUpperCase();
  registrationData = { 
    "Transaction ID": txId, 
    "Status": "Pending",
    "Remarks": "",
    ...registrationData 
  };

  const res = await fetch(REG_URL, {
    method: "POST",
    headers: headers,
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

const fbUpdateRegistration = async (docId, newData, idToken) => {
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/registrations/${docId}?updateMask.fieldPaths=data`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(REG_URL, {
    method: "PATCH",
    headers: headers,
    body: JSON.stringify({
      fields: {
        data: { stringValue: JSON.stringify(newData) }
      }
    })
  });
  if (!res.ok) throw new Error("Update failed");
  return true;
};

const fbUpdateDonation = async (docId, newData, idToken) => {
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/donations/${docId}?updateMask.fieldPaths=data`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(REG_URL, {
    method: "PATCH",
    headers: headers,
    body: JSON.stringify({
      fields: {
        data: { stringValue: JSON.stringify(newData) }
      }
    })
  });
  if (!res.ok) throw new Error("Update failed");
  return true;
};

const fbFetchRegistrations = async (idToken) => {
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/registrations?pageSize=300`;
  const headers = {};
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(REG_URL, { headers });
  if (!res.ok) throw new Error("Failed to fetch registrations");
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map(doc => {
    try {
      const parsed = JSON.parse(doc.fields.data.stringValue);
      let flatData = parsed.formData ? { ...parsed, ...parsed.formData } : parsed;
      delete flatData.formData;
      if (!flatData.eventName && flatData.eventTitle) flatData.eventName = flatData.eventTitle;

      const submittedAt = doc.fields.submittedAt?.timestampValue;
      return { id: doc.name.split("/").pop(), ...flatData, _submittedAt: submittedAt };
    } catch(e) { return null; }
  }).filter(Boolean).sort((a,b) => new Date(b._submittedAt || 0).getTime() - new Date(a._submittedAt || 0).getTime());
};

const fbSubmitDonation = async (donationData, idToken) => {
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/donations`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(REG_URL, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      fields: {
        data: { stringValue: JSON.stringify(donationData) },
        submittedAt: { timestampValue: new Date().toISOString() }
      }
    })
  });
  if (!res.ok) throw new Error("Donation save failed");
  return true;
};

const fbSubmitVolunteer = async (vData) => {
  const URL = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/volunteers`;
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        data: { stringValue: JSON.stringify(vData) },
        submittedAt: { timestampValue: new Date().toISOString() }
      }
    })
  });
  if (!res.ok) throw new Error("Volunteer submission failed");
  return true;
};

const fbFetchVolunteers = async (idToken) => {
  const URL = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/volunteers?pageSize=300`;
  const headers = {};
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(URL, { headers });
  if (!res.ok) throw new Error("Failed to fetch volunteers");
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map(doc => {
    try {
      const parsed = JSON.parse(doc.fields.data.stringValue);
      return { _docId: doc.name.split("/").pop(), ...parsed, _submittedAt: doc.fields.submittedAt?.timestampValue };
    } catch(e) { return null; }
  }).filter(Boolean);
};

const fbUpdateVolunteer = async (docId, vData, idToken) => {
  if (!docId) throw new Error("Missing document ID");
  const URL = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/volunteers/${docId}`;
  const res = await fetch(URL, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify({
      fields: {
        data: { stringValue: JSON.stringify(vData) },
        submittedAt: { timestampValue: vData._submittedAt || new Date().toISOString() }
      }
    })
  });
  if (!res.ok) throw new Error("Volunteer update failed");
  return true;
};

const fbFetchDonations = async (idToken) => {
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/donations?pageSize=300`;
  const headers = {};
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(REG_URL, { headers });
  if (!res.ok) throw new Error("Failed to fetch donations");
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map(doc => {
    try {
      const parsed = JSON.parse(doc.fields.data.stringValue);
      return { _docId: doc.name.split("/").pop(), ...parsed, _submittedAt: doc.fields.submittedAt?.timestampValue };
    } catch(e) { return null; }
  }).filter(Boolean).sort((a,b) => new Date(b._submittedAt || 0).getTime() - new Date(a._submittedAt || 0).getTime());
};


const fbSignUp = async (email, password) => {
  const SIGNUP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB.apiKey}`;
  const res = await fetch(SIGNUP_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message.replace(/_/g," "));
  return { idToken: data.idToken, email: data.email, expiresIn: data.expiresIn, localId: data.localId };
};

const fbLogin = async (email, password) => {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message.replace(/_/g," "));
  return { idToken: data.idToken, email: data.email, expiresIn: data.expiresIn, localId: data.localId };
};

const fbUpdateProfile = async (idToken, displayName, photoUrl) => {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FB.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, displayName, photoUrl, returnSecureToken: true })
  });
  if (!res.ok) throw new Error("Failed to update profile");
  return await res.json();
};

const fbFetchUserProfile = async (localId, idToken) => {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/users/${localId}`, {
    headers: { "Authorization": `Bearer ${idToken}` }
  });
  if (!res.ok) return null;
  const doc = await res.json();
  if (!doc || !doc.fields) return null;
  const obj = {};
  for(const [k,v] of Object.entries(doc.fields)) obj[k] = v.stringValue || "";
  return obj;
};

const fbSaveUserProfile = async (localId, data, idToken) => {
  const fields = {};
  for(const [k,v] of Object.entries(data)) {
    if (v !== undefined && v !== null) fields[k] = { stringValue: String(v) };
  }
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/users/${localId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) throw new Error("Failed to save user profile");
  return await res.json();
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

const fbUploadPublicFile = async (file, idToken) => {
  const ext = file.name.split(".").pop().toLowerCase();
  const name = encodeURIComponent(`public_uploads/file_${Date.now()}_${Math.random().toString(36).substr(2,5)}.${ext}`);
  
  let cType = file.type;
  if (!cType) {
    if (ext === 'pdf') cType = 'application/pdf';
    else if (ext === 'png') cType = 'image/png';
    else if (ext === 'jpg' || ext === 'jpeg') cType = 'image/jpeg';
    else cType = 'application/octet-stream';
  }

  const res = await fetch(`${STG_URL}?uploadType=media&name=${name}`, {
    method: "POST",
    headers: { "Content-Type": cType, "Authorization": `Bearer ${idToken}` },
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
    @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
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
  trust:{name:"Vidya Gohil Charitable Trust",nameGu:"વિદ્યા ગોહિલ સખાવત ટ્રસ્ટ",subtitle:"CHARITABLE TRUST",phone:"+91 98765 43210",email:"info@vidyagohiltrust.org",address:"12, Gokuldham Society, Near Sardar Bridge, Ahmedabad – 380 006, Gujarat",hours:"Mon–Sat: 9:00 AM – 6:00 PM",estd:"2004",reg80G:"CIT(E)/12A/2004/123",panNo:"AACVG1234E",cin:"U85300GJ2004NPL045678",
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
  donate:{heading:"Your Donation Changes Lives",subtext:"100% of donations go directly to programs. Tax exemption under 80G available.",note:"Secured by Razorpay - 256-bit SSL encryption - 80G receipt auto-generated",recurringLabel:"Monthly Recurring Donation",recurringNote:"Auto-deducted each month. Cancel anytime.",razorpayKey:"rzp_test_YourRazorpayKeyHere"},
  contact:{volunteerHeading:"Become a Volunteer",volunteerSub:"Your time and skills can transform lives. Join 340+ active volunteers across Gujarat.",contactHeading:"Contact Us",volunteerOptions:["Education","Healthcare","Field Work","IT and Digital","Fundraising"],socials:["WhatsApp","Facebook","Instagram","YouTube"]},
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
function Navbar({ C, lang, setLang, setPage, auth, onShowLogin, globalProfile, onPublicLogout, onShowDashboard, onShowUserLogin, onHomeClick }) {
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
            
            {globalProfile ? (
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:".75rem",fontWeight:600,color:"white"}}>Welcome, {globalProfile.name?.split(' ')[0] || globalProfile['Full Name']?.split(' ')[0] || "User"}</span>
                <button onClick={onShowDashboard} style={{background:"var(--sf)",border:"none",color:"white",fontWeight:600,fontSize:".7rem",cursor:"pointer",padding:"4px 10px",borderRadius:6}}>My Dashboard</button>
                <button onClick={onPublicLogout} style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",fontWeight:600,fontSize:".7rem",cursor:"pointer",padding:"4px 8px",borderRadius:6}}>Logout</button>
                <div style={{width:1,height:12,background:"rgba(255,255,255,.3)"}}/>
              </div>
            ) : (
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <button onClick={onShowUserLogin} style={{background:"var(--sf)",border:"none",color:"white",fontWeight:600,fontSize:".75rem",cursor:"pointer",padding:"5px 12px",borderRadius:6,transition:"all .2s"}}>
                  User Login
                </button>
                <div style={{width:1,height:12,background:"rgba(255,255,255,.3)"}}/>
                {auth?.email ? (
                  <button onClick={()=>setPage("admin")} style={{background:"transparent",border:"none",color:"white",fontWeight:700,fontSize:".75rem",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{width:18,height:18,borderRadius:"50%",background:"var(--sf)",color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".6rem"}}>{auth.email[0].toUpperCase()}</span> Admin Panel
                  </button>
                ) : (
                  <button onClick={onShowLogin} style={{background:"transparent",border:"none",color:"rgba(255,255,255,.8)",fontWeight:600,fontSize:".75rem",cursor:"pointer",transition:"all .2s"}} onMouseEnter={e=>e.currentTarget.style.color="white"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,.8)"}>
                    Admin Login
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <nav style={{position:"sticky",top:0,zIndex:300,background:scrolled?"rgba(255,251,244,.97)":"var(--ww)",borderBottom:`1px solid ${scrolled?"var(--bd)":"transparent"}`,backdropFilter:"blur(12px)",boxShadow:scrolled?"0 2px 20px rgba(0,0,0,.08)":"none",transition:"all .3s",padding:mob?"0 16px":"0 28px",display:"flex",alignItems:"center",justifyContent:"space-between",height:mob?56:64,gap:8}}>

        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:mob?6:10,cursor:"pointer",flexShrink:1,minWidth:0}} onClick={()=>go("home")}>
          <LogoMark logo={C.trust.logo} mob={mob}/>
          <div style={{flexShrink:1,minWidth:0}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,fontSize:mob?".85rem":".95rem",color:"var(--dt)",lineHeight:1.2,wordBreak:"break-word"}}>{lang==="en"?C.trust.name:C.trust.nameGu}</div>
            {(!mob && C.trust.subtitle) && <div style={{fontSize:".6rem",color:"var(--mu)",letterSpacing:"1px",textTransform:"uppercase"}}>{C.trust.subtitle}</div>}
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
              {globalProfile ? (
                <div style={{background:"#EDFAF1",border:"1px solid #B8E8CC",borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:700}}>
                      {(globalProfile.name || globalProfile['Full Name'] || "U")[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{fontSize:".85rem",fontWeight:700,color:"var(--dt)"}}>{globalProfile.name || globalProfile['Full Name'] || "User"}</div>
                      <div style={{fontSize:".7rem",color:"var(--mu)"}}>Logged In</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>{setDrawer(false); onShowDashboard();}} style={{background:"var(--sf)",border:"none",color:"white",fontWeight:600,fontSize:".75rem",padding:"5px 10px",borderRadius:6,cursor:"pointer"}}>Dashboard</button>
                    <button onClick={onPublicLogout} style={{background:"none",border:"1px solid #B8E8CC",color:"#1A7A3E",fontWeight:600,fontSize:".75rem",padding:"4px 10px",borderRadius:6,cursor:"pointer"}}>Logout</button>
                  </div>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <button onClick={()=>{setDrawer(false); onShowUserLogin();}} style={{padding:"12px",borderRadius:10,background:"var(--sf)",border:"none",color:"white",fontWeight:700,fontSize:".85rem",cursor:"pointer"}}>
                    User Login / Sign Up
                  </button>
                  {auth?.email ? (
                    <div style={{background:"#EDFAF1",border:"1px solid #B8E8CC",borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:700,flexShrink:0}}>
                        {auth.email[0].toUpperCase()}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:".8rem",fontWeight:700,color:"#1A7A3E"}}>Admin Logged In</div>
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
                      Admin Login
                    </button>
                  )}
                </div>
              )}
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
      <div style={{maxWidth:1200,margin:"0 auto",padding:mob?"80px 20px 60px":"60px 32px",display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:mob?32:56,alignItems:"center",width:"100%"}}>
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
function Donate({ C, lang, globalProfile, globalAuthToken, onShowUserLogin }) {
  const [amt, setAmt] = useState(1100); const [cAmt, setCamt] = useState(""); const [prog, setProg] = useState(""); const [progErr, setProgErr] = useState(false);
  const [rec, setRec] = useState(false); const [step, setStep] = useState(1); 
  const [showPaymentPopup, setShowPaymentPopup] = useState(false);
  const [form, setForm] = useState({
    name: globalProfile?.name || globalProfile?.['Full Name'] || globalProfile?.displayName || "",
    phone: globalProfile?.mobile || globalProfile?.['Mobile Number'] || "",
    email: globalProfile?.email || globalProfile?.['Email'] || "",
    pan: ""
  });

  useEffect(() => {
    if (globalProfile) {
      setForm(prev => ({
        ...prev, 
        name: prev.name || globalProfile.name || globalProfile['Full Name'] || globalProfile.displayName || "",
        phone: prev.phone || globalProfile.mobile || globalProfile['Mobile Number'] || "",
        email: prev.email || globalProfile.email || globalProfile['Email'] || ""
      }));
    }
  }, [globalProfile]);
  const w = useW(); const mob = w<640; const presets = [500,1100,2100,5100,11000,25000];
  const final = cAmt ? parseInt(cAmt)||0 : amt; const d = C.donate || {};
  const go = async () => {
    if (step === 1) {
      if (!prog) {
        setProgErr(true);
        setTimeout(() => setProgErr(false), 5000);
        return;
      }
      setProgErr(false);
      if (!globalAuthToken) {
        onShowUserLogin();
        return;
      }
      return setStep(2);
    }
    if (!form.name || !form.phone || !form.email) return alert("Please fill all required fields");
    
    const rzpKey = C.donate?.razorpayKey || "rzp_test_DummyKeyForTest";

    if (rzpKey.startsWith("http")) {
      setShowPaymentPopup(true);
      return;
    }

    if (window.Razorpay) {
      const options = {
        key: rzpKey, // Use key from CMS
        amount: final * 100, 
        currency: "INR",
        name: "Vidya Gohil Trust",
        description: `Donation for ${prog}`,
        handler: async function (response) {
          try {
            await fbSubmitDonation({
              name: form.name,
              phone: form.phone,
              email: form.email,
              pan: form.pan,
              amount: final,
              program: prog,
              status: "Pending",
              date: new Date().toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'}),
              id: `DON-${Math.floor(100000 + Math.random() * 900000)}`,
              razorpay_payment_id: response.razorpay_payment_id
            });
            setStep(3);
          } catch(e) {
            console.error(e);
            alert("Payment recorded by Razorpay, but failed to save in database.");
          }
        },
        prefill: { name: form.name, email: form.email, contact: form.phone },
        theme: { color: "#0D4B5E" }
      };
      const rzp1 = new window.Razorpay(options);
      rzp1.on('payment.failed', function (response){
        alert("Payment Failed: " + response.error.description);
      });
      rzp1.open();
    } else {
      alert("Payment gateway not loaded. Please try again.");
    }
  };
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
                {progErr && (
                  <div style={{animation:"shake 0.4s ease-in-out, fadeUp 0.3s ease-out",background:"#FEF0EF",border:"1.5px solid #F5B8B8",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:14,color:"#C0392B",boxShadow:"0 8px 24px rgba(192,57,43,.15)"}}>
                    <span style={{fontSize:"1.6rem",animation:"float 2s ease-in-out infinite"}}>🎯</span>
                    <div>
                      <div style={{fontWeight:800,fontSize:".95rem",letterSpacing:.5,textTransform:"uppercase"}}>Purpose Required</div>
                      <div style={{fontSize:".82rem",marginTop:3,fontWeight:500,opacity:0.9}}>Please select a program below to direct your donation (e.g. Education / Health / Women etc).</div>
                    </div>
                  </div>
                )}
                <div style={{marginBottom:18}}>
                  <label style={{fontSize:".82rem",fontWeight:600,color:progErr?"#C0392B":"var(--tx)",marginBottom:8,display:"block",transition:"color .3s"}}>Donate to Program</label>
                  <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                    {["General","Education","Healthcare","Women","Environment","Relief"].map(p=><button key={p} onClick={()=>{setProg(p);setProgErr(false);}} style={{padding:"5px 12px",borderRadius:20,fontSize:".78rem",fontWeight:500,background:prog===p?"var(--dt)":"var(--tl)",color:prog===p?"white":"var(--dt)",border:`1px solid ${prog===p?"var(--dt)":progErr?"#F5B8B8":"var(--bd)"}`,cursor:"pointer",transition:"all .2s"}}>{p}</button>)}
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

          {/* ── PAYMENT POPUP MODAL ── */}
          {showPaymentPopup && (
            <div style={{position:"fixed",inset:0,background:"rgba(13,75,94,.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,zIndex:9999,backdropFilter:"blur(6px)"}}>
              <div style={{background:"white",borderRadius:24,width:"100%",maxWidth:400,padding:"32px",boxShadow:"0 32px 80px rgba(0,0,0,.3)",textAlign:"center",position:"relative"}}>
                <div style={{fontSize:"3.5rem",marginBottom:16}}>💳</div>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.4rem",color:"var(--dt)",marginBottom:12,fontWeight:700}}>Redirecting to Payment Gateway</h3>
                <p style={{color:"var(--mu)",fontSize:".9rem",lineHeight:1.6,marginBottom:24}}>
                  You will now be redirected to Razorpay to complete your transaction.<br/><br/>
                  <strong>Note:</strong> If you see a "Payment Completed" screen from a previous donation, please open the payment link in an <strong>Incognito/Private</strong> window to make a new payment.
                </p>
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <button onClick={async () => {
                    setShowPaymentPopup(false);
                    const rzpKey = C.donate?.razorpayKey || "rzp_test_DummyKeyForTest";
                    try {
                      await fbSubmitDonation({
                        name: form.name, phone: form.phone, email: form.email, pan: form.pan,
                        amount: final, program: prog, status: "Pending (Payment Link)",
                        date: new Date().toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'}),
                        id: `DON-${Math.floor(100000 + Math.random() * 900000)}`,
                        razorpay_payment_id: "Off-site Link"
                      });
                      window.open(rzpKey, "_blank");
                      setStep(3);
                    } catch(e) {
                      console.error(e); alert("Failed to save record.");
                    }
                  }} style={{background:"var(--sf)",color:"white",border:"none",padding:"14px",borderRadius:12,fontWeight:700,fontSize:"1rem",cursor:"pointer",transition:"all .2s"}}>
                    Proceed to Payment
                  </button>
                  <button onClick={() => setShowPaymentPopup(false)} style={{background:"#F5F5F5",color:"var(--dt)",border:"none",padding:"14px",borderRadius:12,fontWeight:700,fontSize:"1rem",cursor:"pointer",transition:"all .2s"}}>
                    Back to Home
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </section>
  );
}

function Events({ C, globalAuthToken, globalProfile, onPublicLogin }) {
  const w = useW(); const mob = w<700;
  const [selectedEvent, setSelectedEvent] = useState(null); // { type: 'register' | 'details', event }
  const [formData, setFormData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  
  // Auth State
  const [authStep, setAuthStep] = useState(0); // 0 = login/register, 1 = form
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regGender, setRegGender] = useState("");
  const [regImageFile, setRegImageFile] = useState(null);
  const [authError, setAuthError] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [uploadingFields, setUploadingFields] = useState({});
  const [previewFile, setPreviewFile] = useState(null);

  const handleFileUpload = async (e, fKey) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingFields(prev => ({...prev, [fKey]: true}));
    try {
      const url = await fbUploadPublicFile(file, authToken);
      setFormData(prev => ({...prev, [fKey]: url}));
    } catch (err) {
      alert("Failed to upload. Please try again.");
    } finally {
      setUploadingFields(prev => ({...prev, [fKey]: false}));
    }
  };

  const getForm = (id) => C.forms?.find(f => f.id === id) || { fields: [] };

  const handleAuth = async (e, isRegister) => {
    e.preventDefault();
    if (!mobile || !password) { setAuthError("Please enter mobile and password"); return; }
    if (isRegister && (!regName || !regAddress || !regGender)) { setAuthError("Please fill out Name, Address, and Gender."); return; }
    setSubmitting(true); setAuthError("");
    try {
      const email = `${mobile.replace(/\D/g,'')}@vidyagohil.com`;
      const res = isRegister ? await fbSignUp(email, password) : await fbLogin(email, password);
      
      let profileData = { name: regName, address: regAddress, gender: regGender, mobile: mobile, photoUrl: "" };
      
      if (isRegister) {
        if (regImageFile) {
          profileData.photoUrl = await fbUploadPublicFile(regImageFile, res.idToken).catch(()=>"");
        }
        await fbUpdateProfile(res.idToken, regName, profileData.photoUrl).catch(()=>null);
        await fbSaveUserProfile(res.localId, profileData, res.idToken).catch(()=>null);
      } else {
        const pData = await fbFetchUserProfile(res.localId, res.idToken);
        if (pData) profileData = { ...profileData, ...pData };
      }

      setAuthToken(res.idToken);
      if (onPublicLogin) onPublicLogin(res.idToken, profileData);
      setAuthStep(1);
      
      // Auto-fill form
      const newForm = {...formData, "Submitted By": profileData.name || mobile};
      const formSpec = getForm(selectedEvent?.event?.formId);
      formSpec.fields.forEach(f => {
        const fKey = f.label?.trim() || "Field";
        const kLow = fKey.toLowerCase();
        if (f.type === 'tel' || kLow.includes('mobile') || kLow.includes('phone')) newForm[fKey] = profileData.mobile;
        if (kLow.includes('name') && !kLow.includes('event')) newForm[fKey] = profileData.name || "";
        if (kLow.includes('address')) newForm[fKey] = profileData.address || "";
        if (kLow.includes('gender') || kLow === 'sex') newForm[fKey] = profileData.gender || "";
      });
      setFormData(newForm);
    } catch(err) {
      setAuthError(err.message.includes("INVALID") ? "Invalid mobile or password." : err.message.includes("EXISTS") ? "Account exists. Please click Login." : err.message);
    } finally {
      setSubmitting(false);
    }
  };

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
        }, authToken);
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
                    <button onClick={()=>{
                      setSelectedEvent({type:'register', event:ev});
                      if (globalAuthToken && globalProfile) {
                        setAuthToken(globalAuthToken);
                        setAuthStep(1);
                        const newForm = {...formData, "Submitted By": globalProfile.name || globalProfile['Full Name'] || globalProfile.mobile};
                        const formSpec = getForm(ev.formId);
                        formSpec.fields.forEach(f => {
                          const fKey = f.label?.trim() || "Field";
                          const kLow = fKey.toLowerCase();
                          if (f.type === 'tel' || kLow.includes('mobile') || kLow.includes('phone')) newForm[fKey] = globalProfile.mobile;
                          if (kLow.includes('name') && !kLow.includes('event')) newForm[fKey] = globalProfile.name || globalProfile['Full Name'] || "";
                          if (kLow.includes('address')) newForm[fKey] = globalProfile.address || globalProfile['Address'] || "";
                          if (kLow.includes('gender') || kLow === 'sex') newForm[fKey] = globalProfile.gender || globalProfile['Gender'] || "";
                        });
                        setFormData(newForm);
                      } else {
                        setAuthStep(0);
                      }
                    }} className="bs" style={{padding:"5px 12px",borderRadius:6,fontSize:".75rem",fontWeight:600}}>Register</button>
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
          <div className="ac" style={{background:"linear-gradient(135deg, #ffffff, #f0f7ff)",width:"100%",maxWidth:500,padding:20,borderRadius:12,maxHeight:"95vh",overflowY:"auto",position:"relative", boxShadow:"0 20px 40px rgba(0,0,0,0.2)"}}>
            <button onClick={()=>{setSelectedEvent(null);setDone(false);setFormData({});if(!globalAuthToken){setAuthStep(0);setMobile("");setPassword("");}setAuthError("");}} style={{position:"absolute",top:16,right:16,background:"#F5F5F5",border:"none",fontSize:"1.2rem",cursor:"pointer",width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--mu)"}}>✕</button>
            
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
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.4rem",color:"var(--dt)",marginBottom:4,fontWeight:700,paddingRight:30}}>
                  {authStep === 'register' ? 'New User Entry' : authStep === 0 ? 'User Login' : 'Event Registration'}
                </h3>
                <p style={{fontSize:".85rem",color:"var(--mu)",marginBottom:20}}>
                  {authStep === 1 ? selectedEvent.event.title : 'Sign in or create a profile to continue'}
                </p>
                {done ? (
                  <div style={{textAlign:"center",padding:"30px 0"}}>
                    <div style={{fontSize:"3rem",marginBottom:10}}>✅</div>
                    <h4 style={{color:"#1A7A3E",fontWeight:700,marginBottom:6}}>Registration Successful!</h4>
                    <p style={{fontSize:".85rem",color:"var(--mu)"}}>Redirecting to WhatsApp to send your confirmation...</p>
                  </div>
                ) : authStep === 0 ? (
                  <form style={{display:"flex",flexDirection:"column",gap:12}}>
                    <p style={{fontSize:".9rem",color:"var(--dt)",marginBottom:8, fontWeight:500}}>Please log in to continue.</p>
                    {authError && <div style={{background:"#FDECEA",color:"#C0392B",padding:"8px",borderRadius:6,fontSize:".75rem",fontWeight:600}}>{authError}</div>}
                    <div>
                      <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Mobile Number <span style={{color:"red"}}>*</span></label>
                      <input type="tel" required value={mobile} onChange={e=>setMobile(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:".85rem", background:"#FAFAFA", transition:"all 0.2s", outline:"none"}} placeholder="e.g. 9876543210" onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}/>
                    </div>
                    <div>
                      <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Password <span style={{color:"red"}}>*</span></label>
                      <input type="password" required value={password} onChange={e=>setPassword(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:".85rem", background:"#FAFAFA", transition:"all 0.2s", outline:"none"}} placeholder="Enter your password" onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}/>
                      <div style={{marginTop: 6, textAlign: "right"}}>
                        <button type="button" onClick={() => {
                          if(!mobile) { setAuthError("Please enter your mobile number first to request a password reset."); return; }
                          const n = C?.trust?.phone?.replace(/\D/g,'') || "919224369217";
                          const num = n.length === 10 ? `91${n}` : n;
                          const msg = encodeURIComponent(`Hello, I forgot the password for my Vidya Gohil Trust account (Mobile: ${mobile}). Please help me reset it.`);
                          window.open(`https://wa.me/${num}?text=${msg}`, "_blank");
                        }} style={{background:"none",border:"none",color:"var(--sf)",fontSize:".7rem",fontWeight:600,cursor:"pointer",textDecoration:"underline",padding:0}}>
                          Forgot Password?
                        </button>
                      </div>
                    </div>
                    <button type="button" onClick={e=>handleAuth(e, false)} className="bs" style={{width:"100%",padding:"12px",borderRadius:8,fontWeight:700,marginTop:8,opacity:submitting?0.7:1, fontSize:".9rem", boxShadow:"0 4px 14px rgba(0,0,0,0.15)", cursor:"pointer", border:"none", color:"white"}} disabled={submitting}>
                      {submitting ? "Logging in..." : "Login"}
                    </button>
                    <div style={{textAlign:"center", marginTop: 4}}>
                      <span onClick={()=>{setAuthStep('register');setAuthError("");}} style={{color:"var(--mu)",fontSize:".8rem",cursor:"pointer"}}>
                        Don't have an account? <strong style={{color:"var(--dt)"}}>Create one</strong>
                      </span>
                    </div>
                  </form>
                ) : authStep === 'register' ? (
                  <form style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{background:"#f4f9ff", border:"1px solid #d0e3ff", padding: "10px 14px", borderRadius:8}}>
                      <p style={{fontSize:".8rem",color:"#0056b3",margin:0, fontWeight: 500}}>Create a complete profile to speed up future registrations.</p>
                    </div>
                    {authError && <div style={{background:"#FDECEA",color:"#C0392B",padding:"8px",borderRadius:6,fontSize:".75rem",fontWeight:600}}>{authError}</div>}
                    
                    <div style={{display:"grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 12}}>
                      <div>
                        <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Full Name <span style={{color:"red"}}>*</span></label>
                        <input type="text" required value={regName} onChange={e=>setRegName(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:".85rem", background:"#FAFAFA", transition:"all 0.2s", outline:"none", boxSizing:"border-box"}} placeholder="Enter your full name" onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}/>
                      </div>
                      <div>
                        <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Mobile Number <span style={{color:"red"}}>*</span></label>
                        <input type="tel" required value={mobile} onChange={e=>setMobile(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:".85rem", background:"#FAFAFA", transition:"all 0.2s", outline:"none", boxSizing:"border-box"}} placeholder="e.g. 9876543210" onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}/>
                      </div>
                    </div>

                    <div>
                      <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Address <span style={{color:"red"}}>*</span></label>
                      <input type="text" required value={regAddress} onChange={e=>setRegAddress(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:".85rem", background:"#FAFAFA", transition:"all 0.2s", outline:"none", boxSizing:"border-box"}} placeholder="Enter your full address" onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}/>
                    </div>

                    <div style={{display:"grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 12}}>
                      <div>
                        <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Gender <span style={{color:"red"}}>*</span></label>
                        <select required value={regGender} onChange={e=>setRegGender(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:".85rem",background:"#FAFAFA", transition:"all 0.2s", outline:"none", boxSizing:"border-box", cursor:"pointer"}} onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}>
                          <option value="">Select Gender</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Create Password <span style={{color:"red"}}>*</span></label>
                        <input type="password" required value={password} onChange={e=>setPassword(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:".85rem", background:"#FAFAFA", transition:"all 0.2s", outline:"none", boxSizing:"border-box"}} placeholder="Secure password" onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}/>
                      </div>
                    </div>

                    <div>
                      <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Profile Image <span style={{fontWeight:"normal",color:"#888"}}>(Optional)</span></label>
                      <div style={{position:"relative", display:"flex", alignItems:"center"}}>
                        <input type="file" accept="image/*" onChange={e=>setRegImageFile(e.target.files[0])} style={{width:"100%",padding:"6px 10px",fontSize:".8rem",background:"white",borderRadius:8,border:"2px dashed #CCC",cursor:"pointer", color:"var(--mu)", boxSizing:"border-box"}}/>
                      </div>
                    </div>

                    <button type="button" onClick={e=>handleAuth(e, true)} className="bs" style={{width:"100%",padding:"12px",borderRadius:8,fontWeight:700,marginTop:8,opacity:submitting?0.7:1, fontSize:".9rem", boxShadow:"0 4px 14px rgba(0,0,0,0.15)", cursor:"pointer", border:"none", color:"white"}} disabled={submitting}>
                      {submitting ? "Creating Profile..." : "Create Account"}
                    </button>
                    
                    <div style={{textAlign:"center", marginTop: 2}}>
                      <span onClick={()=>{setAuthStep(0);setAuthError("");}} style={{color:"var(--mu)",fontSize:".8rem",cursor:"pointer"}}>
                        Already have an account? <strong style={{color:"var(--dt)"}}>Log In</strong>
                      </span>
                    </div>
                  </form>
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
                        ) : f.type === 'image' || f.type === 'file' ? (
                          <div style={{padding:"12px",borderRadius:8,border:"1px dashed var(--bd)",background:"#FAFAFA"}}>
                            {formData[fKey] ? (
                              <div style={{display:"flex",alignItems:"center",gap:10,background:"white",padding:"8px",borderRadius:6,border:"1px solid var(--bd)"}}>
                                {f.type === 'image' ? (
                                  <img src={formData[fKey]} alt="preview" style={{width:40,height:40,objectFit:"cover",borderRadius:4}}/>
                                ) : (
                                  <div style={{width:40,height:40,background:"#F0F0F0",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",fontSize:".6rem",fontWeight:700,color:"var(--dt)"}}>FILE</div>
                                )}
                                <div style={{flex:1,overflow:"hidden"}}>
                                  <button type="button" onClick={()=>setPreviewFile({url:formData[fKey], type:f.type})} style={{background:"none",border:"none",fontSize:".8rem",color:"var(--dt)",textDecoration:"underline",cursor:"pointer",whiteSpace:"nowrap",textOverflow:"ellipsis",display:"block",padding:0}}>View Uploaded {f.type==='image'?'Photo':'Document'}</button>
                                </div>
                                <button type="button" onClick={()=>setFormData({...formData, [fKey]:""})} style={{background:"none",border:"none",color:"#C0392B",cursor:"pointer",fontSize:"1.2rem",padding:"0 8px"}}>×</button>
                              </div>
                            ) : uploadingFields[fKey] ? (
                              <div style={{fontSize:".85rem",color:"var(--mu)",fontStyle:"italic",display:"flex",alignItems:"center",gap:8}}>
                                <div style={{width:14,height:14,border:"2px solid var(--bd)",borderTopColor:"var(--dt)",borderRadius:"50%",animation:"spin 1s linear infinite"}}/> Uploading...
                              </div>
                            ) : (
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <label style={{padding:"8px 16px",background:"var(--dt)",color:"white",borderRadius:6,fontSize:".8rem",fontWeight:600,cursor:"pointer",display:"inline-block"}}>
                                  {f.type === 'image' ? '📸 Choose Photo' : '📎 Choose Document'}
                                  <input type="file" required={f.required} accept={f.type==='image'?"image/*":".pdf,.doc,.docx"} onChange={e=>handleFileUpload(e, fKey)} style={{display:"none"}}/>
                                </label>
                                <span style={{fontSize:".75rem",color:"var(--mu)"}}>{f.type === 'image' ? 'JPG, PNG, etc.' : 'PDF, DOC, etc.'}</span>
                              </div>
                            )}
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
      
      {previewFile && (
        <div style={{position:"fixed",top:0,left:0,width:"100vw",height:"100vh",background:"rgba(0,0,0,0.8)",zIndex:99999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{position:"relative",width:"100%",maxWidth:800,maxHeight:"90vh",background:"white",borderRadius:12,overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"12px 16px",background:"var(--dt)",color:"white",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <h3 style={{fontSize:"1rem",fontWeight:600}}>{previewFile.type === 'image' ? 'Photo Preview' : 'Document Preview'}</h3>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                {previewFile.type !== 'image' && (
                  <a href={previewFile.url} target="_blank" rel="noreferrer" style={{color:"white",fontSize:".8rem",textDecoration:"underline"}}>Open externally</a>
                )}
                <button onClick={()=>setPreviewFile(null)} style={{background:"none",border:"none",color:"white",fontSize:"1.5rem",cursor:"pointer",lineHeight:1}}>×</button>
              </div>
            </div>
            <div style={{flex:1,overflow:"auto",padding:20,display:"flex",alignItems:"center",justifyContent:"center",background:"#F5F5F5"}}>
               {previewFile.type === 'image' ? (
                 <img src={previewFile.url} alt="Preview" style={{maxWidth:"100%",maxHeight:"70vh",objectFit:"contain",borderRadius:8,boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}} />
               ) : (
                 <object data={previewFile.url} type="application/pdf" style={{width:"100%",height:"70vh",border:"none",borderRadius:8,boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
                   <iframe src={previewFile.url} style={{width:"100%",height:"100%",border:"none"}} title="Document Preview" />
                 </object>
               )}
            </div>
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
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", city: "", program: "" });
  const [status, setStatus] = useState("idle");

  const handleSubmit = async () => {
    if(!formData.name || !formData.phone) return alert("Name and Phone are required.");
    setStatus("submitting");
    try {
      await fbSubmitVolunteer({ ...formData, status: "Pending" });
      setStatus("success");
    } catch(e) {
      console.error(e);
      alert("Failed to submit. Please try again.");
      setStatus("idle");
    }
  };

  return (
    <section id="contact" style={{padding:mob?"56px 16px":"80px 32px",background:"var(--ww)"}}>
      <div style={{maxWidth:1200,margin:"0 auto",display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:mob?36:48}}>
        <div>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>Join Us</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.5rem":"1.8rem",color:"var(--dt)",marginTop:8,marginBottom:14,fontWeight:700}}>{ct.volunteerHeading}</h2>
          
          {status === "success" ? (
            <div style={{padding:32,background:"#EDFAF1",borderRadius:12,border:"1px solid #B8E8CC",textAlign:"center"}}>
              <div style={{fontSize:"3rem",marginBottom:16}}>🙌</div>
              <h3 style={{color:"#1A7A3E",marginBottom:8,fontSize:"1.3rem"}}>Thank you for applying!</h3>
              <p style={{color:"var(--dt)",fontSize:".95rem"}}>Your volunteer application has been submitted successfully. Our team will review it and get in touch with you shortly.</p>
              <button onClick={()=>{setStatus("idle");setFormData({name:"",email:"",phone:"",city:"",program:""})}} style={{marginTop:20,padding:"8px 16px",borderRadius:8,background:"var(--dt)",color:"white",border:"none",cursor:"pointer",fontWeight:600}}>Submit Another</button>
            </div>
          ) : (
            <>
              <p style={{color:"var(--tm2)",lineHeight:1.7,marginBottom:20,fontSize:".9rem"}}>{ct.volunteerSub}</p>
              {[{f:"Full Name",t:"text",k:"name"},{f:"Email",t:"email",k:"email"},{f:"Phone",t:"tel",k:"phone"},{f:"City",t:"text",k:"city"}].map(i=>
                <div key={i.f} style={{marginBottom:10}}>
                  <input type={i.t} placeholder={i.f} value={formData[i.k]} onChange={e=>setFormData({...formData, [i.k]:e.target.value})} style={{width:"100%",padding:"10px 13px",borderRadius:8,border:"2px solid var(--bd)",fontSize:".875rem",fontFamily:"inherit"}}/>
                </div>
              )}
              <select value={formData.program} onChange={e=>setFormData({...formData, program:e.target.value})} style={{width:"100%",padding:"10px 13px",borderRadius:8,border:"2px solid var(--bd)",fontSize:".875rem",fontFamily:"inherit",marginBottom:14,color:formData.program?"black":"var(--mu)"}}>
                <option value="">Select Area of Interest</option>
                {(ct.volunteerOptions?.length > 0 ? ct.volunteerOptions : ["Education","Healthcare","Field Work","IT and Digital","Fundraising"]).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <button onClick={handleSubmit} disabled={status==="submitting"} className="bs" style={{width:"100%",padding:"12px",borderRadius:10,fontSize:".92rem",fontWeight:700,opacity:status==="submitting"?0.7:1}}>{status==="submitting"?"Submitting...":"Apply to Volunteer"}</button>
            </>
          )}
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
function Footer({ C, onFooterLinkClick }) {
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
          {[{title:"Quick Links",items:[{label:"About Us",id:"about"},{label:"Programs",id:"programs"},{label:"Events",id:"events"},{label:"Gallery",id:"gallery"},{label:"Contact",id:"contact"}]},{title:"Programs",items:[{label:"Education",id:"programs"},{label:"Healthcare",id:"programs"},{label:"Women Empowerment",id:"programs"},{label:"Environment",id:"programs"}]},{title:"Legal",items:[{label:"Privacy Policy",id:"privacy"},{label:"Terms of Use",id:"terms"},{label:"Refund Policy",id:"refund"}]}].map(col=>(
            <div key={col.title}>
              <h4 style={{color:"white",fontWeight:700,marginBottom:14,fontSize:".82rem"}}>{col.title}</h4>
              {col.items.map(item=><div key={item.label} onClick={()=>{if(item.id && onFooterLinkClick){onFooterLinkClick(item.id);}}} style={{fontSize:".78rem",marginBottom:8,cursor:item.id?"pointer":"default"}} onMouseEnter={e=>item.id&&(e.target.style.color="var(--sflt)")} onMouseLeave={e=>item.id&&(e.target.style.color="rgba(255,255,255,.75)")}>{item.label}</div>)}
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

// Number to words helper
const numberToWords = (num) => {
  const a = ['','One ','Two ','Three ','Four ', 'Five ','Six ','Seven ','Eight ','Nine ','Ten ','Eleven ','Twelve ','Thirteen ','Fourteen ','Fifteen ','Sixteen ','Seventeen ','Eighteen ','Nineteen '];
  const b = ['', '', 'Twenty','Thirty','Forty','Fifty', 'Sixty','Seventy','Eighty','Ninety'];
  if ((num = num.toString()).length > 9) return 'overflow';
  let n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!n) return ''; let str = '';
  str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
  str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
  str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
  str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
  str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
  return str.trim() ? str.trim() + ' Rupees Only' : '';
};

// Global Receipt PDF Generator
export const generateReceiptPDF = async (r, C, action="download") => {
  try {
    const template = C?.donate?.receiptTemplate;
    if (!template) {
      alert("No Receipt Template found. Please contact the administrator.");
      return;
    }
    
    const defaultMap = {
      donorName: { x: 50, y: 50, visible: true },
      amount: { x: 50, y: 60, visible: true },
      amountTotal: { x: 80, y: 90, visible: true },
      amountWords: { x: 50, y: 70, visible: true },
      date: { x: 80, y: 20, visible: true },
      receiptNo: { x: 80, y: 15, visible: true },
      pan: { x: 50, y: 80, visible: true },
      purpose: { x: 50, y: 90, visible: true },
      paymentMode: { x: 30, y: 70, visible: true },
      systemGenerated: { x: 50, y: 95, visible: true },
      transactionId: { x: 30, y: 80, visible: true }
    };
    const map = C?.donate?.receiptMap ? { 
      ...defaultMap, 
      ...C.donate.receiptMap, 
      purpose: C.donate.receiptMap.purpose || defaultMap.purpose,
      paymentMode: C.donate.receiptMap.paymentMode || defaultMap.paymentMode,
      systemGenerated: C.donate.receiptMap.systemGenerated || defaultMap.systemGenerated,
      amountTotal: C.donate.receiptMap.amountTotal || defaultMap.amountTotal,
      transactionId: C.donate.receiptMap.transactionId || defaultMap.transactionId
    } : defaultMap;
    
    const baseFontSize = C?.donate?.receiptFontSize || 14;
    
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = template;
    
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Failed to load template image."));
    });

    const doc = new jsPDF({ orientation: img.width > img.height ? 'landscape' : 'portrait', unit: 'px', format: [img.width, img.height] });
    doc.addImage(img, 'PNG', 0, 0, img.width, img.height);
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", "bold");

    const drawText = (key, text, sizeMultiplier=1, maxWidthRatio=null) => {
      if (!map[key] || !map[key].visible || !text) return;
      doc.setFontSize(baseFontSize * sizeMultiplier);
      const px = (map[key].x / 100) * img.width;
      const py = (map[key].y / 100) * img.height;
      let lines = text;
      if (maxWidthRatio) {
        const maxWidthPx = img.width * maxWidthRatio;
        lines = doc.splitTextToSize(text, maxWidthPx);
      }
      
      doc.text(lines, px, py, { align: 'center' });
    };

    drawText("donorName", r.name || "Donor", 1.15);
    drawText("amount", `Rs. ${r.amount.toLocaleString()}`, 1.15);
    drawText("amountTotal", `Rs. ${r.amount.toLocaleString()}`, 1.15);
    drawText("amountWords", numberToWords(r.amount), 1, 0.45); // wrap at 45% of image width
    drawText("date", r.date, 1);
    const displayReceiptNo = r.receiptNo ? r.receiptNo : "Processing...";
    drawText("receiptNo", displayReceiptNo, 1);
    drawText("pan", r.pan ? `PAN: ${r.pan.toUpperCase()}` : "", 1);
    drawText("purpose", `Towards ${r.program || "General"} purpose`, 1);
    drawText("paymentMode", "Online Payment Transfer", 1);
    
    const sysGenText = r.receiptNo 
      ? "This receipt is system generated." 
      : "Payment Under Verification. Official receipt pending.";
    drawText("systemGenerated", sysGenText, 0.7);
    drawText("transactionId", r.razorpay_payment_id ? `TXN: ${r.razorpay_payment_id}` : "", 0.85);

    if (action === "view") {
      return doc.output("bloburl");
    } else if (action === "blob") {
      return doc.output("blob");
    } else {
      const safeId = (r.receiptNo || r.id).replace(/\//g, "-");
      doc.save(`Receipt_${safeId}.pdf`);
    }

  } catch (e) {
    console.error(e);
    alert("Failed to generate PDF: " + e.message);
  }
};

function TemplateMapper({ imgUrl, mapData, fontSize, onChange }) {
  const [fields, setFields] = useState(() => {
    const defaultFields = {
      donorName: { x: 50, y: 50, visible: true },
      amount: { x: 50, y: 60, visible: true },
      amountTotal: { x: 80, y: 90, visible: true },
      amountWords: { x: 50, y: 70, visible: true },
      date: { x: 80, y: 20, visible: true },
      receiptNo: { x: 80, y: 15, visible: true },
      pan: { x: 50, y: 80, visible: true },
      purpose: { x: 50, y: 90, visible: true },
      paymentMode: { x: 30, y: 70, visible: true },
      systemGenerated: { x: 50, y: 95, visible: true },
      transactionId: { x: 30, y: 80, visible: true }
    };
    return mapData ? { 
      ...defaultFields, 
      ...mapData, 
      purpose: mapData.purpose || defaultFields.purpose,
      paymentMode: mapData.paymentMode || defaultFields.paymentMode,
      systemGenerated: mapData.systemGenerated || defaultFields.systemGenerated,
      amountTotal: mapData.amountTotal || defaultFields.amountTotal,
      transactionId: mapData.transactionId || defaultFields.transactionId
    } : defaultFields;
  });

  const [fSize, setFSize] = useState(fontSize || 14);

  const containerRef = useRef(null);
  const [dragging, setDragging] = useState(null);

  const handlePointerDown = (e, key) => { e.preventDefault(); e.target.setPointerCapture(e.pointerId); setDragging(key); };
  const handlePointerMove = (e) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;
    x = Math.max(0, Math.min(100, x)); y = Math.max(0, Math.min(100, y));
    setFields(prev => ({ ...prev, [dragging]: { ...prev[dragging], x, y } }));
  };
  const handlePointerUp = (e) => { 
    if (dragging) {
      e.target.releasePointerCapture(e.pointerId);
      setDragging(null); 
      onChange(fields, fSize); // Save to parent only when dragging stops!
    }
  };

  const toggleVisibility = (key) => {
    const nextFields = { ...fields, [key]: { ...fields[key], visible: !fields[key].visible } };
    setFields(nextFields);
    onChange(nextFields, fSize);
  };
  
  const handleFontSizeChange = (e) => {
    setFSize(parseInt(e.target.value));
  };
  const handleFontSizeSave = () => {
    onChange(fields, fSize);
  };

  return (
    <div style={{marginTop: 16, border: "1px solid var(--bd)", borderRadius: 8, padding: 16, background: "white"}}>
      <h4 style={{margin: 0, marginBottom: 8, fontSize: ".9rem"}}>Visual Template Mapper</h4>
      <p style={{fontSize: ".75rem", color: "var(--mu)", marginBottom: 16}}>Drag the fields to position them on your template. Click a button below to show/hide a field.</p>
      
      <div 
        ref={containerRef} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
        style={{position: "relative", width: "100%", overflow: "hidden", borderRadius: 8, background: "#f5f5f5", border: "1px dashed var(--bd)", touchAction: "none", minHeight: 200}}
      >
        <img src={imgUrl} style={{width: "100%", display: "block", pointerEvents: "none"}} alt="Template" />
        
        {Object.entries(fields).map(([key, pos]) => pos.visible && (
          <div
            key={key} onPointerDown={(e) => handlePointerDown(e, key)}
            style={{
              position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)",
              background: dragging === key ? "var(--sf)" : "rgba(13, 75, 94, 0.85)", color: "white", padding: "4px 8px", borderRadius: 4,
              fontSize: "12px", fontWeight: 700, cursor: dragging === key ? "grabbing" : "grab", userSelect: "none", whiteSpace: "nowrap", zIndex: dragging === key ? 10 : 1
            }}
          >
            {key}
          </div>
        ))}
      </div>
      
      <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16}}>
        {Object.entries(fields).map(([key, pos]) => (
          <button 
            key={key} onClick={() => toggleVisibility(key)}
            style={{ padding: "6px 12px", borderRadius: 16, fontSize: ".75rem", fontWeight: 600, cursor: "pointer", background: pos.visible ? "var(--tl)" : "#f5f5f5", border: `1px solid ${pos.visible ? "var(--dt)" : "#ddd"}`, color: pos.visible ? "var(--dt)" : "#888" }}
          >
            {pos.visible ? "✓ " : "+ "}{key}
          </button>
        ))}
      </div>
      
      <div style={{marginTop: 20, padding: 16, background: "#f9f9f9", borderRadius: 8, border: "1px solid var(--bd)", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap"}}>
        <div style={{fontWeight: 600, fontSize: ".85rem", color: "var(--dt)", minWidth: 140}}>
          Global Font Size: <span style={{color: "var(--sf)", fontSize: "1rem", marginLeft: 4}}>{fSize}px</span>
        </div>
        <input 
          type="range" min="8" max="48" value={fSize} 
          onChange={handleFontSizeChange} 
          onPointerUp={handleFontSizeSave}
          onBlur={handleFontSizeSave}
          style={{flex: 1, minWidth: 200, cursor: "pointer"}} 
        />
      </div>
    </div>
  );
}

// ── ADMIN: Content Editor Components ─────────────────────────────────────────

const EditorContext = createContext({});

const RowBar = ({ arrPath, idx, total, label }) => {
  const { moveItem, delItem } = useContext(EditorContext);
  return (
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
};

const AddBtn = ({ label, onClick }) => (
  <button onClick={onClick}
    style={{width:"100%",padding:"12px",borderRadius:10,border:"2px dashed var(--sf)",background:"#FFF4EC",color:"var(--sf)",fontWeight:700,fontSize:".88rem",cursor:"pointer",transition:"all .2s",marginTop:6}}
    onMouseEnter={e=>e.currentTarget.style.background="#FFE8D6"}
    onMouseLeave={e=>e.currentTarget.style.background="#FFF4EC"}>
    + Add {label}
  </button>
);

const F = ({label, path, ta, hint}) => {
  const { gv, upd, draft } = useContext(EditorContext);
  const initVal = gv(path);
  const [local, setLocal] = useState(initVal);
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

const Sec = ({id, icon, label, children, onAdd, addLabel}) => {
  const { exp, setExp } = useContext(EditorContext);
  return (
    <div className="csc">
      <div className="csh" style={{userSelect:"none"}}>
        <div onClick={()=>setExp(e=>({...e,[id]:!e[id]}))} style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
          <span style={{fontSize:"1.2rem",flexShrink:0}}>{icon}</span>
          <span style={{fontFamily:"'Playfair Display',serif",fontWeight:700,color:"var(--dt)",fontSize:".95rem",flex:1}}>{label}</span>
          <span style={{color:"var(--tm)",fontSize:".8rem",flexShrink:0,marginRight:8}}>{exp[id]?"▲":"▼"}</span>
        </div>
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
};

const G2 = ({children}) => {
  const { mob } = useContext(EditorContext);
  return <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 16px"}}>{children}</div>;
};

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


  return (
    <EditorContext.Provider value={{ draft, gv, upd, moveItem, delItem, addItem, exp, setExp, mob }}>
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
          <F label="Admin Panel Header Title" path="trust.adminHeader" hint="e.g. Trust Admin"/>
          <F label="Trust Name (English)" path="trust.name"/>
          <F label="Trust Name (Gujarati)" path="trust.nameGu"/>
          <F label="Trust Subtitle (Under Name)" path="trust.subtitle"/>
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
        <F label="Razorpay API Key ID (Live or Test)" path="donate.razorpayKey"/>
        
        <div className="cf">
          <label className="cl">80G Receipt Template Image</label>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {draft.donate.receiptTemplate && (
               <img src={draft.donate.receiptTemplate} style={{width:"100%",maxHeight:150,objectFit:"contain",border:"1px solid var(--bd)",borderRadius:8,background:"#f5f5f5"}} alt="Template"/>
            )}
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <label style={{padding:"7px 14px",borderRadius:8,border:"2px solid var(--sf)",background:"#FFF4EC",color:"var(--sf)",fontWeight:700,fontSize:".78rem",cursor:!auth?.idToken||uploading?"not-allowed":"pointer",opacity:!auth?.idToken?.5:1,fontFamily:"inherit",display:"inline-block"}}>
                {uploading ? "Uploading..." : "Upload Template Image"}
                <input type="file" accept="image/*" disabled={uploading||!auth?.idToken} style={{display:"none"}} onChange={(e) => {
                  const file = e.target.files[0]; if(!file) return;
                  if (!auth?.idToken) { alert("Please login to upload."); return; }
                  setUploading(true);
                  try {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                       const img = new Image();
                       img.onload = () => {
                          const canvas = document.createElement('canvas');
                          let w = img.width; let h = img.height;
                          if (w > 1200) { h = Math.round((1200/w)*h); w = 1200; }
                          canvas.width = w; canvas.height = h;
                          const ctx = canvas.getContext('2d');
                          ctx.drawImage(img, 0, 0, w, h);
                          const b64 = canvas.toDataURL('image/jpeg', 0.85);
                          upd("donate.receiptTemplate", b64);
                          alert("Template uploaded successfully!");
                          setUploading(false);
                       };
                       img.src = event.target.result;
                    };
                    reader.readAsDataURL(file);
                  } catch(err) { alert("Upload failed: " + err.message); setUploading(false); }
                }} />
              </label>
            </div>
            <span style={{fontSize:".75rem",color:"var(--mu)"}}>Upload a blank PNG/JPG template. Text will be overlaid automatically.</span>
          </div>
        </div>
      </Sec>
      
      {draft.donate.receiptTemplate && (
        <div style={{background:"white", borderRadius:12, border:"1px solid var(--bd)", padding:20, marginBottom:32, boxShadow:"0 4px 16px rgba(0,0,0,0.05)"}}>
          <h3 style={{fontFamily:"'Playfair Display',serif",fontWeight:700,color:"var(--dt)",fontSize:"1.2rem",marginTop:0,marginBottom:16}}>Receipt Template Builder</h3>
          <TemplateMapper 
            imgUrl={draft.donate.receiptTemplate} 
            mapData={draft.donate.receiptMap} 
            fontSize={draft.donate.receiptFontSize}
            onChange={(map, size) => { 
               upd("donate.receiptMap", map); 
               upd("donate.receiptFontSize", size); 
            }} 
          />
          <div style={{marginTop: 16, background: "rgba(200,134,10,.05)", border: "1px dashed rgba(200,134,10,.3)", padding: 16, borderRadius: 8}}>
            <h4 style={{fontSize: ".9rem", marginTop: 0, marginBottom: 8}}>Test Your Mapping</h4>
            <p style={{fontSize: ".8rem", color: "var(--mu)", marginTop: 0, marginBottom: 12}}>Generate a test receipt with dummy data to see how your layout looks on an actual PDF before saving.</p>
            <button 
              className="bs" 
              onClick={async () => {
                try {
                  const dummy_r = {
                    id: "DON-TEST-12345",
                    name: "Test Donor Name",
                    amount: 5100,
                    date: new Date().toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'}),
                    pan: "ABCDE1234F",
                    program: "Education"
                  };
                  const url = await generateReceiptPDF(dummy_r, draft, "view");
                  window.open(url, "_blank");
                } catch(e) {
                  alert("Failed to generate test PDF");
                }
              }}
              style={{padding: "8px 16px", borderRadius: 8, fontSize: ".85rem", fontWeight: 700}}
            >
              Generate Test PDF
            </button>
          </div>
        </div>
      )}

      <div style={{background:"white", borderRadius:12, border:"1px solid var(--bd)", padding:20, marginBottom:32, boxShadow:"0 4px 16px rgba(0,0,0,0.05)"}}>
        <h3 style={{fontFamily:"'Playfair Display',serif",fontWeight:700,color:"var(--dt)",fontSize:"1.2rem",marginTop:0,marginBottom:16}}>Sequential Receipt Numbering</h3>
        <div style={{display:"flex", gap: 16, flexWrap:"wrap"}}>
          <label style={{display:"flex", flexDirection:"column", gap:8, fontSize:".85rem", fontWeight:600, color:"var(--dt)"}}>
             Prefix
             <input type="text" className="it" value={draft.donate?.receiptPrefix || ""} onChange={e => upd("donate.receiptPrefix", e.target.value)} placeholder="e.g. VGCT/" style={{width: 100}} />
          </label>
          <label style={{display:"flex", flexDirection:"column", gap:8, fontSize:".85rem", fontWeight:600, color:"var(--dt)"}}>
             Include Year?
             <input type="checkbox" checked={draft.donate?.receiptIncYear || false} onChange={e => upd("donate.receiptIncYear", e.target.checked)} />
          </label>
          <label style={{display:"flex", flexDirection:"column", gap:8, fontSize:".85rem", fontWeight:600, color:"var(--dt)"}}>
             Next Number
             <input type="number" className="it" value={draft.donate?.receiptNextNum || 1} onChange={e => upd("donate.receiptNextNum", parseInt(e.target.value) || 1)} style={{width: 100}} />
          </label>
          <label style={{display:"flex", flexDirection:"column", gap:8, fontSize:".85rem", fontWeight:600, color:"var(--dt)"}}>
             Suffix
             <input type="text" className="it" value={draft.donate?.receiptSuffix || ""} onChange={e => upd("donate.receiptSuffix", e.target.value)} placeholder="e.g. /80G" style={{width: 100}} />
          </label>
        </div>
        <p style={{fontSize: ".8rem", color: "var(--mu)", marginTop: 12, marginBottom: 0}}>
           Next receipt will be generated as: <strong style={{color:"var(--sf)"}}>{draft.donate?.receiptPrefix || ""}{draft.donate?.receiptIncYear ? `${new Date().getFullYear()}-${(new Date().getFullYear()+1).toString().slice(2)}/` : ""}{draft.donate?.receiptNextNum || 1}{draft.donate?.receiptSuffix || ""}</strong>
        </p>
      </div>

      <Sec id="contact" icon="📞" label="Contact and Volunteer">
        <F label="Volunteer Heading" path="contact.volunteerHeading"/>
        <F label="Volunteer Sub-text" path="contact.volunteerSub" ta/>
        <F label="Contact Heading" path="contact.contactHeading"/>
        <div className="cf">
          <label className="cl">Volunteer Options</label>
          {(draft.contact.volunteerOptions || ["Education","Healthcare","Field Work","IT and Digital","Fundraising"]).map((opt,i)=>(
            <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              <BlurInput className="ci" style={{flex:1,marginBottom:0}} value={opt} onCommit={v=>upd(`contact.volunteerOptions.${i}`,v)}/>
              <button onClick={()=>delItem("contact.volunteerOptions",i)}
                style={{padding:"8px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".8rem",color:"#C0392B",flexShrink:0,fontWeight:700}}>Del</button>
            </div>
          ))}
          <AddBtn label="Volunteer Option" onClick={()=>addItem("contact.volunteerOptions","New Option")}/>
        </div>
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
    </EditorContext.Provider>
  );
}


// ── ADMIN DASHBOARD ───────────────────────────────────────────────────────────
const ANAV = [
  {id:"content",icon:"✏️",label:"Content Editor"},
  {id:"overview",icon:"📊",label:"Overview"},
  {id:"donations",icon:"💰",label:"Donations"},
  {id:"events",icon:"📅",label:"Events"},
  {id:"registrations",icon:"📋",label:"Registrations"},
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
          <LogoMark logo={{...C.trust.logo, size: 34, visible: true}} />
          {open && <div style={{fontFamily:"'Playfair Display',serif",color:"white",fontWeight:700,fontSize:".82rem",whiteSpace:"nowrap"}}>{C.trust.adminHeader || "Trust Admin"}</div>}
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
          {tab==="overview"  && <Overview mob={mob} C={C} auth={auth}/>}
          {tab==="donations" && <Donations mob={mob} auth={auth} C={C}/>}
          {tab==="events"    && <AdminEvents mob={mob} C={C} setC={setC} auth={auth}/>}
          {tab==="registrations" && <AdminRegistrations mob={mob} C={C} auth={auth}/>}
          {tab==="volunteers"&& <Volunteers mob={mob} auth={auth} C={C}/>}
          {tab==="gallery"   && <AdminGallery mob={mob} C={C} setC={setC} auth={auth}/>}
          {tab==="settings"  && <Settings mob={mob} C={C}/>}
        </div>
      </div>
    </div>
  );
}

function Overview({ mob, C, auth }) {
  const [data, setData] = useState({
    totalDonations: 0,
    activeVolunteers: 0,
    upcomingEvents: C.events?.length || 0,
    pendingReceipts: 0,
    monthly: [],
    programs: [],
    recentDonations: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth?.idToken) return;
    const fetchAll = async () => {
      try {
        const [dons, vols] = await Promise.all([
          fbFetchDonations(auth.idToken),
          fbFetchVolunteers(auth.idToken)
        ]);
        
        let totalDonations = 0;
        let pendingReceipts = 0;
        const progSums = {};
        
        // Process donations
        dons.forEach(d => {
          if (d.status === "Verified") {
            const amt = Number(d.amount) || 0;
            totalDonations += amt;
            progSums[d.program || "General"] = (progSums[d.program || "General"] || 0) + amt;
            if (!d.receiptNo) pendingReceipts++;
          } else {
            pendingReceipts++;
          }
        });

        // Recent Donations
        const recentDonations = dons.sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 4);

        // Monthly
        const months = {};
        const today = new Date();
        for (let i=5; i>=0; i--) {
          const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
          months[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`] = {
            label: d.toLocaleString('en', {month:'short'}),
            total: 0
          };
        }
        dons.forEach(d => {
          if (d.status !== "Verified") return;
          const dt = new Date(d.date);
          const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
          if (months[key]) months[key].total += (Number(d.amount) || 0);
        });
        const monthly = Object.values(months);

        // Programs
        const programs = Object.entries(progSums)
          .map(([p, v]) => ({ p, v: totalDonations ? Math.round((v/totalDonations)*100) : 0, amt: v }))
          .sort((a,b) => b.v - a.v);
          
        const colors = ["var(--sf)", "var(--dt)", "#7B2D8B", "#1A7A3E", "var(--gd)"];
        programs.forEach((p,i) => p.c = colors[i%colors.length]);

        setData({ 
          totalDonations, 
          activeVolunteers: vols.filter(v => v.status !== "Inactive").length, 
          upcomingEvents: C.events?.length || 0, 
          pendingReceipts, 
          monthly, 
          programs, 
          recentDonations 
        });
      } catch (e) {
        console.error("Failed to fetch overview data", e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [auth?.idToken, C.events]);

  const cards=[
    {l:"Total Donations (Verified)",v:`Rs.${data.totalDonations.toLocaleString()}`,ch:"",up:true,ic:"💰",bg:"#FFF4EC",br:"#FDDBB8"},
    {l:"Active Volunteers",v:data.activeVolunteers.toString(),ch:"",up:true,ic:"🤝",bg:"#E8F4F8",br:"#B8D8E8"},
    {l:"Upcoming Events",v:data.upcomingEvents.toString(),ch:"",up:true,ic:"📅",bg:"#EDFAF1",br:"#B8E8CC"},
    {l:"Pending Receipts/Payments",v:data.pendingReceipts.toString(),ch:data.pendingReceipts>0?"⚠️":"",up:false,ic:"📄",bg:"#FEF9EC",br:"#F5E8B8"}
  ];
  
  const mx = Math.max(...data.monthly.map(m=>m.total), 1);

  if (loading && auth?.idToken) return <div style={{padding:40,textAlign:"center",color:"var(--mu)"}}>Loading live data...</div>;

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
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1rem",color:"var(--dt)",marginBottom:18,fontWeight:700}}>Monthly Donations (Verified)</h3>
          <div style={{display:"flex",alignItems:"flex-end",gap:mob?8:12,height:150}}>
            {data.monthly.length > 0 ? data.monthly.map((m,i)=>(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                <div style={{fontSize:".6rem",color:"var(--mu)"}}>{m.total > 0 ? `Rs.${(m.total/1000).toFixed(1)}k` : ''}</div>
                <div style={{width:"100%",background:i===data.monthly.length-1?"linear-gradient(to top,var(--sf),var(--gd))":"linear-gradient(to top,var(--dt),var(--tm))",borderRadius:"5px 5px 0 0",height:`${Math.max((m.total/mx)*120, 4)}px`}}/>
                <div style={{fontSize:".65rem",color:"var(--mu)"}}>{m.label}</div>
              </div>
            )) : <div style={{flex:1,textAlign:"center",color:"var(--mu)",fontSize:".8rem"}}>No data</div>}
          </div>
        </div>
        <div className="ac" style={{padding:mob?"16px":"22px"}}>
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1rem",color:"var(--dt)",marginBottom:18,fontWeight:700}}>By Program</h3>
          {data.programs.length > 0 ? data.programs.map(r=>(
            <div key={r.p} style={{marginBottom:11}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:".78rem"}}>{r.p}</span><span style={{fontSize:".78rem",fontWeight:700}}>{r.v}%</span></div>
              <div style={{height:7,borderRadius:4,background:"#EEE"}}><div style={{height:"100%",width:`${r.v}%`,background:r.c,borderRadius:4}}/></div>
            </div>
          )) : <div style={{textAlign:"center",color:"var(--mu)",fontSize:".8rem"}}>No data</div>}
        </div>
      </div>
      <div className="ac" style={{padding:mob?"16px":"22px"}}>
        <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1rem",color:"var(--dt)",marginBottom:14,fontWeight:700}}>Recent Donations</h3>
        <div style={{overflowX:"auto"}}>
          <table className="tt" style={{width:"100%",borderCollapse:"collapse",fontSize:".8rem",minWidth:500}}>
            <thead><tr>{["ID","Donor","Amount","Program","Date","Status"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
            <tbody>{data.recentDonations.length > 0 ? data.recentDonations.map((r,i)=>(
              <tr key={i} style={{borderBottom:"1px solid var(--bd)"}}>
                <td style={{padding:"10px 12px",color:"var(--mu)",fontFamily:"monospace",fontSize:".75rem"}}>{r.receiptNo || r.id}</td>
                <td style={{padding:"10px 12px",fontWeight:600}}>{r.name}</td>
                <td style={{padding:"10px 12px",fontWeight:700,color:"var(--sf)"}}>Rs.{Number(r.amount).toLocaleString()}</td>
                <td style={{padding:"10px 12px"}}><span style={{fontSize:".72rem",padding:"3px 9px",borderRadius:12,background:"var(--tl)",color:"var(--dt)",fontWeight:600}}>{r.program}</span></td>
                <td style={{padding:"10px 12px",color:"var(--mu)",fontSize:".78rem"}}>{r.date}</td>
                <td style={{padding:"10px 12px"}}><span style={{fontSize:".72rem",padding:"3px 9px",borderRadius:12,fontWeight:600,background:r.status==="Verified"?"#EDFAF1":"#FEF9EC",color:r.status==="Verified"?"#1A7A3E":"#C8860A"}}>{r.status}</span></td>
              </tr>
            )) : <tr><td colSpan="6" style={{textAlign:"center",padding:20,color:"var(--mu)"}}>No recent donations found.</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const MultiSelect = ({ options, value, onChange, width = 100 }) => {
  const [open, setOpen] = useState(false);
  const toggle = (opt) => {
    if (value.includes(opt)) onChange(value.filter(v => v !== opt));
    else onChange([...value, opt]);
  };
  return (
    <div style={{position:"relative", width, marginBottom: 4}} onMouseLeave={() => setOpen(false)}>
      <div onClick={() => setOpen(!open)} style={{padding:"2px 4px", border:"1px solid var(--bd)", borderRadius:4, cursor:"pointer", fontSize:".7rem", background:"white", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
        <span style={{overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1}}>
          {value.length === 0 ? "All" : value.length === 1 ? value[0] : value.length + " selected"}
        </span>
        <span style={{fontSize:".5rem", marginLeft:4}}>▼</span>
      </div>
      {open && (
        <div style={{position:"absolute", top:"100%", left:0, minWidth:"100%", background:"white", border:"1px solid var(--bd)", zIndex:100, maxHeight:180, overflowY:"auto", boxShadow:"0 4px 6px rgba(0,0,0,0.1)", borderRadius:4}}>
          {options.map(opt => (
            <div key={opt} onClick={() => toggle(opt)} style={{padding:"4px 8px", fontSize:".7rem", cursor:"pointer", display:"flex", alignItems:"center", gap:6, background: value.includes(opt) ? "var(--tl)" : "transparent", borderBottom:"1px solid #f0f0f0"}}>
              <input type="checkbox" checked={value.includes(opt)} readOnly style={{margin:0}}/>
              <span style={{whiteSpace:"nowrap"}}>{opt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function Donations({ mob, auth, C }) {
  const [q,setQ]=useState(""); 
  const [colF, setColF] = useState({ id: [], donor: [], amountOp: ">=", amountVal: "", program: [], date: [], pan: [], status: [], statusBtns: "All" });
  const [data, setData] = useState([]);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const token = auth?.idToken || auth?._tokenResponse?.idToken;
        const res = await fbFetchDonations(token);
        setData(res);
      } catch(e) { console.error(e); }
      setLoading(false);
    };
    if (auth) load();
  }, [auth]);

  const generateReceipt = async (r, action) => {
    if (r.receiptUrl) {
      if (action === 'view') {
        setPreviewUrl(r.receiptUrl);
      } else {
        const link = document.createElement("a");
        link.href = r.receiptUrl;
        const safeId = (r.receiptNo || r.id).replace(/\//g, "-");
        link.download = `Receipt_${safeId}.pdf`;
        link.target = "_blank";
        link.click();
      }
      return;
    }
    const url = await generateReceiptPDF(r, C, action);
    if (url && action === 'view') {
      setPreviewUrl(url);
    }
  };

  const assignReceiptNumber = async (r) => {
    if (!window.confirm("Assign the next sequential receipt number to this donation? This will increment the counter.")) return;
    try {
       const prefix = C.donate?.receiptPrefix || "";
       const suffix = C.donate?.receiptSuffix || "";
       const nextNo = C.donate?.receiptNextNum || 1;
       const incYear = C.donate?.receiptIncYear || false;
       let yearStr = "";
       if (incYear) {
          const y = new Date().getFullYear();
          yearStr = `${y}-${(y+1).toString().slice(2)}/`;
       }
       const finalId = `${prefix}${yearStr}${nextNo}${suffix}`;
       
       const updated = { ...r, receiptNo: finalId };
       
       const targetId = r._docId || r.id;
       await fbUpdateDonation(targetId, updated, auth?.idToken);
       
       const newC = JSON.parse(JSON.stringify(C));
       if (!newC.donate) newC.donate = {};
       newC.donate.receiptNextNum = nextNo + 1;
       
       // Mutate local C so we don't have to reload the page to get the updated counter
       if (!C.donate) C.donate = {};
       C.donate.receiptNextNum = nextNo + 1;
       
       await fbSave(newC, auth?.idToken);
       
       setData(prev => prev.map(x => (x._docId && x._docId === r._docId) || (!x._docId && x.id === r.id) ? updated : x));
       alert(`Receipt number ${finalId} assigned successfully!`);
    } catch (e) {
       alert("Failed to assign receipt number: " + e.message);
    }
  };

  const handleStatusChange = async (r, newStatus) => {
    try {
      let updated = { ...r, status: newStatus };
      if (newStatus === "Verified" && r.status !== "Verified") {
        try {
          const blob = await generateReceiptPDF(updated, C, "blob");
          if (blob) {
            const file = new File([blob], `Receipt_${r.id}.pdf`, { type: "application/pdf" });
            const url = await fbUploadPublicFile(file, auth?.idToken);
            updated.receiptUrl = url;
          }
        } catch(err) {
          console.error("Failed to generate and upload initial PDF:", err);
        }
      }
      if (r._docId) {
        await fbUpdateDonation(r._docId, updated, auth?.idToken);
      } else if (!r.id.startsWith("DON")) {
        // Fallback for older items that might use id as docId
        await fbUpdateDonation(r.id, updated, auth?.idToken);
      }
      setData(prev => prev.map(x => (x._docId && x._docId === r._docId) || (!x._docId && x.id === r.id) ? updated : x));
    } catch(e) {
      console.error(e);
      alert("Failed to update donation status: " + e.message);
    }
  };

  const handlePanChange = async (r, newPan) => {
    if ((r.pan || "") === newPan) return;
    try {
      const updated = { ...r, pan: newPan };
      
      if (r.receiptUrl) {
        alert("PAN modified locally. You MUST click 'Regenerate' to permanently save this PAN and update the frozen PDF receipt!");
      } else {
        if (r._docId) {
          await fbUpdateDonation(r._docId, updated, auth?.idToken);
        } else if (!r.id.startsWith("DON")) {
          await fbUpdateDonation(r.id, updated, auth?.idToken);
        }
      }
      
      setData(prev => prev.map(x => (x._docId && x._docId === r._docId) || (!x._docId && x.id === r.id) ? updated : x));
    } catch(e) {
      console.error(e);
      alert("Failed to update PAN: " + e.message);
    }
  };

  const handleRegenerate = async (r) => {
    if (!window.confirm("Are you sure you want to overwrite the existing receipt?")) return;
    try {
      setLoading(true);
      const blob = await generateReceiptPDF(r, C, "blob");
      if (blob) {
        const file = new File([blob], `Receipt_${r.id}.pdf`, { type: "application/pdf" });
        const url = await fbUploadPublicFile(file, auth?.idToken);
        const updated = { ...r, receiptUrl: url };
        
        if (r._docId) {
          await fbUpdateDonation(r._docId, updated, auth?.idToken);
        } else if (!r.id.startsWith("DON")) {
          await fbUpdateDonation(r.id, updated, auth?.idToken);
        }
        setData(prev => prev.map(x => (x._docId && x._docId === r._docId) || (!x._docId && x.id === r.id) ? updated : x));
        alert("Receipt regenerated successfully!");
      }
    } catch(e) {
      console.error(e);
      alert("Failed to regenerate receipt: " + e.message);
    }
    setLoading(false);
  };

  const allData = data.length > 0 ? data : DDATA;
  const uniqueIds = [...new Set(allData.map(d => d.id).filter(Boolean))];
  const uniqueDonors = [...new Set(allData.map(d => d.name).filter(Boolean))];
  const uniquePrograms = [...new Set(allData.map(d => d.program).filter(Boolean))];
  const uniqueDates = [...new Set(allData.map(d => d.date).filter(Boolean))];
  const uniquePans = [...new Set(allData.map(d => d.pan).filter(Boolean))];
  const uniqueStatuses = ["Verified", "Pending", "Pending (Payment Link)"];

  const rows = allData.filter(d => {
    const matchQ = d.name?.toLowerCase().includes(q.toLowerCase()) || d.id?.toLowerCase().includes(q.toLowerCase());
    
    const matchId = colF.id.length === 0 || colF.id.includes(d.id);
    const matchDonor = colF.donor.length === 0 || colF.donor.includes(d.name);
    
    let matchAmount = true;
    if (colF.amountVal !== "") {
      const val = parseFloat(colF.amountVal);
      const rowAmt = parseFloat(d.amount);
      if (!isNaN(val) && !isNaN(rowAmt)) {
        if (colF.amountOp === ">") matchAmount = rowAmt > val;
        else if (colF.amountOp === ">=") matchAmount = rowAmt >= val;
        else if (colF.amountOp === "<") matchAmount = rowAmt < val;
        else if (colF.amountOp === "<=") matchAmount = rowAmt <= val;
        else if (colF.amountOp === "=") matchAmount = rowAmt === val;
      }
    }

    const matchProgram = colF.program.length === 0 || colF.program.includes(d.program);
    const matchDate = colF.date.length === 0 || colF.date.includes(d.date);
    const matchPan = colF.pan.length === 0 || colF.pan.includes(d.pan);
    
    const currentStatus = d.status || "Pending";
    const matchStatus = colF.status.length === 0 || colF.status.includes(currentStatus);
    const matchStatusBtn = colF.statusBtns === "All" || currentStatus === colF.statusBtns;
    
    return matchQ && matchId && matchDonor && matchAmount && matchProgram && matchDate && matchPan && matchStatus && matchStatusBtn;
  });

  const downloadCSV = () => {
    const headers = ["ID", "Donor", "Amount", "Program", "Date", "PAN", "Status", "Receipt_URL"];
    const csvRows = [headers.join(",")];
    rows.forEach(r => {
      const csvRow = [
        r.id || "",
        `"${(r.name || "").replace(/"/g, '""')}"`,
        r.amount || 0,
        `"${(r.program || "").replace(/"/g, '""')}"`,
        r.date || "",
        r.pan || "",
        r.status || "Pending",
        r.receiptUrl || ""
      ];
      csvRows.push(csvRow.join(","));
    });
    const blob = new Blob([csvRows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Donations_Export_${new Date().getTime()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search ID or Name..." style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit",flex:1,minWidth:140}}/>
        <div style={{display:"flex",gap:6}}>{["All","Verified","Pending"].map(v=><button key={v} onClick={()=>setColF({...colF, statusBtns: v})} style={{padding:"8px 14px",borderRadius:8,background:colF.statusBtns===v?"var(--dt)":"white",color:colF.statusBtns===v?"white":"var(--tm2)",border:`1px solid ${colF.statusBtns===v?"var(--dt)":"var(--bd)"}`,cursor:"pointer",fontWeight:600,fontSize:".8rem"}}>{v}</button>)}</div>
        <button onClick={downloadCSV} className="bs" style={{padding:"8px 14px",borderRadius:8,fontWeight:600,fontSize:".8rem", background:"var(--sf)", color:"white", border:"none", cursor:"pointer"}}>Download CSV</button>
        <button className="bs" style={{padding:"8px 14px",borderRadius:8,fontWeight:600,fontSize:".8rem"}}>+ Add</button>
      </div>
      <div className="ac" style={{padding:16,overflowX:"auto"}}>
        <table className="tt" style={{width:"100%",borderCollapse:"collapse",fontSize:".8rem",minWidth:500}}>
          <thead>
            <tr>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>ID</div>
                <MultiSelect options={uniqueIds} value={colF.id} onChange={v=>setColF({...colF, id: v})} width={90} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>DONOR</div>
                <MultiSelect options={uniqueDonors} value={colF.donor} onChange={v=>setColF({...colF, donor: v})} width={100} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>AMOUNT</div>
                <div style={{display:"flex", gap:2}}>
                  <select value={colF.amountOp} onChange={e=>setColF({...colF, amountOp: e.target.value})} style={{fontSize:".7rem",padding:"2px",borderRadius:4,border:"1px solid var(--bd)",outline:"none",cursor:"pointer"}}>
                    <option value=">">&gt;</option>
                    <option value=">=">&ge;</option>
                    <option value="<">&lt;</option>
                    <option value="<=">&le;</option>
                    <option value="=">=</option>
                  </select>
                  <input type="number" value={colF.amountVal} onChange={e=>setColF({...colF, amountVal: e.target.value})} placeholder="Amt" style={{fontSize:".7rem",padding:"2px 4px",maxWidth:50,borderRadius:4,border:"1px solid var(--bd)",outline:"none"}}/>
                </div>
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>PROGRAM</div>
                <MultiSelect options={uniquePrograms} value={colF.program} onChange={v=>setColF({...colF, program: v})} width={100} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>DATE</div>
                <MultiSelect options={uniqueDates} value={colF.date} onChange={v=>setColF({...colF, date: v})} width={90} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>PAN</div>
                <MultiSelect options={uniquePans} value={colF.pan} onChange={v=>setColF({...colF, pan: v})} width={90} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>STATUS</div>
                <MultiSelect options={uniqueStatuses} value={colF.status} onChange={v=>setColF({...colF, status: v})} width={100} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>RECEIPT</th>
            </tr>
          </thead>
          <tbody>{rows.map((r,i)=>(
            <tr key={i} style={{borderBottom:"1px solid var(--bd)"}}>
              <td style={{padding:"10px 12px",color:"var(--mu)",fontFamily:"monospace",fontSize:".75rem"}}>
                <strong style={{color:"var(--dt)"}}>{r.receiptNo || r.id}</strong>
                {r.receiptNo && <div style={{fontSize:".65rem",color:"#aaa"}}>{r.id}</div>}
                {r.razorpay_payment_id && <div style={{fontSize:".65rem",color:"var(--sf)"}} title="Razorpay Txn ID">{r.razorpay_payment_id}</div>}
              </td>
              <td style={{padding:"10px 12px",fontWeight:600}}>{r.name}</td>
              <td style={{padding:"10px 12px",fontWeight:700,color:"var(--sf)"}}>Rs.{r.amount.toLocaleString()}</td>
              <td style={{padding:"10px 12px"}}><span style={{fontSize:".72rem",padding:"3px 9px",borderRadius:12,background:"var(--tl)",color:"var(--dt)",fontWeight:600}}>{r.program}</span></td>
              <td style={{padding:"10px 12px",color:"var(--mu)",fontSize:".78rem"}}>{r.date}</td>
              <td style={{padding:"10px 12px"}}>
                <input type="text" defaultValue={r.pan || ""} onBlur={(e)=>handlePanChange(r, e.target.value)} placeholder="PAN No." style={{fontSize:".75rem", padding:"4px 8px", borderRadius:6, border:"1px solid var(--bd)", width: 100, outline:"none"}} />
              </td>
              <td style={{padding:"10px 12px"}}>
                <select value={r.status || "Pending"} onChange={(e) => handleStatusChange(r, e.target.value)} style={{fontSize:".72rem",padding:"3px 6px",borderRadius:6,border:"1px solid var(--bd)",fontWeight:600,background:r.status==="Verified"?"#EDFAF1":r.status==="Rejected"?"#FEF0EF":"#FEF9EC",color:r.status==="Verified"?"#1A7A3E":r.status==="Rejected"?"#C0392B":"#C8860A",cursor:"pointer",outline:"none"}}>
                  <option value="Pending (Payment Link)">Pending (Payment Link)</option>
                  <option value="Pending">Pending</option>
                  <option value="Verified">Verified</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </td>
              <td style={{padding:"10px 12px"}}>
                <div style={{display:"flex",gap:4, flexWrap:"wrap", alignItems: "center"}}>
                  {!r.receiptNo && r.status === "Verified" && (
                    <button onClick={()=>assignReceiptNumber(r)} style={{padding:"4px 9px",borderRadius:6,background:"var(--sf)",border:"none",color:"white",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>Assign No.</button>
                  )}
                  <button onClick={()=>generateReceipt(r, 'view')} style={{padding:"4px 9px",borderRadius:6,background:"#EDFAF1",border:"none",color:"#1A7A3E",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>View</button>
                  <button onClick={()=>generateReceipt(r, 'download')} style={{padding:"4px 9px",borderRadius:6,background:"#FFF4EC",border:"none",color:"var(--sf)",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>Download</button>
                  {r.status === "Verified" && (
                    <button onClick={()=>handleRegenerate(r)} style={{padding:"4px 9px",borderRadius:6,background:"#FEECEC",border:"none",color:"#D93025",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>Regenerate</button>
                  )}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {rows.length===0&&<div style={{textAlign:"center",padding:28,color:"var(--mu)"}}>No results found.</div>}
      </div>
      {previewUrl && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:99999, display:"flex", alignItems:"center", justifyContent:"center", padding: "4vh 4vw"}}>
          <div style={{background:"white", borderRadius: 16, width:"100%", maxWidth: 900, height:"100%", display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 20px 40px rgba(0,0,0,0.4)"}}>
            <div style={{padding:"16px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid var(--bd)", background:"#F8F9FA"}}>
              <div style={{fontWeight:700, fontSize:"1.2rem", color:"var(--dt)"}}>Receipt Preview</div>
              <button onClick={()=>setPreviewUrl(null)} style={{background:"#E8EAED", border:"none", color:"var(--dt)", cursor:"pointer", fontSize:"1.4rem", width:36, height:36, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:"bold"}}>&times;</button>
            </div>
            <div style={{flex:1,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",background:"#F5F5F5"}}>
              <iframe src={previewUrl} style={{width:"100%", height:"100%", border:"none", borderRadius:"0 0 16px 16px"}} title="Receipt Preview" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminForms({ C, setC, saveToFb, mob }) {
  const defaultFields = [
    { id: "fl_1", label: "Mobile Number", type: "tel" },
    { id: "fl_2", label: "Full Name", type: "fullname" },
    { id: "fl_3", label: "Email Address", type: "email" },
    { id: "fl_4", label: "Age", type: "number" },
    { id: "fl_5", label: "Gender", type: "gender" },
    { id: "fl_6", label: "Address", type: "address" },
    { id: "fl_7", label: "Blood Group", type: "text" },
    { id: "fl_8", label: "Passport Size Photo", type: "image" },
    { id: "fl_9", label: "Supporting Document", type: "file" }
  ];

  const [forms, setForms] = useState(C.forms || []);
  const [editingId, setEditingId] = useState(null);
  const [fieldLib, setFieldLib] = useState(C.fieldLibrary || defaultFields);
  const [isAddingLib, setIsAddingLib] = useState(false);
  const [newLibLabel, setNewLibLabel] = useState("");
  const [newLibType, setNewLibType] = useState("text");

  useEffect(() => {
    setForms(C.forms || []);
    setFieldLib(C.fieldLibrary || defaultFields);
  }, [C.forms, C.fieldLibrary]);

  const saveLib = (newLib) => {
    setFieldLib(newLib);
    const newC = {...C, fieldLibrary: newLib};
    setC(newC);
    saveToFb(newC);
  };

  const handleCreateStandardField = () => {
    if(!newLibLabel.trim()) return;
    const nf = { id: "fl_"+Date.now(), label: newLibLabel.trim(), type: newLibType };
    
    const newLib = [...fieldLib, nf];
    let newForms = forms;
    
    if (editingId) {
      newForms = forms.map(f => {
        if (f.id === editingId) {
          return {...f, fields: [...f.fields, { label: nf.label, type: nf.type, required: false }]};
        }
        return f;
      });
      setForms(newForms);
    }
    
    setFieldLib(newLib);
    const newC = {...C, fieldLibrary: newLib, forms: newForms};
    setC(newC);
    saveToFb(newC);
    
    setNewLibLabel("");
    setIsAddingLib(false);
  };

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
                     <div key={idx} style={{display:"flex",gap:8,alignItems:"center",background:"#F5F5F5",padding:"8px 12px",borderRadius:6}}>
                       <div style={{flex:1,fontWeight:700,fontSize:".85rem",color:"var(--dt)"}}>{field.label}</div>
                       <div style={{fontSize:".75rem",color:"var(--mu)",background:"#E0E0E0",padding:"2px 8px",borderRadius:12,fontWeight:600}}>{field.type}</div>
                       <label style={{fontSize:".75rem",display:"flex",alignItems:"center",gap:4,marginLeft:10,fontWeight:600,color:"var(--dt)",cursor:"pointer"}}><input type="checkbox" checked={field.required} onChange={e=>{
                         const newF = [...f.fields]; newF[idx].required = e.target.checked; updateForm(f.id, {...f, fields:newF});
                       }}/> Req</label>
                       <button onClick={()=>{
                         const newF = [...f.fields]; newF.splice(idx, 1); updateForm(f.id, {...f, fields:newF});
                       }} style={{background:"none",border:"none",color:"#C0392B",cursor:"pointer",fontSize:"1.2rem",marginLeft:10,lineHeight:1}}>×</button>
                     </div>
                   ))}
                 </div>
                 <div style={{background:"#F9F9F9",padding:12,borderRadius:8,border:"1px solid var(--bd)",marginBottom:12}}>
                    <p style={{fontSize:".8rem",fontWeight:700,marginBottom:8,color:"var(--dt)"}}>Add a Standard Field</p>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
                      <select id={`sel_${f.id}`} style={{flex:1,padding:"8px",border:"1px solid var(--bd)",borderRadius:6,fontSize:".85rem"}}>
                        <option value="">-- Choose from Library --</option>
                        {fieldLib.map(fl => <option key={fl.id} value={fl.id}>{fl.label} ({fl.type})</option>)}
                      </select>
                      <button onClick={()=>{
                        const sel = document.getElementById(`sel_${f.id}`);
                        if(!sel.value) return;
                        const target = fieldLib.find(fl => fl.id === sel.value);
                        if(target) updateForm(f.id, {...f, fields: [...f.fields, {label:target.label, type:target.type, required:false}]});
                        sel.value = "";
                      }} className="bt" style={{padding:"8px 16px",borderRadius:6,fontSize:".8rem",fontWeight:700}}>Add</button>
                    </div>
                    {!isAddingLib ? (
                      <button onClick={()=>setIsAddingLib(true)} style={{fontSize:".8rem",background:"var(--dt)",color:"white",border:"none",padding:"6px 12px",borderRadius:6,cursor:"pointer",fontWeight:600,marginTop:4}}>+ Create New Standard Field</button>
                    ) : (
                      <div style={{display:"flex",gap:6,alignItems:"center",marginTop:6,background:"white",padding:10,borderRadius:6,border:"1px dashed var(--tl)"}}>
                        <input value={newLibLabel} onChange={e=>setNewLibLabel(e.target.value)} placeholder="Field Label (e.g. T-Shirt Size)" style={{flex:1,padding:"6px",fontSize:".8rem",border:"1px solid var(--bd)",borderRadius:4}}/>
                        <select value={newLibType} onChange={e=>setNewLibType(e.target.value)} style={{padding:"6px",fontSize:".8rem",border:"1px solid var(--bd)",borderRadius:4}}>
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="email">Email</option>
                          <option value="tel">Phone</option>
                          <option value="date">Date</option>
                          <option value="fullname">Full Name</option>
                          <option value="address">Address</option>
                          <option value="gender">Gender</option>
                          <option value="image">Photo Upload (Image)</option>
                          <option value="file">Document Upload (PDF/Word)</option>
                        </select>
                        <button onClick={handleCreateStandardField} style={{padding:"6px 12px",background:"#1A7A3E",color:"white",border:"none",borderRadius:4,fontSize:".75rem",cursor:"pointer",fontWeight:700}}>Save</button>
                        <button onClick={()=>setIsAddingLib(false)} style={{padding:"6px 12px",background:"#EEE",border:"none",borderRadius:4,fontSize:".75rem",cursor:"pointer",fontWeight:600}}>Cancel</button>
                      </div>
                    )}
                 </div>
                 <div style={{display:"flex",gap:8}}>
                   <div style={{flex:1}}/>
                   <button onClick={()=>setEditingId(null)} className="bt" style={{padding:"6px 16px",borderRadius:6,fontWeight:700,fontSize:".85rem"}}>Done</button>
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

function Volunteers({ mob, auth, C }) {
  const [q,setQ]=useState(""); 
  const [colF, setColF] = useState({ name: [], city: [], program: [], status: [] });
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const token = auth?.idToken || auth?._tokenResponse?.idToken;
        const res = await fbFetchVolunteers(token);
        setData(res);
      } catch(e) { console.error(e); }
      setLoading(false);
    };
    if (auth) load();
  }, [auth]);

  const handleStatusChange = async (r, newStatus) => {
    try {
      const updated = { ...r, status: newStatus, statusUpdatedAt: new Date().toISOString() };
      await fbUpdateVolunteer(r._docId, updated, auth?.idToken);
      setData(prev => prev.map(x => x._docId === r._docId ? updated : x));
    } catch(e) {
      console.error(e);
      alert("Failed to update status: " + e.message);
    }
  };

  const uniqueNames = [...new Set(data.map(d => d.name).filter(Boolean))];
  const uniqueCities = [...new Set(data.map(d => d.city).filter(Boolean))];
  const uniquePrograms = [...new Set(data.map(d => d.program).filter(Boolean))];
  const uniqueStatuses = ["Pending", "Approved", "Rejected"];

  const rows = data.filter(d => {
    const matchQ = d.name?.toLowerCase().includes(q.toLowerCase()) || d.phone?.includes(q) || d.email?.toLowerCase().includes(q.toLowerCase());
    
    const matchName = colF.name.length === 0 || colF.name.includes(d.name);
    const matchCity = colF.city.length === 0 || colF.city.includes(d.city);
    const matchProgram = colF.program.length === 0 || colF.program.includes(d.program);
    const currentStatus = d.status || "Pending";
    const matchStatus = colF.status.length === 0 || colF.status.includes(currentStatus);
    
    return matchQ && matchName && matchCity && matchProgram && matchStatus;
  }).sort((a,b) => new Date(b._submittedAt||0) - new Date(a._submittedAt||0));

  const downloadCSV = () => {
    const headers = ["Name", "Email", "Phone", "City", "Program", "Status", "Date Submitted"];
    const csvRows = [headers.join(",")];
    rows.forEach(r => {
      const csvRow = [
        `"${(r.name || "").replace(/"/g, '""')}"`,
        `"${(r.email || "").replace(/"/g, '""')}"`,
        `"${(r.phone || "").replace(/"/g, '""')}"`,
        `"${(r.city || "").replace(/"/g, '""')}"`,
        `"${(r.program || "").replace(/"/g, '""')}"`,
        r.status || "Pending",
        r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : ""
      ];
      csvRows.push(csvRow.join(","));
    });
    const blob = new Blob([csvRows.join("\\r\\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Volunteers_Export_${new Date().getTime()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search Name, Email, or Phone..." style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit",flex:1,minWidth:140}}/>
        <button onClick={downloadCSV} className="bs" style={{padding:"8px 14px",borderRadius:8,fontWeight:600,fontSize:".8rem", background:"var(--sf)", color:"white", border:"none", cursor:"pointer"}}>Download CSV</button>
      </div>
      <div className="ac" style={{padding:16,overflowX:"auto"}}>
        <table className="tt" style={{width:"100%",borderCollapse:"collapse",fontSize:".8rem",minWidth:600}}>
          <thead>
            <tr>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>NAME</div>
                <MultiSelect options={uniqueNames} value={colF.name} onChange={v=>setColF({...colF, name: v})} width={110} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>CONTACT INFO</th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>CITY</div>
                <MultiSelect options={uniqueCities} value={colF.city} onChange={v=>setColF({...colF, city: v})} width={100} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>PROGRAM</div>
                <MultiSelect options={uniquePrograms} value={colF.program} onChange={v=>setColF({...colF, program: v})} width={110} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>
                <div style={{marginBottom:4}}>STATUS</div>
                <MultiSelect options={uniqueStatuses} value={colF.status} onChange={v=>setColF({...colF, status: v})} width={100} />
              </th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>APPLIED DATE</th>
              <th style={{padding:"9px 12px",textAlign:"left",fontSize:".72rem",letterSpacing:.5,textTransform:"uppercase"}}>STATUS DATE</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="7" style={{textAlign:"center",padding:40,color:"var(--mu)"}}>Loading...</td></tr>}
            {!loading && rows.length===0 && <tr><td colSpan="7" style={{textAlign:"center",padding:40,color:"var(--mu)"}}>No applicants found.</td></tr>}
            {!loading && rows.map((r,i)=>(
            <tr key={i} style={{borderBottom:"1px solid var(--bd)"}}>
              <td style={{padding:"11px 12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:9}}>
                  <div style={{width:30,height:30,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:700,fontSize:".78rem"}}>{r.name?.[0]?.toUpperCase()||"?"}</div>
                  <span style={{fontWeight:600}}>{r.name}</span>
                </div>
              </td>
              <td style={{padding:"11px 12px",color:"var(--tm2)",fontSize:".75rem"}}>
                <div style={{marginBottom:2}}>{r.email}</div>
                <div>{r.phone}</div>
              </td>
              <td style={{padding:"11px 12px",color:"var(--tm2)",fontSize:".8rem"}}>{r.city}</td>
              <td style={{padding:"11px 12px"}}><span style={{fontSize:".72rem",padding:"3px 9px",borderRadius:12,background:"var(--tl)",color:"var(--dt)",fontWeight:600}}>{r.program}</span></td>
              <td style={{padding:"11px 12px"}}>
                <select value={r.status || "Pending"} onChange={(e) => handleStatusChange(r, e.target.value)} style={{fontSize:".72rem",padding:"3px 6px",borderRadius:6,border:"1px solid var(--bd)",fontWeight:600,background:r.status==="Approved"?"#EDFAF1":r.status==="Rejected"?"#FEF0EF":"#FEF9EC",color:r.status==="Approved"?"#1A7A3E":r.status==="Rejected"?"#C0392B":"#C8860A",cursor:"pointer",outline:"none"}}>
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </td>
              <td style={{padding:"11px 12px",color:"var(--mu)",fontSize:".78rem"}}>{r._submittedAt ? new Date(r._submittedAt).toLocaleDateString() : ""}</td>
              <td style={{padding:"11px 12px",color:"var(--mu)",fontSize:".78rem"}}>{r.statusUpdatedAt ? new Date(r.statusUpdatedAt).toLocaleDateString() : "-"}</td>
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
  const w = useW(); const mob = w < 768;

  const [globalAuthToken, setGlobalAuthToken] = useState(() => localStorage.getItem("trustPublicAuthToken") || "");
  const [globalProfile, setGlobalProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trustPublicProfile")) || null; }
    catch(e) { return null; }
  });

  const handlePublicLogin = (token, profile) => {
    setGlobalAuthToken(token);
    setGlobalProfile(profile);
    localStorage.setItem("trustPublicAuthToken", token);
    localStorage.setItem("trustPublicProfile", JSON.stringify(profile));
  };

  const handlePublicLogout = () => {
    setGlobalAuthToken("");
    setGlobalProfile(null);
    localStorage.removeItem("trustPublicAuthToken");
    localStorage.removeItem("trustPublicProfile");
  };

  const [showDashboard, setShowDashboard] = useState(false);
  const [showUserLogin, setShowUserLogin] = useState("");
  const [viewPolicy, setViewPolicy] = useState(null);

  const handleFooterLinkClick = (id) => {
    if (["privacy", "terms", "refund"].includes(id)) {
      setViewPolicy(id);
      window.scrollTo({top:0, behavior:'smooth'});
    } else {
      setViewPolicy(null);
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({behavior:"smooth"});
      }, 50);
    }
  };

  return (
    <div>
      <Navbar C={C} lang={lang} setLang={setLang} setPage={setPage} auth={auth} onShowLogin={onShowLogin} globalProfile={globalProfile} onPublicLogout={handlePublicLogout} onShowDashboard={()=>setShowDashboard(true)} onShowUserLogin={()=>setShowUserLogin("nav")} onHomeClick={()=>setViewPolicy(null)}/>
      {viewPolicy ? <PolicyPage type={viewPolicy} C={C}/> : (
        <>
          <Hero C={C} lang={lang}/>
          {bs.about    !== false && <About C={C} lang={lang}/>}
          {bs.programs !== false && <Programs C={C}/>}
          {bs.gallery  !== false && <Gallery C={C}/>}
          {bs.events   !== false && <Events C={C} globalAuthToken={globalAuthToken} globalProfile={globalProfile} onPublicLogin={handlePublicLogin}/>}
          {bs.donate   !== false && <Donate C={C} lang={lang} globalProfile={globalProfile} globalAuthToken={globalAuthToken} onShowUserLogin={()=>setShowUserLogin("donate")}/>}
          {custom.map(sec => <CustomSection key={sec.id} sec={sec} lang={lang}/>)}
          {bs.contact  !== false && <Contact C={C}/>}
        </>
      )}
      <Footer C={C} onFooterLinkClick={handleFooterLinkClick}/>
      <button className="bs" onClick={()=>document.getElementById("donate")?.scrollIntoView({behavior:"smooth"})} style={{position:"fixed",bottom:24,right:24,zIndex:999,width:52,height:52,borderRadius:"50%",fontSize:"1.3rem",boxShadow:"0 8px 28px rgba(232,101,10,.45)",display:"flex",alignItems:"center",justifyContent:"center",border:"none"}} title="Donate Now">❤️</button>
      {globalProfile && (
        <button className="bs" onClick={()=>setShowDashboard(true)} style={{position:"fixed",bottom:90,right:24,zIndex:999,background:"var(--dt)",color:"white",border:"border:1px solid #B8D8E8",width:52,height:52,borderRadius:"50%",fontSize:"1.2rem",boxShadow:"0 8px 28px rgba(13,75,94,.35)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all .2s"}} title="My Dashboard">
          👤
        </button>
      )}
      {showUserLogin && <UserLoginModal onClose={()=>setShowUserLogin("")} onPublicLogin={(t, p)=>{handlePublicLogin(t,p); const intent = showUserLogin; setShowUserLogin(""); if(intent === "nav") setShowDashboard(true);}}/>}
      {showDashboard && <UserDashboard C={C} globalProfile={globalProfile} globalAuthToken={globalAuthToken} onClose={()=>setShowDashboard(false)} />}
    </div>
  );
}

// ── PUBLIC USER LOGIN MODAL ───────────────────────────────────────────────────
function UserLoginModal({ onClose, onPublicLogin }) {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regGender, setRegGender] = useState("");
  const [regImageFile, setRegImageFile] = useState(null);
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const w = useW(); const mob = w < 640;

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!mobile || !password) { setAuthError("Please enter mobile and password"); return; }
    if (!isLoginMode && (!regName || !regAddress || !regGender || !regEmail)) { setAuthError("Please fill out Name, Email, Address, and Gender."); return; }
    setSubmitting(true); setAuthError("");
    try {
      const email = `${mobile.replace(/\D/g,'')}@vidyagohil.com`;
      const res = !isLoginMode ? await fbSignUp(email, password) : await fbLogin(email, password);
      
      let profileData = { name: regName, email: regEmail, address: regAddress, gender: regGender, mobile: mobile, photoUrl: "" };
      
      if (!isLoginMode) {
        if (regImageFile) {
          profileData.photoUrl = await fbUploadPublicFile(regImageFile, res.idToken).catch(()=>"");
        }
        await fbUpdateProfile(res.idToken, regName, profileData.photoUrl || "").catch(()=>null);
        await fbSaveUserProfile(res.localId, profileData, res.idToken).catch(()=>null);
      } else {
        const pData = await fbFetchUserProfile(res.localId, res.idToken);
        if (pData) profileData = { ...profileData, ...pData };
      }
      if (onPublicLogin) onPublicLogin(res.idToken, profileData);
      onClose();
    } catch(err) {
      setAuthError(err.message.includes("INVALID") ? "Invalid mobile or password." : err.message.includes("EXISTS") ? "Account exists. Please click Login." : err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(13,75,94,.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:mob?16:24,zIndex:9999,backdropFilter:"blur(6px)"}}>
      <div style={{background:"white",borderRadius:24,width:"100%",maxWidth:400,padding:"24px",boxShadow:"0 32px 80px rgba(0,0,0,.3)",position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:16,right:16,background:"#F5F5F5",border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"var(--dt)"}}>✕</button>
        <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.6rem",color:"var(--dt)",marginBottom:6,fontWeight:700}}>{isLoginMode ? "Welcome Back" : "Create Profile"}</h2>
        <p style={{color:"var(--mu)",fontSize:".85rem",marginBottom:20}}>{isLoginMode ? "Login to access your dashboard and event registrations." : "Register once to easily apply for events and awards."}</p>
        
        {authError && <div style={{background:"#FEF0F0",color:"#C0392B",padding:"10px 14px",borderRadius:10,fontSize:".8rem",marginBottom:16,fontWeight:600}}>{authError}</div>}
        
        <form onSubmit={handleAuth} style={{display:"flex",flexDirection:"column",gap:16,textAlign:"left"}}>
          <div style={{display:"flex",gap:12,flexDirection:mob?"column":"row"}}>
            <div style={{flex:1}}>
              <label style={{fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:6,display:"block"}}>📱 Mobile Number *</label>
              <input type="tel" value={mobile} onChange={e=>setMobile(e.target.value)} required style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"1px solid var(--bd)",fontSize:".9rem",outline:"none",background:"#F8F9FA",transition:"all .2s"}} placeholder="10-digit number"/>
            </div>
            <div style={{flex:1}}>
              <label style={{fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:6,display:"block"}}>🔒 Password *</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"1px solid var(--bd)",fontSize:".9rem",outline:"none",background:"#F8F9FA",transition:"all .2s"}} placeholder="••••••"/>
              {isLoginMode && (
                <div style={{marginTop: 6, textAlign: "right"}}>
                  <button type="button" onClick={() => {
                    if(!mobile) { setAuthError("Please enter your mobile number first to request a password reset."); return; }
                    const n = "919224369217"; // using the trust's active whatsapp
                    const msg = encodeURIComponent(`Hello, I forgot the password for my Vidya Gohil Trust account (Mobile: ${mobile}). Please help me reset it.`);
                    window.open(`https://wa.me/${n}?text=${msg}`, "_blank");
                  }} style={{background:"none",border:"none",color:"var(--sf)",fontSize:".75rem",fontWeight:600,cursor:"pointer",textDecoration:"underline",padding:0}}>
                    Forgot Password?
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {!isLoginMode && (
            <div style={{background:"linear-gradient(to bottom right, #F8F9FA, #FFFFFF)",padding:16,borderRadius:16,display:"flex",flexDirection:"column",gap:14,border:"1px solid var(--bd)",boxShadow:"inset 0 2px 10px rgba(0,0,0,.02)"}}>
              <div style={{fontWeight:800,color:"var(--dt)",fontSize:".75rem",textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid var(--bd)",paddingBottom:8}}>👤 New Profile Details</div>
              
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                <div style={{width:56,height:56,borderRadius:"50%",background:"var(--ww)",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0,border:"2px dashed var(--bd)",position:"relative",cursor:"pointer"}} title="Click to upload profile photo">
                  {regImageFile ? <img src={URL.createObjectURL(regImageFile)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="preview"/> : <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}><span style={{fontSize:"1.2rem",opacity:.6}}>📷</span></div>}
                  <input type="file" accept="image/*" onChange={e=>setRegImageFile(e.target.files[0])} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}}/>
                </div>
                <div style={{flex:1}}>
                  <label style={{fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:4,display:"block"}}>Full Name *</label>
                  <input value={regName} onChange={e=>setRegName(e.target.value)} required style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid var(--bd)",fontSize:".9rem",background:"white"}} placeholder="Enter your full name"/>
                </div>
              </div>

              <div style={{}}>
                <label style={{fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:4,display:"block"}}>✉️ Email Address *</label>
                <input type="email" value={regEmail} onChange={e=>setRegEmail(e.target.value)} required style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid var(--bd)",fontSize:".9rem",background:"white"}} placeholder="For event updates and 80G receipts"/>
              </div>

              <div style={{display:"flex",gap:12}}>
                <div style={{flex:2}}>
                  <label style={{fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:4,display:"block"}}>📍 Address *</label>
                  <input value={regAddress} onChange={e=>setRegAddress(e.target.value)} required style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid var(--bd)",fontSize:".9rem",background:"white"}} placeholder="City / Area"/>
                </div>
                <div style={{flex:1}}>
                  <label style={{fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:4,display:"block"}}>⚧ Gender *</label>
                  <select value={regGender} onChange={e=>setRegGender(e.target.value)} required style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid var(--bd)",fontSize:".9rem",background:"white",cursor:"pointer"}}>
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <button type="submit" disabled={submitting} style={{background:"linear-gradient(135deg, var(--sf), var(--gd))",color:"white",padding:"14px",borderRadius:12,fontWeight:800,fontSize:"1rem",border:"none",cursor:submitting?"not-allowed":"pointer",marginTop:8,boxShadow:"0 8px 20px rgba(232,101,10,.3)",transition:"all .2s",letterSpacing:.5}} onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"} onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
            {submitting ? "Processing..." : isLoginMode ? "Login to Dashboard" : "Create Profile & Login"}
          </button>
        </form>
        
        <div style={{textAlign:"center",marginTop:16,fontSize:".85rem",color:"var(--mu)"}}>
          {isLoginMode ? "Don't have an account? " : "Already have an account? "}
          <button onClick={()=>{setIsLoginMode(!isLoginMode);setAuthError("");}} style={{background:"none",border:"none",color:"var(--sf)",fontWeight:700,cursor:"pointer",fontSize:".85rem"}}>
            {isLoginMode ? "Create Profile" : "Login Instead"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── USER DASHBOARD ────────────────────────────────────────────────────────────
function UserDashboard({ C, globalProfile, globalAuthToken, onClose }) {
  const [regs, setRegs] = useState([]);
  const [myDonations, setMyDonations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Registrations");
  const [previewFile, setPreviewFile] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const w = useW(); const mob = w < 768;

  const tabs = [
    { id: "Registrations", label: "Event Registrations", icon: "📅" },
    { id: "Awards", label: "Education Awards", icon: "🎓" },
    { id: "Receipts", label: "Payment Receipts", icon: "🧾" },
    { id: "Invites", label: "Special Invites", icon: "💌" }
  ];

  const handleViewReceipt = async (r) => {
    if (r.receiptUrl) {
      setPreviewFile({ url: r.receiptUrl, type: "pdf", title: `Receipt_${r.id}.pdf` });
      return;
    }
    const url = await generateReceiptPDF(r, C, 'view');
    if (url) {
      setPreviewFile({ url, type: "pdf", title: `Receipt_${r.id}.pdf` });
    }
  };

  const handleDownloadReceipt = async (r) => {
    if (r.receiptUrl) {
      const link = document.createElement("a");
      link.href = r.receiptUrl;
      const safeId = (r.receiptNo || r.id).replace(/\//g, "-");
      link.download = `Receipt_${safeId}.pdf`;
      link.target = "_blank";
      link.click();
      return;
    }
    await generateReceiptPDF(r, C, 'download');
  };

  useEffect(() => {
    const fetchMyRegs = async () => {
      try {
        const allRegs = await fbFetchRegistrations(globalAuthToken);
        const mobileToMatch = String(globalProfile.mobile || globalProfile['Mobile Number'] || "").trim();
        const nameToMatch = String(globalProfile.name || globalProfile['Full Name'] || "").trim().toLowerCase();
        
        const myRegs = allRegs.filter(r => {
          const rMobile = String(r["Mobile Number"] || r.mobile || "").trim();
          const rName = String(r["Submitted By"] || r.name || r["Full Name"] || "").trim().toLowerCase();
          return (mobileToMatch && rMobile === mobileToMatch) || (nameToMatch && rName === nameToMatch);
        });
        
        setRegs(myRegs);
      } catch(e) { console.error(e); }
      setLoading(false);
    };
    
    const fetchMyDonations = async () => {
      try {
        const allDons = await fbFetchDonations(globalAuthToken);
        const mobileToMatch = String(globalProfile.mobile || globalProfile['Mobile Number'] || "").trim();
        const nameToMatch = String(globalProfile.name || globalProfile['Full Name'] || "").trim().toLowerCase();
        
        const mine = allDons.filter(r => {
          const rMobile = String(r.mobile || r.phone || "").trim();
          const rName = String(r.name || r.donor || "").trim().toLowerCase();
          return (mobileToMatch && rMobile === mobileToMatch) || (nameToMatch && rName === nameToMatch);
        });
        
        setMyDonations(mine);
      } catch(e) { console.error(e); }
      setLoading(false);
    };

    if (globalAuthToken && globalProfile) {
      if (activeTab === "Registrations") { setLoading(true); fetchMyRegs(); }
      else if (activeTab === "Receipts") { setLoading(true); fetchMyDonations(); }
    }
  }, [globalAuthToken, globalProfile, activeTab]);

  const getStatusColor = (s) => {
    if (!s) return {bg:"#FFF4EC", col:"#E8650A"}; // Pending
    const st = s.toLowerCase();
    if (st.includes('approv')) return {bg:"#EDFAF1", col:"#1A7A3E"};
    if (st.includes('reject')) return {bg:"#FEF0F0", col:"#C0392B"};
    if (st.includes('info')) return {bg:"#FEF9EC", col:"#C8860A"};
    return {bg:"#F5F5F5", col:"#666"};
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(13,75,94,.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:isFullScreen?0:(mob?"32px 16px":32),zIndex:9999,transition:"all 0.3s"}}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      
      <div style={{background:"#F8F9FA",borderRadius:isFullScreen?0:(mob?16:24),width:isFullScreen?"100%":"95%",maxWidth:isFullScreen?"100%":1000,height:isFullScreen?"100%":(mob?"75vh":"85vh"),display:"flex",flexDirection:"column",boxShadow:"0 32px 80px rgba(0,0,0,.3)",position:"relative",overflow:"hidden",transition:"all 0.3s"}}
        onClick={e=>e.stopPropagation()}>
        
        {/* Header */}
        <div style={{padding:mob?"16px 16px":"20px 32px",background:"linear-gradient(135deg, #1e3a8a, #312e81)",color:"white",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{flex:1, minWidth:0, paddingRight:12}}>
            <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.2rem":"1.6rem",fontWeight:700,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>My Portal</h2>
            <div style={{fontSize:mob?".7rem":".8rem",opacity:.8,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{globalProfile.name || globalProfile['Full Name']} • {globalProfile.mobile || globalProfile['Mobile Number']}</div>
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0}}>
            <button onClick={()=>setIsFullScreen(!isFullScreen)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:8,width:mob?32:36,height:mob?32:36,cursor:"pointer",fontSize:mob?".9rem":"1.1rem",color:"white",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}} title={isFullScreen?"Exit Fullscreen":"Fullscreen"}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.25)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.15)"}>{isFullScreen ? "🗗" : "🗖"}</button>
            <button onClick={onClose} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:8,width:mob?32:36,height:mob?32:36,cursor:"pointer",fontSize:mob?"1rem":"1.2rem",color:"white",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}} title="Close"
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.25)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.15)"}>✕</button>
          </div>
        </div>

        <div style={{display:"flex",flexDirection:mob?"column":"row",flex:1,minHeight:0}}>
          {/* Sidebar Tabs */}
          <div style={{width:mob?"100%":(isSidebarCollapsed ? 80 : 260),background:"white",borderRight:mob?"none":"1px solid var(--bd)",borderBottom:mob?"1px solid var(--bd)":"none",display:"flex",flexDirection:mob?"row":"column",overflowX:mob?"auto":"hidden",flexShrink:0,transition:"width 0.3s ease"}}>
            {!mob && (
              <button 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                style={{display:"flex",alignItems:"center",justifyContent:isSidebarCollapsed?"center":"flex-end",padding:"12px 20px",background:"transparent",border:"none",color:"var(--mu)",cursor:"pointer",fontSize:".85rem",borderBottom:"1px solid var(--ww)",fontWeight:600}}
              >
                {isSidebarCollapsed ? "▶" : "◀ Collapse"}
              </button>
            )}
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                title={isSidebarCollapsed && !mob ? t.label : ""}
                style={{
                  display:"flex",alignItems:"center",gap:12,padding:"16px 20px",border:"none",background:activeTab===t.id?"#FFF4EC":"transparent",
                  color:activeTab===t.id?"var(--sf)":"var(--tm2)",fontWeight:activeTab===t.id?700:500,fontSize:".95rem",cursor:"pointer",
                  borderLeft:mob?"none":`4px solid ${activeTab===t.id?"var(--sf)":"transparent"}`,
                  borderBottom:mob?`4px solid ${activeTab===t.id?"var(--sf)":"transparent"}`:"none",
                  textAlign:"left",whiteSpace:mob?"nowrap":"normal",transition:"all .2s",
                  justifyContent: isSidebarCollapsed && !mob ? "center" : "flex-start"
                }}
                onMouseEnter={e=>{ if(activeTab!==t.id) { e.currentTarget.style.background="#f9f9f9"; e.currentTarget.style.color="var(--dt)"; } }}
                onMouseLeave={e=>{ if(activeTab!==t.id) { e.currentTarget.style.background="transparent"; e.currentTarget.style.color="var(--tm2)"; } }}
              >
                <span style={{fontSize:"1.2rem"}}>{t.icon}</span>
                {(!isSidebarCollapsed || mob) && <span>{t.label}</span>}
              </button>
            ))}
          </div>

          {/* Content Area */}
          <div style={{flex:1,padding:mob?"20px 16px":"32px",overflowY:"auto",background:"#F8F9FA"}}>
            {activeTab === "Registrations" && (
              <>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.3rem",color:"var(--dt)",marginBottom:16,fontWeight:700}}>My Event Registrations</h3>
                {loading ? (
                  <div style={{textAlign:"center",padding:40,color:"var(--mu)"}}>Loading your registrations...</div>
                ) : regs.length === 0 ? (
                  <div style={{background:"white",padding:"40px 20px",borderRadius:16,textAlign:"center",border:"1px solid var(--bd)"}}>
                    <div style={{fontSize:"3rem",marginBottom:12}}>📅</div>
                    <div style={{fontWeight:600,color:"var(--dt)",fontSize:"1.1rem",marginBottom:6}}>No Registrations Found</div>
                    <div style={{color:"var(--mu)",fontSize:".85rem"}}>You haven't registered for any events yet.</div>
                  </div>
                ) : (
                  <div style={{background:"white",borderRadius:12,border:"1px solid var(--bd)",boxShadow:"0 4px 12px rgba(0,0,0,.02)",overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:".85rem",minWidth:800}}>
                      <thead style={{background:"var(--dt)",color:"white"}}>
                        <tr>
                          <th style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>Date</th>
                          <th style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>Event</th>
                          <th style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>Status</th>
                          <th style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>Admin Remarks</th>
                          {Array.from(new Set(regs.flatMap(r => Object.keys(r))))
                            .filter(k => !["id", "_submittedAt", "timestamp", "Status", "status", "Remarks", "remarks", "AdminRemarks", "Event Name", "Event", "eventName", "eventTitle", "eventId"].includes(k))
                            .map(k => (
                            <th key={k} style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {regs.map((r, i) => {
                          const sc = getStatusColor(r.status || r.Status || "Pending");
                          const rowKeys = Array.from(new Set(regs.flatMap(r => Object.keys(r))))
                            .filter(k => !["id", "_submittedAt", "timestamp", "Status", "status", "Remarks", "remarks", "AdminRemarks", "Event Name", "Event", "eventName", "eventTitle", "eventId"].includes(k));
                          
                          return (
                            <tr key={r.id || i} style={{borderBottom:"1px solid var(--ww)",background:i%2===0?"white":"#FAFAFA"}}>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap"}}>{new Date(r.timestamp || r._submittedAt).toLocaleString()}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap",fontWeight:700,color:"var(--dt)"}}>{r.eventName || r["Event Name"] || r["Event"] || "Event Registration"}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap"}}>
                                <span style={{background:sc.bg,color:sc.col,padding:"5px 12px",borderRadius:20,fontSize:".75rem",fontWeight:700,border:`1px solid ${sc.col}33`}}>
                                  {r.status || r.Status || "Pending"}
                                </span>
                              </td>
                              <td style={{padding:"14px 16px",color:"var(--tm2)"}}>
                                <div style={{minWidth:150,maxWidth:500,maxHeight:80,overflow:"auto",resize:"horizontal",whiteSpace:"normal",wordBreak:"break-word",paddingRight:4,paddingBottom:4}}>
                                  {r.AdminRemarks || r.remarks || r.Remarks || "-"}
                                </div>
                              </td>
                              {rowKeys.map(k => {
                                const val = r[k] || "-";
                                const isLink = typeof val === 'string' && val.startsWith('http');
                                return (
                                  <td key={k} style={{padding:"14px 16px",color:"var(--mu)"}}>
                                    {isLink ? (
                                      <button 
                                        type="button" 
                                        onClick={() => setPreviewFile({url: val, type: val.match(/\.(pdf|doc|docx)/i) ? 'file' : 'image'})}
                                        style={{color:"var(--sf)",fontWeight:600,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:6,border:"1px solid var(--bd)",padding:"6px 12px",borderRadius:8,background:"white",boxShadow:"0 2px 4px rgba(0,0,0,.02)",cursor:"pointer"}}
                                      >
                                        📎 View Document
                                      </button>
                                    ) : (
                                      <div style={{minWidth:150,maxWidth:500,maxHeight:80,overflow:"auto",resize:"horizontal",whiteSpace:"normal",wordBreak:"break-word",paddingRight:4,paddingBottom:4}}>
                                        {val}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {activeTab === "Receipts" && (
              <>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.3rem",color:"var(--dt)",marginBottom:16,fontWeight:700}}>My Donations & Receipts</h3>
                {loading ? (
                  <div style={{textAlign:"center",padding:40,color:"var(--mu)"}}>Loading your donations...</div>
                ) : myDonations.length === 0 ? (
                  <div style={{background:"white",padding:"40px 20px",borderRadius:16,textAlign:"center",border:"1px solid var(--bd)"}}>
                    <div style={{fontSize:"3rem",marginBottom:12}}>🧾</div>
                    <div style={{fontWeight:600,color:"var(--dt)",fontSize:"1.1rem",marginBottom:6}}>No Donations Found</div>
                    <div style={{color:"var(--mu)",fontSize:".85rem"}}>We couldn't find any verified donations linked to your profile.</div>
                  </div>
                ) : (
                  <div style={{background:"white",borderRadius:12,border:"1px solid var(--bd)",boxShadow:"0 4px 12px rgba(0,0,0,.02)",overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:".85rem",minWidth:600}}>
                      <thead style={{background:"var(--dt)",color:"white"}}>
                        <tr>
                          <th style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>Date</th>
                          <th style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>Amount</th>
                          <th style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>Program</th>
                          <th style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>Status</th>
                          <th style={{padding:"14px 16px",textAlign:"right",whiteSpace:"nowrap",fontWeight:600}}>Receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myDonations.map((r, i) => {
                          const sc = getStatusColor(r.status || r.Status || "Pending");
                          const isVerified = (r.status || r.Status || "").toLowerCase().includes("verifi") || (r.status || r.Status || "").toLowerCase().includes("approv") || (r.status || r.Status || "").toLowerCase().includes("success") || r.status === "Verified";
                          
                          return (
                            <tr key={r.id || i} style={{borderBottom:"1px solid var(--ww)",background:i%2===0?"white":"#FAFAFA"}}>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap"}}>{r.date || new Date(r.timestamp || r._submittedAt).toLocaleString()}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap",fontWeight:700,color:"var(--dt)"}}>Rs. {Number(r.amount).toLocaleString()}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap",color:"var(--tm2)"}}>{r.program || r["Program"] || "-"}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap"}}>
                                <span style={{background:sc.bg,color:sc.col,padding:"5px 12px",borderRadius:20,fontSize:".75rem",fontWeight:700,border:`1px solid ${sc.col}33`}}>
                                  {r.status || r.Status || "Pending"}
                                </span>
                              </td>
                              <td style={{padding:"14px 16px",textAlign:"right"}}>
                                {isVerified ? (
                                  <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                                    <button onClick={() => handleViewReceipt(r)} style={{padding:"6px 12px",borderRadius:6,background:"white",border:"1px solid var(--bd)",color:"var(--dt)",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>View</button>
                                    <button onClick={() => handleDownloadReceipt(r)} style={{padding:"6px 12px",borderRadius:6,background:"var(--sf)",border:"none",color:"white",cursor:"pointer",fontSize:".75rem",fontWeight:600,boxShadow:"0 2px 4px rgba(232,101,10,.2)"}}>Download PDF</button>
                                  </div>
                                ) : (
                                  <span style={{fontSize:".75rem",color:"var(--mu)"}}>Pending Verification</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {activeTab !== "Registrations" && activeTab !== "Receipts" && (
              <div style={{background:"white",padding:"60px 20px",borderRadius:16,textAlign:"center",border:"1px solid var(--bd)",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontSize:"3.5rem",marginBottom:16}}>{tabs.find(t=>t.id===activeTab)?.icon}</div>
                <div style={{fontWeight:700,color:"var(--dt)",fontSize:"1.3rem",marginBottom:8,fontFamily:"'Playfair Display',serif"}}>No New {tabs.find(t=>t.id===activeTab)?.label}</div>
                <div style={{color:"var(--mu)",fontSize:".9rem",maxWidth:300}}>When the Trust sends you updates related to {activeTab.toLowerCase()}, they will securely appear right here.</div>
              </div>
            )}
          </div>
        </div>
      </div>
      {previewFile && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:99999, display:"flex", alignItems:"center", justifyContent:"center", padding: "4vh 4vw"}}>
          <div style={{background:"white", borderRadius: 16, width:"100%", maxWidth: 900, height:"100%", display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 20px 40px rgba(0,0,0,0.4)"}}>
            <div style={{padding:"16px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid var(--bd)", background:"#F8F9FA"}}>
              <h3 style={{fontWeight:700, fontSize:"1.2rem", color:"var(--dt)", margin:0}}>File Preview</h3>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                {previewFile.type !== 'image' && (
                  <a href={previewFile.url} target="_blank" rel="noreferrer" style={{color:"var(--sf)",fontSize:".9rem",textDecoration:"underline",fontWeight:600}}>Open externally</a>
                )}
                <button onClick={()=>setPreviewFile(null)} style={{background:"#E8EAED", border:"none", color:"var(--dt)", cursor:"pointer", fontSize:"1.4rem", width:36, height:36, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:"bold"}}>&times;</button>
              </div>
            </div>
            <div style={{flex:1,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",background:"#F5F5F5"}}>
               {previewFile.type === 'image' ? (
                 <img src={previewFile.url} alt="Preview" style={{maxWidth:"100%",maxHeight:"70vh",objectFit:"contain",borderRadius:8,boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}} />
               ) : (
                 <object data={previewFile.url} type="application/pdf" style={{width:"100%",height:"70vh",border:"none",borderRadius:8,boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
                   <iframe src={previewFile.url} style={{width:"100%",height:"100%",border:"none"}} title="Document Preview" />
                 </object>
               )}
            </div>
          </div>
        </div>
      )}
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

// ── ADMIN REGISTRATIONS ────────────────────────────────────────────────────────
function AdminRegistrations({ mob, C, auth }) {
  const [regs, setRegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [columnFilters, setColumnFilters] = useState({});

  useEffect(() => {
    try {
      fbFetchRegistrations(auth?.idToken).then(d => {
        setRegs(d || []); setLoading(false);
      }).catch(e => {
        console.error(e); setError(e.message); setLoading(false);
      });
    } catch (e) {
      setError(e.message); setLoading(false);
    }
  }, [auth]);

  if (error) return <div style={{padding:30}}>Error loading registrations: {error}</div>;

  const handleStatusChange = async (r, newStatus) => {
    let newRemarks = r['Remarks'] || "";
    if (newStatus === "Disapproved" || newStatus === "Needs Info") {
      const reason = prompt(`Please enter the reason/remarks for '${newStatus}':`, newRemarks);
      if (reason === null) return; // User cancelled
      newRemarks = reason;
    }
    
    const updatedBy = auth?.email || "Admin";
    
    // Optimistic UI update
    setRegs(prev => prev.map(x => x.id === r.id ? { ...x, Status: newStatus, Remarks: newRemarks, "Updated By": updatedBy } : x));
    
    try {
      const cleanData = { ...r, Status: newStatus, Remarks: newRemarks, "Updated By": updatedBy };
      delete cleanData.id;
      delete cleanData._submittedAt;
      await fbUpdateRegistration(r.id, cleanData, auth?.idToken);
    } catch (e) {
      alert("Failed to update status: " + e.message);
      // Revert on failure
      const d = await fbFetchRegistrations(auth?.idToken);
      setRegs(d || []);
    }
  };

  const handleEditRemarks = async (r) => {
    const reason = prompt(`Edit remarks for this registration:`, r['Remarks'] || "");
    if (reason === null) return;
    
    const updatedBy = auth?.email || "Admin";
    setRegs(prev => prev.map(x => x.id === r.id ? { ...x, Remarks: reason, "Updated By": updatedBy } : x));
    try {
      const cleanData = { ...r, Remarks: reason, "Updated By": updatedBy };
      delete cleanData.id; delete cleanData._submittedAt;
      await fbUpdateRegistration(r.id, cleanData, auth?.idToken);
    } catch (e) {
      alert("Failed to update remarks: " + e.message);
      const d = await fbFetchRegistrations(auth?.idToken);
      setRegs(d || []);
    }
  };

  // 1. Gather all unique dynamic field keys
  const ignoreKeys = ['id', 'eventId', 'eventTitle', 'eventName', '_submittedAt', 'Transaction ID', 'Status', 'Remarks', 'Updated By'];
  const allKeysSet = new Set();
  regs.forEach(r => {
    if(!r) return;
    Object.keys(r).forEach(k => {
      if (!ignoreKeys.includes(k) && !k.startsWith('_')) {
        allKeysSet.add(k);
      }
    });
  });
  
  let allKeys = Array.from(allKeysSet);
  const priority = ["Full Name", "Name", "Mobile Number", "Mobile", "Phone", "Email Address", "Email"];
  allKeys.sort((a, b) => {
    const ia = priority.indexOf(a);
    const ib = priority.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const getUniqueValues = (colKey) => {
    const vals = new Set();
    regs.forEach(r => {
      if(!r) return;
      let val = "";
      if(colKey === "Date") { try { if(r._submittedAt) val = new Date(r._submittedAt).toLocaleString().split(',')[0].trim(); } catch(e){} }
      else if(colKey === "Event") val = r.eventName || r.eventTitle || r.eventId || "Unknown Event";
      else if(colKey === "Status") val = r['Status'] || "Pending";
      else if(colKey === "Transaction ID") val = r['Transaction ID'] || "-";
      else if(colKey === "Updated By") val = r['Updated By'] || "-";
      else val = r[colKey] || "-";
      
      if (typeof val === 'string' && val.startsWith('http')) return;
      if (typeof val === 'string') val = val.trim();
      else val = String(val).trim();
      
      if (!val) val = "-";
      vals.add(val);
    });
    return Array.from(vals).sort();
  };

  // 2. Filter registrations based on search query
  const filteredRegs = regs.filter(r => {
    if(!r) return false;
    
    // 1. Global search
    if(searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!Object.values(r).some(val => String(val).toLowerCase().includes(q))) return false;
    }
    
    // 2. Column filters
    for (const [colKey, filterVal] of Object.entries(columnFilters)) {
      if(!filterVal) continue;
      
      let rVal = "";
      if(colKey === "Date") { try { if(r._submittedAt) rVal = new Date(r._submittedAt).toLocaleString(); } catch(e){} }
      else if(colKey === "Event") rVal = r.eventName || r.eventTitle || r.eventId || "Unknown Event";
      else if(colKey === "Status") rVal = r['Status'] || "Pending";
      else if(colKey === "Transaction ID") rVal = r['Transaction ID'] || "-";
      else if(colKey === "Updated By") rVal = r['Updated By'] || "-";
      else rVal = r[colKey] || "-";
      
      if(!String(rVal).toLowerCase().includes(filterVal.toLowerCase())) return false;
    }
    
    return true;
  });

  const handleExportCSV = () => {
    if(filteredRegs.length === 0) return;
    const headers = ["Date", "Event", "Transaction ID", "Status", "Remarks", "Updated By", ...allKeys];
    const rows = filteredRegs.map(r => {
      let date = "-";
      try { if(r._submittedAt) date = new Date(r._submittedAt).toLocaleString(); } catch(e){}
      const evName = r.eventName || r.eventTitle || r.eventId || "Unknown Event";
      
      const rowData = [
        `"${date}"`,
        `"${evName}"`,
        `"${r['Transaction ID'] || '-'}"`,
        `"${r['Status'] || 'Pending'}"`,
        `"${r['Remarks'] || ''}"`,
        `"${r['Updated By'] || '-'}"`,
        ...allKeys.map(k => {
          let val = r[k] || "";
          if (typeof val === 'string') val = val.replace(/"/g, '""');
          else val = String(val);
          return `"${val}"`;
        })
      ];
      return rowData.join(",");
    });
    
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const ts = new Date().toLocaleString('sv-SE').replace(' ', '_').replace(/:/g, '-');
    link.setAttribute("download", `Trust_Registrations_${ts}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{padding:mob?"16px":"32px",maxWidth:1400,margin:"0 auto"}}>
      <div style={{display:"flex",flexDirection:mob?"column":"row",justifyContent:"space-between",alignItems:mob?"flex-start":"center",marginBottom:20,gap:16}}>
        <h2 style={{fontFamily:"'Playfair Display',serif",color:"var(--dt)",margin:0}}>Event Registrations</h2>
        <div style={{display:"flex",gap:12,width:mob?"100%":"auto"}}>
          <input 
            type="text" 
            placeholder="Search registrations..." 
            value={searchQuery}
            onChange={e=>setSearchQuery(e.target.value)}
            style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".85rem",flex:1,minWidth:250,outline:"none",fontFamily:"inherit"}}
          />
          <button onClick={handleExportCSV} className="bt" style={{padding:"8px 16px",borderRadius:8,fontSize:".85rem",fontWeight:600,display:"flex",alignItems:"center",gap:8,whiteSpace:"nowrap",boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
            <span>📥</span> Export to CSV
          </button>
        </div>
      </div>

      {loading ? <p>Loading registrations...</p> : (
        <>
        <style>{`
          .admin-table tbody tr { transition: background-color 0.2s ease; border-bottom: 1px solid #E0E0E0; }
          .admin-table tbody tr:hover { background-color: #f4f9ff !important; }
          .admin-table-wrapper { border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); overflow: hidden; border: 1px solid #E0E0E0; background: white; }
          .admin-table thead tr:first-child th { background-color: var(--dt); color: white; border-bottom: none; }
          .admin-table th { font-weight: 600; letter-spacing: 0.3px; }
          .admin-table select, .admin-table input { font-family: inherit; }
        `}</style>
        <div className="admin-table-wrapper" style={{overflowX:"auto"}}>
          <table className="admin-table" style={{width:"100%",borderCollapse:"collapse",fontSize:".85rem",minWidth:1200}}>
            <thead>
              <tr>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Date</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Event</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Txn ID</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Status</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Remarks</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Updated By</th>
                {allKeys.map(k => (
                  <th key={k} style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>{k}</th>
                ))}
                <th style={{padding:"14px 12px",textAlign:"left"}}>Actions</th>
              </tr>
              <tr style={{background:"#FAFAFA", borderBottom:"2px solid #E0E0E0"}}>
                {["Date", "Event", "Transaction ID", "Status", "Remarks", "Updated By", ...allKeys].map(k => {
                  const uniqueVals = getUniqueValues(k);
                  return (
                    <th key={`filter-${k}`} style={{padding:"6px 12px", fontWeight:"normal"}}>
                      {uniqueVals.length > 0 ? (
                        <select 
                          value={columnFilters[k] || ""}
                          onChange={(e) => setColumnFilters({...columnFilters, [k]: e.target.value})}
                          style={{width:"100%", padding:"4px 6px", fontSize:".75rem", border:"1px solid #CCC", borderRadius:4, boxSizing:"border-box", minWidth: 80, background:"white", outline:"none"}}
                        >
                          <option value="">All</option>
                          {uniqueVals.map(uv => <option key={uv} value={uv}>{uv}</option>)}
                        </select>
                      ) : (
                        <input 
                          type="text" 
                          placeholder="Filter..." 
                          value={columnFilters[k] || ""}
                          onChange={(e) => setColumnFilters({...columnFilters, [k]: e.target.value})}
                          style={{width:"100%", padding:"4px 6px", fontSize:".75rem", border:"1px solid #CCC", borderRadius:4, boxSizing:"border-box", minWidth: 80, outline:"none"}}
                        />
                      )}
                    </th>
                  );
                })}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRegs.map((r, i) => {
                if(!r) return null;
                let date = "-";
                try { if(r._submittedAt) date = new Date(r._submittedAt).toLocaleString(); } catch(e){}
                let evName = r.eventName || r.eventTitle || r.eventId || "Unknown Event";

                return (
                  <tr key={i}>
                    <td style={{padding:"12px",whiteSpace:"nowrap"}}>{date}</td>
                    <td style={{padding:"12px",whiteSpace:"nowrap"}}>{evName}</td>
                    <td style={{padding:"12px",whiteSpace:"nowrap",fontWeight:600}}>{r['Transaction ID'] || "-"}</td>
                    <td style={{padding:"12px",whiteSpace:"nowrap"}}>
                      <select 
                        value={r['Status'] || "Pending"} 
                        onChange={(e) => handleStatusChange(r, e.target.value)}
                        style={{
                          padding:"4px 8px", borderRadius:6, border:"1px solid rgba(0,0,0,0.1)", fontSize:".8rem", outline:"none",
                          background: (r['Status']==="Approved")?"#E8F5E9":(r['Status']==="Disapproved")?"#FFEBEE":(r['Status']==="Needs Info")?"#FFF3E0":"#F5F5F5",
                          color: (r['Status']==="Approved")?"#2E7D32":(r['Status']==="Disapproved")?"#C62828":(r['Status']==="Needs Info")?"#EF6C00":"#424242",
                          fontWeight: 600, fontFamily: "inherit", cursor:"pointer"
                        }}
                      >
                        <option value="Pending">Pending</option>
                        <option value="Approved">Approved</option>
                        <option value="Disapproved">Disapproved</option>
                        <option value="Needs Info">Needs Info</option>
                      </select>
                    </td>
                    <td style={{padding:"12px",maxWidth:200}}>
                      <div style={{maxHeight:"60px", overflowY:"auto", whiteSpace:"normal", fontSize:".8rem", color:"var(--mu)", display:"flex", alignItems:"flex-start", gap: 6, minWidth:120, paddingRight:4}}>
                        <span>{r['Remarks'] || "-"}</span>
                        <button onClick={() => handleEditRemarks(r)} style={{background:"white",border:"1px solid #E0E0E0",borderRadius:4,cursor:"pointer",fontSize:".7rem",padding:"2px 4px",boxShadow:"0 1px 3px rgba(0,0,0,0.05)"}} title="Edit Remarks">✏️</button>
                      </div>
                    </td>
                    <td style={{padding:"12px",whiteSpace:"nowrap",fontSize:".8rem",color:"var(--mu)"}}>
                      {r['Updated By'] || "-"}
                    </td>
                    {allKeys.map(k => {
                      let val = r[k] || "-";
                      if (typeof val === 'string' && val.startsWith('http')) {
                        const isDoc = val.match(/\.(pdf|doc|docx)/i);
                        if (isDoc) {
                          return (
                            <td key={k} style={{padding:"12px",whiteSpace:"nowrap"}}>
                              <button 
                                type="button" 
                                onClick={()=>setPreviewFile({url: val, type: 'file'})}
                                style={{background:"#f4f9ff",border:"1px solid #d0e3ff",color:"#0056b3",borderRadius:4,cursor:"pointer",padding:"6px 10px",fontSize:".8rem",display:"flex",alignItems:"center",gap:6,fontWeight:500}}
                              >
                                📎 View Doc
                              </button>
                            </td>
                          );
                        } else {
                          return (
                            <td key={k} style={{padding:"12px"}}>
                              <img 
                                src={val} 
                                alt="Upload" 
                                style={{width: 44, height: 44, objectFit: "cover", borderRadius: 6, cursor: "pointer", border:"1px solid #E0E0E0", boxShadow:"0 2px 6px rgba(0,0,0,0.05)"}}
                                onClick={() => setPreviewFile({url: val, type: 'image'})}
                                title="Click to view full size"
                              />
                            </td>
                          );
                        }
                      }
                      
                      else if (typeof val === 'string') val = val.replace(/\|/g, ' ');
                      else val = String(val);
                      
                      return (
                        <td key={k} style={{padding:"12px", maxWidth:250}}>
                          <div style={{maxHeight:"60px", overflowY:"auto", whiteSpace:"normal", minWidth:100, paddingRight:4, lineHeight:1.4}}>
                            {val}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{padding:"12px"}}>
                      <button onClick={()=>setViewing(r)} style={{padding:"6px 12px",borderRadius:6,fontSize:".75rem",background:"var(--dt)",color:"white",border:"none",cursor:"pointer",fontWeight:500,boxShadow:"0 2px 6px rgba(0,0,0,0.15)"}}>View</button>
                    </td>
                  </tr>
                );
              })}
              {filteredRegs.length === 0 && <tr><td colSpan={allKeys.length + 6} style={{padding:40,textAlign:"center",color:"var(--mu)",fontSize:"1rem"}}>No registrations found matching your search.</td></tr>}
            </tbody>
          </table>
        </div>
        </>
      )}

      {viewing && (
        <div style={{position:"fixed",top:0,left:0,width:"100vw",height:"100vh",background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"white",width:"100%",maxWidth:600,borderRadius:12,display:"flex",flexDirection:"column",maxHeight:"90vh"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <h3 style={{fontSize:"1.1rem",fontWeight:700,color:"var(--dt)"}}>Registration Details</h3>
              <button onClick={()=>setViewing(null)} style={{background:"none",border:"none",fontSize:"1.5rem",cursor:"pointer"}}>×</button>
            </div>
            <div style={{padding:"20px",overflowY:"auto",flex:1}}>
              {Object.keys(viewing).filter(k => !k.startsWith('_') && k !== 'id' && k !== 'eventId' && k !== 'eventName').map(k => {
                const val = viewing[k];
                const displayVal = typeof val === 'string' ? val.replace(/\|/g, ' ') : String(val);
                const isUrl = typeof val === 'string' && val.startsWith('http');
                return (
                  <div key={k} style={{marginBottom:16,borderBottom:"1px solid #EEE",paddingBottom:10}}>
                    <div style={{fontSize:".75rem",color:"var(--mu)",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>{k}</div>
                    {isUrl ? (
                      <button type="button" onClick={()=>setPreviewFile({url:val, type:val.includes('.pdf')?'file':'image'})} style={{background:"none",border:"none",fontSize:".85rem",color:"var(--dt)",textDecoration:"underline",cursor:"pointer",padding:0}}>
                        View Uploaded File
                      </button>
                    ) : (
                      <div style={{fontSize:".95rem",color:"var(--tx)"}}>{displayVal}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <div style={{position:"fixed",top:0,left:0,width:"100vw",height:"100vh",background:"rgba(0,0,0,0.8)",zIndex:99999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{position:"relative",width:"100%",maxWidth:800,maxHeight:"90vh",background:"white",borderRadius:12,overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"12px 16px",background:"var(--dt)",color:"white",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <h3 style={{fontSize:"1rem",fontWeight:600}}>File Preview</h3>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                {previewFile.type !== 'image' && (
                  <a href={previewFile.url} target="_blank" rel="noreferrer" style={{color:"white",fontSize:".8rem",textDecoration:"underline"}}>Open externally</a>
                )}
                <button onClick={()=>setPreviewFile(null)} style={{background:"none",border:"none",color:"white",fontSize:"1.5rem",cursor:"pointer",lineHeight:1}}>×</button>
              </div>
            </div>
            <div style={{flex:1,overflow:"auto",padding:20,display:"flex",alignItems:"center",justifyContent:"center",background:"#F5F5F5"}}>
               {previewFile.type === 'image' ? (
                 <img src={previewFile.url} alt="Preview" style={{maxWidth:"100%",maxHeight:"70vh",objectFit:"contain",borderRadius:8,boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}} />
               ) : (
                 <object data={previewFile.url} type="application/pdf" style={{width:"100%",height:"70vh",border:"none",borderRadius:8,boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
                   <iframe src={previewFile.url} style={{width:"100%",height:"100%",border:"none"}} title="Document Preview" />
                 </object>
               )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── POLICY PAGE COMPONENT ───────────────────────────────────────────────────
function PolicyPage({ type, C }) {
  const t = type === 'privacy' ? 'Privacy Policy' : type === 'terms' ? 'Terms & Conditions' : 'Refund & Cancellation Policy';
  return (
    <div style={{maxWidth:900,margin:"0 auto",padding:"60px 24px 100px",minHeight:"80vh"}}>
      <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:"2.5rem",color:"var(--dt)",marginBottom:24}}>{t}</h1>
      <div style={{color:"var(--mu)",lineHeight:1.7,fontSize:".95rem",display:"flex",flexDirection:"column",gap:16}}>
        {type === 'privacy' && (
          <>
            <p><strong>Last Updated: {new Date().toLocaleDateString('en-IN')}</strong></p>
            <p>This Privacy Policy outlines how {C.trust.name} ("we", "us", or "our") collects, uses, and protects your personal information when you use our website or services.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>1. Information We Collect</h3>
            <p>We may collect personal information such as your name, email address, phone number, and payment details when you make a donation, register for an event, or sign up as a volunteer.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>2. How We Use Your Information</h3>
            <p>Your information is used strictly to process donations, issue 80G tax receipts, communicate about events, and manage volunteer activities. We do not sell or rent your personal information to third parties.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>3. Data Security</h3>
            <p>We implement standard security measures to protect your data. All payment transactions are processed securely through Razorpay.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>4. Contact Us</h3>
            <p>If you have any questions about this Privacy Policy, please contact us at {C.trust.email}.</p>
          </>
        )}
        {type === 'terms' && (
          <>
            <p><strong>Last Updated: {new Date().toLocaleDateString('en-IN')}</strong></p>
            <p>Welcome to {C.trust.name}. By accessing or using our website, you agree to be bound by these Terms and Conditions.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>1. Use of the Website</h3>
            <p>You agree to use this website only for lawful purposes. You must not use the site in a way that causes damage or interrupts access to the site.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>2. Donations</h3>
            <p>All donations made through the site are voluntary. By donating, you confirm that the funds are legitimate and belong to you.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>3. Intellectual Property</h3>
            <p>The content, logos, and materials on this site are the property of {C.trust.name}. Unauthorized use is prohibited.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>4. Changes to Terms</h3>
            <p>We reserve the right to modify these terms at any time. Changes will be effective immediately upon posting to the website.</p>
          </>
        )}
        {type === 'refund' && (
          <>
            <p><strong>Last Updated: {new Date().toLocaleDateString('en-IN')}</strong></p>
            <p>Thank you for supporting {C.trust.name}. Because our organization operates on voluntary donations to support charitable causes, all donations are strictly non-refundable.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>1. No Refunds</h3>
            <p>Once a donation has been successfully processed, it cannot be refunded, cancelled, or reversed under any circumstances.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>2. Erroneous Transactions</h3>
            <p>In the event of an erroneous double transaction due to a technical glitch, please contact us at {C.trust.email} within 48 hours with your transaction ID. We will review such cases at our sole discretion.</p>
            <h3 style={{color:"var(--dt)",marginTop:12}}>3. Event Registrations</h3>
            <p>If an event requires a registration fee, it is non-refundable unless the event is officially cancelled by the Trust.</p>
          </>
        )}
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

