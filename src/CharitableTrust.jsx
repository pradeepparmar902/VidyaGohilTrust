import { QRCodeCanvas } from "qrcode.react";
import { useState, useEffect, useRef, createContext, useContext } from "react";
import { jsPDF } from "jspdf";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import { initializeApp } from "firebase/app";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, sendPasswordResetEmail } from "firebase/auth";
import { marked } from "marked";
import DOMPurify from "dompurify";

// ── FIREBASE CONFIG ───────────────────────────────────────────────────────────
const getFB = () => window.FIREBASE_CONFIG || {};
const FS_URL  = () => `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/content/main`;
const AUTH_URL= () => `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${getFB().apiKey}`;
const STG_URL = () => `https://firebasestorage.googleapis.com/v0/b/${getFB().bucket}/o`;

let fbApp = null;
let fbAuth = null;
try {
  const initFB = window.FIREBASE_CONFIG || {};
  if (initFB.apiKey && initFB.apiKey.trim().length > 0 && initFB.apiKey.trim() !== "1") {
    fbApp = initializeApp({
      apiKey: initFB.apiKey.trim(),
      projectId: initFB.projectId?.trim(),
      authDomain: `${initFB.projectId?.trim()}.firebaseapp.com`
    });
    fbAuth = getAuth(fbApp);
  }
} catch (e) {
  console.warn("Firebase could not be initialized:", e);
}

// ── FIREBASE HELPERS ──────────────────────────────────────────────────────────
// Firestore stores everything as one JSON string field for simplicity
const fbLoad = async () => {
  try {
    const res = await fetch(`${FS_URL()}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const doc = await res.json();
    const raw = doc?.fields?.data?.stringValue;
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const fbSave = async (content, idToken) => {
  const res = await fetch(
    `${FS_URL()}?updateMask.fieldPaths=data&updateMask.fieldPaths=savedAt`,
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
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/registrations`;
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
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/registrations/${docId}?updateMask.fieldPaths=data`;
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

const fbDeleteRegistration = async (docId, idToken) => {
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/registrations/${docId}`;
  const headers = {};
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(REG_URL, {
    method: "DELETE",
    headers: headers
  });
  if (!res.ok) throw new Error("Delete failed");
  return true;
};

const fbUpdateDonation = async (docId, newData, idToken) => {
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/donations/${docId}?updateMask.fieldPaths=data`;
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
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/registrations?pageSize=300`;
  const headers = {};
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(REG_URL, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch registrations (${res.status}): ${errText}`);
  }
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
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/donations`;
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
  const URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/volunteers`;
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
  const URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/volunteers?pageSize=300`;
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
  const URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/volunteers/${docId}`;
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
  const REG_URL = `https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/donations?pageSize=300`;
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
  const SIGNUP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${getFB().apiKey}`;
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
  const res = await fetch(AUTH_URL(), {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message.replace(/_/g," "));
  return { idToken: data.idToken, email: data.email, expiresIn: data.expiresIn, localId: data.localId };
};

const fbUpdateProfile = async (idToken, displayName, photoUrl) => {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${getFB().apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, displayName, photoUrl, returnSecureToken: true })
  });
  if (!res.ok) throw new Error("Failed to update profile");
  return await res.json();
};

const fbFetchUserProfile = async (localId, idToken) => {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/users/${localId}`, {
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
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/users/${localId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) throw new Error("Failed to save user profile");
  return await res.json();
};

const fbFetchAllUsers = async (idToken) => {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${getFB().projectId}/databases/(default)/documents/users?pageSize=100`, {
    headers: { "Authorization": `Bearer ${idToken}` }
  });
  if (!res.ok) return [];
  const doc = await res.json();
  if (!doc || !doc.documents) return [];
  return doc.documents.map(d => {
    const obj = { id: d.name.split('/').pop() };
    if (d.fields) {
      for(const [k,v] of Object.entries(d.fields)) obj[k] = v.stringValue || "";
    }
    return obj;
  });
};

const fbUploadLogo = async (file, idToken) => {
  const ext  = file.name.split(".").pop();
  const name = encodeURIComponent(`logos/logo_${Date.now()}.${ext}`);
  const res  = await fetch(`${STG_URL()}?uploadType=media&name=${name}`, {
    method: "POST",
    headers: { "Content-Type": file.type, "Authorization": `Bearer ${idToken}` },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return `${STG_URL()}/${name}?alt=media&token=${data.downloadTokens}`;
};

const fbUploadPhoto = async (file, idToken) => {
  const ext  = file.name.split(".").pop();
  const name = encodeURIComponent(`gallery/photo_${Date.now()}.${ext}`);
  const res  = await fetch(`${STG_URL()}?uploadType=media&name=${name}`, {
    method: "POST",
    headers: { "Content-Type": file.type, "Authorization": `Bearer ${idToken}` },
    body: file,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return `${STG_URL()}/${name}?alt=media&token=${data.downloadTokens}`;
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

  const headers = { "Content-Type": cType };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;

  const res = await fetch(`${STG_URL()}?uploadType=media&name=${name}`, {
    method: "POST",
    headers: headers,
    body: file,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return `${STG_URL()}/${name}?alt=media&token=${data.downloadTokens}`;
};



function useW() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return w;
}

const THEMES = {
  classic: `:root{--sf:#E8650A;--sflt:#F9A14E;--gd:#C8860A;--dt:#0D4B5E;--tm:#1A6B87;--tl:#E8F4F8;--cr:#FDF8F0;--ww:#FFFBF4;--tx:#1C1C1C;--tm2:#4A4A4A;--mu:#888;--bd:#E8DDD0}`,
  ocean: `:root{--sf:#FF6B6B;--sflt:#FF8E8E;--gd:#4ECDC4;--dt:#0B3954;--tm:#087E8B;--tl:#EBF8FA;--cr:#F4F9F9;--ww:#FFFFFF;--tx:#112D32;--tm2:#4A4A4A;--mu:#888;--bd:#DDE8E8}`,
  forest: `:root{--sf:#D4AF37;--sflt:#E6C25B;--gd:#B8860B;--dt:#1A3622;--tm:#2C5535;--tl:#EBF3ED;--cr:#F4F6F4;--ww:#FCFDFD;--tx:#1A251D;--tm2:#4A4A4A;--mu:#888;--bd:#DCE3DD}`,
  "3d": `:root{--sf:#BC13FE;--sflt:#D966FF;--gd:#00F0FF;--dt:#09090B;--tm:#18181B;--tl:#27272A;--cr:#000000;--ww:#0A0A0A;--tx:#FFFFFF;--tm2:#A1A1AA;--mu:#71717A;--bd:#3F3F46}`
};

const G = ({ theme = "classic" }) => {
  const vars = THEMES[theme] || THEMES.classic;
  return (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Yatra+One&family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    ${vars}
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
    ${theme === "ocean" ? `
      .ocean #home > div { text-align: left !important; }
      .ocean .hbg { background: white !important; background-image: radial-gradient(circle at 100% 50%, #EBF8FA 0%, white 50%) !important; }
      .ocean #home h1, .ocean #home p { color: var(--tx) !important; }
      .ocean .sp { border-color: var(--gd) !important; right: -5% !important; top: -5% !important; width: 400px !important; height: 400px !important; }
      .ocean #about, .ocean #events, .ocean #contact { background: #EBF8FA !important; }
      .ocean #programs { background: linear-gradient(180deg, #EBF8FA, #FFFFFF) !important; }
      .ocean #gallery { background: var(--dt) !important; }
      .ocean #gallery h2, .ocean #gallery p { color: white !important; }
      .ocean #gallery img { border-radius: 50% !important; border: 4px solid white !important; }
      .ocean #achievements { background: white !important; }
      .ocean .ac, .ocean .csc { border: none !important; border-radius: 24px !important; box-shadow: 0 10px 40px rgba(0,0,0,0.03) !important; }
      .ocean .bs, .ocean .bt { border-radius: 50px !important; }
    ` : ''}
    ${theme === "forest" ? `
      .forest #home { align-items: flex-end !important; padding-bottom: 120px !important; }
      .forest #home > div { grid-template-columns: 1fr !important; text-align: center !important; max-width: 900px !important; }
      .forest #home .fu > div { justify-content: center !important; }
      .forest .hbg { background: var(--dt) !important; background-image: linear-gradient(180deg, rgba(26,54,34,0.4) 0%, #1A3622 100%) !important; }
      .forest #about, .forest #events { background: var(--dt) !important; color: white !important; }
      .forest #programs, .forest #gallery { background: #122818 !important; color: white !important; }
      .forest #programs h2, .forest #gallery h2, .forest #about h2, .forest #events h2 { color: var(--sf) !important; }
      .forest #programs p, .forest #gallery p, .forest #about p, .forest #events p { color: rgba(255,255,255,0.8) !important; }
      .forest #programs .csc { background: var(--dt) !important; color: white !important; border: 1px solid var(--sf) !important; }
      .forest #gallery img { border-radius: 0px !important; border: 2px solid var(--sf) !important; }
      .forest .ac, .forest .csc { border: 1px solid var(--sf) !important; border-radius: 0px !important; }
      .forest .bs, .forest .bt { border-radius: 0px !important; }
    ` : ''}
    ${theme === "3d" ? `
      .3d #home > div { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); border-radius: 40px; padding: 40px !important; box-shadow: 0 30px 60px rgba(0,0,0,0.5), inset 2px 2px 10px rgba(255,255,255,0.1); }
      .3d .hbg { background: radial-gradient(circle at 50% 50%, #18181B 0%, #09090B 100%) !important; }
      .3d .ac, .3d .csc { background: rgba(255,255,255,0.02) !important; border: 1px solid rgba(255,255,255,0.05) !important; box-shadow: inset 2px 2px 5px rgba(255,255,255,0.05), inset -2px -2px 5px rgba(0,0,0,0.5), 0 10px 30px rgba(0,0,0,0.3) !important; border-radius: 30px !important; color: white !important; }
      .3d section { background: var(--dt) !important; }
      .3d #programs .csc { background: rgba(0,240,255,0.05) !important; border: 1px solid rgba(0,240,255,0.2) !important; box-shadow: 0 0 20px rgba(0,240,255,0.1) !important; border-radius: 20px !important; color: white !important; }
      .3d #programs h2, .3d #gallery h2 { text-shadow: 0 0 10px var(--sf) !important; }
      .3d #gallery img { border-radius: 20px !important; box-shadow: inset 0 0 20px black, 0 10px 20px black !important; border: 1px solid rgba(255,255,255,0.1) !important; }
      .3d h2 { color: white !important; }
      .3d p, .3d .cl { color: var(--tm2) !important; }
      .3d .bs, .3d .bt { box-shadow: inset 2px 2px 5px rgba(255,255,255,0.3), inset -2px -2px 5px rgba(0,0,0,0.5), 0 5px 15px rgba(188,19,254,0.4) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 20px !important; }
      .3d .bs:hover, .3d .bt:hover { box-shadow: inset 1px 1px 3px rgba(255,255,255,0.4), inset -1px -1px 3px rgba(0,0,0,0.6), 0 8px 20px rgba(188,19,254,0.6) !important; }
      .3d .ch { box-shadow: 10px 10px 20px #050505, -10px -10px 20px #111111; border: 1px solid #27272A; background: var(--ww); }
      .3d .ch:hover { transform: translateY(-4px); box-shadow: 12px 12px 24px #040404, -12px -12px 24px #141414; }
      .3d .ci, .3d .csh { background: #111 !important; border-color: #27272A !important; color: white !important; }
    ` : ''}
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
    .ql-toolbar { border-color: var(--bd)!important; border-top-left-radius: 8px; border-top-right-radius: 8px; background: #F8F9FA }
    .ql-container { border-color: var(--bd)!important; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; font-family: inherit!important; }
    .ql-editor { min-height: 150px; font-size: .875rem; color: var(--tx) }
    .csc{background:white;border-radius:16px;border:1px solid var(--bd);box-shadow:0 2px 12px rgba(0,0,0,.05);margin-bottom:14px;overflow:hidden}
    .csh{padding:14px 18px;background:var(--tl);border-bottom:1px solid #B8D8E8;display:flex;align-items:center;gap:10px;cursor:pointer}
    .csb{padding:18px 20px}
    .lt{padding:6px 14px;border-radius:6px;border:1px solid var(--bd);background:white;cursor:pointer;font-size:.78rem;font-weight:600;transition:all .2s}
    .lt.a{background:var(--dt);color:white;border-color:var(--dt)}
    .toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1A7A3E;color:white;padding:12px 24px;border-radius:50px;font-size:.875rem;font-weight:600;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.2);animation:fadeUp .4s ease}
  `}</style>
  );
};

const DC = {
  theme: "classic",
  trust:{name:"myCommunity",nameGu:"મારો સમુદાય",subtitle:"COMMUNITY PLATFORM",phone:"+1 800 123 4567",email:"hello@mycommunity.org",address:"123 Community Drive, Main Street, Global City - 12345",hours:"Mon–Sat: 9:00 AM – 6:00 PM",estd:"2024",reg80G:"REG/2024/123",panNo:"ABCDE1234F",cin:"U12345AB2024CDE012345",
    logo:{
      visible:  true,
      type:     "text",       // "text" | "image"
      text:     "MC",         // shown when type=text
      url:      "",           // image URL when type=image
      size:     42,           // px — applies to both types
      shape:    "circle",     // "circle" | "rounded" | "square"
      bgColor:  "gradient",   // "gradient" | "white" | "transparent"
    }
  },
  hero:{badge:"ESTD. 2024 · COMMUNITY PLATFORM",title:"Empowering Our Community Together",titleGu:"આપણા સમુદાયને સાથે મળીને સશક્તિકરણ",subtitle:"A generic fallback boilerplate for communities to share their mission, programs, and connect with members.",subtitleGu:"સમુદાયો માટે તેમના મિશન, કાર્યક્રમો શેર કરવા અને સભ્યો સાથે જોડાવા માટે એક સામાન્ય ફોલબેક બોઈલરપ્લેટ.",cta1:"Donate Now",cta1Gu:"દાન આપો",cta2:"Our Programs",cta2Gu:"અમારા કાર્યક્રમો",badge1:"Verified",badge2:"Registered",badge3:"Audited",showStats:true,showImage:false,image:"",showRegBtn:false,regBtnLabel:"Register Now",regBtnLabelGu:"હવે નોંધણી કરો",regBtnLink:"#events"},
  stats:[{num:"10,000+",label:"Members",labelGu:"સભ્યો"},{num:"$100k",label:"Funds Raised",labelGu:"ભંડોળ એકત્ર"},{num:"50+",label:"Volunteers",labelGu:"સ્વયંસેવકો"},{num:"10",label:"Active Programs",labelGu:"સક્રિય કાર્યક્રમો"}],
  about:{heading:"Rooted in Compassion, Driven by Purpose",headingGu:"કરુણામાં મૂળ, ઉદ્દેશ્ય દ્વારા ચાલિત",body1:"myCommunity was founded to create a dignified life for every individual regardless of caste, creed, or economic status. This is fallback data when Firebase is not connected.",body1Gu:"મારો સમુદાય દરેક વ્યક્તિ માટે સન્માનજનક જીવન બનાવવા માટે સ્થાપિત કરવામાં આવ્યો હતો.",body2:"Our work spans education, healthcare, and empowerment through community participation.",body2Gu:"અમારું કાર્ય શિક્ષણ, આરોગ્ય અને સશક્તિકરણ સુધી ફેલાયેલું છે.",points:["Transparent Governance","Community-Led Programs","Annual Public Audit","Zero Admin Fee Policy"],yearsLabel:"Years of Service",cta:"Read Our Story"},
  programs:[{icon:"📚",title:"Education for All",sub:"Scholarships and learning centers for underprivileged children",details:"### Our Mission\nOur Education for All initiative focuses on providing quality education to children from marginalized communities. \n\n### What We Do\n- **Evening Centers**: We run evening learning centers for over 500 children.\n- **Scholarships**: We offer merit-based scholarships to help students pursue higher education.\n- **Free Supplies**: Distribute free school supplies, uniforms, and textbooks.\n\n> *\"Education is the most powerful weapon which you can use to change the world.\"*",color:"#FFF4EC",border:"#FDDBB8"},{icon:"🏥",title:"Health and Wellness",sub:"Free medical camps, medicines and health awareness drives",details:"### Healthcare for Everyone\nWe organize monthly free medical camps in rural areas, offering:\n\n1. General physical checkups\n2. Eye and dental exams\n3. Free basic medicines\n\nOur health awareness drives educate communities on hygiene, nutrition, and preventative care.",color:"#E8F4F8",border:"#B8D8E8"},{icon:"🌾",title:"Livelihood Support",sub:"Skill development and micro-finance for rural communities",details:"### Economic Independence\nTo foster economic independence, we provide skill development workshops in:\n- **Tailoring & Sewing**\n- **Computer Literacy**\n- **Basic Mechanics**\n\nWe also offer micro-finance support to help families start small sustainable businesses.",color:"#EDFAF1",border:"#B8E8CC"},{icon:"🤝",title:"Women Empowerment",sub:"Self-help groups, vocational training and legal aid",details:"### Empowering Women\nOur Women Empowerment programs create **self-help groups** where women can save and invest together.\n\nWe offer specialized vocational training and free legal aid to ensure women are aware of and can protect their rights.",color:"#F9F0FF",border:"#D8B8E8"},{icon:"🌊",title:"Disaster Relief",sub:"Rapid response support for flood and earthquake victims",details:"### Emergency Response\nIn times of natural calamities, our rapid response teams distribute:\n- Emergency ration kits\n- Clean drinking water\n- Temporary shelter materials\n\nWe work closely with local authorities to ensure aid reaches the most affected areas quickly.",color:"#FEF9EC",border:"#F5E8B8"},{icon:"🌱",title:"Environment",sub:"Tree plantation drives and clean water initiatives",details:"### A Greener Future\nCommitted to a greener future, we conduct regular **tree plantation drives** and maintain them with community support.\n\nWe also install water purification systems in schools and villages to ensure access to safe drinking water.",color:"#EDFAF1",border:"#B8E8CC"}],
  events:[{date:"Jun 15",month:"2025",title:"Annual Blood Donation Camp",location:"Ahmedabad Community Hall",tag:"Health",color:"#E8F4F8"},{date:"Jul 04",month:"2025",title:"Monsoon Tree Plantation Drive",location:"Sabarmati Riverfront",tag:"Environment",color:"#EDFAF1"},{date:"Aug 20",month:"2025",title:"Scholarship Distribution Ceremony",location:"Sardar Patel Hall, Surat",tag:"Education",color:"#FFF4EC"},{date:"Sep 10",month:"2025",title:"Womens Skill Fair 2025",location:"Vadodara Exhibition Ground",tag:"Empowerment",color:"#F9F0FF"}],
  donate:{heading:"Your Donation Changes Lives",subtext:"100% of donations go directly to programs. Tax exemption under 80G available.",note:"Secured by Razorpay - 256-bit SSL encryption - 80G receipt auto-generated",recurringLabel:"Monthly Recurring Donation",recurringNote:"Auto-deducted each month. Cancel anytime.",razorpayKey:"rzp_test_YourRazorpayKeyHere",programs:["General","Education","Healthcare","Women","Environment","Relief"]},
  contact:{volunteerHeading:"Become a Volunteer",volunteerSub:"Your time and skills can transform lives. Join 340+ active volunteers across Gujarat.",contactHeading:"Contact Us",volunteerOptions:["Education","Healthcare","Field Work","IT and Digital","Fundraising"],socials:["WhatsApp","Facebook","Instagram","YouTube"]},
  nav:[
    {label:"Home",      labelGu:"ઘર",           sectionId:"home",     icon:"🏠", visible:true},
    {label:"About",     labelGu:"અમારા વિશે",    sectionId:"about",    icon:"ℹ️", visible:true},
    {label:"Programs",  labelGu:"કાર્યક્રમો",     sectionId:"programs", icon:"📋", visible:true},
    {label:"Achievements",labelGu:"સિદ્ધિઓ",      sectionId:"achievements",icon:"🏆", visible:true},
    {label:"Gallery",   labelGu:"ગૅલેરી",         sectionId:"gallery",  icon:"🖼️", visible:true},
    {label:"Events",    labelGu:"ઘટનાઓ",          sectionId:"events",   icon:"📅", visible:true},
    {label:"Donate",    labelGu:"દાન",            sectionId:"donate",   icon:"❤️", visible:true},
    {label:"Contact",   labelGu:"સંપર્ક",          sectionId:"contact",  icon:"📞", visible:true},
  ],
  footer: {
    description: "Serving humanity with compassion since 2004. Registered under Gujarat Public Trust Act. 80G and FCRA Certified.",
    copyrightYear: "2025",
    tagline: "Designed with love for humanity"
  },
  builtinSections:{
    hero:true, about:true, programs:true, team:true,
    gallery:true, events:true, donate:true, contact:true,
  },
  customSections:[],
  galleryItems:[],
  teamItems:[],
  teamLayout:"plain",
  teamNodeCounter: 1,
  access:{roles:[]},
};

const EMOJIS = ["📚","🏥","🌾","🤝","🌊","🌱","🏛️","💡","🎓","🏃","🌍","⭐","❤️","🎯","🔬","🎨"];
const COLORS = [{c:"#FFF4EC",b:"#FDDBB8"},{c:"#E8F4F8",b:"#B8D8E8"},{c:"#EDFAF1",b:"#B8E8CC"},{c:"#F9F0FF",b:"#D8B8E8"},{c:"#FEF9EC",b:"#F5E8B8"},{c:"#FFF0F0",b:"#F5B8B8"}];
const SIDS = ["home","about","programs","team","achievements","gallery","events","donate","contact"];
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
  const isSectionVisible = (id) => {
    const bs = C.builtinSections || {};
    const key = id === "home" ? "hero" : id;
    if (bs[key] !== undefined) return bs[key] !== false;
    const custom = C.customSections?.find(c => c.id === id);
    if (custom) return custom.visible !== false;
    return true;
  };

  let visibleNav = (C.nav || []).filter(n => n.visible && isSectionVisible(n.sectionId));
  
  const builtIn = {
    team: {label: "Our Team", icon: "👥"},
    achievements: {label: "Achievements", icon: "🏆"},
    about: {label: "About", icon: "ℹ️"},
    programs: {label: "Programs", icon: "📋"},
    gallery: {label: "Gallery", icon: "🖼️"},
    events: {label: "Events", icon: "📅"},
    donate: {label: "Donate", icon: "❤️"},
    contact: {label: "Contact", icon: "📞"}
  };
  
  Object.keys(builtIn).forEach(k => {
    if (isSectionVisible(k) && !visibleNav.find(n => n.sectionId === k)) {
      visibleNav.push({ label: builtIn[k].label, sectionId: k, icon: builtIn[k].icon });
    }
  });

  (C.customSections || []).forEach(c => {
    if (c.visible !== false && !visibleNav.find(n => n.sectionId === c.id)) {
      visibleNav.push({ label: c.title || "Custom", sectionId: c.id, icon: "✨" });
    }
  });
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
                  Login
                </button>
                {auth?.email && (
                  <>
                  <div style={{width:1,height:12,background:"rgba(255,255,255,.3)"}}/>
                  <button onClick={()=>setPage("admin")} style={{background:"transparent",border:"none",color:"white",fontWeight:700,fontSize:".75rem",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{width:18,height:18,borderRadius:"50%",background:"var(--sf)",color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".6rem"}}>{auth.email[0].toUpperCase()}</span> Admin Panel
                  </button>
                  </>
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
                  {auth?.email && (
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
    <section id="home" className="hbg" style={{minHeight:mob?"auto":"88vh",display:"flex",flexDirection:"column",justifyContent:"center",position:"relative",paddingBottom:mob?60:80, ...(h?.bgCss ? {background: h.bgCss} : {})}}>
      {h?.showTopBanner && h?.topBanner && (
        <div style={{width:"100%",maxWidth:1200,margin:"0 auto",padding:mob?"20px 20px 0":"20px 32px 0",display:"flex",justifyContent:"center",zIndex:2}}>
           <img src={h.topBanner} alt="Top Banner" style={{width:"100%", height:h?.topBannerHeight || 250, objectFit:"contain"}} />
        </div>
      )}
      <div style={{position:"absolute",top:"10%",right:"5%",width:200,height:200,borderRadius:"50%",border:"1px solid rgba(200,134,10,.15)",opacity:.4}} className="sp"/>
      <div style={{maxWidth:1200,margin:"0 auto",padding:mob?"80px 20px 60px":"60px 32px",display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:mob?32:56,alignItems:"center",width:"100%"}}>
        <div className="fu">
          <div style={{display:"inline-flex",alignItems:"center",gap:8,background:h?.badgeBgColor || "rgba(200,134,10,.2)",border:"1px solid "+(h?.badgeBgColor ? "transparent" : "rgba(200,134,10,.4)"),borderRadius:20,padding:"5px 14px",marginBottom:20}}>
            <span style={{color:h?.badgeTextColor || "#F9A14E",fontSize:".75rem",fontWeight:600,letterSpacing:1}}>{h.badge}</span>
          </div>
          {lang==="gu"
            ? <h1 style={{fontFamily:"'Yatra One',cursive",fontSize:mob?"1.8rem":"2.4rem",color:h?.textColor || "white",lineHeight:1.35,marginBottom:18}}>{h.titleGu}</h1>
            : <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.9rem":"2.8rem",color:h?.textColor || "white",lineHeight:1.25,marginBottom:18,fontWeight:700}}>{h.title}</h1>}
          <p style={{color:h?.textColor || "rgba(255,255,255,.8)",fontSize:mob?".9rem":"1rem",lineHeight:1.75,marginBottom:28}}>{lang==="en"?h.subtitle:h.subtitleGu}</p>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <button className="bs" onClick={()=>document.getElementById("donate")?.scrollIntoView({behavior:"smooth"})} style={{padding:mob?"12px 22px":"14px 28px",borderRadius:10,fontSize:mob?".9rem":"1rem",fontWeight:700}}>{lang==="en"?h.cta1:h.cta1Gu}</button>
            <button onClick={()=>document.getElementById("programs")?.scrollIntoView({behavior:"smooth"})} style={{padding:mob?"12px 22px":"14px 28px",borderRadius:10,fontSize:mob?".9rem":"1rem",fontWeight:600,background:"rgba(255,255,255,.1)",border:"1px solid "+(h?.textColor || "rgba(255,255,255,.3)"),color:h?.textColor || "white",cursor:"pointer"}}>{lang==="en"?h.cta2:h.cta2Gu}</button>
          </div>
          <div style={{display:"flex",gap:20,marginTop:28,flexWrap:"wrap"}}>
            {[h.badge1,h.badge2,h.badge3].map(b=><div key={b} style={{display:"flex",alignItems:"center",gap:6,color:h?.textColor || "rgba(255,255,255,.7)",fontSize:".78rem"}}><span style={{color:"#F9A14E"}}>✓</span>{b}</div>)}
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:24}}>
          {h.showStats !== false && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {C.stats.map((s,i)=><div key={i} className="sb" style={{borderRadius:16,padding:mob?"20px 16px":"26px 22px",textAlign:"center"}}>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.6rem":"2rem",fontWeight:700,color:"#F9A14E",marginBottom:6}}>{s.num}</div>
                <div style={{color:h?.textColor || "rgba(255,255,255,.75)",fontSize:mob?".78rem":".85rem",lineHeight:1.3}}>{lang==="en"?s.label:s.labelGu}</div>
              </div>)}
            </div>
          )}
          {h.showImage && h.image && (
            <div style={{width:"100%",borderRadius:16,overflow:"hidden",boxShadow:"0 12px 30px rgba(0,0,0,0.3)"}}>
              <img src={h.image} alt="Campaign" style={{width:"100%",display:"block",objectFit:"cover"}} />
            </div>
          )}
          {h.showRegBtn && (
            <div style={{textAlign:"center"}}>
              <a href={(h.regBtnLink === "external" ? h.regBtnExternal : h.regBtnLink) || "#events"} 
                 onClick={(e) => {
                   let link = h.regBtnLink || "#events";
                   if (link === "external") link = h.regBtnExternal;
                   if (!link) return;
                   
                   if (link.startsWith("#event-")) {
                     e.preventDefault();
                     const idx = parseInt(link.split("-")[1]);
                     document.getElementById("events")?.scrollIntoView({behavior:"smooth"});
                     setTimeout(() => {
                       window.dispatchEvent(new CustomEvent('openEventRegistration', { detail: idx }));
                     }, 500);
                   } else if (link.startsWith("#")) {
                     e.preventDefault();
                     document.querySelector(link)?.scrollIntoView({behavior:"smooth"});
                   }
                 }}
                 target={(h.regBtnLink==="external" && h.regBtnExternal && !h.regBtnExternal.startsWith("#")) ? "_blank" : undefined}
                 style={{display:"inline-block",padding:"16px 32px",background:"#F9A14E",color:"white",borderRadius:12,fontSize:"1.1rem",fontWeight:700,textDecoration:"none",boxShadow:"0 8px 24px rgba(249, 161, 78, 0.4)",transition:"transform 0.2s"}} onMouseEnter={e=>e.currentTarget.style.transform="translateY(-3px)"} onMouseLeave={e=>e.currentTarget.style.transform="none"}>
                {lang==="en"?h.regBtnLabel:h.regBtnLabelGu}
              </a>
            </div>
          )}
        </div>
      </div>
      <svg style={{position:"absolute",bottom:0,left:0,width:"100%",height:50}} viewBox="0 0 1440 50" preserveAspectRatio="none"><path d="M0,30 C360,60 1080,0 1440,30 L1440,50 L0,50 Z" fill="var(--cr)"/></svg>
    </section>
  );
}

// ── PROGRAMS ──────────────────────────────────────────────────────────────────
function Programs({ C, lang }) {
  const w = useW(); const cols = w<640?"1fr":w<960?"1fr 1fr":"1fr 1fr 1fr";
  const [activeProg, setActiveProg] = useState(null);
  return (
    <>
    <section id="programs" style={{padding:w<640?"16px 16px":"20px 32px",background:"var(--cr)"}}>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:48}}>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>What We Do</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:w<640?"1.7rem":"2.2rem",color:"var(--dt)",marginTop:8,fontWeight:700}} className="sh">Our Programs</h2>
        </div>
        <div style={{display:"grid",gridTemplateColumns:cols,gap:18}}>
          {C.programs.map((p,i)=><div key={i} className="ch" style={{background:p.color,border:`1px solid ${p.border}`,borderRadius:16,padding:"24px 20px",cursor:"pointer"}} onClick={()=>setActiveProg(p)}>
            <div style={{fontSize:"2rem",marginBottom:12}}>{p.icon}</div>
            <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1rem",fontWeight:700,color:"var(--dt)",marginBottom:7}}>{lang==="gu"&&p.titleGu?p.titleGu:p.title}</h3>
            <p style={{fontSize:".85rem",color:"var(--tm2)",lineHeight:1.6,margin:0}}>{lang==="gu"&&p.subGu?p.subGu:p.sub}</p>
            <div style={{marginTop:14,color:"var(--sf)",fontSize:".8rem",fontWeight:600}}>Learn more</div>
          </div>)}
        </div>
      </div>
    </section>

    {activeProg && (
      <div style={{position:"fixed",inset:0,background:"rgba(13,75,94,.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:1000,backdropFilter:"blur(4px)"}}
        onClick={()=>setActiveProg(null)}>
        <div style={{background:"white",borderRadius:24,padding:"36px 32px",width:"100%",maxWidth:500,boxShadow:"0 32px 80px rgba(0,0,0,.3)",position:"relative",maxHeight:"90vh",overflowY:"auto"}}
          onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setActiveProg(null)}
            style={{position:"absolute",top:14,right:14,background:"none",border:"1px solid var(--bd)",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:"1rem",color:"var(--mu)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            ✕
          </button>
          <div style={{fontSize:"3rem",marginBottom:16,textAlign:"center"}}>{activeProg.icon}</div>
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.6rem",fontWeight:700,color:"var(--dt)",marginBottom:12,textAlign:"center"}}>{lang==="gu"&&activeProg.titleGu?activeProg.titleGu:activeProg.title}</h3>
          <div style={{width:60,height:4,background:"var(--sf)",borderRadius:2,margin:"0 auto 20px"}}/>
          <style>{`
            .md-content { font-size: .95rem; color: var(--tm2); line-height: 1.7; text-align: left; word-break: break-word; overflow-wrap: break-word; max-width: 100%; overflow-x: hidden; }
            .md-content h1, .md-content h2, .md-content h3, .md-content h4 { color: var(--dt); margin-top: 1.5em; margin-bottom: .5em; font-family: 'Playfair Display', serif; }
            .md-content h1 { font-size: 1.5rem; }
            .md-content h2 { font-size: 1.3rem; }
            .md-content h3 { font-size: 1.15rem; }
            .md-content h4 { font-size: 1.05rem; }
            .md-content p { margin-bottom: 1em; }
            .md-content ul, .md-content ol { margin-bottom: 1em; padding-left: 1.5em; }
            .md-content li { margin-bottom: .4em; }
            .md-content strong { color: var(--dt); font-weight: 700; }
            .md-content blockquote { border-left: 4px solid var(--sf); padding-left: 1em; margin-left: 0; color: #666; font-style: italic; }
            .md-content mark { background: #FFF4EC; color: var(--dt); padding: 0 4px; border-radius: 4px; font-weight: 600; }
          `}</style>
          <div className="md-content" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse((lang==="gu"&&activeProg.detailsGu?activeProg.detailsGu:activeProg.details) || (lang==="gu"&&activeProg.subGu?activeProg.subGu:activeProg.sub)))}} />
          <div style={{marginTop:30,textAlign:"center"}}>
            <button onClick={()=>setActiveProg(null)} style={{padding:"12px 30px",borderRadius:10,background:"var(--sf)",color:"white",border:"none",fontWeight:600,fontSize:".9rem",cursor:"pointer"}}>Close</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ── ABOUT ─────────────────────────────────────────────────────────────────────
function About({ C, lang }) {
  const w = useW(); const mob = w<768; const a = C.about || {};
  const align = a.align || "left";
  const [showStory, setShowStory] = useState(false);
  return (
    <section id="about" style={{padding:mob?"16px 16px":"20px 32px",background:"var(--ww)"}}>
      <div style={{maxWidth:1200,margin:"0 auto",display:"grid",gridTemplateColumns:mob||a.hideImage?"1fr":"1fr 1fr",gap:mob?32:60,alignItems:"center",textAlign:align}}>
        {!mob && !a.hideImage && <div style={{position:"relative"}}>
          <div style={{width:"100%",aspectRatio:"4/3",borderRadius:20,background:"linear-gradient(135deg,var(--dt),var(--tm))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"6rem",boxShadow:"0 24px 60px rgba(13,75,94,.2)",overflow:"hidden"}}>
            {a.mainImage ? (
              <img src={a.mainImage} alt="About Us" style={{width:"100%",height:"100%",objectFit:"contain",background:"white",display:"block"}} />
            ) : (
              "🙏"
            )}
          </div>
          {a.badgeImage && (
            <div style={{position:"absolute",bottom:-20,right:-16,background:"white",borderRadius:16,padding:"12px",boxShadow:"0 12px 40px rgba(0,0,0,.1)",border:"1px solid var(--bd)"}}>
              <img src={a.badgeImage} alt="Badge" style={{height: 70, objectFit:"contain", display:"block"}}/>
            </div>
          )}
        </div>}
        <div style={{display:"flex",flexDirection:"column",alignItems:align==="center"?"center":align==="right"?"flex-end":"flex-start"}}>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>About the Trust</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.6rem":"2rem",color:"var(--dt)",marginTop:8,marginBottom:18,fontWeight:700}} className="sh l">{lang==="en"?a.heading:a.headingGu}</h2>
          <p style={{color:"var(--tm2)",lineHeight:1.8,marginBottom:14,fontSize:".93rem"}}>{lang==="en"?a.body1:a.body1Gu}</p>
          <p style={{color:"var(--tm2)",lineHeight:1.8,marginBottom:24,fontSize:".93rem"}}>{lang==="en"?a.body2:a.body2Gu}</p>
          <div style={{display:"grid",gridTemplateColumns:mob||a.hideImage?"repeat(auto-fit, minmax(200px, 1fr))":"1fr 1fr",gap:10,marginBottom:24,width:"100%"}}>
            {a.points?.map((v, i)=>{
              const text = lang === "gu" ? (a.pointsGu?.[i] || v) : v;
              return <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:".875rem",justifyContent:align==="center"?"center":align==="right"?"flex-end":"flex-start"}}><span style={{color:"var(--sf)"}}>✓</span>{text}</div>
            })}
          </div>
          {(a.story || a.storyGu) ? (
            <button className="bt" onClick={() => setShowStory(true)} style={{padding:"11px 22px",borderRadius:10,fontWeight:600,fontSize:".875rem",cursor:"pointer"}}>{a.cta}</button>
          ) : (
            <button className="bt" style={{padding:"11px 22px",borderRadius:10,fontWeight:600,fontSize:".875rem"}}>{a.cta}</button>
          )}
        </div>
      </div>

      {showStory && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"white",width:"100%",maxWidth:800,maxHeight:"90vh",borderRadius:20,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{padding:"20px 24px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--ww)"}}>
              <h3 style={{margin:0,fontSize:"1.4rem",color:"var(--dt)",fontFamily:"'Playfair Display',serif"}}>{a.cta}</h3>
              <button onClick={() => setShowStory(false)} style={{background:"none",border:"none",fontSize:"1.8rem",cursor:"pointer",color:"var(--mu)",lineHeight:1}}>×</button>
            </div>
            <div className="rich-text-content" style={{padding:"24px",overflowY:"auto",lineHeight:1.7,color:"#444",fontSize:"1.05rem"}} dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(lang==="gu"?(a.storyGu||""):(a.story||""))}} />
          </div>
        </div>
      )}
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
              razorpay_payment_id: response.razorpay_payment_id,
              submitterMob: auth?.mob || ""
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
    <section id="donate" style={{padding:mob?"16px 16px":"20px 32px",background:"linear-gradient(135deg,#0D4B5E,#1A6B87)",position:"relative"}}>
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
                    {(C.donate.programs || ["General","Education","Healthcare","Women","Environment","Relief"]).map(p=><button key={p} type="button" onClick={()=>{setProg(p);setProgErr(false);}} style={{padding:"5px 12px",borderRadius:20,fontSize:".78rem",fontWeight:500,background:prog===p?"var(--dt)":"var(--tl)",color:prog===p?"white":"var(--dt)",border:`1px solid ${prog===p?"var(--dt)":progErr?"#F5B8B8":"var(--bd)"}`,cursor:"pointer",transition:"all .2s"}}>{p}</button>)}
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

function Events({ C, lang, globalAuthToken, globalProfile, onPublicLogin }) {
  const w = useW(); const mob = w<700;
  const [selectedEvent, setSelectedEvent] = useState(null); // { type: 'register' | 'details', event }
  const [formData, setFormData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [waMessageLink, setWaMessageLink] = useState("");
  
  // Auth State
  const [authStep, setAuthStep] = useState(0); // 0 = login/register, 1 = form
  const [mobile, setMobile] = useState("");

  const [regName, setRegName] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regGender, setRegGender] = useState("");
  const [regImageFile, setRegImageFile] = useState(null);
  const [authError, setAuthError] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [uploadingFields, setUploadingFields] = useState({});
  const [previewFile, setPreviewFile] = useState(null);

  useEffect(() => {
    const handleOpen = (e) => {
      const idx = e.detail;
      if (C.events && C.events[idx]) {
        setSelectedEvent({ type: 'register', event: C.events[idx] });
        if (globalAuthToken && globalProfile) {
          setAuthToken(globalAuthToken);
          setAuthStep(1);
          const newForm = { "Submitted By": globalProfile.name || globalProfile['Full Name'] || globalProfile.mobile };
          const formSpec = C.forms?.find(f => f.id === C.events[idx].formId) || { fields: [] };
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
          setAuthToken("");
          setAuthStep(0);
        }
      }
    };
    window.addEventListener('openEventRegistration', handleOpen);
    return () => window.removeEventListener('openEventRegistration', handleOpen);
  }, [C.events]);

  const handleFileUpload = async (e, fKey) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingFields(prev => ({...prev, [fKey]: true}));
    try {
      const url = await fbUploadPublicFile(file, authToken);
      setFormData(prev => ({...prev, [fKey]: url}));
    } catch (err) {
      console.error(err);
      alert("Failed to upload: " + err.message);
    } finally {
      setUploadingFields(prev => ({...prev, [fKey]: false}));
    }
  };

  const getForm = (id) => C.forms?.find(f => f.id === id) || { fields: [] };

  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState(null);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!mobile || mobile.length < 10) { setAuthError("Please enter a valid 10-digit mobile number"); return; }
    
    if (!window.recaptchaVerifierEvent) {
      try {
        window.recaptchaVerifierEvent = new RecaptchaVerifier(fbAuth, 'recaptcha-container-event', {
          'size': 'invisible',
        });
      } catch (err) {
        console.error("Recaptcha Init Error:", err);
      }
    }
    
    setSubmitting(true); setAuthError("");
    try {
      const phoneNumber = `+91${mobile.replace(/\D/g, '').slice(-10)}`;
      const appVerifier = window.recaptchaVerifierEvent;
      const result = await signInWithPhoneNumber(fbAuth, phoneNumber, appVerifier);
      setConfirmationResult(result);
      setOtpSent(true);
      setAuthError("");
    } catch (error) {
      console.error(error);
      setAuthError(error.message.includes("auth/billing-not-enabled") ? "SMS quota exceeded. Please contact admin." : error.message.includes("auth/invalid-phone-number") ? "Invalid phone number." : error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp) return;
    setSubmitting(true); setAuthError("");
    try {
      const result = await confirmationResult.confirm(otp);
      const user = result.user;
      const idToken = await user.getIdToken();
      
      setAuthToken(idToken); // Temp save for profile creation
      
      const pData = await fbFetchUserProfile(user.uid, idToken);
      if (pData && pData.name && pData.address) {
        // Profile exists, proceed to form
        if (onPublicLogin) onPublicLogin(idToken, pData);
        setAuthStep(1);
        
        const newForm = {...formData, "Submitted By": pData.name || mobile};
        const formSpec = getForm(selectedEvent?.event?.formId);
        formSpec.fields.forEach(f => {
          const fKey = f.label?.trim() || "Field";
          const kLow = fKey.toLowerCase();
          if (f.type === 'tel' || kLow.includes('mobile') || kLow.includes('phone')) newForm[fKey] = pData.mobile || mobile;
          if (kLow.includes('name') && !kLow.includes('event')) newForm[fKey] = pData.name || "";
          if (kLow.includes('address')) newForm[fKey] = pData.address || "";
          if (kLow.includes('gender') || kLow === 'sex') newForm[fKey] = pData.gender || "";
        });
        setFormData(newForm);
      } else {
        // No profile, ask to complete profile
        setAuthStep('complete_profile');
      }
    } catch(err) {
      setAuthError(err.message.includes("invalid-verification-code") ? "Invalid OTP code." : err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!regName || !regAddress || !regGender) { setAuthError("Please fill out Name, Address, and Gender."); return; }
    setSubmitting(true); setAuthError("");
    try {
      let pUrl = "";
      if (regImageFile) {
        pUrl = await fbUploadPublicFile(regImageFile, authToken).catch(()=>"");
      }
      
      const user = fbAuth.currentUser;
      if (!user) throw new Error("Not authenticated");
      
      let profileData = { name: regName, address: regAddress, gender: regGender, mobile: mobile, photoUrl: pUrl };
      
      await fbUpdateProfile(authToken, regName, pUrl).catch(()=>null);
      await fbSaveUserProfile(user.uid, profileData, authToken).catch(()=>null);
      
      if (onPublicLogin) onPublicLogin(authToken, profileData);
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
    } catch (err) {
      setAuthError(err.message);
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
          submitterMob: (globalProfile?.mobile || mobile || ""),
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
      setWaMessageLink(waLink);
      setDone(true);
    } catch(err) {
      alert("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="events" style={{padding:mob?"16px 16px":"20px 32px",background:"var(--ww)",position:"relative"}}>
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
                <div style={{fontSize:"1.6rem",fontWeight:700,fontFamily:"'Playfair Display',serif",lineHeight:1}}>{(lang==="gu"&&ev.dateGu?ev.dateGu:ev.date)?.split(" ")[0]}</div>
                <div style={{fontSize:".7rem",opacity:.8,marginTop:3}}>{(lang==="gu"&&ev.dateGu?ev.dateGu:ev.date)?.split(" ")[1]}</div>
                <div style={{fontSize:".65rem",opacity:.6}}>{lang==="gu"&&ev.monthGu?ev.monthGu:ev.month}</div>
              </div>
              <div style={{padding:"16px",flex:1,minWidth:0}}>
                <span style={{fontSize:".7rem",fontWeight:700,padding:"3px 9px",borderRadius:20,display:"inline-block",marginBottom:8,background:ev.color,color:"var(--dt)",border:"1px solid var(--bd)"}}>{lang==="gu"&&ev.tagGu?ev.tagGu:ev.tag}</span>
                <h4 style={{fontFamily:"'Playfair Display',serif",fontSize:".95rem",fontWeight:700,color:"var(--dt)",marginBottom:5}}>{lang==="gu"&&ev.titleGu?ev.titleGu:ev.title}</h4>
                <p style={{fontSize:".78rem",color:"var(--mu)",marginBottom:12}}>{lang==="gu"&&ev.locationGu?ev.locationGu:ev.location}</p>
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
            <button onClick={()=>{setSelectedEvent(null);setDone(false);setFormData({});setWaMessageLink("");if(!globalAuthToken){setAuthStep(0);setMobile("");setPassword("");}setAuthError("");}} style={{position:"absolute",top:16,right:16,background:"#F5F5F5",border:"none",fontSize:"1.2rem",cursor:"pointer",width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--mu)"}}>✕</button>
            
            {selectedEvent.type === 'details' && (
              <div>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.4rem",color:"var(--dt)",marginBottom:10,fontWeight:700,paddingRight:30}}>{lang==="gu"&&selectedEvent.event.titleGu?selectedEvent.event.titleGu:selectedEvent.event.title}</h3>
                <div style={{display:"flex",gap:10,marginBottom:16}}>
                   <span style={{fontSize:".75rem",fontWeight:600,padding:"4px 10px",borderRadius:20,background:selectedEvent.event.color||"var(--tl)",color:"var(--dt)"}}>{lang==="gu"&&selectedEvent.event.tagGu?selectedEvent.event.tagGu:selectedEvent.event.tag}</span>
                   <span style={{fontSize:".75rem",fontWeight:600,padding:"4px 10px",borderRadius:20,background:"#F5F5F5",color:"var(--mu)"}}>{lang==="gu"&&selectedEvent.event.dateGu?selectedEvent.event.dateGu:selectedEvent.event.date} {lang==="gu"&&selectedEvent.event.monthGu?selectedEvent.event.monthGu:selectedEvent.event.month}</span>
                </div>
                <p style={{fontSize:".9rem",color:"var(--tm2)",lineHeight:1.6}}>
                  {lang === "gu" ? "આ ઇવેન્ટ માટે " : "Join us at "} 
                  <strong>{lang==="gu"&&selectedEvent.event.locationGu?selectedEvent.event.locationGu:selectedEvent.event.location}</strong> 
                  {lang === "gu" ? " માં જોડાઓ. અમે તમને ત્યાં જોવા માટે આતુર છીએ!" : " for this incredible event. We look forward to seeing you there!"}
                </p>
              </div>
            )}

            {selectedEvent.type === 'register' && (
              <div>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.4rem",color:"var(--dt)",marginBottom:4,fontWeight:700,paddingRight:30}}>
                  {authStep === 'complete_profile' ? 'Complete Profile' : authStep === 0 ? 'User Login' : 'Event Registration'}
                </h3>
                <p style={{fontSize:".85rem",color:"var(--mu)",marginBottom:20}}>
                  {authStep === 1 ? (lang==="gu"&&selectedEvent.event.titleGu?selectedEvent.event.titleGu:selectedEvent.event.title) : 'Sign in or create a profile to continue'}
                </p>
                {done ? (
                  <div style={{textAlign:"center",padding:"30px 0"}}>
                    <div style={{fontSize:"3rem",marginBottom:10}}>✅</div>
                    <h4 style={{color:"#1A7A3E",fontWeight:700,marginBottom:6}}>Registration Successful!</h4>
                    <p style={{fontSize:".85rem",color:"var(--mu)",marginBottom:24}}>Thank you for registering. Please choose an option below:</p>
                    <div style={{display:"flex",flexDirection:"column",gap:12,alignItems:"center"}}>
                      <a href={waMessageLink} target="_blank" rel="noreferrer" style={{display:"inline-block",padding:"10px 20px",borderRadius:20,background:"#F5F5F5",color:"var(--dt)",fontWeight:700,textDecoration:"none",fontSize:".9rem",border:"1px solid var(--bd)"}}>
                        📤 Send Details to Admin (WhatsApp)
                      </a>
                      {selectedEvent.event.waGroupLink && (
                        <a href={selectedEvent.event.waGroupLink} target="_blank" rel="noreferrer" style={{display:"inline-block",padding:"10px 20px",borderRadius:20,background:"linear-gradient(135deg, #25D366, #128C7E)",color:"white",fontWeight:700,textDecoration:"none",fontSize:".9rem",boxShadow:"0 4px 10px rgba(37,211,102,0.3)"}}>
                          💬 Join Event WhatsApp Group
                        </a>
                      )}
                    </div>
                  </div>
                ) : authStep === 0 ? (
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <p style={{fontSize:".9rem",color:"var(--dt)",marginBottom:8, fontWeight:500}}>Please log in securely to continue.</p>
                    {authError && <div style={{background:"#FDECEA",color:"#C0392B",padding:"8px",borderRadius:6,fontSize:".75rem",fontWeight:600}}>{authError}</div>}
                    <div id="recaptcha-container-event"></div>
                    
                    {!otpSent ? (
                    <form onSubmit={e=>handleSendOtp(e)} style={{display:"flex",flexDirection:"column",gap:12}}>
                      <div>
                        <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Mobile Number <span style={{color:"red"}}>*</span></label>
                        <input type="tel" required value={mobile} onChange={e=>setMobile(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:".85rem", background:"#FAFAFA", transition:"all 0.2s", outline:"none"}} placeholder="e.g. 9876543210" onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}/>
                      </div>
                      <button type="submit" className="bs" style={{width:"100%",padding:"12px",borderRadius:8,fontWeight:700,marginTop:8,opacity:submitting?0.7:1, fontSize:".9rem", boxShadow:"0 4px 14px rgba(0,0,0,0.15)", cursor:"pointer", border:"none", color:"white"}} disabled={submitting}>
                        {submitting ? "Processing..." : "Send OTP"}
                      </button>
                    </form>
                    ) : (
                    <form onSubmit={e=>handleVerifyOtp(e)} style={{display:"flex",flexDirection:"column",gap:12}}>
                      <div>
                        <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Enter 6-digit OTP <span style={{color:"red"}}>*</span></label>
                        <input type="text" required value={otp} onChange={e=>setOtp(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:"1.1rem",letterSpacing:4,textAlign:"center", background:"#FAFAFA", transition:"all 0.2s", outline:"none"}} placeholder="------" maxLength={6} onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}/>
                      </div>
                      <button type="submit" className="bs" style={{width:"100%",padding:"12px",borderRadius:8,fontWeight:700,marginTop:8,opacity:submitting?0.7:1, fontSize:".9rem", boxShadow:"0 4px 14px rgba(0,0,0,0.15)", cursor:"pointer", border:"none", color:"white"}} disabled={submitting}>
                        {submitting ? "Verifying..." : "Verify & Login"}
                      </button>
                    </form>
                    )}
                    
                  </div>
                ) : authStep === 'complete_profile' ? (
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{background:"#f4f9ff", border:"1px solid #d0e3ff", padding: "10px 14px", borderRadius:8}}>
                      <p style={{fontSize:".8rem",color:"#0056b3",margin:0, fontWeight: 500}}>Create a complete profile to speed up future registrations.</p>
                    </div>
                    {authError && <div style={{background:"#FDECEA",color:"#C0392B",padding:"8px",borderRadius:6,fontSize:".75rem",fontWeight:600}}>{authError}</div>}
                    
                    <div>
                      <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Full Name <span style={{color:"red"}}>*</span></label>
                      <input type="text" required value={regName} onChange={e=>setRegName(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #CCC",fontFamily:"inherit",fontSize:".85rem", background:"#FAFAFA", transition:"all 0.2s", outline:"none", boxSizing:"border-box"}} placeholder="Enter your full name" onFocus={e=>e.target.style.borderColor="var(--dt)"} onBlur={e=>e.target.style.borderColor="#CCC"}/>
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
                    </div>

                    <div>
                      <label style={{display:"block",fontSize:".7rem",fontWeight:600,color:"var(--dt)",marginBottom:4}}>Profile Image <span style={{fontWeight:"normal",color:"#888"}}>(Optional)</span></label>
                      <div style={{position:"relative", display:"flex", alignItems:"center"}}>
                        <input type="file" accept="image/*" onChange={e=>setRegImageFile(e.target.files[0])} style={{width:"100%",padding:"6px 10px",fontSize:".8rem",background:"white",borderRadius:8,border:"2px dashed #CCC",cursor:"pointer", color:"var(--mu)", boxSizing:"border-box"}}/>
                      </div>
                    </div>

                    <button type="button" onClick={handleSaveProfile} className="bs" style={{width:"100%",padding:"12px",borderRadius:8,fontWeight:700,marginTop:8,opacity:submitting?0.7:1, fontSize:".9rem", boxShadow:"0 4px 14px rgba(0,0,0,0.15)", cursor:"pointer", border:"none", color:"white"}} disabled={submitting}>
                      {submitting ? "Saving Profile..." : "Save Profile & Continue"}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={submitForm} style={{display:"grid",gridTemplateColumns: mob ? "1fr" : "1fr 1fr",gap:12, rowGap:16}}>
                    {(() => {
                      const formObj = getForm(selectedEvent.event.formId);
                      return (
                        <>
                          {formObj.bannerImage && (
                            <div style={{gridColumn:"1 / -1", marginBottom: 10, borderRadius: 8, overflow: "hidden", border: "1px solid var(--bd)"}}>
                              <img src={formObj.bannerImage} alt="Form Banner" style={{width: "100%", maxHeight: 150, objectFit: "cover"}} />
                            </div>
                          )}
                          {formObj.instructions && (
                            <div style={{gridColumn:"1 / -1", marginBottom: 14, background: "#FFFBF4", border: "1px solid var(--bd)", padding: "12px 16px", borderRadius: 8, fontSize: ".85rem", color: "var(--tx)", lineHeight: 1.5, whiteSpace: "pre-wrap"}}>
                              {formObj.instructions}
                            </div>
                          )}
                        </>
                      );
                    })()} 
                    {getForm(selectedEvent.event.formId).fields.length === 0 && <p style={{gridColumn:"1 / -1",fontSize:".85rem",color:"var(--mu)",fontStyle:"italic"}}>This form has no fields. You can still register to send a blank confirmation.</p>}
                    {getForm(selectedEvent.event.formId).fields.map((f, idx) => {
                      let shouldShow = true;
                      let logicRules = [];
                      if (f.logicRules && f.logicRules.length > 0) {
                          logicRules = f.logicRules.filter(r => r.dependsOn && r.dependsValue);
                      } else if (f.dependsOn && f.dependsValue) {
                          logicRules = [{ dependsOn: f.dependsOn, dependsValue: f.dependsValue }];
                      }
                      
                      if (logicRules.length > 0) {
                          shouldShow = logicRules.some(rule => {
                              const parentField = getForm(selectedEvent.event.formId).fields.find(ff => ff.label === rule.dependsOn);
                              const parentKey = parentField ? (parentField.dataKey || parentField.label)?.trim() : rule.dependsOn;
                              const parentVal = formData[parentKey];
                              return parentVal === rule.dependsValue;
                          });
                      }
                      if (!shouldShow) return null;
                      
                      const fKey = (f.dataKey || f.label)?.trim() || `Field ${idx + 1}`;
                      const spanFull = f.type === 'address' || f.type === 'file' || f.type === 'image' || f.type === 'fullname';
                      return (
                      <div key={idx} id={`form_field_${idx}`} style={{animation:"fadeIn 0.4s ease-out", gridColumn: (spanFull || mob) ? "1 / -1" : "auto"}}>
                        <label style={{display:"block",fontSize:".75rem",fontWeight:600,color:"var(--mu)",marginBottom:4}}>{f.label || fKey} {f.required&&<span style={{color:"red"}}>*</span>}</label>
                        {f.type === 'address' ? (
                          <textarea required={f.required} value={formData[fKey]||""} onChange={e=>setFormData({...formData, [fKey]:e.target.value})} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem",minHeight:80,resize:"vertical"}}/>
                        ) : f.type === 'dropdown' ? (
                          <select required={f.required} value={formData[fKey]||""} onChange={e=>setFormData({...formData, [fKey]:e.target.value})} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem"}}>
                            <option value="">-- Select --</option>
                            {(f.options||"").split(",").map((opt, oi) => opt.trim() && <option key={oi} value={opt.trim()}>{opt.trim()}</option>)}
                          </select>
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

// ── ACHIEVEMENTS ──────────────────────────────────────────────────────────────
function Achievements({ C, lang }) {
  const [activeItem, setActiveItem] = useState(null);
  const w = useW(); const mob = w<768; const items = C.achievements || [];

  const navigate = (dir) => {
    if(!activeItem) return;
    const idx = items.indexOf(activeItem);
    if(idx === -1) return;
    const nextIdx = (idx + dir + items.length) % items.length;
    setActiveItem(items[nextIdx]);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if(!activeItem) return;
      if(e.key === "ArrowLeft") navigate(-1);
      if(e.key === "ArrowRight") navigate(1);
      if(e.key === "Escape") setActiveItem(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeItem, items]);

  if(items.length === 0) return null;
  return (
    <section id="achievements" style={{padding:mob?"16px 16px":"20px 32px",background:"var(--ww)"}}>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:mob?32:48}}>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>Recognition</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.8rem":"2.4rem",color:"var(--dt)",marginTop:8,fontWeight:700}}>{lang==="en"?"Achievements & Press Releases":"સિદ્ધિઓ અને અખબારી યાદીઓ"}</h2>
        </div>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":w<1024?"repeat(3,1fr)":"repeat(4,1fr)",gap:16}}>
          {items.map((item, i) => (
            <div key={i} onClick={()=>setActiveItem(item)} className="gi"
              onMouseEnter={e=>e.currentTarget.style.transform="translateY(-6px)"}
              onMouseLeave={e=>e.currentTarget.style.transform="none"}
              style={{background:"white",borderRadius:16,border:"1px solid #EAEAEA",overflow:"hidden",boxShadow:"0 12px 30px rgba(0,0,0,.04)",display:"flex",flexDirection:"column",cursor:"pointer",transition:"all .3s ease"}}>
              
              {/* Image Area */}
              <div style={{width:"100%",aspectRatio:"16/9",background:"#F9F9F9",borderBottom:"1px solid #EAEAEA",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
                {item.image ? (
                  <img src={item.image} alt={item.title} style={{width:"100%",height:"100%",objectFit:"cover",transition:"transform .5s ease"}} className="ach-img"/>
                ) : (
                  <span style={{fontSize:"3rem",opacity:0.1}}>🏆</span>
                )}
              </div>

              {/* Text Area (Yellow Box equivalent) */}
              <div style={{padding:"12px 16px",flex:1,display:"flex",flexDirection:"column",background:"white"}}>
                <div style={{fontSize:".65rem",color:"var(--sf)",textTransform:"uppercase",fontWeight:700,letterSpacing:1,marginBottom:4}}>
                  {lang==="en"?"Press Release / Certificate":"અખબારી યાદી / પ્રમાણપત્ર"}
                </div>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.05rem",color:"var(--dt)",fontWeight:700,margin:"0 0 6px 0",lineHeight:1.3}}>
                  {lang==="en"?(item.title||"Untitled"):(item.titleGu||item.title||"Untitled")}
                </h3>
                {item.desc && (
                  <p style={{color:"var(--tm)",fontSize:".85rem",lineHeight:1.4,margin:0,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
                    {lang==="en"?item.desc:item.descGu}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {activeItem && (
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.85)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:mob?16:40}}>
          {items.length > 1 && <button onClick={(e)=>{e.stopPropagation(); navigate(-1);}} style={{position:"absolute",left:mob?10:40,top:"50%",transform:"translateY(-50%)",background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"white",fontSize:"1.5rem",cursor:"pointer",padding:mob?"8px 12px":"12px 18px",borderRadius:8,zIndex:10001,backdropFilter:"blur(4px)"}}>&#10094;</button>}
          {items.length > 1 && <button onClick={(e)=>{e.stopPropagation(); navigate(1);}} style={{position:"absolute",right:mob?10:40,top:"50%",transform:"translateY(-50%)",background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"white",fontSize:"1.5rem",cursor:"pointer",padding:mob?"8px 12px":"12px 18px",borderRadius:8,zIndex:10001,backdropFilter:"blur(4px)"}}>&#10095;</button>}
          <div style={{background:"white",borderRadius:16,width:"100%",maxWidth:800,maxHeight:"90vh",overflowY:"auto",position:"relative",display:"flex",flexDirection:"column",boxShadow:"0 24px 60px rgba(0,0,0,.4)",zIndex:10000}}>
            <button onClick={()=>setActiveItem(null)} style={{position:"absolute",top:16,right:16,width:36,height:36,borderRadius:"50%",background:"#f5f5f5",color:"#333",border:"none",fontSize:"1.2rem",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,.1)"}}>✕</button>
            {activeItem.image && (
              <div style={{width:"100%",background:"#F4F6F8",padding:mob?16:32,display:"flex",justifyContent:"center",alignItems:"center",borderBottom:"1px solid var(--bd)"}}>
                <img src={activeItem.image} alt={activeItem.title} style={{maxWidth:"100%",maxHeight:"60vh",objectFit:"contain",boxShadow:"0 8px 24px rgba(0,0,0,.12)",borderRadius:4}}/>
              </div>
            )}
            <div style={{padding:mob?"24px 20px":"32px 40px"}}>
              <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.6rem",color:"var(--dt)",fontWeight:700,marginBottom:16}}>
                {lang==="en"?(activeItem.title||"Untitled"):(activeItem.titleGu||activeItem.title||"Untitled")}
              </h3>
              {activeItem.desc && (
                <p style={{color:"var(--tm2)",fontSize:"1.05rem",lineHeight:1.7,margin:0,whiteSpace:"pre-wrap"}}>
                  {lang==="en"?activeItem.desc:activeItem.descGu}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── GALLERY ───────────────────────────────────────────────────────────────────
// ── PUBLIC TEAM ───────────────────────────────────────────────────────────────
function Team({ C, lang }) {
  const [activeMember, setActiveMember] = useState(null);
  const [fullScreenMode, setFullScreenMode] = useState(null);
  const items = C.teamItems || [];
  const layout = C.teamLayout || "plain";
  const w = useW(); const mob = w<768;

  if(items.length === 0) return null;

  const plainItems = items.filter(i => i.parentId === "plain" || typeof i.parentId === "undefined");
  const sortedPlainItems = [...plainItems].sort((a,b)=>(a.order||0)-(b.order||0));

  const openModal = (item) => {
    setActiveMember(item);
  };

  const navModal = (dir) => {
    if (!activeMember) return;
    const idx = sortedPlainItems.findIndex(i => i.id === activeMember.id);
    if (idx === -1) return;
    let n = idx + dir;
    if(n < 0) n = sortedPlainItems.length - 1;
    if(n >= sortedPlainItems.length) n = 0;
    setActiveMember(sortedPlainItems[n]);
  };

  const renderHierarchy = (parentId = null) => {
    let children = items.filter(i => i.parentId === parentId);
    children.sort((a,b) => (a.order||0) - (b.order||0));
    
    if(children.length === 0) return null;

    return (
      <div style={{display:"flex", gap: mob?"8px":"16px", justifyContent:"center", paddingTop: parentId ? (mob?16:20) : 0, position:"relative", flexWrap:mob?"wrap":"nowrap"}}>
        {children.map((node, i) => (
          <div key={node.id} style={{display:"flex", flexDirection:"column", alignItems:"center", position:"relative"}}>
            {/* Connecting lines for children */}
            {parentId && !mob && (
              <>
                <div style={{position:"absolute", top: 0, left: "50%", width: 2, height: 20, background: "var(--sf)", transform:"translateX(-50%)"}} />
                {children.length > 1 && (
                  <div style={{
                    position:"absolute", top: 0, height: 2, background: "var(--sf)",
                    left: i === 0 ? "50%" : 0,
                    right: i === children.length - 1 ? "50%" : 0,
                    width: i === 0 || i === children.length - 1 ? "50%" : "100%"
                  }} />
                )}
              </>
            )}
            
            {/* The Node */}
            <div style={{marginTop: (parentId && !mob) ? 20 : 0, position:"relative", display:"flex", flexDirection:"column", alignItems:"center"}}>
              {/* Parent connector */}
              {!mob && items.find(x=>x.parentId===node.id) && (
                <div style={{position:"absolute", bottom: -20, left: "50%", width: 2, height: 20, background: "var(--sf)", transform:"translateX(-50%)"}} />
              )}
              
              {/* Card */}
              <div className="gi" style={{
                background:"white", padding: mob?8:10, borderRadius: 12, borderTop: "3px solid var(--sf)", 
                width: mob?110:140, textAlign:"center", boxShadow:"0 8px 24px rgba(0,0,0,0.06)",
                transition:"transform .3s", position:"relative", zIndex:2, cursor:"pointer"
              }} onMouseEnter={e=>e.currentTarget.style.transform="translateY(-3px)"} onMouseLeave={e=>e.currentTarget.style.transform="none"} onClick={() => openModal(node)}>
                <div style={{width:mob?40:50, height:mob?40:50, margin:"0 auto 8px", borderRadius:"50%", overflow:"hidden", border:"2px solid #f0f0f0", background:"#eee"}}>
                  {node.image ? (
                    <img src={node.image} alt={node.name} style={{width:"100%", height:"100%", objectFit:"cover"}}/>
                  ) : (
                    <div style={{width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.5rem"}}>👤</div>
                  )}
                </div>
                <h4 style={{fontFamily:"'Playfair Display',serif", color:"var(--dt)", margin:"0 0 2px 0", fontSize:mob?".75rem":".85rem", fontWeight:700}}>{node.name}</h4>
                <div style={{fontSize:mob?".6rem":".65rem", color:"var(--sf)", fontWeight:600, textTransform:"uppercase", letterSpacing:1}}>{node.position}</div>
              </div>
            </div>

            {/* Recursively render children */}
            <div style={{marginTop: mob?12:20, display:"flex", justifyContent:"center", width:"100%"}}>
              {renderHierarchy(node.id)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderPlainGrid = (isFullScreen = false) => (
    <div style={{display:"grid",gridTemplateColumns:mob?"repeat(2,1fr)":(!isFullScreen && items.filter(i => i.parentId === null).length > 0 && sortedPlainItems.length > 0 && !mob)?"repeat(2,1fr)":isFullScreen?"repeat(auto-fit, minmax(180px, 1fr))":w<1024?"repeat(4,1fr)":"repeat(5,1fr)",gap:mob?16:24, padding: "10px"}}>
      {sortedPlainItems.map(item => (
        <div key={item.id} className="gi" style={{background:"#fdfdfd",borderRadius:20,overflow:"hidden",boxShadow:"0 12px 30px rgba(0,0,0,.06)",transition:"all .3s", cursor:"pointer", border:"1px solid rgba(0,0,0,0.05)"}}
          onMouseEnter={e=>e.currentTarget.style.transform="translateY(-8px)"} onMouseLeave={e=>e.currentTarget.style.transform="none"} onClick={() => openModal(item)}>
          <div style={{width:"100%",aspectRatio:"1",background:"#f5f5f5",position:"relative"}}>
            {item.image ? (
              <img src={item.image} alt={item.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            ) : (
              <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"4rem",opacity:0.1}}>👤</div>
            )}
          </div>
          <div style={{padding:mob?16:20,textAlign:"center"}}>
            <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1rem":"1.1rem",color:"var(--dt)",margin:"0 0 4px 0",fontWeight:700}}>{item.name}</h3>
            <div style={{fontSize:mob?".65rem":".75rem",color:"var(--sf)",fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>{item.position}</div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <section id="team" style={{padding:mob?"16px 16px":"20px 32px",background:"#F9FBFD",position:"relative",overflow:"hidden"}}>
      <div style={{maxWidth:1200,margin:"0 auto",position:"relative",zIndex:2}}>
        <div style={{textAlign:"center",marginBottom:mob?16:20}}>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>Leadership</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.8rem":"2.4rem",color:"var(--dt)",marginTop:8,fontWeight:700}}>Our Team</h2>
        </div>

        <div style={{display: (items.filter(i => i.parentId === null).length > 0 && sortedPlainItems.length > 0 && !mob) ? "flex" : "block", gap: 24, alignItems: "flex-start"}}>
          {items.filter(i => i.parentId === null).length > 0 && (
            <div style={{flex: 1, position:"relative", width: (items.filter(i => i.parentId === null).length > 0 && sortedPlainItems.length > 0 && !mob) ? "50%" : "100%", marginBottom: (items.filter(i => i.parentId === null).length > 0 && sortedPlainItems.length > 0 && !mob) ? 0 : 40}}>
              <div style={{overflow:"auto", maxHeight:"450px", padding:"24px", background:"white", borderRadius:24, border:"1px solid var(--bd)", boxShadow:"inset 0 4px 24px rgba(0,0,0,0.03)"}}>
                <div style={{minWidth: mob?300:((items.filter(i => i.parentId === null).length > 0 && sortedPlainItems.length > 0 && !mob) ? 400 : 800), margin:"0 auto", paddingTop: 10, paddingBottom: 10}}>
                   {renderHierarchy(null)}
                </div>
              </div>
              <button onClick={() => setFullScreenMode("hierarchy")} style={{position:"absolute", top:16, right:24, background:"white", border:"1px solid #ddd", borderRadius:"50%", width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", zIndex:10, boxShadow:"0 4px 12px rgba(0,0,0,0.1)", fontSize:"1.2rem", color:"var(--dt)"}} title="Full Screen">⛶</button>
            </div>
          )}

          {sortedPlainItems.length > 0 && (
            <div style={{flex: 1, position:"relative", width: (items.filter(i => i.parentId === null).length > 0 && sortedPlainItems.length > 0 && !mob) ? "50%" : "100%"}}>
              <div style={{overflowY:"auto", overflowX:"hidden", maxHeight:"450px", padding:"24px", background:"white", borderRadius:24, border:"1px solid var(--bd)", boxShadow:"inset 0 4px 24px rgba(0,0,0,0.03)"}}>
                {renderPlainGrid(false)}
              </div>
              <button onClick={() => setFullScreenMode("plain")} style={{position:"absolute", top:16, right:24, background:"white", border:"1px solid #ddd", borderRadius:"50%", width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", zIndex:10, boxShadow:"0 4px 12px rgba(0,0,0,0.1)", fontSize:"1.2rem", color:"var(--dt)"}} title="Full Screen">⛶</button>
            </div>
          )}
        </div>
      </div>

      {/* Full Screen Layout Modal */}
      {fullScreenMode && (
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"#F9FBFD",zIndex:99999,display:"flex",flexDirection:"column",padding:mob?16:32,overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,maxWidth:1600,margin:"0 auto 24px",width:"100%"}}>
            <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:mob?"1.5rem":"2rem",color:"var(--dt)",margin:0}}>
              {fullScreenMode === "hierarchy" ? "Organization Chart" : "Team Members"}
            </h2>
            <button onClick={()=>setFullScreenMode(null)} style={{background:"white",border:"1px solid var(--bd)",borderRadius:"50%",width:44,height:44,fontSize:"1.2rem",cursor:"pointer",color:"#333",display:"flex",alignItems:"center",justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.1)"}}>✕</button>
          </div>
          
          <div style={{flex:1, overflow:"auto", background:"white", borderRadius:24, border:"1px solid var(--bd)", boxShadow:"inset 0 4px 24px rgba(0,0,0,0.03)", padding:mob?16:32, maxWidth:1600, margin:"0 auto", width:"100%"}}>
            {fullScreenMode === "hierarchy" ? (
              <div style={{minWidth: mob?300:1000, margin:"0 auto", paddingTop: 20, paddingBottom: 40}}>
                 {renderHierarchy(null)}
              </div>
            ) : (
               renderPlainGrid(true)
            )}
          </div>
        </div>
      )}

      {/* Member Detail Modal */}
      {activeMember && (
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.8)",zIndex:99999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"white",width:"100%",maxWidth:mob?400:800,borderRadius:24,position:"relative",boxShadow:"0 20px 60px rgba(0,0,0,.3)", overflow:"hidden", display:"flex", flexDirection:mob?"column":"row", maxHeight:"90vh"}}>
            <button onClick={()=>setActiveMember(null)} style={{position:"absolute",top:16,right:16,background:"rgba(255,255,255,0.9)",border:"none",borderRadius:"50%",width:40,height:40,fontSize:"1.5rem",cursor:"pointer",color:"#333",zIndex:10, display:"flex",alignItems:"center",justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>✕</button>
            
            <div style={{background:"#f9fafb", width:mob?"100%":"45%", position:"relative", padding: mob?"32px 16px":"40px 24px", display:"flex", justifyContent:"center", alignItems:"center", borderBottom:mob?"1px solid var(--bd)":"none", borderRight:mob?"none":"1px solid var(--bd)"}}>
              {activeMember.image ? (
                <img src={activeMember.image} style={{maxHeight: mob?250:400, maxWidth:"100%", objectFit:"contain", borderRadius:16, boxShadow:"0 12px 30px rgba(0,0,0,0.1)"}} alt=""/>
              ) : (
                <div style={{width:150, height:150, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"5rem", opacity:0.1}}>👤</div>
              )}
            </div>
            
            <div style={{width:mob?"100%":"55%", padding:mob?24:40, overflowY:"auto", display:"flex", flexDirection:"column", justifyContent:"center"}}>
              <h2 style={{fontFamily:"'Playfair Display',serif", color:"var(--dt)", margin:"0 0 8px 0", fontSize:"2rem"}}>{activeMember.name}</h2>
              <div style={{color:"var(--sf)", fontWeight:700, fontSize:"1.1rem", textTransform:"uppercase", letterSpacing:1, marginBottom:24}}>{activeMember.position}</div>
              
              <div style={{background:"#f8f9fa", padding:20, borderRadius:16, border:"1px solid var(--bd)"}}>
                <h4 style={{margin:"0 0 12px 0", color:"var(--dt)", fontSize:"1rem"}}>Information</h4>
                <p style={{color:"var(--tm)", lineHeight:1.6, fontSize:"1rem", margin:0, whiteSpace:"pre-wrap"}}>
                  {activeMember.desc || "No further details available."}
                </p>
              </div>
            </div>

            {/* Navigation Arrows */}
            {sortedPlainItems.findIndex(i => i.id === activeMember.id) !== -1 && sortedPlainItems.length > 1 && (
              <>
                <button onClick={(e)=>{e.stopPropagation(); navModal(-1);}} style={{position:"absolute",top:"50%",left:16,transform:"translateY(-50%)",background:"white",border:"none",borderRadius:"50%",width:48,height:48,fontSize:"1.5rem",cursor:"pointer",color:"var(--dt)",boxShadow:"0 4px 12px rgba(0,0,0,0.15)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10}}>←</button>
                <button onClick={(e)=>{e.stopPropagation(); navModal(1);}} style={{position:"absolute",top:"50%",right:16,transform:"translateY(-50%)",background:"white",border:"none",borderRadius:"50%",width:48,height:48,fontSize:"1.5rem",cursor:"pointer",color:"var(--dt)",boxShadow:"0 4px 12px rgba(0,0,0,0.15)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10}}>→</button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}


function Gallery({ C }) {
  const [active, setActive] = useState("All"); 
  const [selectedImage, setSelectedImage] = useState(null);
  const w = useW();
  const items = C.galleryItems || [];
  const cats = ["All", ...new Set(items.map(g=>g.category).filter(Boolean))];
  const filtered = active==="All" ? items : items.filter(g=>g.category===active);

  const navigate = (dir) => {
    if(!selectedImage) return;
    const idx = filtered.findIndex(g=>g.id===selectedImage.id);
    if(idx === -1) return;
    const nextIdx = (idx + dir + filtered.length) % filtered.length;
    setSelectedImage(filtered[nextIdx]);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if(!selectedImage) return;
      if(e.key === "ArrowLeft") navigate(-1);
      if(e.key === "ArrowRight") navigate(1);
      if(e.key === "Escape") setSelectedImage(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedImage, filtered]);

  useEffect(() => {
    if(!selectedImage) return;
    const idx = filtered.findIndex(g=>g.id===selectedImage.id);
    if(idx === -1) return;
    const nextIdx = (idx + 1) % filtered.length;
    const prevIdx = (idx - 1 + filtered.length) % filtered.length;
    const img1 = new Image(); img1.src = filtered[nextIdx].url;
    const img2 = new Image(); img2.src = filtered[prevIdx].url;
  }, [selectedImage, filtered]);

  return (
    <>
    <section id="gallery" style={{padding:w<640?"16px 16px":"20px 32px",background:"var(--cr)"}}>
      <div style={{maxWidth:1200,margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <span style={{color:"var(--sf)",fontWeight:600,fontSize:".8rem",letterSpacing:2,textTransform:"uppercase"}}>Our Work</span>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:w<640?"1.6rem":"2rem",color:"var(--dt)",marginTop:8,fontWeight:700}} className="sh">Gallery</h2>
        </div>
        <div style={{display:"flex",gap:7,justifyContent:"center",flexWrap:"wrap",marginBottom:28}}>
          {cats.map(c=><button key={c} onClick={()=>setActive(c)} style={{padding:"7px 14px",borderRadius:20,fontSize:".78rem",fontWeight:600,cursor:"pointer",background:active===c?"var(--dt)":"white",color:active===c?"white":"var(--tm2)",border:`1px solid ${active===c?"var(--dt)":"var(--bd)"}`,touchAction:"manipulation"}}>{c}</button>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:w<640?"1fr 1fr":"repeat(3,1fr)",gap:12}}>
          {filtered.length === 0 && <div style={{gridColumn:"1/-1",textAlign:"center",padding:40,color:"var(--mu)"}}>No photos uploaded yet.</div>}
          {filtered.map(g=>(
            <div key={g.id} onClick={()=>setSelectedImage(g)} className="gi ch" style={{aspectRatio:"4/3",background:"#eee",backgroundImage:g.type==='video'?'none':`url(${g.url})`,backgroundSize:"cover",backgroundPosition:"center",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative",borderRadius:12,overflow:"hidden",cursor:"pointer",touchAction:"manipulation"}}>
              {g.type === 'video' && <video src={g.url} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",zIndex:0}} muted playsInline preload="metadata" />}
              {g.type === 'video' && <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.3)",zIndex:1}}><span style={{fontSize:"3rem",color:"white"}}>▶</span></div>}
              <div style={{position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(to top,rgba(0,0,0,.7),transparent)",padding:"24px 12px 10px",color:"white",pointerEvents:"none",zIndex:2}}>
                <div style={{fontSize:".85rem",fontWeight:600}}>{g.title}</div>
                <div style={{fontSize:".7rem",opacity:.9}}>{g.category}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {selectedImage && (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:1000,backdropFilter:"blur(4px)"}}
        onClick={()=>setSelectedImage(null)}>
        
        <button onClick={(e)=>{e.stopPropagation(); navigate(-1);}}
          style={{position:"absolute",left:w<640?10:20,top:"50%",transform:"translateY(-50%)",background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"white",fontSize:"1.5rem",cursor:"pointer",padding:w<640?"8px 12px":"12px 18px",borderRadius:8,zIndex:1001,backdropFilter:"blur(4px)",touchAction:"manipulation"}}>
          &#10094;
        </button>

        <button onClick={(e)=>{e.stopPropagation(); navigate(1);}}
          style={{position:"absolute",right:w<640?10:20,top:"50%",transform:"translateY(-50%)",background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"white",fontSize:"1.5rem",cursor:"pointer",padding:w<640?"8px 12px":"12px 18px",borderRadius:8,zIndex:1001,backdropFilter:"blur(4px)",touchAction:"manipulation"}}>
          &#10095;
        </button>

        <div style={{position:"relative",maxWidth:"100%",maxHeight:"100%",display:"flex",flexDirection:"column",alignItems:"center"}}
          onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setSelectedImage(null)}
            style={{position:"absolute",top:-40,right:0,background:"none",border:"none",color:"white",fontSize:"2rem",cursor:"pointer",lineHeight:1,touchAction:"manipulation"}}>
            &times;
          </button>
          {selectedImage.type === 'video' ? (
            <video key={selectedImage.url} src={selectedImage.url} controls autoPlay style={{maxWidth:"100%",maxHeight:"80vh",objectFit:"contain",borderRadius:8,boxShadow:"0 16px 40px rgba(0,0,0,.5)"}} />
          ) : (
            <img key={selectedImage.url} src={selectedImage.url} alt={selectedImage.title} style={{maxWidth:"100%",maxHeight:"80vh",objectFit:"contain",borderRadius:8,boxShadow:"0 16px 40px rgba(0,0,0,.5)"}} />
          )}
          <div style={{marginTop:16,color:"white",textAlign:"center"}}>
            <div style={{fontSize:"1.2rem",fontWeight:600}}>{selectedImage.title}</div>
            <div style={{fontSize:".9rem",opacity:.8,marginTop:4}}>{selectedImage.category}</div>
          </div>
        </div>
      </div>
    )}
    </>
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
    <section id="contact" style={{padding:mob?"16px 16px":"20px 32px",background:"var(--ww)"}}>
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
          {[{icon:"📍",label:"Address",val:tr.address},{icon:"📞",label:"Phone",val:tr.phone},{icon:"✉️",label:"Email",val:tr.email},{icon:"🕐",label:"Hours",val:tr.hours}].filter(c => c.val && c.val.trim() !== "").map(c=>(
            <div key={c.label} style={{display:"flex",gap:14,marginBottom:14,padding:"14px",background:"var(--tl)",borderRadius:12,border:"1px solid #B8D8E8"}}>
              <div style={{fontSize:"1.3rem"}}>{c.icon}</div>
              <div>
                <div style={{fontSize:".7rem",fontWeight:700,color:"var(--tm)",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{c.label}</div>
                <div style={{fontSize:".85rem",color:"var(--tx)"}}>{c.val}</div>
              </div>
            </div>
          ))}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {ct.socials.map((s, i) => {
              const isObj = typeof s === 'object';
              const name = isObj ? s.name : s;
              let url = isObj ? s.url : "";
              const msg = isObj ? s.msg : "";
              
              if (url && !url.startsWith("http")) {
                const n = name.toLowerCase();
                const cleanUrl = url.startsWith("@") ? url.substring(1) : url;
                if (n === "youtube") url = `https://youtube.com/@${cleanUrl}`;
                else if (n === "instagram") url = `https://instagram.com/${cleanUrl}`;
                else if (n === "facebook") url = `https://facebook.com/${cleanUrl}`;
                else if (n === "x" || n === "twitter") url = `https://twitter.com/${cleanUrl}`;
                else url = `https://${url}`;
              }

              if (url && msg && name.toLowerCase() === "whatsapp" && !url.includes("?text=")) {
                url = `${url}?text=${encodeURIComponent(msg)}`;
              }
              
              const platformStyles = {
                whatsapp: { bg: "linear-gradient(135deg, #25D366, #128C7E)", icon: "💬", color: "white" },
                facebook: { bg: "linear-gradient(135deg, #1877F2, #0C5EBF)", icon: "👍", color: "white" },
                instagram: { bg: "linear-gradient(135deg, #F58529, #DD2A7B, #8134AF, #515BD4)", icon: "📸", color: "white" },
                youtube: { bg: "linear-gradient(135deg, #FF0000, #CC0000)", icon: "▶️", color: "white" },
                x: { bg: "linear-gradient(135deg, #333, #000)", icon: "🐦", color: "white" },
                twitter: { bg: "linear-gradient(135deg, #1DA1F2, #0C85D0)", icon: "🐦", color: "white" },
                linkedin: { bg: "linear-gradient(135deg, #0A66C2, #084482)", icon: "💼", color: "white" }
              };
              const nLower = name.toLowerCase();
              const style = platformStyles[nLower] || { bg: "linear-gradient(135deg, #f5f7fa, #e4e8eb)", icon: "🔗", color: "#333" };

              return (
                <a key={i} href={url || "#"} target={url ? "_blank" : "_self"} rel="noreferrer" 
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "8px 16px", borderRadius: "20px", 
                    background: style.bg, 
                    color: style.color, 
                    fontSize: ".85rem", fontWeight: 700, 
                    textDecoration: "none",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
                    transition: "transform 0.2s, box-shadow 0.2s"
                  }} 
                  onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 6px 15px rgba(0,0,0,0.2)"}} 
                  onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 4px 10px rgba(0,0,0,0.15)"}}>
                  <span style={{fontSize: "1.1rem"}}>{style.icon}</span>
                  {name}
                </a>
              );
            })}
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
    <section id={sec.id} style={{padding:mob?"16px 16px":"20px 32px",background:bg}}>
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
            <p style={{fontSize:".82rem",lineHeight:1.7,marginBottom:12}}>{C.footer?.description || `Serving humanity with compassion since ${C.trust.estd}. Registered under Gujarat Public Trust Act. 80G and FCRA Certified.`}</p>
            <div style={{fontSize:".72rem",color:"rgba(255,255,255,.4)"}}>CIN: {C.trust.cin}</div>
          </div>
          {[{title:"Quick Links",items:[{label:"About Us",id:"about"},{label:"Programs",id:"programs"},{label:"Events",id:"events"},{label:"Gallery",id:"gallery"},{label:"Contact",id:"contact"}]},{title:"Programs",items:[{label:"Education",id:"programs"},{label:"Healthcare",id:"programs"},{label:"Women Empowerment",id:"programs"},{label:"Environment",id:"programs"}]},{title:"Legal",items:[{label:"Privacy Policy",id:"privacy"},{label:"Terms of Use",id:"terms"},{label:"Refund Policy",id:"refund"},{label:"Admin Login",id:"admin_login"}]}].map(col=>(
            <div key={col.title}>
              <h4 style={{color:"white",fontWeight:700,marginBottom:14,fontSize:".82rem"}}>{col.title}</h4>
              {col.items.map(item=><div key={item.label} onClick={()=>{if(item.id && onFooterLinkClick){onFooterLinkClick(item.id);}}} style={{fontSize:".78rem",marginBottom:8,cursor:item.id?"pointer":"default"}} onMouseEnter={e=>item.id&&(e.target.style.color="var(--sflt)")} onMouseLeave={e=>item.id&&(e.target.style.color="rgba(255,255,255,.75)")}>{item.label}</div>)}
            </div>
          ))}
        </div>
        <div style={{borderTop:"1px solid rgba(255,255,255,.1)",paddingTop:18,display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{fontSize:".75rem"}}>{C.footer?.copyrightYear || "2025"} {C.trust.name}. All rights reserved.</div>
          <div style={{fontSize:".75rem"}}>{C.footer?.tagline || "Designed with love for humanity"}</div>
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


export const generateCertificatePDF = async (certConfig, fieldsData, fallbackName, previewMode = false) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let srcUrl = certConfig.certBgUrl;
    
    if (srcUrl && srcUrl.startsWith('http')) {
      img.crossOrigin = "Anonymous";
      srcUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(srcUrl)}`;
    }
    
    img.onload = () => {
      try {
        const doc = new jsPDF({ orientation: img.width > img.height ? 'landscape' : 'portrait', unit: 'px', format: [img.width, img.height] });
        doc.addImage(img, 'JPEG', 0, 0, img.width, img.height);
        
        doc.setFontSize(certConfig.certFontSize || 30);
        doc.setTextColor(certConfig.certFontColor || "#000000");
        doc.setFont("helvetica", "bold");

        const m = certConfig.certMap || {};

        Object.entries(m).forEach(([key, pos]) => {
          if (pos.visible) {
            const xPx = (parseFloat(pos.x) / 100) * img.width;
            const yPx = (parseFloat(pos.y) / 100) * img.height;
            let val = fieldsData[key] || "";
            
            if (key.startsWith("[TEXT] ")) {
                val = key.replace("[TEXT] ", "");
            } else if (!val) {
                // Special fallback for standard fields if not provided
                if (key.toLowerCase().includes("name") && !key.toLowerCase().includes("event")) val = fallbackName;
            }
            
            if (typeof val === 'string') {
                val = val.replace(/\|/g, ' ').trim();
            }
            doc.text(String(val), xPx, yPx, { align: "center", baseline: "middle" });
          }
        });
        
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        
        if (previewMode) {
            window.open(url, '_blank');
        } else {
            const link = document.createElement("a");
            link.href = url;
            const outName = fallbackName ? fallbackName.replace(/\s+/g, '_') : "Student";
            link.download = `Certificate_${outName}.pdf`;
            link.click();
        }
        
        resolve(true);
      } catch(e) { reject(e); }
    };
    img.onerror = (e) => reject(new Error("Failed to load certificate template image."));
    img.src = srcUrl;
  });
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
    if (template && !template.startsWith('data:')) {
      img.crossOrigin = "Anonymous";
    }
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
            {key.startsWith("[TEXT] ") ? key.replace("[TEXT] ", "") : key}
          </div>
        ))}
      </div>
      
      <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16}}>
        {Object.entries(fields).map(([key, pos]) => (
          <button 
            key={key} onClick={() => toggleVisibility(key)}
            style={{ padding: "6px 12px", borderRadius: 16, fontSize: ".75rem", fontWeight: 600, cursor: "pointer", background: pos.visible ? "var(--tl)" : "#f5f5f5", border: `1px solid ${pos.visible ? "var(--dt)" : "#ddd"}`, color: pos.visible ? "var(--dt)" : "#888" }}
          >
            {pos.visible ? "✓ " : "+ "}{key.startsWith("[TEXT] ") ? key.replace("[TEXT] ", "") : key}
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

const quillModules = {
  toolbar: [
    [{ 'header': [1, 2, 3, false] }, { 'size': ['small', false, 'large', 'huge'] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }, { 'align': [] }],
    ['link', 'clean']
  ]
};

const F = ({label, path, ta, rtf, hint}) => {
  const { gv, upd, draft } = useContext(EditorContext);
  const initVal = gv(path);
  const getInitial = () => rtf && initVal && typeof initVal === "string" && !initVal.trim().startsWith("<") ? marked.parse(initVal) : initVal;
  const [local, setLocal] = useState(getInitial);
  useEffect(() => { setLocal(getInitial()); }, [path, draft]);
  const commit = () => upd(path, local);

  const engPath = path.endsWith("Gu") ? path.slice(0, -2) : null;
  const [translating, setTranslating] = useState(false);
  const handleTranslate = async (e) => {
    e.preventDefault();
    if (!engPath) return;
    const engText = gv(engPath);
    if (!engText) return;
    setTranslating(true);
    try {
      const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=' + encodeURIComponent(engText));
      const data = await res.json();
      const translated = data[0].map(x => x[0]).join('');
      setLocal(translated);
      upd(path, translated);
    } catch (err) {
      alert("Translation failed");
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="cf">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:4}}>
        <label className="cl" style={{marginBottom:0}}>{label}{hint&&<span style={{color:"var(--tm)",marginLeft:6,fontWeight:400,textTransform:"none",fontSize:".7rem"}}>({hint})</span>}</label>
        {engPath && (
          <button type="button" onClick={handleTranslate} disabled={translating} style={{background:"none",border:"none",color:"var(--sf)",fontSize:".75rem",cursor:"pointer",fontWeight:600,padding:0}}>
            {translating ? "Translating..." : "Auto Translate"}
          </button>
        )}
      </div>
      {rtf
        ? <div style={{background:"white"}}><ReactQuill theme="snow" modules={quillModules} value={local} onChange={(content) => { setLocal(content); upd(path, content); }} /></div>
        : ta
          ? <textarea className="ci" rows={3} value={local} onChange={e=>setLocal(e.target.value)} onBlur={commit}/>
          : <input    className="ci"          value={local} onChange={e=>setLocal(e.target.value)} onBlur={commit}/>
      }
    </div>
  );
};

const ImgUpload = ({ label, path, auth }) => {
  const { gv, upd } = useContext(EditorContext);
  const val = gv(path);
  const [uploading, setUploading] = useState(false);
  const handleUp = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!auth?.idToken) { alert("Please login to upload images."); return; }
    setUploading(true);
    try {
      const url = await fbUploadLogo(file, auth.idToken);
      upd(path, url);
    } catch (err) { alert(err.message); }
    finally { setUploading(false); }
  };
  return (
    <div className="cf">
      <label className="cl">{label}</label>
      <div style={{display:"flex", alignItems:"center", gap:12}}>
        {val && <img src={val} style={{height:40, objectFit:"contain"}} alt=""/>}
        <label style={{padding:"6px 12px", background:"white", border:"1px solid var(--bd)", borderRadius:6, cursor:"pointer", fontSize:".8rem", fontWeight:600, color:"var(--dt)"}}>
          {uploading ? "..." : "Upload Image"}
          <input type="file" accept="image/*" style={{display:"none"}} onChange={handleUp} disabled={uploading}/>
        </label>
        {val && <button onClick={()=>upd(path,"")} style={{background:"none",border:"none",color:"#C0392B",fontSize:".8rem",cursor:"pointer",fontWeight:600}}>Remove</button>}
      </div>
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
function ContentEditor({ C, setC, setPage, auth, hasAccess, master }) {
  const showSec = (id) => {
    if (master) return true;
    if (!hasAccess) return false;
    return hasAccess.includes("content:" + id);
  };
  const getDraft = (C) => {
    const d = JSON.parse(JSON.stringify(C));
    if(!d.hero) d.hero = {};
    if(d.hero.showTopBanner === undefined) d.hero.showTopBanner = false;
    if(!d.hero.topBanner) d.hero.topBanner = "";
    if(d.hero.showStats === undefined) d.hero.showStats = true;
    if(d.hero.showImage === undefined) d.hero.showImage = false;
    if(!d.hero.image) d.hero.image = "";
    if(d.hero.showRegBtn === undefined) d.hero.showRegBtn = false;
    if(!d.hero.regBtnLabel) d.hero.regBtnLabel = "Register Now";
    if(!d.hero.regBtnLabelGu) d.hero.regBtnLabelGu = "હવે નોંધણી કરો";
    if(!d.hero.regBtnLink) d.hero.regBtnLink = "#events";
    if(!d.donate) d.donate = {};
    if(!d.donate.programs) d.donate.programs = ["General","Education","Healthcare","Women","Environment","Relief"];
    if(!d.about) d.about = {};
    if(!d.about.points) d.about.points = [];
    if(!d.about.pointsGu || d.about.pointsGu.length !== d.about.points.length) {
      d.about.pointsGu = d.about.points.map((p, i) => (d.about.pointsGu && d.about.pointsGu[i]) || "");
    }
    if(!d.programs) d.programs = [];
    d.programs.forEach(p => {
      if(!p.titleGu) p.titleGu = "";
      if(!p.subGu) p.subGu = "";
      if(!p.detailsGu) p.detailsGu = "";
    });
    if(!d.events) d.events = [];
    d.events.forEach(ev => {
      if(!ev.titleGu) ev.titleGu = "";
      if(!ev.locationGu) ev.locationGu = "";
      if(!ev.dateGu) ev.dateGu = "";
      if(!ev.monthGu) ev.monthGu = "";
      if(!ev.tagGu) ev.tagGu = "";
    });
    if(!d.achievements) d.achievements = [];
    d.achievements.forEach(a => {
      if(!a.titleGu) a.titleGu = "";
      if(!a.descGu) a.descGu = "";
    });
    if(!d.footer) d.footer = {
      description: `Serving humanity with compassion since ${d.trust?.estd || "2004"}. Registered under Gujarat Public Trust Act. 80G and FCRA Certified.`,
      copyrightYear: new Date().getFullYear().toString(),
      tagline: "Designed with love for humanity"
    };
    return d;
  };
  const [draft, setDraft] = useState(()=>getDraft(C));
  const [toast,    setToast]    = useState(null); // null | "saving" | "saved" | "error"
  const [toastMsg, setToastMsg] = useState("");
  const [exp, setExp] = useState({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();
  const w = useW(); const mob = w<768;

  useEffect(()=>{ setDraft(getDraft(C)); },[C]);

  const showToast = (type, msg) => { setToast(type); setToastMsg(msg); setTimeout(()=>setToast(null),3500); };

  const save = async () => {
    const saved = JSON.parse(JSON.stringify(draft));
    setC(saved); // apply locally immediately
    if (!auth?.idToken) { showToast("warn","Changes applied locally. Login to save to database."); return; }
    showToast("saving","Saving changes...");
    try {
      await fbSave(saved, auth.idToken);
      showToast("saved","Saved successfully!");
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

  const handleTopBannerUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!auth?.idToken) { showToast("error","Please login to upload images."); return; }
    setUploading(true);
    try {
      const url = await fbUploadPhoto(file, auth.idToken);
      upd("hero.topBanner", url);
      showToast("saved","Top banner uploaded successfully!");
    } catch(e) {
      showToast("error","Upload failed: " + e.message);
    } finally { setUploading(false); }
  };

  const handleHeroImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!auth?.idToken) { showToast("error","Please login to upload images."); return; }
    setUploading(true);
    try {
      const url = await fbUploadPhoto(file, auth.idToken);
      upd("hero.image", url);
      showToast("saved","Hero image uploaded successfully!");
    } catch(e) {
      showToast("error","Upload failed: " + e.message);
    } finally { setUploading(false); }
  };

  const upd = (path, value) => {
    setDraft(prev=>{
      try {
        const next=JSON.parse(JSON.stringify(prev || {}));
        const keys=path.split("."); let obj=next;
        for(let i=0;i<keys.length-1;i++){
          const k=isNaN(keys[i])?keys[i]:parseInt(keys[i]);
          if(!obj[k] || typeof obj[k] !== 'object') obj[k] = isNaN(keys[i+1]) ? {} : [];
          obj=obj[k];
        }
        const lk=isNaN(keys[keys.length-1])?keys[keys.length-1]:parseInt(keys[keys.length-1]);
        if(obj) obj[lk]=value; return next;
      } catch(e) { return prev; }
    });
  };

  const gv = (path) => path.split(".").reduce((o,k)=>o?.[isNaN(k)?k:parseInt(k)],draft)??"";

  // ── Array helpers ──────────────────────────────────────────────────────────
  const getArr = (next, path) => {
    const keys = path.split(".");
    let o = next;
    for (const k of keys) {
      const pk=isNaN(k)?k:parseInt(k);
      if(!o[pk] || typeof o[pk] !== 'object') o[pk] = [];
      o = o[pk];
    }
    return o;
  };
  const addItem = (arrPath, newItem) => {
    setDraft(prev => {
      try {
        const next = JSON.parse(JSON.stringify(prev || {}));
        const arr = getArr(next, arrPath);
        if(Array.isArray(arr)) arr.push(newItem);
        return next;
      } catch(e) { return prev; }
    });
  };
  const delItem = (arrPath, idx) => {
    setDraft(prev => {
      try {
        const next = JSON.parse(JSON.stringify(prev || {}));
        const arr = getArr(next, arrPath);
        if(Array.isArray(arr)) arr.splice(idx, 1);
        return next;
      } catch(e) { return prev; }
    });
  };
  const moveItem = (arrPath, idx, dir) => {
    setDraft(prev => {
      try {
        const next = JSON.parse(JSON.stringify(prev || {}));
        const arr = getArr(next, arrPath);
        if(!Array.isArray(arr)) return next;
        const to = idx + dir;
        if (to < 0 || to >= arr.length) return next;
        [arr[idx], arr[to]] = [arr[to], arr[idx]];
        return next;
      } catch(e) { return prev; }
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
      {showSec("sections") && <Sec id="sections" icon="📄" label="Page Sections Manager"
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
              {key:"team",     label:"Our Team",          icon:"👥"},
              {key:"achievements", label:"Achievements",  icon:"🏆"},
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
      </Sec>}
      {/* ══ END SECTIONS MANAGER ══════════════════════════════════════════ */}

      {showSec("nav") && <Sec id="nav" icon="🔗" label="Navigation Menu"
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
                    {["home","about","programs","team","achievements","gallery","events","donate","contact"].map(s=><option key={s} value={s}>{s}</option>)}
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
      </Sec>}

      {showSec("trust") && <Sec id="trust" icon="🏛️" label="Trust Information">

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
      </Sec>}

      {showSec("hero") && <Sec id="hero" icon="🌟" label="Hero Section">
        <G2>
          <F label="Hero Title" path="hero.title" ta hint="English"/>
          <F label="Hero Title" path="hero.titleGu" ta hint="Gujarati"/>
          <F label="Subtitle" path="hero.subtitle" ta hint="English"/>
          <F label="Subtitle" path="hero.subtitleGu" ta hint="Gujarati"/>
          <F label="Primary Button" path="hero.cta1" hint="English"/>
          <F label="Primary Button" path="hero.cta1Gu" hint="Gujarati"/>
          <F label="Secondary Button" path="hero.cta2" hint="English"/>
          <F label="Secondary Button" path="hero.cta2Gu" hint="Gujarati"/>
          
          <div style={{display:"flex", gap: 16, alignItems:"center"}}>
            <div style={{flex: 1}}>
              <F label="Badge Text" path="hero.badge"/>
            </div>
            <div style={{display:"flex", flexDirection:"column", gap: 4, alignItems:"center"}}>
               <span style={{fontSize:".7rem", fontWeight:700, color:"var(--dt)"}}>Bg Color</span>
               <input type="color" 
                      value={(draft.hero.badgeBgColor || "").startsWith("#") ? draft.hero.badgeBgColor : "#e59f0f"} 
                      onChange={(e)=>upd("hero.badgeBgColor", e.target.value)} 
                      style={{width: 30, height: 30, padding: 0, border: "none", cursor: "pointer", background:"transparent"}}/>
            </div>
            <div style={{display:"flex", flexDirection:"column", gap: 4, alignItems:"center"}}>
               <span style={{fontSize:".7rem", fontWeight:700, color:"var(--dt)"}}>Text Color</span>
               <input type="color" 
                      value={(draft.hero.badgeTextColor || "").startsWith("#") ? draft.hero.badgeTextColor : "#f9a14e"} 
                      onChange={(e)=>upd("hero.badgeTextColor", e.target.value)} 
                      style={{width: 30, height: 30, padding: 0, border: "none", cursor: "pointer", background:"transparent"}}/>
            </div>
          </div>
          <F label="Trust Badge 1" path="hero.badge1"/>
          <F label="Trust Badge 2" path="hero.badge2"/>
          <F label="Trust Badge 3" path="hero.badge3"/>
        </G2>

        <div style={{marginTop: 32, paddingTop: 24, borderTop: "1px dashed var(--bd)"}}>
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.1rem",color:"var(--dt)",marginBottom:16}}>Hero Background Style</h3>
          
          <div style={{display:"flex", gap:16, marginBottom: 24, flexWrap: "wrap", alignItems: "center"}}>
            {/* Presets */}
            { [
               {label: "Default Navy", val: ""},
               {label: "Ocean Blue", val: "linear-gradient(135deg, #0D4B5E 0%, #1A6B87 50%, #0D4B5E 100%)"},
               {label: "Warm Sunset", val: "linear-gradient(135deg, #FF512F 0%, #DD2476 100%)"},
               {label: "Midnight", val: "linear-gradient(to right, #0f2027, #203a43, #2c5364)"},
               {label: "Royal Purple", val: "linear-gradient(to right, #8e2de2, #4a00e0)"},
               {label: "Forest Green", val: "linear-gradient(180deg, #1A3622 0%, #0D1C11 100%)"}
              ].map(preset => (
                <div key={preset.label} onClick={()=>upd("hero.bgCss", preset.val)}
                     style={{
                       width: 50, height: 50, borderRadius: "50%", cursor:"pointer",
                       background: preset.val || "linear-gradient(135deg,#0D4B5E 0%,#1A6B87 40%,#0D4B5E 70%,#C8860A22 100%)",
                       border: (draft.hero.bgCss || "") === preset.val ? "3px solid #F9A14E" : "2px solid #e0e0e0",
                       boxShadow: (draft.hero.bgCss || "") === preset.val ? "0 4px 12px rgba(249,161,78,0.5)" : "none",
                       position: "relative", transition: "all 0.2s"
                     }} title={preset.label}>
                     {(draft.hero.bgCss || "") === preset.val && <div style={{position:"absolute", top:-4, right:-4, background:"#F9A14E", color:"white", borderRadius:"50%", width:20, height:20, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:"bold"}}>✓</div>}
                </div>
              ))
            }
            {/* Custom Color Picker */}
            <div style={{display:"flex", flexDirection:"column", gap: 6, alignItems:"center", marginLeft: 16, borderLeft: "1px solid #ddd", paddingLeft: 24}}>
               <span style={{fontSize:".75rem", fontWeight:700, color:"var(--dt)"}}>Solid Color</span>
               <input type="color" 
                      value={(draft.hero.bgCss || "").startsWith("#") ? draft.hero.bgCss : "#0d4b5e"} 
                      onChange={(e)=>upd("hero.bgCss", e.target.value)} 
                      style={{width: 36, height: 36, padding: 0, border: "none", cursor: "pointer", background:"transparent"}}/>
            </div>
            {/* Custom Text Color Picker */}
            <div style={{display:"flex", flexDirection:"column", gap: 6, alignItems:"center", marginLeft: 16, borderLeft: "1px solid #ddd", paddingLeft: 24}}>
               <span style={{fontSize:".75rem", fontWeight:700, color:"var(--dt)"}}>Text Color</span>
               <input type="color" 
                      value={(draft.hero.textColor || "").startsWith("#") ? draft.hero.textColor : "#ffffff"} 
                      onChange={(e)=>upd("hero.textColor", e.target.value)} 
                      style={{width: 36, height: 36, padding: 0, border: "none", cursor: "pointer", background:"transparent"}}/>
            </div>
          </div>
          
          <div style={{marginBottom: 8}}>
            <F label="Or Type Custom CSS (Advanced)" path="hero.bgCss" hint="e.g. #FF5733 or linear-gradient(...)"/>
          </div>
        </div>

        <div style={{marginTop: 32, paddingTop: 24, borderTop: "1px dashed var(--bd)"}}>
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.1rem",color:"var(--dt)",marginBottom:16}}>Top Banner</h3>
          
          {/* Top Banner Toggle */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:draft.hero.showTopBanner?16:16,padding:"10px 14px",background:draft.hero.showTopBanner?"var(--tl)":"#f5f5f5",borderRadius:10,border:"1px solid "+(draft.hero.showTopBanner?"#B8D8E8":"#ddd")}}>
            <div onClick={()=>upd("hero.showTopBanner",!draft.hero.showTopBanner)}
              style={{width:44,height:24,borderRadius:12,background:draft.hero.showTopBanner?"var(--dt)":"#ccc",position:"relative",cursor:"pointer",transition:"background .3s",flexShrink:0}}>
              <div style={{position:"absolute",top:3,left:draft.hero.showTopBanner?22:3,width:18,height:18,borderRadius:"50%",background:"white",transition:"left .3s"}}/>
            </div>
            <div>
              <div style={{fontSize:".85rem",fontWeight:700,color:"var(--dt)"}}>Show Top Banner</div>
              <div style={{fontSize:".72rem",color:"var(--mu)"}}>{draft.hero.showTopBanner ? "Banner will be displayed at the top" : "Banner is hidden"}</div>
            </div>
          </div>
          {draft.hero.showTopBanner && (
            <div style={{marginBottom: 24, marginLeft: 20}}>
              <div style={{display:"flex", alignItems:"flex-end", gap:8}}>
                <div style={{flex:1}}>
                  <F label="Top Banner Image URL (Or upload)" path="hero.topBanner" hint="Paste image URL here"/>
                  <div style={{marginTop: 12}}>
                    <label style={{display:"block", fontSize:".85rem", fontWeight:600, color:"var(--dt)", marginBottom:6}}>Max Height (px)</label>
                    <input type="range" min="50" max="600" value={draft.hero.topBannerHeight || 250} onChange={(e)=>upd("hero.topBannerHeight", parseInt(e.target.value))} style={{width:"100%"}}/>
                    <div style={{textAlign:"right", fontSize:".8rem", color:"var(--tm2)", fontWeight: "bold"}}>{draft.hero.topBannerHeight || 250}px</div>
                  </div>
                </div>
                <div style={{marginBottom: 16}}>
                  <input id="hero-banner-upload" type="file" accept="image/*" style={{display:"none"}} onChange={handleTopBannerUpload} />
                  <label htmlFor="hero-banner-upload" style={{display:"inline-block",background:"var(--dt)",color:"white",padding:"10px 16px",borderRadius:8,fontSize:".85rem",cursor:"pointer",fontWeight:600}}>
                    {uploading ? "Uploading..." : "Upload"}
                  </label>
                </div>
              </div>
            </div>
          )}
          
          <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.1rem",color:"var(--dt)",marginBottom:16}}>Right Side Layout</h3>
          
          {/* Stats Toggle */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,padding:"10px 14px",background:draft.hero.showStats?"var(--tl)":"#f5f5f5",borderRadius:10,border:"1px solid "+(draft.hero.showStats?"#B8D8E8":"#ddd")}}>
            <div onClick={()=>upd("hero.showStats",draft.hero.showStats===false?true:false)}
              style={{width:44,height:24,borderRadius:12,background:draft.hero.showStats!==false?"var(--dt)":"#ccc",position:"relative",cursor:"pointer",transition:"background .3s",flexShrink:0}}>
              <div style={{position:"absolute",top:3,left:draft.hero.showStats!==false?22:3,width:18,height:18,borderRadius:"50%",background:"white",transition:"left .3s"}}/>
            </div>
            <div>
              <div style={{fontSize:".85rem",fontWeight:700,color:"var(--dt)"}}>Show Impact Statistics</div>
              <div style={{fontSize:".72rem",color:"var(--mu)"}}>{draft.hero.showStats!==false ? "Stats boxes will be displayed" : "Stats are hidden"}</div>
            </div>
          </div>

          {/* Image Toggle */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:draft.hero.showImage?16:16,padding:"10px 14px",background:draft.hero.showImage?"var(--tl)":"#f5f5f5",borderRadius:10,border:"1px solid "+(draft.hero.showImage?"#B8D8E8":"#ddd")}}>
            <div onClick={()=>upd("hero.showImage",!draft.hero.showImage)}
              style={{width:44,height:24,borderRadius:12,background:draft.hero.showImage?"var(--dt)":"#ccc",position:"relative",cursor:"pointer",transition:"background .3s",flexShrink:0}}>
              <div style={{position:"absolute",top:3,left:draft.hero.showImage?22:3,width:18,height:18,borderRadius:"50%",background:"white",transition:"left .3s"}}/>
            </div>
            <div>
              <div style={{fontSize:".85rem",fontWeight:700,color:"var(--dt)"}}>Show Campaign Image</div>
              <div style={{fontSize:".72rem",color:"var(--mu)"}}>{draft.hero.showImage ? "Image will be displayed" : "Image is hidden"}</div>
            </div>
          </div>
          {draft.hero.showImage && (
            <div style={{marginBottom: 24, marginLeft: 20}}>
              <div style={{display:"flex", alignItems:"flex-end", gap:8}}>
                <div style={{flex:1}}>
                  <F label="Image URL (Or upload)" path="hero.image" hint="Paste image URL here"/>
                </div>
                <div style={{marginBottom: 16}}>
                  <input id="hero-img-upload" type="file" accept="image/*" style={{display:"none"}} onChange={handleHeroImageUpload} />
                  <label htmlFor="hero-img-upload" style={{display:"inline-block",background:"var(--dt)",color:"white",padding:"10px 16px",borderRadius:8,fontSize:".85rem",cursor:"pointer",fontWeight:600}}>
                    {uploading ? "Uploading..." : "Upload"}
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Registration Button Toggle */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:draft.hero.showRegBtn?16:0,padding:"10px 14px",background:draft.hero.showRegBtn?"var(--tl)":"#f5f5f5",borderRadius:10,border:"1px solid "+(draft.hero.showRegBtn?"#B8D8E8":"#ddd")}}>
            <div onClick={()=>upd("hero.showRegBtn",!draft.hero.showRegBtn)}
              style={{width:44,height:24,borderRadius:12,background:draft.hero.showRegBtn?"var(--dt)":"#ccc",position:"relative",cursor:"pointer",transition:"background .3s",flexShrink:0}}>
              <div style={{position:"absolute",top:3,left:draft.hero.showRegBtn?22:3,width:18,height:18,borderRadius:"50%",background:"white",transition:"left .3s"}}/>
            </div>
            <div>
              <div style={{fontSize:".85rem",fontWeight:700,color:"var(--dt)"}}>Show Registration/Hot Topic Button</div>
              <div style={{fontSize:".72rem",color:"var(--mu)"}}>{draft.hero.showRegBtn ? "Button will be displayed" : "Button is hidden"}</div>
            </div>
          </div>
          {draft.hero.showRegBtn && (
            <div style={{marginLeft: 20}}>
              <G2>
                <F label="Button Label (English)" path="hero.regBtnLabel"/>
                <F label="Button Label (Gujarati)" path="hero.regBtnLabelGu"/>
              </G2>
              <div style={{marginBottom: 16}}>
                <div style={{fontSize:".8rem",fontWeight:700,marginBottom:6,color:"var(--dt)",textTransform:"uppercase",letterSpacing:1}}>Button Action</div>
                <select value={draft.hero.regBtnLink || "#events"} onChange={(e)=>upd("hero.regBtnLink",e.target.value)} style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".9rem",outline:"none",background:"white"}}>
                  <option value="#events">Scroll to Events Section</option>
                  <option value="external">External Link (Enter URL)</option>
                  {draft.events && draft.events.map((ev, i) => (
                    <option key={i} value={`#event-${i}`}>Open Registration: {ev.title || "Unnamed Event"}</option>
                  ))}
                </select>
              </div>
              {draft.hero.regBtnLink === "external" && (
                <F label="External URL" path="hero.regBtnExternal" hint="https://..."/>
              )}
            </div>
          )}
        </div>
      </Sec>}

      {showSec("stats") && <Sec id="stats" icon="📊" label="Impact Statistics"
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
      </Sec>}

      {showSec("about") && <Sec id="about" icon="ℹ️" label="About Section">
        <G2>
          <F label="Section Heading" path="about.heading" hint="English"/>
          <F label="Section Heading" path="about.headingGu" hint="Gujarati"/>
          <F label="Paragraph 1" path="about.body1" ta hint="English"/>
          <F label="Paragraph 1" path="about.body1Gu" ta hint="Gujarati"/>
          <F label="Paragraph 2" path="about.body2" ta hint="English"/>
          <F label="Paragraph 2" path="about.body2Gu" ta hint="Gujarati"/>
          <F label="Detailed Story (Pop-up Modal)" path="about.story" rtf={true} hint="English"/>
          <F label="Detailed Story (Pop-up Modal)" path="about.storyGu" rtf={true} hint="Gujarati"/>
        </G2>
        <G2>
          <ImgUpload label="Main Image (Overrides 🙏)" path="about.mainImage" auth={auth}/>
          <ImgUpload label="Floating Badge Image (Overrides Years Label)" path="about.badgeImage" auth={auth}/>
          
          <div style={{display:"flex",gap:16,alignItems:"center",marginTop:8,marginBottom:16,flexWrap:"wrap"}}>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:".8rem",fontWeight:600,cursor:"pointer"}}>
              <input type="checkbox" checked={!!draft.about.hideImage} onChange={e=>upd("about.hideImage", e.target.checked)}/>
              Hide Image Section
            </label>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:".8rem",fontWeight:600}}>Content Align:</span>
              <select value={draft.about.align || "left"} onChange={e=>upd("about.align", e.target.value)} style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".8rem",fontFamily:"inherit"}}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>
        </G2>
        <G2>
          <F label="Years Label" path="about.yearsLabel"/>
          <F label="CTA Button Text" path="about.cta"/>
        </G2>
        <div className="cf">
          <label className="cl">Key Bullet Points</label>
          {draft.about.points.map((pt,i)=>(
            <div key={i} style={{marginBottom:16, padding:12, border:"1px solid var(--bd)", borderRadius:8, background:"#FAFAFA"}}>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:".75rem",fontWeight:600,color:"#666",width:60}}>English</span>
                <BlurInput className="ci" style={{flex:1,marginBottom:0}} value={pt} onCommit={v=>upd(`about.points.${i}`,v)}/>
                <button onClick={()=>moveItem("about.points",i,-1)} disabled={i===0}
                  style={{padding:"8px 10px",borderRadius:6,border:"1px solid var(--bd)",background:i===0?"#f5f5f5":"white",cursor:i===0?"not-allowed":"pointer",fontSize:".8rem",color:i===0?"#ccc":"var(--dt)",flexShrink:0}}>↑</button>
                <button onClick={()=>moveItem("about.points",i,1)} disabled={i===draft.about.points.length-1}
                  style={{padding:"8px 10px",borderRadius:6,border:"1px solid var(--bd)",background:i===draft.about.points.length-1?"#f5f5f5":"white",cursor:i===draft.about.points.length-1?"not-allowed":"pointer",fontSize:".8rem",color:i===draft.about.points.length-1?"#ccc":"var(--dt)",flexShrink:0}}>↓</button>
                <button onClick={()=>{ delItem("about.points",i); delItem("about.pointsGu",i); }}
                  style={{padding:"8px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".8rem",color:"#C0392B",flexShrink:0,fontWeight:700}}>Del</button>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:".75rem",fontWeight:600,color:"#666",width:60}}>Gujarati</span>
                <BlurInput className="ci" style={{flex:1,marginBottom:0}} value={draft.about.pointsGu?.[i] || ""} onCommit={v=>upd(`about.pointsGu.${i}`,v)}/>
                <button type="button" onClick={async (e) => {
                  e.preventDefault();
                  try {
                    const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=' + encodeURIComponent(pt));
                    const data = await res.json();
                    upd(`about.pointsGu.${i}`, data[0].map(x => x[0]).join(''));
                  } catch(err) { alert("Translation failed"); }
                }} style={{padding:"8px 10px",borderRadius:6,border:"1px solid var(--sf)",background:"#FFF7EC",color:"var(--sf)",fontSize:".75rem",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Auto Translate v2</button>
              </div>
            </div>
          ))}
          <AddBtn label="Bullet Point" onClick={()=>{ addItem("about.points","New point"); addItem("about.pointsGu",""); }}/>
        </div>
      </Sec>}

      {showSec("programs") && <Sec id="programs" icon="📋" label="Programs"
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
              <div className="cf" style={{gridColumn: "1 / -1"}}>
                <label className="cl" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Program Title</span>
                  <button onClick={async()=>{
                    try {
                      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(p.title)}`);
                      if(!res.ok) throw new Error();
                      const data = await res.json();
                      upd(`programs.${i}.titleGu`, data[0].map(x => x[0]).join(''));
                    } catch(err) { alert("Translation failed"); }
                  }} style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--sf)",background:"#FFF7EC",color:"var(--sf)",fontSize:".7rem",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Auto Translate</button>
                </label>
                <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:8}}>
                  <BlurInput className="ci" value={p.title} onCommit={v=>upd(`programs.${i}.title`,v)} placeholder="English Title"/>
                  <BlurInput className="ci" value={p.titleGu||""} onCommit={v=>upd(`programs.${i}.titleGu`,v)} placeholder="Gujarati Title"/>
                </div>
              </div>

              <div className="cf" style={{gridColumn: "1 / -1"}}>
                <label className="cl" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Short Description</span>
                  <button onClick={async()=>{
                    try {
                      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(p.sub)}`);
                      if(!res.ok) throw new Error();
                      const data = await res.json();
                      upd(`programs.${i}.subGu`, data[0].map(x => x[0]).join(''));
                    } catch(err) { alert("Translation failed"); }
                  }} style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--sf)",background:"#FFF7EC",color:"var(--sf)",fontSize:".7rem",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Auto Translate</button>
                </label>
                <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:8}}>
                  <BlurInput className="ci" value={p.sub} onCommit={v=>upd(`programs.${i}.sub`,v)} placeholder="English Description"/>
                  <BlurInput className="ci" value={p.subGu||""} onCommit={v=>upd(`programs.${i}.subGu`,v)} placeholder="Gujarati Description"/>
                </div>
              </div>

              <div style={{gridColumn: "1 / -1"}}>
                <label className="cl">Full Details (Popup) - English</label>
                <div style={{background:"white",borderRadius:8,border:"1px solid var(--bd)",marginBottom:14}}>
                  <ReactQuill theme="snow" value={p.details||""} onChange={v=>upd(`programs.${i}.details`,v)} />
                </div>
                
                <label className="cl" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Full Details (Popup) - Gujarati</span>
                  <button onClick={async()=>{
                    try {
                      const plainText = (p.details||"").replace(/<[^>]+>/g, ' ');
                      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(plainText)}`);
                      if(!res.ok) throw new Error();
                      const data = await res.json();
                      upd(`programs.${i}.detailsGu`, data[0].map(x => x[0]).join(''));
                    } catch(err) { alert("Translation failed"); }
                  }} style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--sf)",background:"#FFF7EC",color:"var(--sf)",fontSize:".7rem",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Auto Translate (Plain Text)</button>
                </label>
                <div style={{background:"white",borderRadius:8,border:"1px solid var(--bd)"}}>
                  <ReactQuill theme="snow" value={p.detailsGu||""} onChange={v=>upd(`programs.${i}.detailsGu`,v)} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </Sec>}

      {showSec("events") && <Sec id="events" icon="📅" label="Events"
        onAdd={()=>addItem("events",{date:"Jan 01",month:"2025",title:"New Event",location:"Location",tag:"Health",color:"#E8F4F8"})} addLabel="Add Event">
        {draft.events.map((ev,i)=>(
          <div key={i} style={{border:"1px solid var(--bd)",borderRadius:12,padding:"16px",marginBottom:14,background:"#FAFAFA"}}>
            <RowBar arrPath="events" idx={i} total={draft.events.length} label="Event"/>
            <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:"0 14px"}}>
              <div className="cf">
                <label className="cl" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Event Title</span>
                  <button onClick={async()=>{
                    try {
                      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(ev.title)}`);
                      if(!res.ok) throw new Error();
                      const data = await res.json();
                      upd(`events.${i}.titleGu`, data[0].map(x => x[0]).join(''));
                    } catch(err) { alert("Translation failed"); }
                  }} style={{padding:"2px 6px",borderRadius:4,border:"1px solid var(--sf)",background:"#FFF7EC",color:"var(--sf)",fontSize:".65rem",fontWeight:600,cursor:"pointer"}}>Auto Translate</button>
                </label>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <BlurInput className="ci" value={ev.title} onCommit={v=>upd(`events.${i}.title`,v)} placeholder="English Title"/>
                  <BlurInput className="ci" value={ev.titleGu||""} onCommit={v=>upd(`events.${i}.titleGu`,v)} placeholder="Gujarati Title"/>
                </div>
              </div>

              <div className="cf">
                <label className="cl" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Location</span>
                  <button onClick={async()=>{
                    try {
                      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(ev.location)}`);
                      if(!res.ok) throw new Error();
                      const data = await res.json();
                      upd(`events.${i}.locationGu`, data[0].map(x => x[0]).join(''));
                    } catch(err) { alert("Translation failed"); }
                  }} style={{padding:"2px 6px",borderRadius:4,border:"1px solid var(--sf)",background:"#FFF7EC",color:"var(--sf)",fontSize:".65rem",fontWeight:600,cursor:"pointer"}}>Auto Translate</button>
                </label>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <BlurInput className="ci" value={ev.location} onCommit={v=>upd(`events.${i}.location`,v)} placeholder="English Location"/>
                  <BlurInput className="ci" value={ev.locationGu||""} onCommit={v=>upd(`events.${i}.locationGu`,v)} placeholder="Gujarati Location"/>
                </div>
              </div>

              <div className="cf">
                <label className="cl" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Date (e.g. Jun 15)</span>
                  <button onClick={async()=>{
                    try {
                      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(ev.date)}`);
                      if(!res.ok) throw new Error();
                      const data = await res.json();
                      upd(`events.${i}.dateGu`, data[0].map(x => x[0]).join(''));
                    } catch(err) { alert("Translation failed"); }
                  }} style={{padding:"2px 6px",borderRadius:4,border:"1px solid var(--sf)",background:"#FFF7EC",color:"var(--sf)",fontSize:".65rem",fontWeight:600,cursor:"pointer"}}>Auto</button>
                </label>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <BlurInput className="ci" value={ev.date} onCommit={v=>upd(`events.${i}.date`,v)} placeholder="English Date"/>
                  <BlurInput className="ci" value={ev.dateGu||""} onCommit={v=>upd(`events.${i}.dateGu`,v)} placeholder="Gujarati Date"/>
                </div>
              </div>

              <div className="cf">
                <label className="cl" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Year</span>
                  <button onClick={async()=>{
                    try {
                      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(ev.month)}`);
                      if(!res.ok) throw new Error();
                      const data = await res.json();
                      upd(`events.${i}.monthGu`, data[0].map(x => x[0]).join(''));
                    } catch(err) { alert("Translation failed"); }
                  }} style={{padding:"2px 6px",borderRadius:4,border:"1px solid var(--sf)",background:"#FFF7EC",color:"var(--sf)",fontSize:".65rem",fontWeight:600,cursor:"pointer"}}>Auto</button>
                </label>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <BlurInput className="ci" value={ev.month} onCommit={v=>upd(`events.${i}.month`,v)} placeholder="English Year"/>
                  <BlurInput className="ci" value={ev.monthGu||""} onCommit={v=>upd(`events.${i}.monthGu`,v)} placeholder="Gujarati Year"/>
                </div>
              </div>

              <div className="cf">
                <label className="cl" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Category</span>
                  <button onClick={async()=>{
                    try {
                      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(ev.tag)}`);
                      if(!res.ok) throw new Error();
                      const data = await res.json();
                      upd(`events.${i}.tagGu`, data[0].map(x => x[0]).join(''));
                    } catch(err) { alert("Translation failed"); }
                  }} style={{padding:"2px 6px",borderRadius:4,border:"1px solid var(--sf)",background:"#FFF7EC",color:"var(--sf)",fontSize:".65rem",fontWeight:600,cursor:"pointer"}}>Auto</button>
                </label>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <select className="ci" value={ev.tag} onChange={e=>upd(`events.${i}.tag`,e.target.value)}>
                    {["Health","Education","Environment","Empowerment","Relief","Community"].map(t=><option key={t}>{t}</option>)}
                  </select>
                  <BlurInput className="ci" value={ev.tagGu||""} onCommit={v=>upd(`events.${i}.tagGu`,v)} placeholder="Gujarati Category"/>
                </div>
              </div>
            </div>
          </div>
        ))}
      </Sec>}

      {showSec("contact") && <Sec id="contact" icon="📞" label="Contact and Volunteer">
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
          {draft.contact.socials.map((s,i)=>{
            const isObj = typeof s === 'object';
            const name = isObj ? s.name : s;
            const url = isObj ? s.url : "";
            const msg = isObj ? s.msg : "";
            return (
            <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              <BlurInput className="ci" placeholder="Platform" style={{flex:1,marginBottom:0}} value={name} onCommit={v=>upd(`contact.socials.${i}`, isObj ? {...s, name:v} : {name:v, url:"", msg:""})}/>
              <BlurInput className="ci" placeholder="Link URL (https://...)" style={{flex:2,marginBottom:0}} value={url} onCommit={v=>upd(`contact.socials.${i}`, {name, url:v, msg})}/>
              {name.toLowerCase() === "whatsapp" && (
                <BlurInput className="ci" placeholder="Pre-filled Message" style={{flex:2,marginBottom:0}} value={msg || ""} onCommit={v=>upd(`contact.socials.${i}`, {name, url, msg:v})}/>
              )}
              <button onClick={()=>delItem("contact.socials",i)}
                style={{padding:"8px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",cursor:"pointer",fontSize:".8rem",color:"#C0392B",flexShrink:0,fontWeight:700}}>Del</button>
            </div>
          )})}
          <AddBtn label="Social Link" onClick={()=>addItem("contact.socials",{name:"New Link",url:"",msg:""})}/>
        </div>
      </Sec>}

      {showSec("footer") && <Sec id="footer" icon="🦶" label="Footer Settings">
        <F label="Footer Description" path="footer.description" ta/>
        <F label="Copyright Year" path="footer.copyrightYear"/>
        <F label="Footer Tagline" path="footer.tagline"/>
      </Sec>}


      <div style={{position:"sticky",bottom:16,background:"white",border:"1px solid var(--bd)",borderRadius:16,padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 8px 32px rgba(0,0,0,.1)",marginTop:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:".82rem",color:"var(--mu)"}}>
          {auth?.idToken ? <span style={{color:"#1A7A3E",fontWeight:600}}>Database connected — saves go live instantly.</span> : <span style={{color:"#C0392B"}}>Not logged in — changes are local only.</span>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setPage("public")} style={{padding:"9px 16px",borderRadius:8,background:"var(--tl)",border:"none",cursor:"pointer",fontWeight:600,fontSize:".82rem",color:"var(--dt)"}}>Preview</button>
          <button className="bs" onClick={save} disabled={toast==="saving"} style={{padding:"9px 22px",borderRadius:8,fontWeight:700,fontSize:".9rem",opacity:toast==="saving"?.7:1}}>
            {toast==="saving" ? "Saving..." : "Save Changes"}
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
  {id:"team",icon:"👥",label:"Our Team"},
  {id:"achievements",icon:"🏆",label:"Achievements"},
  {id:"settings",icon:"⚙️",label:"Settings"},
  {id:"access",icon:"🔐",label:"Access Control"},
  {id:"profile",icon:"👤",label:"My Profile"},
{id: "meritlist", label: "Reports & Lists", icon: "📑"}, {id: "inviteletters", label: "Invite Letters", icon: "📩"}, {id: "certificates", label: "Certificates", icon: "🎓"}];

function Admin({ C, setC, setPage, auth, onLogout, onShowLogin }) {
  const isMasterAdmin = (email) => ["admin@vidyagohiltrust.org", "pradeepparmar902@yahoo.com"].includes(email?.toLowerCase());
  const master = auth?.email ? isMasterAdmin(auth.email) : false;
  const userRole = C.access?.roles?.find(r => r.email.toLowerCase() === auth?.email?.toLowerCase());

  let hasAccess = [];
  if (auth?.email) {
    hasAccess = master ? ["content", "overview", "donations", "events", "registrations", "volunteers", "gallery", "team", "achievements", "settings", "access", "profile", "meritlist", "inviteletters", "certificates"] : [...(userRole?.permissions || []), "profile"];
  }

  const visibleNav = ANAV.filter(item => hasAccess.includes(item.id));
  const [tab, setTab] = useState(visibleNav.length > 0 ? visibleNav[0].id : "");
  const [open, setOpen] = useState(true);
  const [adminProfile, setAdminProfile] = useState(null);
  
  useEffect(() => {
    if (auth?.idToken && auth?.localId) {
      fbFetchUserProfile(auth.localId, auth.idToken).then(p => {
        if(p) setAdminProfile(p);
      }).catch(console.error);
    }
  }, [auth]);

  const w = useW(); const mob = w<768;
  
  useEffect(()=>{ if(mob) setOpen(false); else setOpen(true); },[mob]);
  
  useEffect(() => {
    if (visibleNav.length > 0 && !visibleNav.find(n => n.id === tab)) {
      setTab(visibleNav[0].id);
    }
  }, [visibleNav, tab]);

  if (!auth?.email) {
    return (
      <div style={{minHeight:"100vh",background:"#f4f6f8",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div style={{background:"white",padding:"40px 30px",borderRadius:24,boxShadow:"0 12px 40px rgba(0,0,0,0.08)",textAlign:"center",maxWidth:400,width:"100%"}}>
          <div style={{width:64,height:64,borderRadius:"50%",background:"linear-gradient(135deg,var(--sf),var(--gd))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.8rem",margin:"0 auto 20px",boxShadow:"0 6px 20px rgba(232,101,10,.3)",color:"white"}}>🔒</div>
          <h2 style={{fontSize:"1.6rem",color:"var(--dt)",marginBottom:10}}>Admin Access Required</h2>
          <p style={{color:"var(--mu)",fontSize:".95rem",marginBottom:24,lineHeight:1.5}}>You must be logged in with an authorized account to access the Vidya Gohil Charitable Trust admin portal.</p>
          <button onClick={onShowLogin} className="btn-primary" style={{width:"100%",padding:"12px",fontSize:"1rem",fontWeight:600}}>
            Admin Login
          </button>
          <button onClick={()=>setPage("public")} style={{background:"none",border:"none",color:"var(--sf)",fontSize:".9rem",fontWeight:600,cursor:"pointer",marginTop:16}}>
            ← Return to Website
          </button>
        </div>
      </div>
    );
  }

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
          {visibleNav.map(item=>(
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
                <div style={{fontSize:".78rem",color:"var(--sflt)",fontWeight:700,whiteSpace:"nowrap"}}>Admin Login</div>
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
        {mob && !open && (
          <button onClick={()=>setOpen(true)} style={{position:"fixed",top:16,left:16,zIndex:100,background:"white",border:"1px solid var(--bd)",borderRadius:8,width:40,height:40,cursor:"pointer",fontSize:"1.2rem",boxShadow:"0 2px 8px rgba(0,0,0,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>☰</button>
        )}
        <div style={{padding:mob?"60px 16px 16px":"24px"}}>
          {visibleNav.length === 0 && (
            <div style={{textAlign:"center",padding:40,color:"var(--mu)",background:"white",borderRadius:12}}>
              <h2 style={{fontSize:"1.5rem",color:"#C0392B",marginBottom:10}}>Access Denied</h2>
              <p>Your account ({auth?.email}) does not have permission to view any Admin modules.</p>
              <p>Please contact the Master Admin to request access.</p>
            </div>
          )}
          {tab==="content"   && hasAccess.includes("content") && <ContentEditor C={C} setC={setC} setPage={setPage} auth={auth} hasAccess={hasAccess} master={master}/>}
          {tab==="overview"  && hasAccess.includes("overview") && <Overview mob={mob} C={C} auth={auth}/>}
          {tab==="donations" && hasAccess.includes("donations") && <Donations mob={mob} auth={auth} C={C}/>}
          {tab==="events"    && hasAccess.includes("events") && <AdminEvents mob={mob} C={C} setC={setC} auth={auth}/>}
          {tab==="registrations" && hasAccess.includes("registrations") && <AdminRegistrations mob={mob} C={C} auth={auth}/>}
          {tab==="volunteers"&& hasAccess.includes("volunteers") && <Volunteers mob={mob} auth={auth} C={C}/>}
          {tab==="meritlist" && hasAccess.includes("meritlist") && <AdminMeritList mob={mob} C={C} auth={auth}/>}
          {tab==="inviteletters" && hasAccess.includes("inviteletters") && <AdminInviteLetters mob={mob} C={C} auth={auth}/>}
          {tab==="certificates" && hasAccess.includes("certificates") && <AdminCertificates mob={mob} C={C} auth={auth}/>}
          {tab==="team"      && hasAccess.includes("team") && <AdminTeam mob={mob} C={C} setC={setC} auth={auth}/>}
          {tab==="gallery"   && hasAccess.includes("gallery") && <AdminGallery mob={mob} C={C} setC={setC} auth={auth}/>}
          {tab==="achievements" && hasAccess.includes("achievements") && <AdminAchievements mob={mob} C={C} setC={setC} auth={auth}/>}
          {tab==="settings"  && hasAccess.includes("settings") && <Settings mob={mob} C={C} setC={setC} auth={auth} setPage={setPage} hasAccess={hasAccess} master={master}/>}
          {tab==="access"    && hasAccess.includes("access") && <AdminAccess C={C} setC={setC} master={master} auth={auth}/>}
          {tab==="profile"   && hasAccess.includes("profile") && <AdminProfile auth={auth} mob={mob} adminProfile={adminProfile} setAdminProfile={setAdminProfile}/>}
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


  const saveVerification = async (r, newStatus, newRemarks) => {
    const updatedBy = auth?.email || "Admin";
    setRegs(prev => prev.map(x => x.id === r.id ? { ...x, Status: newStatus, status: newStatus, Remarks: newRemarks, "Updated By": updatedBy } : x));
    try {
      const cleanData = { ...r, Status: newStatus, status: newStatus, Remarks: newRemarks, "Updated By": updatedBy };
      delete cleanData.id; delete cleanData._submittedAt;
      await fbUpdateRegistration(r.id, cleanData, auth?.idToken);
      // Removed setViewing(null) here so modal can handle auto-advance
    } catch (e) {
      alert("Failed to save verification: " + e.message);
      const d = await fbFetchRegistrations(auth?.idToken);
      setRegs(d || []);
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
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
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

function AdminForms({ C, setC, saveToFb, mob, auth }) {
  const [previewForm, setPreviewForm] = useState(null);
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
  const [isManagingLib, setIsManagingLib] = useState(false);
  const [newLibLabel, setNewLibLabel] = useState("");
  const [newLibType, setNewLibType] = useState("text");
  const [newLibOptions, setNewLibOptions] = useState("");
  const dragItem = useRef();
  const dragOverItem = useRef();
  const [showLogic, setShowLogic] = useState({});
  const [editingFieldId, setEditingFieldId] = useState(null);

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
    if(newLibType === 'dropdown' && !newLibOptions.trim()) return alert("Please provide options separated by commas");
    const nf = { id: "fl_"+Date.now(), label: newLibLabel.trim(), type: newLibType, options: newLibType === 'dropdown' ? newLibOptions : "" };
    
    const newLib = [...fieldLib, nf];
    let newForms = forms;
    
    if (editingId) {
      newForms = forms.map(f => {
        if (f.id === editingId) {
          return {...f, fields: [...f.fields, { label: nf.label, type: nf.type, options: nf.options, required: false }]};
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
                 <input value={f.name} onChange={e=>updateForm(f.id, {...f, name: e.target.value})} style={{padding:"6px",border:"1px solid var(--bd)",borderRadius:6,marginBottom:10,fontWeight:600,width:"100%"}} placeholder="Form Name"/>
                 <div style={{display:"flex", flexDirection:"column", gap:10, marginBottom:15, background:"#F9F9F9", padding:12, borderRadius:8, border:"1px solid var(--bd)"}}>
                   <div>
                     <label style={{display:"block",fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:4}}>Banner/Header Image</label>
                     <div style={{display:"flex", gap:8, alignItems:"center"}}>
                       <input value={f.bannerImage||""} onChange={e=>updateForm(f.id, {...f, bannerImage: e.target.value})} style={{flex:1, padding:"8px",border:"1px solid var(--bd)",borderRadius:6,fontSize:".85rem"}} placeholder="Paste image URL or upload ->"/>
                       <label style={{padding:"8px 14px", background:"var(--dt)", color:"white", borderRadius:6, fontSize:".8rem", fontWeight:600, cursor:"pointer", whiteSpace:"nowrap"}}>
                         Upload Image
                         <input type="file" accept="image/*" style={{display:"none"}} onChange={async (e) => {
                           const file = e.target.files?.[0];
                           if(!file) return;
                           try {
                             const url = await fbUploadPublicFile(file, auth?.idToken);
                             updateForm(f.id, {...f, bannerImage: url});
                           } catch(err) {
                             alert("Upload failed: " + err.message);
                           }
                         }}/>
                       </label>
                     </div>
                     {f.bannerImage && <img src={f.bannerImage} alt="Banner Preview" style={{marginTop:8, width:"100%", maxHeight:100, objectFit:"cover", borderRadius:6, border:"1px solid var(--bd)"}}/>}
                   </div>
                   <div>
                     <label style={{display:"block",fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:4}}>Form Instructions</label>
                     <textarea value={f.instructions||""} onChange={e=>updateForm(f.id, {...f, instructions: e.target.value})} style={{width:"100%", padding:"8px",border:"1px solid var(--bd)",borderRadius:6,fontSize:".85rem", minHeight:60, fontFamily:"inherit"}} placeholder="Enter guidelines or instructions for users filling out the form..."/>
                   </div>
                 </div>
                 <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
                   {f.fields.map((field, idx) => (
                      <div key={idx} style={{display:"flex",flexDirection:"column", transition:"transform 0.2s"}}
                           draggable
                           onDragStart={(e) => { dragItem.current = idx; }}
                           onDragEnter={(e) => { dragOverItem.current = idx; }}
                           onDragEnd={() => {
                              if(dragItem.current !== undefined && dragOverItem.current !== undefined && dragItem.current !== dragOverItem.current) {
                                  const newF = [...f.fields];
                                  const draggedItemContent = newF.splice(dragItem.current, 1)[0];
                                  newF.splice(dragOverItem.current, 0, draggedItemContent);
                                  dragItem.current = null;
                                  dragOverItem.current = null;
                                  updateForm(f.id, {...f, fields:newF});
                              }
                           }}
                           onDragOver={(e) => e.preventDefault()}
                      >
                        <div style={{display:"flex",gap:8,alignItems:"center",background:"#F5F5F5",padding:"8px 12px",borderRadius:6}}>
                          {editingFieldId === `${f.id}_${idx}` ? (
                             <div style={{flex:1, display:"flex", flexDirection:"column", gap: 6}}>
                               <input value={field.label} onChange={e=>{ const newF=[...f.fields]; newF[idx].label=e.target.value; updateForm(f.id, {...f, fields:newF}); }} style={{padding:4, border:"1px solid var(--bd)", borderRadius:4, fontSize:".85rem", fontWeight:700, width: "100%"}}/>
                               <input value={field.dataKey||""} onChange={e=>{ const newF=[...f.fields]; newF[idx].dataKey=e.target.value; updateForm(f.id, {...f, fields:newF}); }} placeholder="Data Header / Key (Optional)" style={{padding:4, border:"1px solid var(--bd)", borderRadius:4, fontSize:".75rem", width: "100%", marginTop: 4}} title="If provided, multiple fields with the same Data Header will be merged into one column when exporting data."/>
                               {field.type === 'dropdown' && <input value={field.options||""} onChange={e=>{ const newF=[...f.fields]; newF[idx].options=e.target.value; updateForm(f.id, {...f, fields:newF}); }} placeholder="Options (comma separated)" style={{padding:4, border:"1px solid var(--bd)", borderRadius:4, fontSize:".75rem"}}/>}
                               <button onClick={()=>{
                                 setEditingFieldId(null);
                                 let targetLibId = field.libId;
                                 if (!targetLibId) {
                                     // Try to find it by matching type and approximate options if it's old
                                     const possible = fieldLib.find(fl => fl.type === field.type && (fl.type !== 'dropdown' || fl.options === field.options));
                                     if (possible) targetLibId = possible.id;
                                 }
                                 if (targetLibId) {
                                     const newLib = fieldLib.map(fl => fl.id === targetLibId ? {...fl, label: field.label, options: field.options} : fl);
                                     saveLib(newLib);
                                 }
                               }} style={{alignSelf:"flex-start", padding:"4px 12px", background:"var(--dt)", color:"white", border:"none", borderRadius:4, fontSize:".75rem", cursor:"pointer", fontWeight:600}}>Done</button>
                             </div>
                          ) : (
                             <div style={{flex:1, display:"flex", alignItems:"center", gap: 8}}>
                               <div style={{cursor:"grab", color:"#999", fontSize:"1.2rem", display:"flex", alignItems:"center", justifyContent:"center", userSelect:"none"}} title="Drag to reorder">☰</div>
                               <div style={{fontWeight:700,fontSize:".85rem",color:"var(--dt)"}}>{field.label}</div>
                               <button onClick={() => setEditingFieldId(`${f.id}_${idx}`)} title="Edit Field" style={{background:"none",border:"none",color:"var(--mu)",cursor:"pointer",fontSize:".9rem"}}>✏️</button>
                             </div>
                          )}
                          <div style={{fontSize:".75rem",color:"var(--mu)",background:"#E0E0E0",padding:"2px 8px",borderRadius:12,fontWeight:600}}>{field.type}</div>
                          <label style={{fontSize:".75rem",display:"flex",alignItems:"center",gap:4,marginLeft:10,fontWeight:600,color:"var(--dt)",cursor:"pointer"}}><input type="checkbox" checked={field.required} onChange={e=>{
                            const newF = [...f.fields]; newF[idx].required = e.target.checked; updateForm(f.id, {...f, fields:newF});
                          }}/> Req</label>
                          <button onClick={() => setShowLogic(prev => ({...prev, [`${f.id}_${idx}`]: !prev[`${f.id}_${idx}`]}))} title="Logic" style={{background:"none",border:"none",color:"#1A7A3E",cursor:"pointer",fontSize:"1rem",marginLeft:10}}>⚙️</button>
                          <button disabled={idx === 0} onClick={()=>{
                            const newF = [...f.fields];
                            const temp = newF[idx-1];
                            newF[idx-1] = newF[idx];
                            newF[idx] = temp;
                            updateForm(f.id, {...f, fields:newF});
                          }} style={{background:"none",border:"none",color:idx===0?"#ccc":"var(--dt)",cursor:idx===0?"default":"pointer",fontSize:"1.2rem",marginLeft:10,lineHeight:1}}>↑</button>
                          
                          <button disabled={idx === f.fields.length - 1} onClick={()=>{
                            const newF = [...f.fields];
                            const temp = newF[idx+1];
                            newF[idx+1] = newF[idx];
                            newF[idx] = temp;
                            updateForm(f.id, {...f, fields:newF});
                          }} style={{background:"none",border:"none",color:idx===f.fields.length-1?"#ccc":"var(--dt)",cursor:idx===f.fields.length-1?"default":"pointer",fontSize:"1.2rem",marginLeft:4,lineHeight:1}}>↓</button>

                          <button onClick={()=>{
                            const newF = [...f.fields]; newF.splice(idx, 1); updateForm(f.id, {...f, fields:newF});
                          }} style={{background:"none",border:"none",color:"#C0392B",cursor:"pointer",fontSize:"1.2rem",marginLeft:10,lineHeight:1}}>×</button>
                        </div>
                        {showLogic[`${f.id}_${idx}`] && (
                          <div style={{background:"white",padding:"10px",borderRadius:6,marginTop:4,border:"1px dashed var(--bd)",display:"flex",alignItems:"center",gap:8,animation:"fadeIn 0.2s"}}>
                            <div style={{display:"flex", flexDirection:"column", gap: 8, width:"100%"}}>
                                <div style={{fontSize:".75rem",fontWeight:600,color:"var(--dt)"}}>Show this field ONLY IF:</div>
                                {(() => {
                                    let rules = field.logicRules;
                                    if (!rules || rules.length === 0) {
                                        if (field.dependsOn) {
                                            rules = [{ dependsOn: field.dependsOn, dependsValue: field.dependsValue }];
                                        } else {
                                            rules = [{ dependsOn: "", dependsValue: "" }];
                                        }
                                    }
                                    
                                    return rules.map((rule, ruleIdx) => (
                                        <div key={ruleIdx} style={{display:"flex", alignItems:"center", gap: 8, flexWrap:"wrap"}}>
                                            {ruleIdx > 0 && <span style={{fontSize:".75rem",fontWeight:700,color:"var(--dt)", background:"#eee", padding:"2px 6px", borderRadius:4}}>OR</span>}
                                            <select value={rule.dependsOn || ""} onChange={e=>{
                                              const newF = [...f.fields];
                                              const newRules = [...rules];
                                              newRules[ruleIdx] = { dependsOn: e.target.value, dependsValue: "" };
                                              newF[idx].logicRules = newRules;
                                              if (ruleIdx === 0) {
                                                  newF[idx].dependsOn = e.target.value;
                                                  newF[idx].dependsValue = "";
                                              }
                                              updateForm(f.id, {...f, fields:newF});
                                            }} style={{padding:"4px",fontSize:".75rem",borderRadius:4,border:"1px solid var(--bd)"}}>
                                              <option value="">-- Always Show --</option>
                                              {f.fields.filter((ff,i) => i !== idx && ff.label && ff.type === 'dropdown').map(ff => <option key={ff.label} value={ff.label}>{ff.label}</option>)}
                                            </select>
                                            
                                            {rule.dependsOn && (
                                              <>
                                                <span style={{fontSize:".75rem",fontWeight:600,color:"var(--mu)"}}>EQUALS</span>
                                                {(() => {
                                                  const parentField = f.fields.find(ff => ff.label === rule.dependsOn);
                                                  const handleValChange = (val) => {
                                                      const newF = [...f.fields];
                                                      const newRules = [...rules];
                                                      newRules[ruleIdx] = { ...newRules[ruleIdx], dependsValue: val };
                                                      newF[idx].logicRules = newRules;
                                                      if (ruleIdx === 0) {
                                                          newF[idx].dependsValue = val;
                                                      }
                                                      updateForm(f.id, {...f, fields:newF});
                                                  };
                                                  if (parentField && parentField.type === 'dropdown' && parentField.options) {
                                                    return (
                                                      <select value={rule.dependsValue || ""} onChange={e=>handleValChange(e.target.value)} style={{padding:"4px",fontSize:".75rem",borderRadius:4,border:"1px solid var(--bd)"}}>
                                                        <option value="">-- Select Option --</option>
                                                        {parentField.options.split(",").map((opt,oi) => opt.trim() && <option key={oi} value={opt.trim()}>{opt.trim()}</option>)}
                                                      </select>
                                                    )
                                                  }
                                                  return <input type="text" value={rule.dependsValue || ""} onChange={e=>handleValChange(e.target.value)} placeholder="e.g. Study" style={{padding:"4px",fontSize:".75rem",borderRadius:4,border:"1px solid var(--bd)"}}/>;
                                                })()}
                                                
                                                {rules.length > 1 && (
                                                    <button onClick={() => {
                                                        const newF = [...f.fields];
                                                        const newRules = rules.filter((_, i) => i !== ruleIdx);
                                                        newF[idx].logicRules = newRules;
                                                        if (ruleIdx === 0 && newRules.length > 0) {
                                                            newF[idx].dependsOn = newRules[0].dependsOn;
                                                            newF[idx].dependsValue = newRules[0].dependsValue;
                                                        } else if (newRules.length === 0) {
                                                            newF[idx].dependsOn = "";
                                                            newF[idx].dependsValue = "";
                                                        }
                                                        updateForm(f.id, {...f, fields:newF});
                                                    }} style={{background:"none",border:"none",color:"#C0392B",cursor:"pointer",fontSize:"1.2rem",lineHeight:1, padding:0, marginLeft:4}}>×</button>
                                                )}
                                              </>
                                            )}
                                        </div>
                                    ));
                                })()}
                                
                                {(() => {
                                    const rules = field.logicRules || (field.dependsOn ? [{dependsOn: field.dependsOn}] : []);
                                    if (rules.length > 0 && rules[rules.length-1].dependsOn) {
                                        return (
                                            <button onClick={() => {
                                                const newF = [...f.fields];
                                                newF[idx].logicRules = [...rules, { dependsOn: "", dependsValue: "" }];
                                                updateForm(f.id, {...f, fields:newF});
                                            }} style={{alignSelf:"flex-start", marginTop: 6, background:"#F0F4F8", border:"1px solid #D0E1F9", color:"#2B6CB0", padding:"4px 10px", borderRadius:6, fontSize:".7rem", fontWeight:700, cursor:"pointer", transition:"all 0.2s"}} onMouseEnter={e=>{e.currentTarget.style.background="#E2EBF5"}} onMouseLeave={e=>{e.currentTarget.style.background="#F0F4F8"}}>+ Add OR Condition</button>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                 </div>
                 <div style={{background:"#F9F9F9",padding:12,borderRadius:8,border:"1px solid var(--bd)",marginBottom:12}}>
                    <p style={{fontSize:".8rem",fontWeight:700,marginBottom:8,color:"var(--dt)"}}>Add a Standard Field</p>
                     
                     {isManagingLib && (
                       <div style={{marginBottom:16,padding:12,background:"white",borderRadius:6,border:"1px solid var(--bd)"}}>
                         <h4 style={{fontSize:".85rem",margin:0,marginBottom:10,color:"var(--dt)",fontWeight:700}}>Manage Library Fields</h4>
                         <div style={{display:"flex",flexDirection:"column",gap:6}}>
                           {fieldLib.map(fl => (
                             <div key={fl.id} style={{display:"flex",alignItems:"center",gap:10,background:"#F5F5F5",padding:"6px 10px",borderRadius:4}}>
                               <div style={{flex:1}}>
                                 <input value={fl.label} onChange={e=>{
                                   const newLib = fieldLib.map(l => l.id === fl.id ? {...l, label: e.target.value} : l);
                                   saveLib(newLib);
                                 }} style={{padding:4,border:"1px solid #CCC",borderRadius:4,fontSize:".8rem",width:"40%"}}/>
                                 {fl.type === 'dropdown' && (
                                   <input value={fl.options||""} onChange={e=>{
                                     const newLib = fieldLib.map(l => l.id === fl.id ? {...l, options: e.target.value} : l);
                                     saveLib(newLib);
                                   }} placeholder="Options" style={{padding:4,border:"1px solid #CCC",borderRadius:4,fontSize:".75rem",width:"50%",marginLeft:6}}/>
                                 )}
                               </div>
                               <span style={{fontSize:".7rem",color:"var(--mu)",background:"#E0E0E0",padding:"2px 6px",borderRadius:10}}>{fl.type}</span>
                               <button onClick={()=>{
                                 if(!window.confirm("Delete this field from the library?")) return;
                                 saveLib(fieldLib.filter(l => l.id !== fl.id));
                               }} style={{background:"none",border:"none",color:"#C0392B",cursor:"pointer",fontSize:"1.1rem"}}>×</button>
                             </div>
                           ))}
                         </div>
                       </div>
                     )}

                     <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
                      <select id={`sel_${f.id}`} style={{flex:1,padding:"8px",border:"1px solid var(--bd)",borderRadius:6,fontSize:".85rem"}}>
                        <option value="">-- Choose from Library --</option>
                        {fieldLib.map(fl => <option key={fl.id} value={fl.id}>{fl.label} ({fl.type})</option>)}
                      </select>
                      <button onClick={()=>{
                        const sel = document.getElementById(`sel_${f.id}`);
                        if(!sel.value) return;
                        const target = fieldLib.find(fl => fl.id === sel.value);
                        if(target) updateForm(f.id, {...f, fields: [...f.fields, {libId: target.id, label:target.label, type:target.type, options:target.options, required:false}]});
                        sel.value = "";
                      }} className="bt" style={{padding:"8px 16px",borderRadius:6,fontSize:".8rem",fontWeight:700}}>Add</button>
                    </div>
                    {!isAddingLib ? (
                      <div style={{display:"flex",gap:10,marginTop:4}}>
                        <button onClick={()=>setIsAddingLib(true)} style={{fontSize:".8rem",background:"var(--dt)",color:"white",border:"none",padding:"6px 12px",borderRadius:6,cursor:"pointer",fontWeight:600}}>+ Create New Standard Field</button>
                        <button onClick={()=>setIsManagingLib(!isManagingLib)} style={{fontSize:".8rem",background:"white",color:"var(--dt)",border:"1px solid var(--bd)",padding:"6px 12px",borderRadius:6,cursor:"pointer",fontWeight:600}}>Manage Library</button>
                      </div>
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
                          <option value="dropdown">Dropdown Options</option>
                        </select>
                        {newLibType === 'dropdown' && (
                          <div style={{display:"flex", alignItems:"center", gap: 8, flex: 1}}>
                            <input value={newLibOptions} onChange={e=>setNewLibOptions(e.target.value)} placeholder="Options (comma separated, e.g. Study, Working)" style={{flex:1,padding:"6px",fontSize:".8rem",border:"1px solid var(--bd)",borderRadius:4}}/>
                            <label style={{cursor:"pointer", padding:"6px 12px", background:"#0D4B5E", color:"white", borderRadius:4, fontSize:".75rem", fontWeight:700, display:"flex", alignItems:"center", gap:4, whiteSpace:"nowrap"}}>
                              📁 Upload CSV/TXT
                              <input type="file" accept=".csv,.txt" style={{display:"none"}} onChange={e => {
                                const file = e.target.files[0];
                                if(!file) return;
                                const reader = new FileReader();
                                reader.onload = (ev) => {
                                  const content = ev.target.result;
                                  const items = content.split(/[\n,]+/).map(i => i.trim()).filter(i => i);
                                  const currentOptions = newLibOptions ? newLibOptions.split(',').map(i=>i.trim()).filter(i=>i) : [];
                                  const combined = Array.from(new Set([...currentOptions, ...items])).join(', ');
                                  setNewLibOptions(combined);
                                  e.target.value = '';
                                };
                                reader.readAsText(file);
                              }} />
                            </label>
                          </div>
                        )}
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
                   <button onClick={()=>setPreviewForm(f)} style={{padding:"4px 10px",background:"#F0F4F8",border:"none",borderRadius:6,color:"#2B6CB0",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>Preview</button>
                   <button onClick={()=>setEditingId(f.id)} style={{padding:"4px 10px",background:"var(--tl)",border:"none",borderRadius:6,color:"var(--dt)",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>Edit</button>
                   <button onClick={()=>removeForm(f.id)} style={{padding:"4px 10px",background:"#FEF0EF",border:"none",borderRadius:6,color:"#C0392B",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>Delete</button>
                 </div>
               </div>
             )}
           </div>
         ))}
       </div>
       <hr style={{margin:"30px 0",border:"none",borderTop:"1px dashed var(--bd)"}}/>
       {previewForm && (
         <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
           <div className="ac" style={{background:"linear-gradient(135deg, #ffffff, #f0f7ff)",width:"100%",maxWidth:500,padding:20,borderRadius:12,maxHeight:"95vh",overflowY:"auto",position:"relative", boxSizing:"border-box", boxShadow:"0 20px 40px rgba(0,0,0,0.2)"}}>
             <button onClick={()=>setPreviewForm(null)} style={{position:"absolute",top:16,right:16,background:"#F5F5F5",border:"none",fontSize:"1.2rem",cursor:"pointer",width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--mu)",zIndex:10}}>✕</button>
             
             <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.4rem",color:"var(--dt)",marginBottom:15,fontWeight:700,paddingRight:30}}>
               Form Preview: {previewForm.name}
             </h3>
             
             <div style={{display:"grid",gridTemplateColumns:"1fr",gap:12,textAlign:"left"}}>
               {previewForm.bannerImage && (
                 <div style={{marginBottom: 10, borderRadius: 8, overflow: "hidden", border: "1px solid var(--bd)"}}>
                   <img src={previewForm.bannerImage} alt="Form Banner" style={{width: "100%", maxHeight: 150, objectFit: "cover"}} />
                 </div>
               )}
               {previewForm.instructions && (
                 <div style={{marginBottom: 14, background: "#FFFBF4", border: "1px solid var(--bd)", padding: "12px 16px", borderRadius: 8, fontSize: ".85rem", color: "var(--tx)", lineHeight: 1.5, whiteSpace: "pre-wrap"}}>
                   {previewForm.instructions}
                 </div>
               )}
               
               {previewForm.fields.length === 0 && <p style={{fontSize:".85rem",color:"var(--mu)",fontStyle:"italic"}}>This form has no fields.</p>}
               {previewForm.fields.map((field, idx) => (
                 <div key={idx}>
                   <label style={{display:"block",fontSize:".75rem",fontWeight:600,color:"var(--mu)",marginBottom:4}}>{field.label} {field.required&&<span style={{color:"red"}}>*</span>}</label>
                   {field.type === 'address' ? (
                     <textarea disabled style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem",minHeight:60,background:"#F9F9F9"}}/>
                   ) : field.type === 'dropdown' ? (
                     <select disabled style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem",background:"#F9F9F9"}}>
                       <option value="">-- Select --</option>
                       {(field.options||"").split(",").map((opt, oi) => opt.trim() && <option key={oi} value={opt.trim()}>{opt.trim()}</option>)}
                     </select>
                   ) : field.type === 'gender' ? (
                     <select disabled style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem",background:"#F9F9F9"}}>
                       <option value="">-- Select Gender --</option>
                     </select>
                   ) : field.type === 'fullname' ? (
                     <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                       <input disabled placeholder="First" style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".9rem",background:"#F9F9F9"}}/>
                       <input disabled placeholder="Middle" style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".9rem",background:"#F9F9F9"}}/>
                       <input disabled placeholder="Last" style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".9rem",background:"#F9F9F9"}}/>
                     </div>
                   ) : field.type === 'image' || field.type === 'file' ? (
                     <div style={{padding:"12px",borderRadius:8,border:"1px dashed var(--bd)",background:"#F9F9F9",fontSize:".8rem",color:"var(--mu)"}}>
                       {field.type === 'image' ? '📸 Choose Photo' : '📎 Choose Document'} (File upload preview)
                     </div>
                   ) : (
                     <input disabled type={field.type} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".9rem",background:"#F9F9F9"}}/>
                   )}
                 </div>
               ))}
             </div>
           </div>
         </div>
       )}
    </div>
  );
}




function CertificateTemplateMapper({ imgUrl, mapData, fontSize, fontColor, onChange, availableFields }) {
  const [fields, setFields] = useState(() => {
    const initFields = {};
    if (availableFields) {
       availableFields.forEach((f, i) => {
         initFields[f] = { x: 50, y: 30 + ((i % 6) * 10), visible: false };
       });
    }
    if (mapData) {
       return { ...initFields, ...mapData };
    }
    return initFields;
  });

  useEffect(() => {
    if (availableFields) {
      setFields(prev => {
        const next = { ...prev };
        let changed = false;
        availableFields.forEach((f, i) => {
          if (!next[f]) {
            next[f] = { x: 50, y: 30 + ((i % 6) * 10), visible: false };
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [availableFields]);

  const [fSize, setFSize] = useState(fontSize || 30);
  const [fColor, setFColor] = useState(fontColor || "#000000");

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
      onChange(fields, fSize, fColor); 
    }
  };

  const toggleVisibility = (key) => {
    const nextFields = { ...fields, [key]: { ...fields[key], visible: !fields[key].visible } };
    setFields(nextFields);
    onChange(nextFields, fSize, fColor);
  };

  return (
    <div style={{marginTop: 16, border: "1px solid var(--bd)", borderRadius: 8, padding: 16, background: "white"}}>
      <h4 style={{margin: 0, marginBottom: 8, fontSize: ".9rem"}}>Visual Certificate Mapper</h4>
      <p style={{fontSize: ".75rem", color: "var(--mu)", marginBottom: 16}}>Drag the fields to position them on your template. Click a button below to show/hide a field.</p>
      
      <div style={{display:"flex",gap:16,marginBottom:16}}>
        <div>
          <label style={{fontSize:".75rem",fontWeight:600,display:"block",marginBottom:4}}>Font Size (px)</label>
          <input type="number" value={fSize} onChange={(e) => { setFSize(parseInt(e.target.value)); onChange(fields, parseInt(e.target.value), fColor); }} style={{width:80,padding:6,borderRadius:6,border:"1px solid var(--bd)"}} />
        </div>
        <div>
          <label style={{fontSize:".75rem",fontWeight:600,display:"block",marginBottom:4}}>Text Color</label>
          <input type="color" value={fColor} onChange={(e) => { setFColor(e.target.value); onChange(fields, fSize, e.target.value); }} style={{width:50,height:32,padding:0,border:"none",borderRadius:6,cursor:"pointer"}} />
        </div>
      </div>
      <div style={{display:"flex", gap: 8, flexWrap: "wrap", marginBottom: 16}}>
        {Object.entries(fields).map(([key, pos]) => (
          <button 
            key={key} 
            onClick={() => toggleVisibility(key)}
            style={{padding:"6px 12px", borderRadius:20, border:"1px solid var(--bd)", background:pos.visible?"var(--dt)":"#f5f5f5", color:pos.visible?"white":"#555", fontSize:".75rem", fontWeight:600, cursor:"pointer"}}
          >
            {pos.visible ? "✓ " : "+ "}{key.startsWith("[TEXT] ") ? key.replace("[TEXT] ", "") : key}
          </button>
        ))}
      </div>

      <div 
        ref={containerRef} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
        style={{position: "relative", width: "100%", overflow: "hidden", borderRadius: 8, background: "#f5f5f5", border: "1px dashed var(--bd)", touchAction: "none", minHeight: 200}}
      >
        <img src={imgUrl} style={{width: "100%", display: "block", pointerEvents: "none"}} alt="Template" />
        
        {Object.entries(fields).map(([key, pos]) => {
          if (!pos.visible) return null;
          let safeX = Math.max(5, Math.min(95, parseFloat(pos.x) || 50));
          let safeY = Math.max(5, Math.min(95, parseFloat(pos.y) || 50));
          return (
          <div
            key={key} onPointerDown={(e) => handlePointerDown(e, key)}
            style={{
              position: "absolute", left: `${safeX}%`, top: `${safeY}%`, transform: "translate(-50%, -50%)",
              background: dragging === key ? "var(--sf)" : "rgba(13, 75, 94, 0.85)", color: "white", padding: "4px 8px", borderRadius: 4,
              fontSize: "12px", fontWeight: 700, cursor: dragging === key ? "grabbing" : "grab", userSelect: "none", whiteSpace: "nowrap", zIndex: dragging === key ? 10 : 1
            }}
          >
            {key.startsWith("[TEXT] ") ? key.replace("[TEXT] ", "") : key}
          </div>
          );
        })}
      </div>
      
      <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16}}>
        {Object.entries(fields).map(([key, pos]) => (
          <button 
            key={key} onClick={() => toggleVisibility(key)}
            style={{ padding: "6px 12px", borderRadius: 16, fontSize: ".75rem", fontWeight: 600, cursor: "pointer", background: pos.visible ? "var(--tl)" : "#f5f5f5", border: `1px solid ${pos.visible ? "var(--dt)" : "#ddd"}`, color: pos.visible ? "var(--dt)" : "#888" }}
          >
            {pos.visible ? "✓ " : "+ "}{key.startsWith("[TEXT] ") ? key.replace("[TEXT] ", "") : key}
          </button>
        ))}
      </div>
    </div>
  );
}

function CertificateConfigModal({ ev, onSave, onClose, auth, forms }) {
  const [certBgUrl, setCertBgUrl] = useState(ev.certBgUrl || "");
  const [certMap, setCertMap] = useState(ev.certMap || null);
  
  // Extract form fields dynamically for this event
  const [availableFields, setAvailableFields] = useState(["Event Name", "Date"]);
  useEffect(() => {
    if (ev.formId && forms) {
      const form = forms.find(f => f.id === ev.formId);
      if (form && form.fields) {
         const labels = form.fields.map(f => f.label || "Field").filter(Boolean);
         setAvailableFields([...labels, "Event Name", "Date"]);
      }
    }
  }, [ev.formId, forms]);
  const [certFontSize, setCertFontSize] = useState(ev.certFontSize || 30);
  const [certFontColor, setCertFontColor] = useState(ev.certFontColor || "#000000");
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
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
          setCertBgUrl(b64);
          setUploading(false);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    } catch(err) {
      alert("Upload failed: " + err.message);
      setUploading(false);
    }
  };

  const save = () => {
    onSave({ certBgUrl, certMap, certFontSize, certFontColor });
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:99999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"white",width:"100%",maxWidth:900,borderRadius:12,padding:24,maxHeight:"90vh",overflowY:"auto"}}>
        <h3 style={{marginBottom:16,fontFamily:"'Playfair Display',serif",fontSize:"1.3rem"}}>Configure Certificate for {ev.title}</h3>
        
        <div style={{display:"flex",gap:16,marginBottom:20, flexWrap: "wrap"}}>
          <div style={{flex:1, minWidth: 300}}>
            <label style={{fontSize:".8rem",fontWeight:600,display:"block",marginBottom:6}}>Background Image</label>
            <div style={{display:"flex",gap:8}}>
              <input type="text" value={certBgUrl} onChange={e=>setCertBgUrl(e.target.value)} placeholder="Image URL (or upload)..." style={{flex:1,padding:8,borderRadius:6,border:"1px solid var(--bd)"}} />
              <label style={{background:"var(--sf)",color:"white",padding:"8px 16px",borderRadius:6,cursor:"pointer",fontWeight:600}}>
                {uploading ? "..." : "Upload"}
                <input type="file" accept="image/*" onChange={handleUpload} style={{display:"none"}} disabled={uploading}/>
              </label>
            </div>
            {certBgUrl && (
              <button onClick={() => setCertBgUrl("")} style={{background:"none",border:"none",color:"#C0392B",fontSize:".75rem",fontWeight:600,cursor:"pointer",padding:0,marginTop:6}}>Remove Image</button>
            )}
          </div>
          
          <div style={{flex:1, minWidth: 300}}>
            <label style={{fontSize:".8rem",fontWeight:600,display:"block",marginBottom:6}}>Add Custom Static Text (e.g. Date, Phrase)</label>
            <div style={{display:"flex",gap:8}}>
              <input type="text" id="customTextInp" placeholder="Enter text to print..." style={{flex:1,padding:8,borderRadius:6,border:"1px solid var(--bd)"}} />
              <button onClick={() => {
                const inp = document.getElementById('customTextInp');
                if(inp && inp.value.trim()){
                  setAvailableFields(prev => [...prev, "[TEXT] " + inp.value.trim()]);
                  inp.value = "";
                }
              }} style={{background:"var(--dt)",color:"white",padding:"8px 16px",borderRadius:6,cursor:"pointer",border:"none",fontWeight:600}}>Add Text</button>
            </div>
          </div>
        </div>

        {certBgUrl ? (
          <CertificateTemplateMapper 
            imgUrl={certBgUrl} 
            mapData={certMap} 
            fontSize={certFontSize}
            fontColor={certFontColor}
            availableFields={availableFields}
            onChange={(map, size, color) => {
              setCertMap(map);
              setCertFontSize(size);
              setCertFontColor(color);
            }} 
          />
        ) : (
          <div style={{padding:40,textAlign:"center",background:"#F5F5F5",borderRadius:8,marginBottom:20,color:"var(--mu)"}}>
            Upload or paste an image URL to start mapping the fields.
          </div>
        )}

        <div style={{display:"flex",justifyContent:"flex-end",gap:12,marginTop:20}}>
          <button onClick={onClose} style={{padding:"8px 16px",borderRadius:6,border:"1px solid var(--bd)",background:"white",cursor:"pointer"}}>Cancel</button>
          <button onClick={save} style={{padding:"8px 16px",borderRadius:6,border:"none",background:"var(--dt)",color:"white",cursor:"pointer",fontWeight:600}}>Save Configuration</button>
        </div>
      </div>
    </div>
  );
}

function AdminEvents({ mob, C, setC, auth }) {
  const [items, setItems] = useState(C.events || []);
  const [previewForm, setPreviewForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [configModal, setConfigModal] = useState(null);
  const [qrModal, setQrModal] = useState(null); // { ev, idx }

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
      id: "ev_" + Date.now(),
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
      <AdminForms C={C} setC={setC} saveToFb={saveToFb} mob={mob} auth={auth} />

      {configModal && (
        <CertificateConfigModal 
          ev={configModal.ev} 
          auth={auth}
          forms={C.forms}
          type={configModal.type || 'cert'}
          onClose={() => setConfigModal(null)} 
          onSave={(conf) => {
            const newArr = [...items];
            if (configModal.type === 'invite') {
              newArr[configModal.idx] = {
                ...newArr[configModal.idx],
                inviteBgUrl: conf.bgUrl,
                inviteMap: conf.map,
                inviteFontSize: conf.fontSize,
                inviteFontColor: conf.fontColor
              };
            } else {
              newArr[configModal.idx] = {
                ...newArr[configModal.idx],
                certBgUrl: conf.bgUrl,
                certMap: conf.map,
                certFontSize: conf.fontSize,
                certFontColor: conf.fontColor
              };
            }
            setItems(newArr);
            upd(newArr);
            setConfigModal(null);
          }} 
        />
      )}
      
      {qrModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"white",borderRadius:12,padding:30,width:"100%",maxWidth:400,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 10px 30px rgba(0,0,0,0.5)",position:"relative",display:"flex",flexDirection:"column",alignItems:"center"}}>
            <button onClick={() => setQrModal(null)} style={{position:"absolute",top:15,right:20,background:"none",border:"none",fontSize:"1.5rem",cursor:"pointer",color:"#999"}}>×</button>
            <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.3rem",color:"var(--dt)",fontWeight:700,marginBottom:20,textAlign:"center"}}>{qrModal.ev.title}</h3>
            <p style={{fontSize:".85rem",color:"var(--mu)",textAlign:"center",marginBottom:20}}>Scan this QR code to jump directly to this event's registration form.</p>
            <div style={{padding:20,background:"white",borderRadius:12,border:"1px solid var(--bd)",marginBottom:20}}>
              <QRCodeCanvas 
                value={`${window.location.origin}${window.location.pathname}?event=${qrModal.idx}`} 
                size={200}
                level={"H"}
              />
            </div>
            <div style={{fontSize:".75rem",color:"var(--sf)",background:"#F5F7FA",padding:"8px 12px",borderRadius:6,border:"1px solid #D0E1F9",wordBreak:"break-all",textAlign:"center"}}>
              {`${window.location.origin}${window.location.pathname}?event=${qrModal.idx}`}
            </div>
          </div>
        </div>
      )}

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
                  <label style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600}}>Registration Section (For grouping bulk registrations)</label>
                  <select value={ev.section || "Default"} onChange={e=>updateItem(i,"section",e.target.value)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit"}}>
                    <option value="Default">Default Section</option>
                    {(C.eventSections||[]).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600}}>Registration Form</label>
                  <select value={ev.formId || ""} onChange={e=>updateItem(i,"formId",e.target.value)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit"}}>
                    <option value="">-- No Form (Disabled) --</option>
                    {(C.forms||[]).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600}}>WhatsApp Group Link (Optional - Shows after registration)</label>
                  <input type="text" placeholder="https://chat.whatsapp.com/..." value={ev.waGroupLink || ""} onChange={e=>updateItem(i,"waGroupLink",e.target.value)} style={{width:"100%",padding:"6px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit"}}/>
                </div>
                                <div style={{gridColumn:"1/-1", marginTop: 8, padding: 12, background: "#F5F7FA", borderRadius: 8, border: "1px solid var(--bd)"}}>
                  <h4 style={{fontSize:".85rem",marginBottom:8,color:"var(--dt)",fontWeight:700}}>Education Awards (Certificates)</h4>
                  <div style={{display:"flex", alignItems:"center", gap: 16}}>
                    <label style={{fontSize:".75rem",fontWeight:600,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                      <input type="checkbox" checked={ev.issueCertificates || false} onChange={e=>updateItem(i,"issueCertificates",e.target.checked)} />
                      Enable / Issue Certificates
                    </label>
                    <button onClick={()=>setConfigModal({ev, idx: i, type: 'cert'})} className="bt" style={{padding:"5px 12px",borderRadius:6,fontSize:".75rem",fontWeight:600}}>⚙️ Configure Template</button>
                  </div>
                  {ev.certBgUrl && <div style={{fontSize:".7rem",color:"var(--sf)",marginTop:6}}>✅ Template mapped successfully.</div>}
                </div>
                
                <div style={{gridColumn:"1/-1", marginTop: 8, padding: 12, background: "#FDF5E6", borderRadius: 8, border: "1px solid #F5DEB3"}}>
                  <h4 style={{fontSize:".85rem",marginBottom:8,color:"#D2691E",fontWeight:700}}>Official Invite Letters</h4>
                  <div style={{display:"flex", alignItems:"center", gap: 16}}>
                    <label style={{fontSize:".75rem",fontWeight:600,display:"flex",alignItems:"center",gap:6,cursor:"pointer",color:"#8B4513"}}>
                      <input type="checkbox" checked={ev.issueInviteLetters || false} onChange={e=>updateItem(i,"issueInviteLetters",e.target.checked)} />
                      Enable / Issue Invite Letters
                    </label>
                    <button onClick={()=>setConfigModal({ev, idx: i, type: 'invite'})} className="bs" style={{padding:"5px 12px",borderRadius:6,fontSize:".75rem",fontWeight:600,background:"#D2691E",border:"none",color:"white"}}>✉️ Configure Template</button>
                  </div>
                  {ev.inviteBgUrl && <div style={{fontSize:".7rem",color:"#2E8B57",marginTop:6}}>✅ Template mapped successfully.</div>}
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
                  <button onClick={()=>{
                    if (!ev.id) {
                      const newEv = {...ev, id: "ev_" + Date.now()};
                      const newArr = [...items];
                      newArr[i] = newEv;
                      setItems(newArr);
                      const newC = {...C, events: newArr};
                      setC(newC);
                      if (typeof saveToFb === 'function') saveToFb(newC);
                      setQrModal({ev: newEv, idx: i});
                    } else {
                      setQrModal({ev, idx: i});
                    }
                  }} style={{padding:"5px 11px",borderRadius:6,background:"#F0F4F8",border:"1px solid #D0E1F9",color:"#2B6CB0",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>QR Code</button>
                  <button onClick={()=>remove(i)} style={{padding:"5px 11px",borderRadius:6,background:"#FEF0EF",border:"none",color:"#C0392B",cursor:"pointer",fontSize:".75rem",fontWeight:600}}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {previewForm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems: mob ? "flex-start" : "center",justifyContent:"center",padding: mob ? "60px 16px 20px 16px" : "16px"}}>
          <div className="ac" style={{background:"linear-gradient(135deg, #ffffff, #f0f7ff)",width:"100%",maxWidth:500,padding:20,borderRadius:12,maxHeight: mob ? "calc(100svh - 80px)" : "95vh",overflowY:"auto",position:"relative", boxShadow:"0 20px 40px rgba(0,0,0,0.2)"}}>
            <button onClick={() => setPreviewForm(null)} style={{position:"absolute",top:16,right:16,background:"#F5F5F5",border:"none",fontSize:"1.2rem",cursor:"pointer",width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--mu)"}}>✕</button>
            <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.4rem",color:"var(--dt)",marginBottom:4,fontWeight:700,paddingRight:30}}>Preview</h3>
            <p style={{fontSize:".85rem",color:"var(--mu)",marginBottom:20}}>{previewForm.name}</p>
            
            <div style={{display:"flex", flexDirection:"column", gap:16}}>
              {previewForm.bannerUrl && (
                <div style={{width:"100%", borderRadius:8, overflow:"hidden", marginBottom:0}}>
                  <img src={previewForm.bannerUrl} alt="Form Banner" style={{width:"100%", height:"auto", display:"block", maxHeight:200, objectFit:"cover"}} />
                </div>
              )}
              {previewForm.instructionText && (
                <div style={{background:"#F8FAFC", padding:"16px", borderRadius:8, borderLeft:"4px solid #3498DB", fontSize:".85rem", color:"#2C3E50", whiteSpace:"pre-wrap", lineHeight:1.5}}>
                  {previewForm.instructionText}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns: mob ? "1fr" : "1fr 1fr",gap:12, rowGap:16}}>
                 {previewForm.fields.length === 0 && <p style={{gridColumn:"1 / -1",fontSize:".85rem",color:"var(--mu)",fontStyle:"italic"}}>This form has no fields.</p>}
                 {previewForm.fields.map((f, idx) => {
                    const fKey = (f.dataKey || f.label)?.trim() || `Field ${idx + 1}`;
                    const spanFull = f.type === 'address' || f.type === 'file' || f.type === 'image' || f.type === 'fullname';
                    return (
                      <div key={idx} style={{gridColumn: (spanFull || mob) ? "1 / -1" : "auto", opacity: f.logicRules?.length ? 0.7 : 1}}>
                        <label style={{display:"block",fontSize:".75rem",fontWeight:600,color:"var(--mu)",marginBottom:4}}>
                          {f.label || fKey} {f.required&&<span style={{color:"red"}}>*</span>}
                          {f.logicRules?.length > 0 && <span style={{marginLeft:6,fontSize:".65rem",color:"#1A7A3E",background:"#E8F5E9",padding:"2px 4px",borderRadius:4}}>Conditional</span>}
                        </label>
                        {f.type === 'address' ? (
                          <textarea disabled placeholder="Address input..." style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem",minHeight:80,resize:"vertical",background:"white"}}/>
                        ) : f.type === 'dropdown' || f.type === 'gender' ? (
                          <select disabled style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem",background:"white"}}>
                            <option>-- Select --</option>
                          </select>
                        ) : f.type === 'fullname' ? (
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                            <input disabled placeholder="First" style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",background:"white",fontSize:".9rem"}}/>
                            <input disabled placeholder="Middle" style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",background:"white",fontSize:".9rem"}}/>
                            <input disabled placeholder="Last" style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",background:"white",fontSize:".9rem"}}/>
                          </div>
                        ) : f.type === 'image' || f.type === 'file' ? (
                          <div style={{padding:"10px",background:"#F5F5F5",borderRadius:8,border:"1px dashed var(--bd)",color:"var(--mu)",fontSize:".8rem",textAlign:"center"}}>
                            File Upload Area
                          </div>
                        ) : (
                          <input type={f.type} disabled placeholder={`${f.type} input...`} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",fontFamily:"inherit",fontSize:".9rem",background:"white"}}/>
                        )}
                      </div>
                    );
                 })}
                 <button disabled type="button" className="bs" style={{padding:"12px",borderRadius:8,fontWeight:700,marginTop:10}}>
                   Submit Registration
                 </button>
              </div>
            </div>
          </div>
        </div>
      )}
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


  const saveVerification = async (r, newStatus, newRemarks) => {
    const updatedBy = auth?.email || "Admin";
    setRegs(prev => prev.map(x => x.id === r.id ? { ...x, Status: newStatus, status: newStatus, Remarks: newRemarks, "Updated By": updatedBy } : x));
    try {
      const cleanData = { ...r, Status: newStatus, status: newStatus, Remarks: newRemarks, "Updated By": updatedBy };
      delete cleanData.id; delete cleanData._submittedAt;
      await fbUpdateRegistration(r.id, cleanData, auth?.idToken);
      // Removed setViewing(null) here so modal can handle auto-advance
    } catch (e) {
      alert("Failed to save verification: " + e.message);
      const d = await fbFetchRegistrations(auth?.idToken);
      setRegs(d || []);
    }
  };

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

// ── ADMIN ACHIEVEMENTS ───────────────────────────────────────────────────────
function AdminAchievements({ mob, C, setC, auth }) {
  const [items, setItems] = useState(C.achievements || []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null);

  useEffect(() => setItems(C.achievements || []), [C.achievements]);

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
    const newC = {...C, achievements: newItems};
    setC(newC);
    saveToFb(newC);
  };

  const addItem = () => {
    const newItem = { title: "New Achievement", desc: "", image: "" };
    upd([newItem, ...items]);
  };

  const updItem = (i, field, val) => {
    const newItems = [...items];
    newItems[i][field] = val;
    upd(newItems);
  };

  const remove = (i) => {
    if(confirm("Are you sure?")) {
      const newItems = [...items];
      newItems.splice(i, 1);
      upd(newItems);
    }
  };

  const move = (i, dir) => {
    if(i+dir < 0 || i+dir >= items.length) return;
    const newItems = [...items];
    const temp = newItems[i];
    newItems[i] = newItems[i+dir];
    newItems[i+dir] = temp;
    upd(newItems);
  };

  const uploadPhoto = async (e, i) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!auth?.idToken) { alert("Please login to upload media."); return; }
    setUploading(i);
    try {
      const url = await fbUploadPhoto(file, auth.idToken);
      updItem(i, "image", url);
    } catch (err) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div style={{padding:mob?16:32,background:"#F4F6F8",minHeight:"100%"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <h2 style={{fontSize:"1.4rem",color:"var(--dt)",margin:0}}>Achievements & Press Releases</h2>
        <div style={{display:"flex",gap:12}}>
          {saving && <span style={{color:"var(--sf)",fontSize:".9rem",display:"flex",alignItems:"center"}}>Saving...</span>}
          <button onClick={addItem} style={{background:"var(--dt)",color:"white",border:"none",padding:"10px 16px",borderRadius:8,cursor:"pointer",fontWeight:600}}>
            + Add Achievement
          </button>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {items.length===0 && <div style={{padding:40,textAlign:"center",background:"white",borderRadius:12,color:"#888"}}>No achievements yet.</div>}
        {items.map((a,i)=>(
          <div key={i} style={{background:"white",borderRadius:12,padding:mob?16:24,boxShadow:"0 2px 8px rgba(0,0,0,.04)",position:"relative"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,borderBottom:"1px solid #eee",paddingBottom:12}}>
              <span style={{fontWeight:600,color:"#555"}}>Item {i+1}</span>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>move(i,-1)} disabled={i===0} style={{padding:"4px 8px",cursor:i===0?"not-allowed":"pointer"}}>↑</button>
                <button onClick={()=>move(i,1)} disabled={i===items.length-1} style={{padding:"4px 8px",cursor:i===items.length-1?"not-allowed":"pointer"}}>↓</button>
                <button onClick={()=>remove(i)} style={{padding:"4px 8px",color:"red",cursor:"pointer"}}>✕</button>
              </div>
            </div>
            
            <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"200px 1fr",gap:20}}>
              <div>
                <label style={{display:"block",fontSize:".8rem",fontWeight:600,marginBottom:8,color:"#666"}}>Image</label>
                <div style={{width:"100%",aspectRatio:"4/3",background:"#f5f5f5",borderRadius:8,border:"1px dashed #ccc",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",cursor:"pointer"}} onClick={()=>document.getElementById(`ach_img_${i}`).click()}>
                  {a.image ? <img src={a.image} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <span style={{color:"#aaa"}}>{uploading===i?"Uploading...":"Click to Upload"}</span>}
                  <input type="file" id={`ach_img_${i}`} style={{display:"none"}} accept="image/*" onChange={(e)=>uploadPhoto(e,i)}/>
                </div>
              </div>
              
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <label style={{fontSize:".8rem",fontWeight:600,color:"#666"}}>Title (EN/GU)</label>
                    <button onClick={async()=>{
                      try {
                        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(a.title)}`);
                        if(!res.ok) throw new Error();
                        const data = await res.json();
                        updItem(i, "titleGu", data[0].map(x => x[0]).join(''));
                      } catch(err) { alert("Translation failed"); }
                    }} style={{padding:"2px 6px",fontSize:".7rem",cursor:"pointer"}}>Auto Translate</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:8}}>
                    <input style={{padding:8,border:"1px solid #ccc",borderRadius:4}} value={a.title||""} onChange={e=>updItem(i,"title",e.target.value)} placeholder="English Title"/>
                    <input style={{padding:8,border:"1px solid #ccc",borderRadius:4}} value={a.titleGu||""} onChange={e=>updItem(i,"titleGu",e.target.value)} placeholder="Gujarati Title"/>
                  </div>
                </div>

                <div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <label style={{fontSize:".8rem",fontWeight:600,color:"#666"}}>Description (EN/GU)</label>
                    <button onClick={async()=>{
                      if(!a.desc) return;
                      try {
                        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(a.desc)}`);
                        if(!res.ok) throw new Error();
                        const data = await res.json();
                        updItem(i, "descGu", data[0].map(x => x[0]).join(''));
                      } catch(err) { alert("Translation failed"); }
                    }} style={{padding:"2px 6px",fontSize:".7rem",cursor:"pointer"}}>Auto Translate</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:8}}>
                    <textarea style={{padding:8,border:"1px solid #ccc",borderRadius:4,minHeight:60,resize:"vertical"}} value={a.desc||""} onChange={e=>updItem(i,"desc",e.target.value)} placeholder="English Description"/>
                    <textarea style={{padding:8,border:"1px solid #ccc",borderRadius:4,minHeight:60,resize:"vertical"}} value={a.descGu||""} onChange={e=>updItem(i,"descGu",e.target.value)} placeholder="Gujarati Description"/>
                  </div>
                </div>
              </div>
            </div>
            
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ADMIN TEAM ────────────────────────────────────────────────────────────────
function AdminTeam({ mob, C, setC, auth }) {
  const [items, setItems] = useState(C.teamItems || []);
  const [layout, setLayout] = useState(C.teamLayout || "plain");
  const [saving, setSaving] = useState(false);
  const [activeNode, setActiveNode] = useState(null); // For editing details
  const [menuNode, setMenuNode] = useState(null); // For Add actions
  const [uploadingImage, setUploadingImage] = useState(false);
  const [allUsers, setAllUsers] = useState([]);

  useEffect(() => {
    if (auth?.idToken) {
      fbFetchAllUsers(auth.idToken).then(u => setAllUsers(u || [])).catch(console.error);
    }
  }, [auth]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!auth?.idToken) { alert("Please login to upload media."); return; }
    setUploadingImage(true);
    try {
      const url = await fbUploadPhoto(file, auth.idToken);
      updateActiveNode("image", url);
    } catch (err) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSelectUser = (e) => {
    const uid = e.target.value;
    if (!uid) return;
    const u = allUsers.find(x => x.id === uid);
    if (u) {
      const updates = {};
      
      const fetchedName = u.name || u.Name || u['Full Name'] || u.displayName || u.firstName || "";
      if (fetchedName) updates.name = fetchedName;
      
      const fetchedPhoto = u.photo || u.photoUrl || u.image || u.picture || u.profilePhoto || u.Photo || "";
      if (fetchedPhoto) updates.image = fetchedPhoto;
      
      if (u.position || u.Position) updates.position = u.position || u.Position;
      
      const details = [];
      const mob = u.mobile || u.Mobile || u['Mobile Number'] || u.phone || u.Phone;
      if (mob) details.push(`Mobile: ${mob}`);
      
      const eml = u.email || u.Email;
      if (eml) details.push(`Email: ${eml}`);
      
      const add = u.address || u.Address;
      if (add) details.push(`Address: ${add}`);
      
      const dob = u.dob || u.DOB || u['Date of Birth'];
      if (dob) details.push(`DOB: ${dob}`);
      
      const gen = u.gender || u.Gender;
      if (gen) details.push(`Gender: ${gen}`);
      
      const reg = u.registrationNo || u.RegistrationNo || u['Registration Number'];
      if (reg) details.push(`Reg No: ${reg}`);
      
      if (details.length > 0) updates.desc = details.join(' | ');

      setActiveNode(prev => ({ ...prev, ...updates }));

      e.target.value = "";
    }
  };

  // Sync state if C changes
  useEffect(() => {
    setItems(C.teamItems || []);
    setLayout(C.teamLayout || "plain");
  }, [C.teamItems, C.teamLayout]);

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

  const updItems = (newItems) => {
    setItems(newItems);
    const newC = {...C, teamItems: newItems};
    setC(newC);
    saveToFb(newC);
  };

  const updLayout = (l) => {
    setLayout(l);
    const newC = {...C, teamLayout: l};
    setC(newC);
    saveToFb(newC);
  };

  const getNewId = () => "team_" + Date.now() + Math.floor(Math.random()*1000);

  // Hierarchy actions
  const addRoot = () => {
    const root = { id: getNewId(), parentId: null, name: "New Member", position: "Role", desc: "", image: "", order: 0 };
    updItems([...items, root]);
  };

  const addBoss = (node) => {
    const newBossId = getNewId();
    const newBoss = { id: newBossId, parentId: node.parentId, name: "New Boss", position: "Role", desc: "", image: "", order: node.order };
    
    // All siblings (including node itself) become children of newBoss
    const updatedItems = items.map(i => {
      if(i.parentId === node.parentId) return { ...i, parentId: newBossId };
      return i;
    });
    
    updItems([...updatedItems, newBoss]);
    setMenuNode(null);
  };

  const addSubordinate = (node) => {
    const children = items.filter(i => i.parentId === node.id);
    const order = children.length > 0 ? Math.max(...children.map(c=>c.order||0)) + 1 : 0;
    const child = { id: getNewId(), parentId: node.id, name: "New Member", position: "Role", desc: "", image: "", order };
    updItems([...items, child]);
    setMenuNode(null);
  };

  const addSibling = (node, dir) => {
    // dir: -1 (left), 1 (right)
    const newSibling = { id: getNewId(), parentId: node.parentId, name: "New Member", position: "Role", desc: "", image: "", order: node.order + dir * 0.5 };
    updItems([...items, newSibling]);
    setMenuNode(null);
  };

  const removeNode = (id) => {
    if(!window.confirm("Delete this member? Any subordinates will also be deleted.")) return;
    
    const getDescendants = (pid) => {
      let desc = items.filter(i => i.parentId === pid).map(i => i.id);
      let all = [...desc];
      desc.forEach(d => all.push(...getDescendants(d)));
      return all;
    };
    
    const toRemove = [id, ...getDescendants(id)];
    updItems(items.filter(i => !toRemove.includes(i.id)));
    setMenuNode(null);
  };

  const updateActiveNode = (field, val) => {
    setActiveNode(prev => {
      const nextNode = { ...prev, [field]: val };
      // Also update local items array to reflect change immediately
      setItems(currItems => currItems.map(i => i.id === prev.id ? nextNode : i));
      return nextNode;
    });
  };

  const flushNodeUpdate = () => {
    setActiveNode(currActive => {
      if (!currActive) return null;
      setItems(currItems => {
        const newItems = currItems.map(it => it.id === currActive.id ? currActive : it);
        
        setC(currC => {
          const newC = { ...currC, teamItems: newItems };
          saveToFb(newC);
          return newC;
        });
        
        return newItems;
      });
      return null;
    });
  };

  // Plain layout actions
  const addPlain = () => {
    const newItem = { id: getNewId(), parentId: "plain", name: "New Member", position: "Role", desc: "", image: "", order: items.length };
    updItems([...items, newItem]);
  };

  const movePlain = (index, dir) => {
    let arr = [...items];
    const temp = arr[index];
    arr[index] = arr[index + dir];
    arr[index + dir] = temp;
    arr = arr.map((x,i)=>({...x, order:i}));
    updItems(arr);
  };

  const removePlain = (index) => {
    if(!window.confirm("Delete this member?")) return;
    let arr = [...items];
    arr.splice(index, 1);
    updItems(arr);
  };

  // Hierarchy Renderer component (recursive)
  const renderTree = (parentId = null) => {
    let children = items.filter(i => i.parentId === parentId);
    children.sort((a,b) => (a.order||0) - (b.order||0));
    
    if(children.length === 0) return null;

    return (
      <div style={{display:"flex", gap: "20px", justifyContent:"center", paddingTop: parentId ? 20 : 0, position:"relative"}}>
        {children.map((node, i) => (
          <div key={node.id} style={{display:"flex", flexDirection:"column", alignItems:"center", position:"relative"}}>
            {/* Connecting lines for children */}
            {parentId && (
              <>
                <div style={{position:"absolute", top: 0, left: "50%", width: 2, height: 20, background: "#ccc", transform:"translateX(-50%)"}} />
                {children.length > 1 && (
                  <div style={{
                    position:"absolute", top: 0, height: 2, background: "#ccc",
                    left: i === 0 ? "50%" : 0,
                    right: i === children.length - 1 ? "50%" : 0,
                    width: i === 0 || i === children.length - 1 ? "50%" : "100%"
                  }} />
                )}
              </>
            )}
            
            {/* The Node */}
            <div style={{marginTop: parentId ? 20 : 0, position:"relative"}}>
              {/* Parent connector */}
              {items.find(x=>x.parentId===node.id) && (
                <div style={{position:"absolute", bottom: -20, left: "50%", width: 2, height: 20, background: "#ccc", transform:"translateX(-50%)"}} />
              )}
              
              <div style={{
                background:"white", padding: 10, borderRadius: 8, border: "2px solid var(--bd)", 
                width: 160, textAlign:"center", boxShadow:"0 4px 12px rgba(0,0,0,0.05)",
                cursor:"pointer", position:"relative"
              }} onClick={() => setActiveNode(node)}>
                {node.image ? (
                  <img src={node.image} alt="" style={{width:50, height:50, borderRadius:"50%", objectFit:"cover", marginBottom:8, border:"2px solid #eee"}}/>
                ) : (
                  <div style={{width:50, height:50, borderRadius:"50%", background:"#f5f5f5", display:"inline-flex", alignItems:"center", justifyContent:"center", marginBottom:8, fontSize:"1.2rem"}}>👤</div>
                )}
                <div style={{fontWeight:700, fontSize:".85rem", color:"var(--dt)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{node.name || "Name"}</div>
                <div style={{fontSize:".7rem", color:"var(--sf)"}}>{node.position || "Position"}</div>
                
                {/* Plus button to open menu */}
                <button onClick={(e)=>{e.stopPropagation(); setMenuNode(node);}} style={{
                  position:"absolute", bottom: -12, right: -12, width: 24, height: 24, borderRadius:"50%", 
                  background:"var(--dt)", color:"white", border:"2px solid white", cursor:"pointer",
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1rem", zIndex:10
                }}>+</button>
              </div>

              {/* Action Menu Context */}
              {menuNode?.id === node.id && (
                <div style={{position:"absolute", top: "100%", left: "50%", transform:"translate(-50%, 15px)", background:"white", borderRadius:8, boxShadow:"0 10px 30px rgba(0,0,0,.2)", zIndex:100, width: 160, padding: 8, border:"1px solid #eee"}}>
                  <div style={{fontSize:".7rem", color:"#888", marginBottom:6, textAlign:"center", fontWeight:600}}>ADD RELATIVE</div>
                  <button onClick={()=>addBoss(node)} className="gi" style={{display:"block", width:"100%", padding:"6px", fontSize:".75rem", background:"#f9f9f9", border:"none", borderRadius:4, marginBottom:4, cursor:"pointer"}}>⬆️ Add Boss (Above)</button>
                  <button onClick={()=>addSibling(node, -1)} className="gi" style={{display:"block", width:"100%", padding:"6px", fontSize:".75rem", background:"#f9f9f9", border:"none", borderRadius:4, marginBottom:4, cursor:"pointer"}}>⬅️ Add Sibling (Left)</button>
                  <button onClick={()=>addSibling(node, 1)} className="gi" style={{display:"block", width:"100%", padding:"6px", fontSize:".75rem", background:"#f9f9f9", border:"none", borderRadius:4, marginBottom:4, cursor:"pointer"}}>➡️ Add Sibling (Right)</button>
                  <button onClick={()=>addSubordinate(node)} className="gi" style={{display:"block", width:"100%", padding:"6px", fontSize:".75rem", background:"#f9f9f9", border:"none", borderRadius:4, marginBottom:4, cursor:"pointer"}}>⬇️ Add Subordinate</button>
                  <div style={{height:1, background:"#eee", margin:"6px 0"}}/>
                  <button onClick={()=>removeNode(node.id)} style={{display:"block", width:"100%", padding:"6px", fontSize:".75rem", background:"#FFF0F0", color:"#D32F2F", border:"none", borderRadius:4, cursor:"pointer"}}>🗑️ Delete Node</button>
                  <button onClick={()=>setMenuNode(null)} style={{display:"block", width:"100%", padding:"6px", fontSize:".75rem", background:"transparent", border:"none", marginTop:4, cursor:"pointer", color:"#666"}}>Cancel</button>
                </div>
              )}
            </div>

            {/* Recursively render children */}
            <div style={{marginTop: 20}}>
              {renderTree(node.id)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{padding:mob?16:32, maxWidth:1200, margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,flexWrap:"wrap",gap:16}}>
        <div>
          <h2 style={{fontSize:"1.8rem",color:"var(--dt)",fontFamily:"'Playfair Display',serif",fontWeight:700,margin:0}}>Our Team Manager</h2>
          <p style={{color:"var(--mu)",fontSize:".9rem",marginTop:4}}>Manage your team structure and profiles.</p>
        </div>
        <div style={{display:"flex",gap:10,background:"#fff",padding:4,borderRadius:12,boxShadow:"0 4px 12px rgba(0,0,0,.05)"}}>
          <button onClick={()=>updLayout("plain")} style={{padding:"8px 16px",borderRadius:8,border:"none",background:layout==="plain"?"var(--sf)":"transparent",color:layout==="plain"?"white":"var(--mu)",fontWeight:600,cursor:"pointer",transition:"all .2s"}}>Plain Layout</button>
          <button onClick={()=>updLayout("hierarchy")} style={{padding:"8px 16px",borderRadius:8,border:"none",background:layout==="hierarchy"?"var(--dt)":"transparent",color:layout==="hierarchy"?"white":"var(--mu)",fontWeight:600,cursor:"pointer",transition:"all .2s"}}>Hierarchy (Org Chart)</button>
        </div>
      </div>

      {layout === "hierarchy" ? (
        <div style={{background:"white",borderRadius:24,padding:32,boxShadow:"0 12px 40px rgba(0,0,0,0.04)", overflowX:"auto", minHeight: 400}}>
          {items.filter(i => i.parentId === null).length === 0 ? (
            <div style={{textAlign:"center", padding: 60}}>
              <div style={{fontSize:"3rem", marginBottom:16}}>🌳</div>
              <h3 style={{color:"var(--dt)", marginBottom:16}}>Your Org Chart is Empty</h3>
              <p style={{color:"var(--sf)", marginBottom:24}}>Start building your hierarchy by adding a top leader. Members created in Plain Layout can be recreated here using Auto-Fill.</p>
              <button className="btn-primary" onClick={addRoot} style={{padding:"12px 24px"}}>Add Top Leader</button>
            </div>
          ) : (
            <div style={{minWidth: 800, paddingBottom: 60}}>
              {renderTree(null)}
            </div>
          )}
        </div>
      ) : (
        <div style={{background:"white",borderRadius:24,padding:mob?16:32,boxShadow:"0 12px 40px rgba(0,0,0,0.04)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <h3 style={{color:"var(--dt)",margin:0}}>Team Members</h3>
            <button className="btn-primary" onClick={addPlain} style={{padding:"8px 16px",borderRadius:8}}>+ Add Member</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {items.filter(i => i.parentId === "plain" || typeof i.parentId === "undefined").sort((a,b)=>(a.order||0)-(b.order||0)).map((item, i) => (
              <div key={item.id} style={{display:"flex",gap:16,padding:16,border:"1px solid var(--bd)",borderRadius:16,background:"#fafafa",alignItems:"center",flexWrap:"wrap"}}>
                <div style={{width:60,height:60,borderRadius:"50%",background:"#eee",overflow:"hidden",flexShrink:0}}>
                  {item.image ? <img src={item.image} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.5rem"}}>👤</div>}
                </div>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{fontWeight:700,color:"var(--dt)",fontSize:"1.1rem"}}>{item.name || "No Name"}</div>
                  <div style={{color:"var(--sf)",fontSize:".85rem",fontWeight:600}}>{item.position || "No Position"}</div>
                  <div style={{color:"var(--tm)",fontSize:".8rem",marginTop:4}}>{item.desc || "No Description"}</div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setActiveNode(item)} style={{padding:"6px 12px",borderRadius:6,border:"1px solid var(--sf)",background:"white",color:"var(--sf)",cursor:"pointer",fontWeight:600}}>Edit</button>
                  <button onClick={()=>movePlain(i,-1)} disabled={i===0} style={{padding:"6px 12px",borderRadius:6,border:"1px solid var(--bd)",background:"white",cursor:i===0?"not-allowed":"pointer"}}>↑</button>
                  <button onClick={()=>movePlain(i,1)} disabled={i===items.length-1} style={{padding:"6px 12px",borderRadius:6,border:"1px solid var(--bd)",background:"white",cursor:i===items.length-1?"not-allowed":"pointer"}}>↓</button>
                  <button onClick={()=>removePlain(i)} style={{padding:"6px 12px",borderRadius:6,border:"none",background:"#FFF0F0",color:"#D32F2F",cursor:"pointer"}}>Delete</button>
                </div>
              </div>
            ))}
            {items.length===0 && <div style={{padding:40,textAlign:"center",color:"#888"}}>No team members yet.</div>}
          </div>
        </div>
      )}

      {/* Edit Node Modal */}
      {activeNode && (
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"white",width:"100%",maxWidth:500,borderRadius:24,padding:32,position:"relative",boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <button onClick={flushNodeUpdate} style={{position:"absolute",top:16,right:16,background:"none",border:"none",fontSize:"1.5rem",cursor:"pointer",color:"#888"}}>✕</button>
            <h3 style={{marginTop:0,marginBottom:24,color:"var(--dt)"}}>Edit Team Member</h3>
            
            <div style={{marginBottom:24, paddingBottom:20, borderBottom:"1px solid #eee"}}>
              <label style={{display:"block",fontSize:".75rem",fontWeight:700,color:"var(--sf)",marginBottom:6}}>⚡ AUTO-FILL FROM REGISTERED USER</label>
              <select onChange={handleSelectUser} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem",background:"#fafafa",cursor:"pointer"}}>
                <option value="">-- Select a User to auto-fill details --</option>
                {allUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name || u.email || u.id}</option>
                ))}
              </select>
            </div>

            <div style={{display:"flex",gap:16,marginBottom:20}}>
              <div style={{width:80,height:80,borderRadius:"50%",background:"#f5f5f5",overflow:"hidden",position:"relative",flexShrink:0}}>
                {activeNode.image ? <img src={activeNode.image} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"2rem"}}>👤</div>}
              </div>
              <div style={{flex:1, minWidth:0}}>
                <label style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:".75rem",fontWeight:700,color:"var(--mu)",marginBottom:4}}>
                  <span>PHOTO URL</span>
                  <label style={{cursor:"pointer",color:"var(--dt)",textDecoration:"underline",fontWeight:700}}>
                    {uploadingImage ? "Uploading..." : "Click to Upload Photo"}
                    <input type="file" style={{display:"none"}} accept="image/*" onChange={handlePhotoUpload} disabled={uploadingImage}/>
                  </label>
                </label>
                <input type="text" value={activeNode.image} onChange={e=>updateActiveNode("image", e.target.value)} style={{width:"100%",padding:10,borderRadius:8,border:"1px solid var(--bd)",fontSize:".9rem"}} placeholder="https://..."/>
              </div>
            </div>

            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:".75rem",fontWeight:700,color:"var(--mu)",marginBottom:4}}>NAME</label>
              <input type="text" value={activeNode.name} onChange={e=>updateActiveNode("name", e.target.value)} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem"}}/>
            </div>
            
            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:".75rem",fontWeight:700,color:"var(--mu)",marginBottom:4}}>POSITION / TITLE</label>
              <input type="text" value={activeNode.position} onChange={e=>updateActiveNode("position", e.target.value)} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem"}}/>
            </div>

            <div style={{marginBottom:24}}>
              <label style={{display:"block",fontSize:".75rem",fontWeight:700,color:"var(--mu)",marginBottom:4}}>SHORT DESCRIPTION</label>
              <textarea value={activeNode.desc} onChange={e=>updateActiveNode("desc", e.target.value)} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem",minHeight:80,resize:"vertical"}}/>
            </div>

            <button onClick={flushNodeUpdate} className="btn-primary" style={{width:"100%",padding:14,borderRadius:12,fontSize:"1rem"}}>Save Changes</button>
          </div>
        </div>
      )}

      {saving && <div style={{position:"fixed",bottom:20,right:20,background:"#333",color:"white",padding:"10px 20px",borderRadius:20,fontSize:".8rem",fontWeight:600}}>Saving...</div>}
    </div>
  );
}


function AdminGallery({ mob, C, setC, auth }) {
  const [loading, setLoading] = useState(false);
  const [bulkTag, setBulkTag] = useState("");
  const [selected, setSelected] = useState([]);
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
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (!auth?.idToken) { alert("Please login to upload media."); return; }
    setLoading(true);
    try {
      const newUploads = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const url = await fbUploadPhoto(file, auth.idToken);
        const isVideo = file.type.startsWith("video/");
        newUploads.push({
          id: Date.now().toString() + "-" + i,
          url,
          title: isVideo ? "New Video" : "New Photo",
          category: bulkTag.trim() || "General",
          type: isVideo ? "video" : "image"
        });
      }
      upd([...newUploads, ...items]);
    } catch(err) {
      alert("Upload failed: " + err.message);
    } finally {
      setLoading(false);
      e.target.value = null;
    }
  };

  const remove = (id) => {
    if (!window.confirm("Delete this photo?")) return;
    upd(items.filter(g => g.id !== id));
  };

  const move = (idx, dir) => {
    const to = idx + dir;
    if (to < 0 || to >= items.length) return;
    const newItems = [...items];
    [newItems[idx], newItems[to]] = [newItems[to], newItems[idx]];
    upd(newItems);
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
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:16}}>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={() => upd([...items].sort((a,b) => (a.category||"").localeCompare(b.category||"")))} style={{padding:"8px 14px",borderRadius:8,border:"1px solid var(--bd)",background:"white",cursor:"pointer",fontSize:".8rem",fontWeight:600,color:"var(--dt)"}}>Sort by Category</button>
          <input type="text" list="gallery-categories" value={bulkTag} onChange={e=>setBulkTag(e.target.value)} placeholder="Tag for uploads or selected..." style={{padding:"8px 11px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".8rem",fontFamily:"inherit",width:220}}/>
          {selected.length > 0 && (
            <button onClick={() => {
              if (!bulkTag.trim()) return alert("Please enter a tag in the box first!");
              const newItems = items.map(g => selected.includes(g.id) ? {...g, category: bulkTag.trim()} : g);
              upd(newItems);
              setSelected([]);
            }} style={{padding:"8px 14px",borderRadius:8,background:"var(--sf)",color:"white",border:"none",cursor:"pointer",fontSize:".8rem",fontWeight:600}}>
              Apply Tag to {selected.length} Selected
            </button>
          )}
        </div>
        <label className="bs" style={{padding:"8px 14px",borderRadius:8,fontWeight:600,fontSize:".8rem",cursor:"pointer",opacity:loading?0.5:1}}>
          {loading ? "Uploading..." : "Upload Media"}
          <input type="file" multiple accept="image/*,video/*" style={{display:"none"}} onChange={uploadPhoto} disabled={loading}/>
        </label>
      </div>
      <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":"repeat(3,1fr)",gap:14}}>
        {items.map((g, i)=>(
          <div key={g.id} className="ac" style={{overflow:"hidden",padding:0,position:"relative",border:selected.includes(g.id)?"2px solid var(--sf)":""}}>
            <input type="checkbox" checked={selected.includes(g.id)} onChange={e => {
              if (e.target.checked) setSelected([...selected, g.id]);
              else setSelected(selected.filter(id => id !== g.id));
            }} style={{position:"absolute",top:8,left:8,width:20,height:20,cursor:"pointer",zIndex:10}}/>
            {g.type === 'video' ? (
              <video src={g.url} style={{width:"100%", height:140, objectFit:"cover", display:"block"}} muted playsInline preload="metadata" />
            ) : (
              <div style={{height:140,background:"#eee",backgroundImage:`url(${g.url})`,backgroundSize:"cover",backgroundPosition:"center"}}/>
            )}
            <div style={{padding:"12px"}}>
              <input type="text" value={g.title} onChange={e=>updateItem(g.id,"title",e.target.value)} placeholder="Photo Title" style={{width:"100%",padding:"4px 8px",marginBottom:6,border:"1px solid var(--bd)",borderRadius:6,fontSize:".82rem",fontFamily:"inherit"}}/>
              <input type="text" list="gallery-categories" value={g.category} onChange={e=>updateItem(g.id,"category",e.target.value)} placeholder="Category (e.g. Events)" style={{width:"100%",padding:"4px 8px",marginBottom:10,border:"1px solid var(--bd)",borderRadius:6,fontSize:".75rem",fontFamily:"inherit",color:"var(--mu)"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",gap:4}}>
                  <button onClick={()=>move(i, -1)} disabled={i===0} style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--bd)",background:i===0?"#f5f5f5":"white",cursor:i===0?"not-allowed":"pointer",color:i===0?"#ccc":"var(--dt)",fontSize:".8rem"}}>←</button>
                  <button onClick={()=>move(i, 1)} disabled={i===items.length-1} style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--bd)",background:i===items.length-1?"#f5f5f5":"white",cursor:i===items.length-1?"not-allowed":"pointer",color:i===items.length-1?"#ccc":"var(--dt)",fontSize:".8rem"}}>→</button>
                </div>
                <button onClick={()=>remove(g.id)} style={{padding:"4px 9px",borderRadius:6,background:"#FEF0EF",border:"none",color:"#C0392B",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>Delete</button>
              </div>
            </div>
          </div>
        ))}
        <label style={{border:"2px dashed var(--bd)",borderRadius:12,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:180,cursor:"pointer",color:"var(--mu)",gap:7,transition:"all .2s",opacity:loading?0.5:1}} onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--sf)";e.currentTarget.style.color="var(--sf)"}} onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd)";e.currentTarget.style.color="var(--mu)"}}>
          <span style={{fontSize:"1.8rem"}}>📤</span><span style={{fontSize:".82rem",fontWeight:600}}>Bulk Upload Media</span>
          <input type="file" multiple accept="image/*,video/*" style={{display:"none"}} onChange={uploadPhoto} disabled={loading}/>
        </label>
      </div>
    </div>
  );
}


// ── PAYMENT SETTINGS ────────────────────────────────────────────────────────
function PaymentSettings({ mob, C, setC, auth }) {
  const getDraft = (C) => {
    const d = JSON.parse(JSON.stringify(C));
    if(!d.donate) d.donate = {};
    if(!d.donate.programs) d.donate.programs = ["General","Education","Healthcare","Women","Environment","Relief"];
    return d;
  };
  const [draft, setDraft] = useState(()=>getDraft(C));
  const [toast, setToast] = useState(null);
  const [toastMsg, setToastMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(()=>{ setDraft(getDraft(C)); },[C]);

  const showToast = (type, msg) => { setToast(type); setToastMsg(msg); setTimeout(()=>setToast(null),3500); };

  const save = async () => {
    const saved = JSON.parse(JSON.stringify(draft));
    setC(saved); 
    if (!auth?.idToken) { showToast("warn","Changes applied locally. Login to save."); return; }
    showToast("saving","Saving changes...");
    try {
      await fbSave(saved, auth.idToken);
      showToast("saved","Payment settings saved securely!");
    } catch(e) {
      showToast("error", e.message || "Save failed.");
    }
  };

  const upd = (path, value) => {
    setDraft(prev=>{
      try {
        const n = JSON.parse(JSON.stringify(prev));
        let obj = n; const parts = path.split('.');
        for(let i=0;i<parts.length-1;i++) obj = obj[parts[i]];
        obj[parts[parts.length-1]] = value;
        return n;
      } catch(e){return prev;}
    });
  };
  const gv = (path) => {
    try {
      let obj = draft; const parts = path.split('.');
      for(let p of parts) { if(obj===undefined)return ""; obj=obj[p]; }
      return obj;
    } catch(e){return "";}
  };
  const moveItem = (path, i, dir) => {
    setDraft(prev=>{
      const n = JSON.parse(JSON.stringify(prev));
      let obj = n; const parts = path.split('.');
      for(let p of parts) obj = obj[p];
      if(i+dir<0 || i+dir>=obj.length) return prev;
      const t = obj[i]; obj[i] = obj[i+dir]; obj[i+dir] = t;
      return n;
    });
  };
  const delItem = (path, i) => {
    if(!window.confirm("Delete this item?")) return;
    setDraft(prev=>{
      const n = JSON.parse(JSON.stringify(prev));
      let obj = n; const parts = path.split('.');
      for(let p of parts) obj = obj[p];
      obj.splice(i,1);
      return n;
    });
  };
  const addItem = (path, def) => {
    setDraft(prev=>{
      const n = JSON.parse(JSON.stringify(prev));
      let obj = n; const parts = path.split('.');
      for(let p of parts) obj = obj[p];
      obj.push(typeof def==='object'?JSON.parse(JSON.stringify(def)):def);
      return n;
    });
  };
  const [exp, setExp] = useState({});

  return (
    <EditorContext.Provider value={{ draft, gv, upd, moveItem, delItem, addItem, mob, exp, setExp }}>
      <div style={{background:"white", borderRadius:16, padding:mob?16:32, boxShadow:"0 4px 20px rgba(0,0,0,0.05)", position:"relative", marginBottom:32, border:"1px solid var(--bd)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,flexWrap:"wrap",gap:16}}>
          <div>
            <h2 style={{fontFamily:"'Playfair Display',serif",color:"#C0392B",margin:0,fontSize:"1.6rem"}}>Secure Payment Configuration</h2>
            <p style={{color:"var(--mu)",fontSize:".9rem",marginTop:4}}>Manage Razorpay API keys and Receipt Templates. Restricted access.</p>
          </div>
          <button onClick={save} className="bt" style={{padding:"12px 24px",borderRadius:12,fontWeight:700,fontSize:"1.05rem",boxShadow:"0 4px 16px rgba(170,59,255,0.3)"}}>
            {toast==="saving" ? "Saving..." : "Save Payment Settings"}
          </button>
        </div>
        
        {toast && (
          <div style={{padding:"12px 20px",borderRadius:8,marginBottom:20,fontWeight:600,fontSize:".9rem",
            background:toast==="error"?"#FEF0EF":toast==="warn"?"#FFF8E1":"#E8F5E9",
            color:toast==="error"?"#C0392B":toast==="warn"?"#F57F17":"#2E7D32",border:`1px solid ${toast==="error"?"#F5B8B8":toast==="warn"?"#FFE082":"#A5D6A7"}`}}>
            {toastMsg}
          </div>
        )}

      <Sec id="donate" icon="❤️" label="Donation Section">
        <F label="Section Heading" path="donate.heading"/>
        <F label="Subtext" path="donate.subtext" ta/>
        <F label="Security Note" path="donate.note"/>
        <F label="Recurring Toggle Label" path="donate.recurringLabel"/>
        <F label="Recurring Note" path="donate.recurringNote"/>
        <F label="Razorpay API Key ID (Live or Test)" path="donate.razorpayKey"/>
        
        <div className="cf">
          <label className="cl">Donation Program Categories</label>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
            {(draft.donate.programs || []).map((pt,i)=>(
              <div key={i} style={{display:"flex",gap:6}}>
                <BlurInput className="ci" style={{flex:1,marginBottom:0}} value={pt} onCommit={v=>upd(`donate.programs.${i}`,v)}/>
                <button type="button" onClick={()=>moveItem("donate.programs",i,-1)} disabled={i===0}
                  style={{padding:"8px 10px",borderRadius:6,border:"1px solid var(--bd)",background:i===0?"#f5f5f5":"white",cursor:i===0?"not-allowed":"pointer",fontSize:".8rem",color:i===0?"#ccc":"var(--dt)",flexShrink:0}}>↑</button>
                <button type="button" onClick={()=>moveItem("donate.programs",i,1)} disabled={i===(draft.donate.programs||[]).length-1}
                  style={{padding:"8px 10px",borderRadius:6,border:"1px solid var(--bd)",background:i===(draft.donate.programs||[]).length-1?"#f5f5f5":"white",cursor:i===(draft.donate.programs||[]).length-1?"not-allowed":"pointer",fontSize:".8rem",color:i===(draft.donate.programs||[]).length-1?"#ccc":"var(--dt)",flexShrink:0}}>↓</button>
                <button type="button" onClick={()=>delItem("donate.programs",i)}
                  style={{padding:"8px 10px",borderRadius:6,border:"1px solid #F5B8B8",background:"#FEF0EF",color:"#C0392B",cursor:"pointer",fontSize:".8rem",flexShrink:0}}>✕</button>
              </div>
            ))}
          </div>
          <AddBtn label="Program Category" onClick={()=>addItem("donate.programs","New Category")}/>
        </div>

      </Sec>
      
      <div style={{background:"white", borderRadius:12, border:"1px solid var(--bd)", padding:20, marginBottom:32, boxShadow:"0 4px 16px rgba(0,0,0,0.05)"}}>
        <h3 style={{fontFamily:"'Playfair Display',serif",fontWeight:700,color:"var(--dt)",fontSize:"1.2rem",marginTop:0,marginBottom:16}}>Receipt Template Builder</h3>
        
        <div className="cf" style={{marginBottom: 24}}>
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
              {draft.donate.receiptTemplate && (
                <button type="button" onClick={() => upd("donate.receiptTemplate", null)} style={{padding:"7px 14px",borderRadius:8,border:"1px solid #F5B8B8",background:"#FEF0EF",color:"#C0392B",cursor:"pointer",fontSize:".78rem",fontWeight:700}}>Remove Template</button>
              )}
            </div>
            <span style={{fontSize:".75rem",color:"var(--mu)"}}>Upload a blank PNG/JPG template. Text will be overlaid automatically.</span>
          </div>
        </div>

        {draft.donate.receiptTemplate && (
          <>
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
          </>
        )}
      </div>

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


      </div>
    </EditorContext.Provider>
  );
}

function Settings({ mob, C, setC, auth, setPage, hasAccess, master }) {
  const [theme, setTheme] = useState(C.theme || "classic");
  const [saving, setSaving] = useState(false);

  const handleSaveTheme = async () => {
    setSaving(true);
    const newC = { ...C, theme };
    setC(newC);
    if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && window.FIREBASE_CONFIG.apiKey.trim().length > 0 && window.FIREBASE_CONFIG.apiKey.trim() !== "1") {
      await fbSave(newC, auth?.idToken).catch(e => alert(e.message));
    }
    setSaving(false);
    alert("Theme updated successfully!");
  };

  return (
    <>
      <PaymentSettings mob={mob} C={C} setC={setC} auth={auth} />
      <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:16}}>
      <div className="ac" style={{padding:mob?"16px":"22px",gridColumn:mob?"1":"1 / -1"}}>
        <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:".95rem",color:"var(--dt)",marginBottom:14,fontWeight:700}}>🎨 Theme Selection</h3>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:".72rem",fontWeight:600,color:"var(--mu)",display:"block",marginBottom:4}}>Active Theme</label>
          <select value={theme} onChange={e=>setTheme(e.target.value)} style={{width:"100%",padding:"8px 11px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".82rem",fontFamily:"inherit",background:"white"}}>
            <option value="classic">Classic (Teal & Orange)</option>
            <option value="ocean">Ocean (Navy & Coral)</option>
            <option value="forest">Forest (Emerald & Gold)</option>
            <option value="3d">Glossy 3D (Purple & Cyan)</option>
          </select>
        </div>
        <button onClick={handleSaveTheme} disabled={saving} className="bt" style={{padding:"7px 14px",borderRadius:8,fontWeight:600,fontSize:".8rem",marginTop:6}}>
          {saving ? "Saving..." : "Apply Theme"}
        </button>
      </div>
    </div>
    
      {master && (
        <div style={{marginTop: 40}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",color:"#C0392B",margin:0,fontSize:"1.6rem",marginBottom: 20}}>Master Content Editor</h2>
          <ContentEditor C={C} setC={setC} setPage={setPage} auth={auth} hasAccess={hasAccess} master={true} />
        </div>
      )}
</>
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
    if (id === "admin_login") {
      onShowLogin();
      return;
    }
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

  const SectionDivider = () => (
    <div style={{width:"100%", display:"flex", justifyContent:"center", alignItems:"center", padding:"0", margin:"-1px 0", position:"relative", zIndex:2, pointerEvents:"none"}}>
      <div style={{width:"70%", maxWidth:400, height:2, background:"linear-gradient(90deg, transparent, #D4AF37, transparent)", opacity:0.8, position:"relative", display:"flex", justifyContent:"center", alignItems:"center"}}>
        <div style={{width:10, height:10, background:"#D4AF37", transform:"rotate(45deg)", border:"2px solid var(--ww)", borderRadius:2}} />
      </div>
    </div>
  );

  return (
    <div>
      <Navbar C={C} lang={lang} setLang={setLang} setPage={setPage} auth={auth} onShowLogin={onShowLogin} globalProfile={globalProfile} onPublicLogout={handlePublicLogout} onShowDashboard={()=>setShowDashboard(true)} onShowUserLogin={()=>setShowUserLogin("nav")} onHomeClick={()=>setViewPolicy(null)}/>
      {viewPolicy ? <PolicyPage type={viewPolicy} C={C}/> : (
        <>
          <Hero C={C} lang={lang}/>
          <SectionDivider/>
          {bs.about    !== false && <><About C={C} lang={lang}/><SectionDivider/></>}
          {bs.programs !== false && <><Programs C={C} lang={lang}/><SectionDivider/></>}
          {bs.achievements !== false && <><Achievements C={C} lang={lang}/><SectionDivider/></>}
          {bs.team !== false && <><Team C={C} lang={lang}/><SectionDivider/></>}
          {bs.gallery  !== false && <><Gallery C={C}/><SectionDivider/></>}
          {bs.events   !== false && <><Events C={C} lang={lang} globalAuthToken={globalAuthToken} globalProfile={globalProfile} onPublicLogin={handlePublicLogin}/><SectionDivider/></>}
          {bs.donate   !== false && <><Donate C={C} lang={lang} globalProfile={globalProfile} globalAuthToken={globalAuthToken} onShowUserLogin={()=>setShowUserLogin("donate")}/><SectionDivider/></>}
          {custom.map((sec,i) => <div key={sec.id}><CustomSection sec={sec} lang={lang}/><SectionDivider/></div>)}
          {bs.contact  !== false && <Contact C={C}/>}
        </>
      )}
      <Footer C={C} onFooterLinkClick={handleFooterLinkClick}/>
      <button className="bs" onClick={()=>document.getElementById("donate")?.scrollIntoView({behavior:"smooth"})} style={{position:"fixed",bottom:16,right:16,zIndex:999,width:40,height:40,borderRadius:"50%",fontSize:"1.1rem",boxShadow:"0 8px 28px rgba(232,101,10,.45)",display:"flex",alignItems:"center",justifyContent:"center",border:"none"}} title="Donate Now">❤️</button>
      {globalProfile && (
        <button className="bs" onClick={()=>setShowDashboard(true)} style={{position:"fixed",bottom:64,right:16,zIndex:999,background:"var(--dt)",color:"white",border:"border:1px solid #B8D8E8",width:40,height:40,borderRadius:"50%",fontSize:"1.1rem",boxShadow:"0 8px 28px rgba(13,75,94,.35)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all .2s"}} title="My Dashboard">
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
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState(null);
  
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regGender, setRegGender] = useState("");
  const [regImageFile, setRegImageFile] = useState(null);
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const w = useW(); const mob = w < 640;

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!mobile || mobile.length < 10) { setAuthError("Please enter a valid 10-digit mobile number"); return; }
    if (!isLoginMode && (!regName || !regAddress || !regGender || !regEmail)) { setAuthError("Please fill out Name, Email, Address, and Gender."); return; }
    
    if (!window.recaptchaVerifierLogin) {
      try {
        window.recaptchaVerifierLogin = new RecaptchaVerifier(fbAuth, 'recaptcha-container-login', {
          'size': 'invisible',
        });
      } catch (err) {
        console.error("Recaptcha Init Error:", err);
      }
    }
    
    setSubmitting(true); setAuthError("");
    try {
      const phoneNumber = `+91${mobile.replace(/\D/g, '').slice(-10)}`;
      const appVerifier = window.recaptchaVerifierLogin;
      const result = await signInWithPhoneNumber(fbAuth, phoneNumber, appVerifier);
      setConfirmationResult(result);
      setOtpSent(true);
      setAuthError("");
    } catch (error) {
      console.error(error);
      setAuthError(error.message.includes("auth/billing-not-enabled") ? "SMS quota exceeded. Please contact admin." : error.message.includes("auth/invalid-phone-number") ? "Invalid phone number." : error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp) return;
    setSubmitting(true); setAuthError("");
    try {
      const result = await confirmationResult.confirm(otp);
      const user = result.user;
      const idToken = await user.getIdToken();
      
      let profileData = { name: regName, email: regEmail, address: regAddress, gender: regGender, mobile: mobile, photoUrl: "" };
      
      if (!isLoginMode) {
        if (regImageFile) {
          profileData.photoUrl = await fbUploadPublicFile(regImageFile, idToken).catch(()=>"");
        }
        await fbUpdateProfile(idToken, regName, profileData.photoUrl || "").catch(()=>null);
        await fbSaveUserProfile(user.uid, profileData, idToken).catch(()=>null);
      } else {
        const pData = await fbFetchUserProfile(user.uid, idToken);
        if (pData) profileData = { ...profileData, ...pData };
        else if(!pData && !isLoginMode) {
            await fbSaveUserProfile(user.uid, profileData, idToken).catch(()=>null);
        }
      }
      if (onPublicLogin) onPublicLogin(idToken, profileData);
      onClose();
    } catch(err) {
      setAuthError(err.message.includes("invalid-verification-code") ? "Invalid OTP code." : err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(13,75,94,.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:mob?16:24,zIndex:9999,backdropFilter:"blur(6px)"}}>
      <div style={{background:"white",borderRadius:24,width:"100%",maxWidth:400,padding:"24px",boxShadow:"0 32px 80px rgba(0,0,0,.3)",position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:16,right:16,background:"#F5F5F5",border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"var(--dt)"}}>✕</button>
        <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.6rem",color:"var(--dt)",marginBottom:6,fontWeight:700}}>{isLoginMode ? "Welcome Back" : "Create Profile"}</h2>
        <p style={{color:"var(--mu)",fontSize:".85rem",marginBottom:20}}>{isLoginMode ? "Login securely via SMS OTP." : "Register once to easily apply for events and awards."}</p>
        
        {authError && <div style={{background:"#FEF0F0",color:"#C0392B",padding:"10px 14px",borderRadius:10,fontSize:".8rem",marginBottom:16,fontWeight:600}}>{authError}</div>}
        <div id="recaptcha-container-login"></div>
        
        {!otpSent ? (
        <form onSubmit={handleSendOtp} style={{display:"flex",flexDirection:"column",gap:16,textAlign:"left"}}>
          <div style={{display:"flex",gap:12,flexDirection:mob?"column":"row"}}>
            <div style={{flex:1}}>
              <label style={{fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:6,display:"block"}}>📱 Mobile Number *</label>
              <input type="tel" value={mobile} onChange={e=>setMobile(e.target.value)} required style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"1px solid var(--bd)",fontSize:".9rem",outline:"none",background:"#F8F9FA",transition:"all .2s"}} placeholder="10-digit number"/>
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
            {submitting ? "Processing..." : "Send OTP"}
          </button>
        </form>
        ) : (
        <form onSubmit={handleVerifyOtp} style={{display:"flex",flexDirection:"column",gap:16,textAlign:"left"}}>
          <div>
            <label style={{fontSize:".75rem",fontWeight:700,color:"var(--dt)",marginBottom:6,display:"block"}}>🔐 Enter 6-digit OTP *</label>
            <input type="text" value={otp} onChange={e=>setOtp(e.target.value)} required style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"1px solid var(--bd)",fontSize:"1.1rem",letterSpacing:4,textAlign:"center",outline:"none",background:"#F8F9FA",transition:"all .2s"}} placeholder="------" maxLength={6}/>
          </div>
          <button type="submit" disabled={submitting} style={{background:"linear-gradient(135deg, var(--sf), var(--gd))",color:"white",padding:"14px",borderRadius:12,fontWeight:800,fontSize:"1rem",border:"none",cursor:submitting?"not-allowed":"pointer",marginTop:8,boxShadow:"0 8px 20px rgba(232,101,10,.3)",transition:"all .2s",letterSpacing:.5}} onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"} onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
            {submitting ? "Verifying..." : "Verify & Login"}
          </button>
        </form>
        )}
        
        <div style={{textAlign:"center",marginTop:16,fontSize:".85rem",color:"var(--mu)"}}>
          {isLoginMode ? "Don't have an account? " : "Already have an account? "}
          <button onClick={()=>{setIsLoginMode(!isLoginMode);setAuthError("");setOtpSent(false);}} style={{background:"none",border:"none",color:"var(--sf)",fontWeight:700,cursor:"pointer",fontSize:".85rem"}}>
            {isLoginMode ? "Create Profile" : "Login Instead"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── USER DASHBOARD ────────────────────────────────────────────────────────────

function UserEditRegistrationModal({ reg, onClose, onSave, authToken }) {
  const [formData, setFormData] = useState({ ...reg });
  const [saving, setSaving] = useState(false);
  const [uploadingFields, setUploadingFields] = useState({});

  const handleTextChange = (k, v) => setFormData(prev => ({ ...prev, [k]: v }));
  
  const handleFileUpload = async (e, k) => {
    const file = e.target.files[0];
    if(!file) return;
    setUploadingFields(prev => ({...prev, [k]: true}));
    try {
      const url = await fbUploadPublicFile(file, authToken);
      setFormData(prev => ({...prev, [k]: url}));
    } catch(err) {
      alert("Failed to upload. Please try again.");
    } finally {
      setUploadingFields(prev => ({...prev, [k]: false}));
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    await onSave(formData);
    setSaving(false);
  };

  const keys = Object.keys(reg).filter(k => !["id", "_submittedAt", "timestamp", "Status", "status", "Remarks", "remarks", "AdminRemarks", "Event Name", "Event", "eventName", "eventTitle", "eventId"].includes(k) && !k.startsWith('_'));

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:99999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"white",width:"100%",maxWidth:600,maxHeight:"90vh",borderRadius:12,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 24px 48px rgba(0,0,0,0.2)"}}>
        <div style={{padding:"16px 24px",background:"var(--dt)",color:"white",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h3 style={{margin:0,fontSize:"1.1rem",fontWeight:700}}>Edit Registration: {reg.eventName || reg.eventTitle || "Event"}</h3>
          <button onClick={onClose} style={{background:"none",border:"none",color:"white",fontSize:"1.5rem",cursor:"pointer"}}>✕</button>
        </div>
        <div style={{padding:"24px",overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:16}}>
          
          <div style={{background:"#FFF3E0",border:"1px solid #FFE0B2",padding:"12px 16px",borderRadius:8,color:"#E65100",fontSize:".85rem",marginBottom:8}}>
            <strong>Admin Remarks:</strong> {reg.Remarks || reg.AdminRemarks || "Please update your information and resubmit."}
          </div>

          {keys.map(k => {
            const val = formData[k] || "";
            const isLink = typeof val === 'string' && val.startsWith('http');
            return (
              <div key={k} style={{display:"flex",flexDirection:"column",gap:6}}>
                <label style={{fontSize:".8rem",fontWeight:600,color:"var(--dt)"}}>{k}</label>
                {isLink ? (
                  <div style={{border:"1px dashed var(--bd)",padding:12,borderRadius:8,background:"#FAFAFA",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <a href={val} target="_blank" rel="noreferrer" style={{fontSize:".8rem",color:"var(--sf)",textDecoration:"underline",maxWidth:"60%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>View Current Document</a>
                    <div style={{position:"relative"}}>
                      <button style={{padding:"6px 12px",background:"white",border:"1px solid var(--bd)",borderRadius:6,fontSize:".75rem",cursor:"pointer",fontWeight:600}}>
                        {uploadingFields[k] ? "Uploading..." : "Upload Replacement"}
                      </button>
                      <input type="file" onChange={e => handleFileUpload(e, k)} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}} disabled={uploadingFields[k]} />
                    </div>
                  </div>
                ) : (
                  <input type="text" value={val} onChange={e => handleTextChange(k, e.target.value)} style={{padding:"10px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".9rem",fontFamily:"inherit"}} />
                )}
              </div>
            );
          })}
        </div>
        <div style={{padding:"16px 24px",background:"#FAFAFA",borderTop:"1px solid var(--bd)",display:"flex",justifyContent:"flex-end",gap:12}}>
          <button onClick={onClose} style={{padding:"10px 16px",borderRadius:6,background:"white",border:"1px solid var(--bd)",color:"var(--mu)",cursor:"pointer",fontWeight:600}}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{padding:"10px 24px",borderRadius:6,background:"var(--dt)",color:"white",border:"none",cursor:"pointer",fontWeight:700}}>{saving ? "Saving..." : "Save & Resubmit"}</button>
        </div>
      </div>
    </div>
  );
}

function UserDashboard({ C, globalProfile, globalAuthToken, onClose }) {

  const [regs, setRegs] = useState([]);
  const [myDonations, setMyDonations] = useState([]);
  const [editingReg, setEditingReg] = useState(null);

  const handleSaveResubmission = async (updatedData) => {
    try {
      const cleanData = { ...updatedData, Status: "Pending", status: "Pending" };
      delete cleanData.id;
      delete cleanData._submittedAt;
      await fbUpdateRegistration(editingReg.id, cleanData, globalAuthToken);
      
      setRegs(prev => prev.map(x => x.id === editingReg.id ? { ...x, ...cleanData } : x));
      setEditingReg(null);
      alert("Registration resubmitted successfully!");
    } catch(e) {
      alert("Failed to resubmit: " + e.message);
    }
  };
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Registrations");
  const [subTab, setSubTab] = useState("For Me");
  const [previewFile, setPreviewFile] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const w = useW(); const mob = w < 768;

  const tabs = [
    { id: "Registrations", label: "Event Registrations", icon: "📅" },
    { id: "Awards", label: "Education Awards", icon: "🎓" },
    { id: "Receipts", label: "Payment Receipts", icon: "🧾" },
    { id: "Invites", label: "Special Invites", icon: "💌" },
    { id: "Profile", label: "My Profile", icon: "👤" }
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
    setSubTab("For Me");
  }, [activeTab]);

  useEffect(() => {
    const fetchMyRegs = async () => {
      try {
        const allRegs = await fbFetchRegistrations(globalAuthToken);
        const mobileToMatch = String(globalProfile.mobile || globalProfile['Mobile Number'] || "").trim();
        const nameToMatch = String(globalProfile.name || globalProfile['Full Name'] || "").trim().toLowerCase();
        
        const mine = [];
        allRegs.forEach(r => {
          const rMobile = String(r["Mobile Number"] || r.mobile || "").trim();
          const rName = String(r["Submitted By"] || r.name || r["Full Name"] || "").trim().toLowerCase();
          const sMob = String(r.submitterMob || "").trim();
          
          if ((mobileToMatch && rMobile === mobileToMatch) || (nameToMatch && rName === nameToMatch) || sMob === mobileToMatch) {
            mine.push(r);
          }
        });
        
        setRegs(mine);
      } catch(e) { console.error(e); }
      setLoading(false);
    };
    
    const fetchMyDonations = async () => {
      try {
        const allDons = await fbFetchDonations(globalAuthToken);
        const mobileToMatch = String(globalProfile.mobile || globalProfile['Mobile Number'] || "").trim();
        const nameToMatch = String(globalProfile.name || globalProfile['Full Name'] || "").trim().toLowerCase();
        
        const mine = [];
        allDons.forEach(r => {
          const rMobile = String(r.mobile || r.phone || "").trim();
          const rName = String(r.name || r.donor || "").trim().toLowerCase();
          const sMob = String(r.submitterMob || "").trim();
          
          if ((mobileToMatch && rMobile === mobileToMatch) || (nameToMatch && rName === nameToMatch) || sMob === mobileToMatch) {
            mine.push(r);
          }
        });
        
        setMyDonations(mine);
      } catch(e) { console.error(e); }
      setLoading(false);
    };

    if (globalAuthToken && globalProfile) {
      if (activeTab === "Registrations" || activeTab === "Awards") { setLoading(true); fetchMyRegs(); }
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
            {activeTab === "Profile" && <DashboardProfile globalProfile={globalProfile} globalAuthToken={globalAuthToken} mob={mob} />}
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
                          <th style={{padding:"14px 16px",textAlign:"center",whiteSpace:"nowrap",fontWeight:600}}>Actions</th>
                          {Array.from(new Set(regs.flatMap(r => Object.keys(r))))
                            .filter(k => !["id", "_submittedAt", "timestamp", "Status", "status", "Remarks", "remarks", "AdminRemarks", "Event Name", "Event", "eventName", "eventTitle", "eventId"].includes(k))
                            .map(k => (
                            <th key={k} style={{padding:"14px 16px",textAlign:"left",whiteSpace:"nowrap",fontWeight:600}}>{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {regs.map((r, i) => {
                          const sc = getStatusColor(r.Status || r.status || "Pending");
                          const rowKeys = Array.from(new Set(regs.flatMap(r => Object.keys(r))))
                            .filter(k => !["id", "_submittedAt", "timestamp", "Status", "status", "Remarks", "remarks", "AdminRemarks", "Event Name", "Event", "eventName", "eventTitle", "eventId"].includes(k));
                          
                          return (
                            <tr key={r.id || i} style={{borderBottom:"1px solid var(--ww)",background:i%2===0?"white":"#FAFAFA"}}>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap"}}>{new Date(r.timestamp || r._submittedAt).toLocaleString()}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap",fontWeight:700,color:"var(--dt)"}}>{r.eventName || r["Event Name"] || r["Event"] || "Event Registration"}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap"}}>
                                <span style={{background:sc.bg,color:sc.col,padding:"5px 12px",borderRadius:20,fontSize:".75rem",fontWeight:700,border:`1px solid ${sc.col}33`}}>
                                  {r.Status || r.status || "Pending"}
                                </span>
                              </td>
                              <td style={{padding:"14px 16px",color:"var(--tm2)"}}>
                                <div style={{minWidth:150,maxWidth:500,maxHeight:80,overflow:"auto",resize:"horizontal",whiteSpace:"normal",wordBreak:"break-word",paddingRight:4,paddingBottom:4}}>
                                  {r.AdminRemarks || r.remarks || r.Remarks || "-"}
                                </div>
                              </td>
                              <td style={{padding:"14px 16px",textAlign:"center",whiteSpace:"nowrap"}}>
                                {((r.Status || r.status || "Pending") === "Pending" || (r.Status || r.status) === "Needs Info") ? (
                                  <button onClick={() => setEditingReg(r)} style={{padding:"6px 12px",borderRadius:6,background:"var(--dt)",color:"white",border:"none",fontWeight:600,cursor:"pointer",boxShadow:"0 2px 4px rgba(0,0,0,0.1)"}}>
                                    ✏️ Edit & Resubmit
                                  </button>
                                ) : (
                                  <span style={{fontSize:".75rem",color:"var(--mu)"}}>🔒 Frozen</span>
                                )}
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
                          const sc = getStatusColor(r.Status || r.status || "Pending");
                          const isVerified = (r.Status || r.status || "").toLowerCase().includes("verifi") || (r.Status || r.status || "").toLowerCase().includes("approv") || (r.Status || r.status || "").toLowerCase().includes("success") || r.status === "Verified";
                          
                          return (
                            <tr key={r.id || i} style={{borderBottom:"1px solid var(--ww)",background:i%2===0?"white":"#FAFAFA"}}>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap"}}>{r.date || new Date(r.timestamp || r._submittedAt).toLocaleString()}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap",fontWeight:700,color:"var(--dt)"}}>Rs. {Number(r.amount).toLocaleString()}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap",color:"var(--tm2)"}}>{r.program || r["Program"] || "-"}</td>
                              <td style={{padding:"14px 16px",whiteSpace:"nowrap"}}>
                                <span style={{background:sc.bg,color:sc.col,padding:"5px 12px",borderRadius:20,fontSize:".75rem",fontWeight:700,border:`1px solid ${sc.col}33`}}>
                                  {r.Status || r.status || "Pending"}
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


            {activeTab === "Awards" && (
              <>
                <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.3rem",color:"var(--dt)",marginBottom:16,fontWeight:700}}>My Education Awards</h3>
                {` + subtabs_ui.strip() + `}
                {(() => {
                  const mobileToMatch = String(globalProfile.mobile || globalProfile['Mobile Number'] || "").trim();
                  const approvedRegs = regs.filter(r => {
                    const isVerified = (r.Status || r.status || "").toLowerCase().includes("verifi") || (r.Status || r.status || "").toLowerCase().includes("approv") || (r.Status || r.status || "").toLowerCase().includes("success");
                    if (!isVerified) return false;
                    
                    const rMobile = String(r["Mobile Number"] || r.mobile || "").trim();
                    if (subTab === "For Me") {
                       return rMobile === mobileToMatch || (!r.submitterMob && rMobile !== mobileToMatch && rMobile !== "");
                    } else {
                       return rMobile !== mobileToMatch && String(r.submitterMob || "").trim() === mobileToMatch;
                    }
                  });
                  
                  const awds = approvedRegs.map(r => {
                    const rEvName = (r.eventName || r.eventTitle || r["Event Name"] || r["Event"] || "").trim().toLowerCase();
                    const ev = (C.events || []).find(e => {
                      if (rEvName && e.title && e.title.trim().toLowerCase() === rEvName) return true;
                      if (r.eventId && e.id === r.eventId) return true;
                      return false;
                    });
                    if (ev) return { reg: r, ev };
                    return null;
                  }).filter(Boolean);
                  
                  if (loading) return <div style={{textAlign:"center",padding:40,color:"var(--mu)"}}>Loading awards...</div>;
                  if (awds.length === 0) return (
                    <div style={{background:"white",padding:"60px 20px",borderRadius:16,textAlign:"center",border:"1px solid var(--bd)",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                      <div style={{fontSize:"3.5rem",marginBottom:16}}>🎓</div>
                      <div style={{fontWeight:700,color:"var(--dt)",fontSize:"1.3rem",marginBottom:8,fontFamily:"'Playfair Display',serif"}}>No Awards {subTab}</div>
                      <div style={{color:"var(--mu)",fontSize:".9rem",maxWidth:300}}>Certificates will appear here once your event registrations are approved and certificates are issued.</div>
                    </div>
                  );
                  
                  return (
                    <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"repeat(auto-fill, minmax(280px, 1fr))",gap:16}}>
                      {awds.map((a, i) => {
                        let extractedName = "";
                        if (a.reg) {
                          for (const key of Object.keys(a.reg)) {
                            const kLow = key.toLowerCase().trim();
                            if (kLow.includes("name") && !kLow.includes("event")) {
                              extractedName = a.reg[key];
                              if (extractedName) break;
                            }
                          }
                        }
                        const sName = extractedName || a.reg["Submitted By"] || globalProfile.name || "Student";
                        const downloading = false;
                        return (
                          <div key={i} style={{background:"white",borderRadius:12,border:"1px solid var(--bd)",overflow:"hidden",boxShadow:"0 4px 12px rgba(0,0,0,.04)",display:"flex",flexDirection:"column"}}>
                            {a.ev.certBgUrl ? (
                              <div style={{height:140,background:`url(${a.ev.certBgUrl}) center/cover no-repeat`,position:"relative",borderBottom:"1px solid var(--bd)"}}>
                                 <div style={{position:"absolute",inset:0,background:"linear-gradient(to top, rgba(0,0,0,0.6), transparent)"}} />
                                 <div style={{position:"absolute",bottom:12,left:12,right:12,color:"white"}}>
                                   <div style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:1,opacity:0.9}}>Certificate of Award</div>
                                   <div style={{fontSize:"1rem",fontWeight:700,fontFamily:"'Playfair Display',serif",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.ev.title}</div>
                                 </div>
                              </div>
                            ) : (
                              <div style={{height:140,background:"#FEF0EF",position:"relative",borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,textAlign:"center"}}>
                                <div style={{color:"#C0392B",fontSize:".8rem",fontWeight:600}}>⚠️ Missing Background Image. Admin needs to configure the certificate template.</div>
                              </div>
                            )}
                            <div style={{padding:16,display:"flex",flexDirection:"column",gap:12,flex:1}}>
                              <div>
                                <div style={{fontSize:".7rem",color:"var(--mu)",fontWeight:600,textTransform:"uppercase"}}>Awarded To</div>
                                <div style={{fontSize:".95rem",fontWeight:700,color:"var(--dt)"}}>{sName}</div>
                              </div>
                              {!a.ev.issueCertificates && (
                                <div style={{padding:"8px 12px",background:"#FEF0EF",color:"#C0392B",borderRadius:6,fontSize:".75rem",fontWeight:600,marginTop:4}}>
                                  ⚠️ Not Issued Yet. Admin has not checked "Enable / Issue Certificates".
                                </div>
                              )}
                              <div style={{marginTop:"auto", display:"flex", gap:8, width:"100%"}}>
                                <button 
                                  disabled={!a.ev.certBgUrl || !a.ev.issueCertificates}
                                  onClick={async (e) => {
                                    const btn = e.currentTarget;
                                    const orig = btn.innerHTML;
                                    btn.disabled = true;
                                    btn.innerText = "...";
                                    try {
                                      const evtName = a.ev.title || "Event";
                                      const evtDate = a.ev.date ? `${a.ev.date} ${a.ev.month}` : "2025";
                                      const fieldsData = { "Event Name": evtName, "Date": evtDate, ...a.reg };
                                      await generateCertificatePDF(a.ev, fieldsData, sName, true);
                                    } catch(err) {
                                      alert(err.message);
                                    }
                                    btn.disabled = false;
                                    btn.innerHTML = orig;
                                  }} 
                                  style={{flex:1, padding:"10px",borderRadius:8,background:(!a.ev.certBgUrl || !a.ev.issueCertificates) ? "#ccc" : "#f5f5f5",color:(!a.ev.certBgUrl || !a.ev.issueCertificates) ? "white" : "var(--dt)",border:"1px solid " + ((!a.ev.certBgUrl || !a.ev.issueCertificates) ? "#ccc" : "var(--dt)"),fontWeight:600,cursor:(!a.ev.certBgUrl || !a.ev.issueCertificates) ? "not-allowed" : "pointer",display:"flex",justifyContent:"center",alignItems:"center"}}
                                >
                                  👁 Preview
                                </button>
                                <button 
                                  disabled={!a.ev.certBgUrl || !a.ev.issueCertificates}
                                  onClick={async (e) => {
                                    const btn = e.currentTarget;
                                    const orig = btn.innerHTML;
                                    btn.disabled = true;
                                    btn.innerText = "...";
                                    try {
                                      const evtName = a.ev.title || "Event";
                                      const evtDate = a.ev.date ? `${a.ev.date} ${a.ev.month}` : "2025";
                                      const fieldsData = { "Event Name": evtName, "Date": evtDate, ...a.reg };
                                      await generateCertificatePDF(a.ev, fieldsData, sName, false);
                                    } catch(err) {
                                      alert(err.message);
                                    }
                                    btn.disabled = false;
                                    btn.innerHTML = orig;
                                  }} 
                                  style={{flex:1, padding:"10px",borderRadius:8,background:(!a.ev.certBgUrl || !a.ev.issueCertificates) ? "#ccc" : "var(--dt)",color:"white",border:"none",fontWeight:600,cursor:(!a.ev.certBgUrl || !a.ev.issueCertificates) ? "not-allowed" : "pointer",display:"flex",justifyContent:"center",alignItems:"center",boxShadow:"0 2px 6px rgba(0,0,0,0.15)"}}
                                >
                                  ⬇ Download
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </>
            )}

            {activeTab !== "Registrations" && activeTab !== "Receipts" && activeTab !== "Awards" && (
              <div style={{background:"white",padding:"60px 20px",borderRadius:16,textAlign:"center",border:"1px solid var(--bd)",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontSize:"3.5rem",marginBottom:16}}>{tabs.find(t=>t.id===activeTab)?.icon}</div>
                <div style={{fontWeight:700,color:"var(--dt)",fontSize:"1.3rem",marginBottom:8,fontFamily:"'Playfair Display',serif"}}>No New {tabs.find(t=>t.id===activeTab)?.label}</div>
                <div style={{color:"var(--mu)",fontSize:".9rem",maxWidth:300}}>When the Trust sends you updates related to {activeTab.toLowerCase()}, they will securely appear right here.</div>
              </div>
            )}

          </div>
        </div>
      </div>
      {editingReg && (
        <UserEditRegistrationModal 
          reg={editingReg} 
          onClose={() => setEditingReg(null)} 
          onSave={handleSaveResubmission}
          authToken={globalAuthToken}
        />
      )}
      
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
function LoginScreen({ C, onLogin, onSkip }) {
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

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email) {
      setErr("Please enter your admin email address first, then click Forgot Password.");
      return;
    }
    setErr(""); setLoading(true);
    try {
      await sendPasswordResetEmail(fbAuth, email);
      setErr("✅ A password reset link has been sent to your email. Please check your inbox.");
    } catch(e) {
      setErr(e.message.replace("Firebase: ", ""));
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
          <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
            <LogoMark logo={{...C.trust.logo, size: 56}} mob={false} />
          </div>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.3rem",color:"var(--dt)",fontWeight:700}}>Admin Login</h2>
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
          <div style={{textAlign:"right", marginTop:6}}>
            <button type="button" onClick={handleForgotPassword} style={{background:"none",border:"none",color:"var(--sf)",fontSize:".75rem",fontWeight:600,cursor:"pointer"}}>Forgot Password?</button>
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
          Login only needed to save content.
          <br/>You can still edit and preview without logging in.
        </p>
      </div>
    </div>
  );
}

// ── ADMIN REGISTRATIONS ────────────────────────────────────────────────────────
function AdminAccess({ C, setC, master, auth }) {
  if (!master) return <div style={{padding:40,textAlign:"center"}}>Access Denied.</div>;

  const roles = C.access?.roles || [];
  const allPerms = ANAV.filter(item => !["access", "profile"].includes(item.id));
  const contentSubPerms = ["sections", "nav", "trust", "hero", "stats", "about", "programs", "events", "contact", "footer"];

  const [allUsers, setAllUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [contentExpanded, setContentExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expContent, setExpContent] = useState({});

  useEffect(() => {
    if (master && auth?.idToken) {
      setLoading(true);
      fbFetchAllUsers(auth.idToken).then(users => {
        setAllUsers(users.filter(u => u.email));
        setLoading(false);
      });
    }
  }, [master, auth?.idToken]);

  const saveToFirebase = async (newC) => {
    try {
      await fbSave(newC, auth.idToken);
    } catch(e) {
      alert("Failed to save access control changes to Firebase: " + e.message);
    }
  };

  const handleAdd = () => {
    if (!selectedUser) return alert("Please enter or select an email address.");
    const email = selectedUser.trim();
    if (!email.includes("@")) return alert("Please enter a valid email address.");
    if (roles.find(r => r.email.toLowerCase() === email.toLowerCase())) {
      return alert("User already exists in access control.");
    }
    const newC = {...C, access: { ...C.access, roles: [...roles, { email: email.toLowerCase(), permissions: [] }] }};
    setC(newC);
    saveToFirebase(newC);
    setSelectedUser("");
  };

  const handleRemove = (email) => {
    if(!confirm("Remove access for " + email + "?")) return;
    const newC = {...C, access: { ...C.access, roles: roles.filter(r => r.email !== email) }};
    setC(newC);
    saveToFirebase(newC);
  };

  const togglePerm = (email, perm) => {
    const newC = {...C, access: { ...C.access, roles: roles.map(r => {
      if (r.email === email) {
        const perms = r.permissions.includes(perm) ? r.permissions.filter(p => p !== perm) : [...r.permissions, perm];
        return { ...r, permissions: perms };
      }
      return r;
    })}};
    setC(newC);
    saveToFirebase(newC);
  };

  return (
    <div className="card">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:16}}>
        <div>
          <h2 className="sh" style={{fontSize:"1.4rem",color:"var(--dt)",marginBottom:4}}>Access Control</h2>
          <p style={{fontSize:".85rem",color:"var(--mu)"}}>Grant specific tab access to registered staff members.</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input 
            type="email"
            list="registered-users"
            value={selectedUser} 
            onChange={e=>setSelectedUser(e.target.value)} 
            disabled={loading} 
            placeholder={loading ? "Loading users..." : "Enter or select email..."}
            style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit",minWidth:220}}
          />
          <datalist id="registered-users">
            {allUsers.map(u => (
              <option key={u.id} value={u.email}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
            ))}
          </datalist>
          <button onClick={handleAdd} disabled={loading || !selectedUser} className="btn-primary" style={{padding:"8px 16px",fontSize:".85rem",opacity:!selectedUser||loading?.5:1}}>+ Add User</button>
        </div>
      </div>

      <div className="admin-table-wrapper" style={{overflowX:"auto"}}>
        <table className="admin-table" style={{width:"100%",borderCollapse:"collapse",fontSize:".85rem",minWidth:800}}>
          <thead>
            <tr>
              <th style={{padding:"12px 16px",textAlign:"left"}}>Email</th>
              <th style={{padding:"12px 16px",textAlign:"left"}}>Permissions</th>
              <th style={{padding:"12px 16px",textAlign:"right"}}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 && <tr><td colSpan={3} style={{padding:20,textAlign:"center",color:"var(--mu)"}}>No additional users have been granted access.</td></tr>}
            {roles.map(r => (
              <tr key={r.email}>
                <td style={{padding:"16px",fontWeight:600}}>{r.email}</td>
                <td style={{padding:"16px"}}>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {allPerms.map(p => (
                      <div key={p.id} style={{display:"flex", flexDirection:"column", gap: 4}}>
                        <div style={{display:"flex", alignItems:"center"}}>
                          <label style={{display:"flex",alignItems:"center",gap:4,fontSize:".75rem",background:r.permissions.includes(p.id)?"#E8F4F8":"#f5f5f5",padding:"4px 8px",borderRadius:4,cursor:"pointer",border:r.permissions.includes(p.id)?"1px solid #B8D8E8":"1px solid transparent"}}>
                            <input type="checkbox" checked={r.permissions.includes(p.id)} onChange={()=>togglePerm(r.email, p.id)} style={{margin:0,cursor:"pointer"}}/>
                            {p.label}
                          </label>
                          {p.id === "content" && (
                            <button 
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpContent(prev => ({...prev, [r.email]: !prev[r.email]})); }}
                              style={{background:"none",border:"none",color:"var(--sf)",fontWeight:"bold",fontSize:".9rem",cursor:"pointer",padding:"4px 8px"}}
                            >
                              {expContent[r.email] ? "[-]" : "[+]"}
                            </button>
                          )}
                        </div>
                        {p.id === "content" && expContent[r.email] && (
                          <div style={{display:"flex", flexDirection:"column", gap: 4, paddingLeft: 12, borderLeft: "2px solid #B8D8E8", marginLeft: 4}}>
                            {contentSubPerms.map(sub => {
                               const permId = `content:${sub}`;
                               return (
                                  <label key={sub} style={{display:"flex",alignItems:"center",gap:4,fontSize:".7rem",color:r.permissions.includes("content")?"var(--dt)":"#aaa",cursor:r.permissions.includes("content")?"pointer":"not-allowed"}}>
                                    <input type="checkbox" checked={r.permissions.includes(permId)} onChange={()=>r.permissions.includes("content") && togglePerm(r.email, permId)} disabled={!r.permissions.includes("content")} style={{margin:0,cursor:r.permissions.includes("content")?"pointer":"not-allowed"}}/>
                                    {sub.charAt(0).toUpperCase() + sub.slice(1)}
                                  </label>
                               )
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </td>
                <td style={{padding:"16px",textAlign:"right"}}>
                  <button onClick={()=>handleRemove(r.email)} style={{background:"#FEF0EF",border:"1px solid #F5B8B8",color:"#C0392B",padding:"4px 8px",borderRadius:6,fontSize:".75rem",cursor:"pointer"}}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{marginTop:20,background:"#FFF4EC",padding:16,borderRadius:8,fontSize:".8rem",color:"var(--sf)"}}>
        <strong>Super Admins:</strong> <code>admin@vidyagohiltrust.org</code> and <code>pradeepparmar902@yahoo.com</code> automatically have full access to all tabs.
      </div>
    </div>
  );
}


function VerificationModal({ viewing, setViewing, allRegs, saveVerification }) {
  const [eventFilter, setEventFilter] = useState(viewing.eventName || viewing.eventTitle || viewing.eventId || "");
  const [statusFilter, setStatusFilter] = useState(viewing['Status'] || "Pending");

  const handleFilterChange = (type, val) => {
    if (type === 'event') setEventFilter(val);
    if (type === 'status') setStatusFilter(val);
    
    const newEvent = type === 'event' ? val : eventFilter;
    const newStatus = type === 'status' ? val : statusFilter;
    
    const newList = allRegs.filter(r => {
      const evName = r.eventName || r.eventTitle || r.eventId || "Unknown Event";
      if (newEvent && evName !== newEvent) return false;
      const stat = r['Status'] || "Pending";
      if (newStatus && newStatus !== "All" && stat !== newStatus) return false;
      return true;
    });

    if (newList.length > 0) {
      setViewing(newList[0]);
    } else {
      alert("No registrations match this filter combination.");
    }
  };

  const uniqueEvents = Array.from(new Set(allRegs.map(r => r.eventName || r.eventTitle || r.eventId || "Unknown Event")));

  const filteredList = allRegs.filter(r => {
    const evName = r.eventName || r.eventTitle || r.eventId || "Unknown Event";
    if (eventFilter && evName !== eventFilter) return false;
    const stat = r['Status'] || "Pending";
    if (statusFilter && statusFilter !== "All" && stat !== statusFilter) return false;
    return true;
  });

  const currentIndex = filteredList.findIndex(r => r.id === viewing.id);

  const docKeys = Object.keys(viewing).filter(k => typeof viewing[k] === 'string' && viewing[k].startsWith('http'));
  const [activeDoc, setActiveDoc] = useState(docKeys.length > 0 ? viewing[docKeys[0]] : null);
  const [status, setStatus] = useState(viewing['Status'] || 'Pending');
  const [remarks, setRemarks] = useState(viewing['Remarks'] || '');
  const [saving, setSaving] = useState(false);
  const [editedReg, setEditedReg] = useState(viewing);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const keys = Object.keys(viewing).filter(k => typeof viewing[k] === 'string' && viewing[k].startsWith('http'));
    setActiveDoc(keys.length > 0 ? viewing[keys[0]] : null);
    setStatus(viewing['Status'] || 'Pending');
    setRemarks(viewing['Remarks'] || '');
    setEditedReg(viewing);
    setIsEditing(false);
  }, [viewing]);

  const handleSave = async () => {
    if (status !== 'Approved' && status !== 'Needs Info' && status !== 'Disapproved') {
      alert("Please select a Verification Action (Approve, Pause, or Reject) before saving.");
      return;
    }

    let nextItem = null;
    if (currentIndex >= 0 && currentIndex < filteredList.length - 1) {
       nextItem = filteredList[currentIndex + 1];
    }
    
    setSaving(true);
    await saveVerification(editedReg, status, remarks);
    setSaving(false);
    
    if (nextItem) {
      setViewing(nextItem);
    } else {
      setViewing(null);
    }
  };

  const goNext = () => {
    if (currentIndex >= 0 && currentIndex < filteredList.length - 1) setViewing(filteredList[currentIndex + 1]);
  };
  const goPrev = () => {
    if (currentIndex > 0) setViewing(filteredList[currentIndex - 1]);
  };

  const isPdf = activeDoc && activeDoc.toLowerCase().includes('.pdf');

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"white",width:"100%",maxWidth:1200,height:"90vh",borderRadius:12,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 24px 48px rgba(0,0,0,0.2)"}}>
        
        {/* Header */}
        <div style={{padding:"12px 24px",background:"var(--dt)",color:"white",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:24}}>
             <div>
               <h3 style={{fontSize:"1.1rem",fontWeight:700,margin:0,whiteSpace:"nowrap"}}>Verification Workflow</h3>
               <div style={{fontSize:".75rem",opacity:0.8,marginTop:2}}>ID: {viewing['Transaction ID'] || "N/A"}</div>
             </div>
             
             {/* Filter Dropdowns */}
             <div style={{display:"flex",gap:8,alignItems:"center",borderLeft:"1px solid rgba(255,255,255,0.2)",paddingLeft:24}}>
               <span style={{fontSize:".75rem",fontWeight:600,textTransform:"uppercase",opacity:0.8}}>Filter:</span>
               <select value={eventFilter} onChange={e=>handleFilterChange('event', e.target.value)} style={{padding:"6px 12px",borderRadius:6,border:"none",fontSize:".8rem",outline:"none",background:"rgba(255,255,255,0.1)",color:"white"}}>
                 <option value="" style={{color:"black"}}>All Events</option>
                 {uniqueEvents.map(e => <option key={e} value={e} style={{color:"black"}}>{e}</option>)}
               </select>

               <select value={statusFilter} onChange={e=>handleFilterChange('status', e.target.value)} style={{padding:"6px 12px",borderRadius:6,border:"none",fontSize:".8rem",outline:"none",background:"rgba(255,255,255,0.1)",color:"white"}}>
                 <option value="All" style={{color:"black"}}>All Status</option>
                 <option value="Pending" style={{color:"black"}}>Pending</option>
                 <option value="Needs Info" style={{color:"black"}}>Needs Info</option>
                 <option value="Approved" style={{color:"black"}}>Approved</option>
                 <option value="Disapproved" style={{color:"black"}}>Disapproved</option>
               </select>
             </div>
          </div>
          
          <div style={{display:"flex",alignItems:"center",gap:20}}>
             <div style={{fontSize:".8rem",fontWeight:600,display:"flex",alignItems:"center",gap:8,background:"rgba(0,0,0,0.2)",padding:"4px 12px",borderRadius:20}}>
               <button onClick={goPrev} disabled={currentIndex <= 0} style={{background:"none",border:"none",color:"white",cursor:currentIndex<=0?"not-allowed":"pointer",opacity:currentIndex<=0?0.3:1}}>◄ Prev</button>
               <span>{currentIndex >= 0 ? currentIndex + 1 : 0} of {filteredList.length}</span>
               <button onClick={goNext} disabled={currentIndex === -1 || currentIndex >= filteredList.length - 1} style={{background:"none",border:"none",color:"white",cursor:(currentIndex===-1||currentIndex>=filteredList.length-1)?"not-allowed":"pointer",opacity:(currentIndex===-1||currentIndex>=filteredList.length-1)?0.3:1}}>Next ►</button>
             </div>
             <button onClick={()=>setViewing(null)} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",width:32,height:32,borderRadius:"50%",fontSize:"1.1rem",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}} onMouseOver={e=>e.target.style.background="rgba(255,255,255,0.3)"} onMouseOut={e=>e.target.style.background="rgba(255,255,255,0.2)"}>✕</button>
          </div>
        </div>

        {/* Split Screen Body */}
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          
          {/* Left: Document Viewer */}
          <div style={{flex:1,borderRight:"1px solid var(--bd)",display:"flex",flexDirection:"column",background:"#F5F5F7"}}>
            {docKeys.length > 0 ? (
              <>
                {docKeys.length > 1 && (
                  <div style={{padding:"12px 16px",background:"white",borderBottom:"1px solid var(--bd)",display:"flex",gap:8,overflowX:"auto"}}>
                    {docKeys.map(k => (
                      <button key={k} onClick={()=>setActiveDoc(viewing[k])} style={{padding:"6px 12px",borderRadius:20,border:activeDoc===viewing[k]?"none":"1px solid var(--bd)",background:activeDoc===viewing[k]?"var(--tl)":"white",color:activeDoc===viewing[k]?"var(--dt)":"var(--mu)",fontSize:".8rem",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
                        {k}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{flex:1,padding:16,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                  {isPdf ? (
                    <iframe src={activeDoc} style={{width:"100%",height:"100%",border:"none",borderRadius:8,background:"white",boxShadow:"0 4px 12px rgba(0,0,0,0.05)"}} title="Document" />
                  ) : (
                    <img src={activeDoc} alt="Document" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",borderRadius:8,boxShadow:"0 4px 12px rgba(0,0,0,0.05)"}} />
                  )}
                </div>
              </>
            ) : (
              <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"var(--mu)",padding:40,textAlign:"center"}}>
                <div style={{fontSize:"3rem",marginBottom:16,opacity:0.5}}>📄</div>
                <h4 style={{margin:0,fontSize:"1.1rem",fontWeight:600,color:"var(--dt)"}}>No Documents Provided</h4>
                <p style={{fontSize:".9rem",marginTop:8}}>This registration does not contain any uploaded files or images.</p>
              </div>
            )}
          </div>

          {/* Right: Data & Verification Controls */}
          <div style={{width:400,display:"flex",flexDirection:"column",background:"white"}}>
            
            {/* Input Data List */}
            <div style={{flex:1,overflowY:"auto",padding:"24px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <h4 style={{fontSize:".95rem",fontWeight:700,color:"var(--dt)",margin:0,textTransform:"uppercase",letterSpacing:1}}>Submitted Details</h4>
                <button 
                  onClick={() => setIsEditing(!isEditing)} 
                  style={{
                    background: "none", 
                    border: "none", 
                    color: "var(--dt)", 
                    cursor: "pointer", 
                    fontSize: ".85rem", 
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 4
                  }}
                >
                  {isEditing ? "👁 Read Only" : "✏️ Edit Fields"}
                </button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {Object.keys(editedReg || viewing).filter(k => !k.startsWith('_') && !['id','eventId','eventName','Status','Remarks','Updated By'].includes(k)).map(k => {
                  const val = (editedReg || viewing)[k];
                  if (typeof val === 'string' && val.startsWith('http')) return null; // Skip docs
                  const displayVal = typeof val === 'string' ? val.replace(/\|/g, ' ') : String(val);

                  if (isEditing) {
                    const isLong = String(val).length > 50 || k.toLowerCase().includes("address") || k.toLowerCase().includes("remark");
                    return (
                      <div key={k}>
                        <div style={{fontSize:".75rem",color:"var(--mu)",fontWeight:600,marginBottom:4}}>{k}</div>
                        {isLong ? (
                          <textarea 
                            value={editedReg[k] || ""} 
                            onChange={(e) => setEditedReg(prev => ({ ...prev, [k]: e.target.value }))}
                            rows={3}
                            style={{
                              width: "100%",
                              fontSize: ".95rem",
                              color: "var(--tx)",
                              background: "#fff",
                              padding: "8px 12px",
                              borderRadius: 6,
                              border: "1px solid var(--bd)",
                              boxSizing: "border-box",
                              outline: "none",
                              resize: "vertical",
                              fontFamily: "inherit",
                              boxShadow: "inset 0 1px 3px rgba(0,0,0,0.05)"
                            }} 
                          />
                        ) : (
                          <input 
                            type="text" 
                            value={editedReg[k] || ""} 
                            onChange={(e) => setEditedReg(prev => ({ ...prev, [k]: e.target.value }))}
                            style={{
                              width: "100%",
                              fontSize: ".95rem",
                              color: "var(--tx)",
                              background: "#fff",
                              padding: "8px 12px",
                              borderRadius: 6,
                              border: "1px solid var(--bd)",
                              boxSizing: "border-box",
                              outline: "none",
                              boxShadow: "inset 0 1px 3px rgba(0,0,0,0.05)"
                            }} 
                          />
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={k}>
                      <div style={{fontSize:".75rem",color:"var(--mu)",fontWeight:600,marginBottom:4}}>{k}</div>
                      <div style={{fontSize:".95rem",color:"var(--tx)",wordBreak:"break-word",background:"#FAFAFA",padding:"8px 12px",borderRadius:6,border:"1px solid #EEE"}}>{displayVal || "-"}</div>
                    </div>
                  );
                })}

                {isEditing && (
                  <button 
                    onClick={async () => {
                      setSaving(true);
                      await saveVerification(editedReg, status, remarks);
                      setSaving(false);
                      setIsEditing(false);
                    }}
                    disabled={saving}
                    style={{
                      marginTop: 12,
                      width: "100%",
                      padding: "12px",
                      borderRadius: 8,
                      background: "#333",
                      color: "white",
                      border: "none",
                      fontWeight: 700,
                      fontSize: ".9rem",
                      cursor: "pointer",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.15)"
                    }}
                  >
                    {saving ? "Saving..." : "💾 Save Details Only"}
                  </button>
                )}
              </div>
            </div>

            {/* Verification Controls */}
            <div style={{padding:"20px 24px",background:"#FAFAFA",borderTop:"1px solid var(--bd)"}}>
              <h4 style={{fontSize:".95rem",fontWeight:700,color:"var(--dt)",marginBottom:12}}>Verification Action</h4>
              
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
                <button onClick={()=>setStatus('Approved')} style={{padding:"10px",borderRadius:6,fontWeight:600,fontSize:".85rem",cursor:"pointer",border:status==='Approved'?"2px solid #2E7D32":"1px solid #CCC",background:status==='Approved'?"#E8F5E9":"white",color:status==='Approved'?"#2E7D32":"var(--mu)",transition:"0.2s"}}>✓ Approve</button>
                <button onClick={()=>setStatus('Needs Info')} style={{padding:"10px",borderRadius:6,fontWeight:600,fontSize:".85rem",cursor:"pointer",border:status==='Needs Info'?"2px solid #EF6C00":"1px solid #CCC",background:status==='Needs Info'?"#FFF3E0":"white",color:status==='Needs Info'?"#EF6C00":"var(--mu)",transition:"0.2s"}}>⏸ Pause</button>
                <button onClick={()=>setStatus('Disapproved')} style={{padding:"10px",borderRadius:6,fontWeight:600,fontSize:".85rem",cursor:"pointer",border:status==='Disapproved'?"2px solid #C62828":"1px solid #CCC",background:status==='Disapproved'?"#FFEBEE":"white",color:status==='Disapproved'?"#C62828":"var(--mu)",transition:"0.2s"}}>✕ Reject</button>
              </div>

              <div style={{marginBottom:16}}>
                <label style={{display:"block",fontSize:".75rem",fontWeight:600,color:"var(--dt)",marginBottom:6}}>Remarks / Reason (Optional)</label>
                <textarea value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="e.g. Marksheet is blurry, please re-upload" style={{width:"100%",padding:"10px",borderRadius:6,border:"1px solid var(--bd)",fontSize:".85rem",fontFamily:"inherit",minHeight:80,resize:"vertical"}} />
              </div>

              <button onClick={handleSave} disabled={saving} style={{width:"100%",padding:"14px",borderRadius:8,background:"var(--dt)",color:"white",border:"none",fontWeight:700,fontSize:".95rem",cursor:"pointer",opacity:saving?0.7:1,boxShadow:"0 4px 12px rgba(0,0,0,0.15)"}}>
                {saving ? "Saving..." : "Save Verification"}
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

function AdminRegistrations({ mob, C, auth }) {

  const [regs, setRegs] = useState([]);
  const [selectedSection, setSelectedSection] = useState("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewing, setViewing] = useState(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const d = await fbFetchRegistrations(auth?.idToken);
      setRegs(d || []);
    } catch(e) {
      console.error("Refresh error:", e);
    }
    setRefreshing(false);
  };
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


  const saveVerification = async (r, newStatus, newRemarks) => {
    const updatedBy = auth?.email || "Admin";
    setRegs(prev => prev.map(x => x.id === r.id ? { ...x, Status: newStatus, status: newStatus, Remarks: newRemarks, "Updated By": updatedBy } : x));
    try {
      const cleanData = { ...r, Status: newStatus, status: newStatus, Remarks: newRemarks, "Updated By": updatedBy };
      delete cleanData.id; delete cleanData._submittedAt;
      await fbUpdateRegistration(r.id, cleanData, auth?.idToken);
      // Removed setViewing(null) here so modal can handle auto-advance
    } catch (e) {
      alert("Failed to save verification: " + e.message);
      const d = await fbFetchRegistrations(auth?.idToken);
      setRegs(d || []);
    }
  };

  const handleStatusChange = async (r, newStatus) => {
    let newRemarks = r['Remarks'] || "";
    if (newStatus === "Disapproved" || newStatus === "Needs Info") {
      const reason = prompt(`Please enter the reason/remarks for '${newStatus}':`, newRemarks);
      if (reason === null) return; // User cancelled
      newRemarks = reason;
    }
    
    const updatedBy = auth?.email || "Admin";
    
    // Optimistic UI update
    setRegs(prev => prev.map(x => x.id === r.id ? { ...x, Status: newStatus, status: newStatus, Remarks: newRemarks, "Updated By": updatedBy } : x));
    
    try {
      const cleanData = { ...r, Status: newStatus, status: newStatus, Remarks: newRemarks, "Updated By": updatedBy };
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

  const handleDeleteRegistration = async (r) => {
    if (!window.confirm("Are you absolutely sure you want to permanently delete this registration? This action cannot be undone.")) return;
    try {
      await fbDeleteRegistration(r.id, auth?.idToken);
      setRegs(prev => prev.filter(x => x.id !== r.id));
      alert("Registration deleted successfully.");
    } catch (e) {
      alert("Failed to delete registration: " + e.message);
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
    
    // Group section filter
    const ev = C.events?.find(e => e.title === r.eventTitle || e.title === r.eventName || e.title === r.eventId);
    const evSection = ev?.section || "Default";
    if (selectedSection !== "All") {
      if (selectedSection === "Default") {
        if (evSection !== "Default" && evSection !== "") return false;
      } else {
        if (evSection !== selectedSection) return false;
      }
    }
    
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
    <div style={{padding:mob?"16px":"32px",width:"100%",boxSizing:"border-box"}}>
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
          <button onClick={handleRefresh} disabled={refreshing} style={{padding:"8px 16px",borderRadius:8,fontSize:".85rem",fontWeight:600,display:"flex",alignItems:"center",gap:6,background:"white",border:"1px solid var(--bd)",color:"var(--dt)",cursor:refreshing?"wait":"pointer",boxShadow:"0 2px 8px rgba(0,0,0,0.05)",whiteSpace:"nowrap"}}>
            {refreshing ? "..." : "↻"} Refresh
          </button>
          <button onClick={handleExportCSV} className="bt" style={{padding:"8px 16px",borderRadius:8,fontSize:".85rem",fontWeight:600,display:"flex",alignItems:"center",gap:8,whiteSpace:"nowrap",boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
            <span>📥</span> Export to CSV
          </button>
        </div>
      </div>

      {/* Group/Section Tabs */}
      <div style={{display:"flex", gap:8, marginBottom:20, flexWrap:"wrap", borderBottom:"1px solid var(--bd)", paddingBottom:12}}>
        {["All", "Default", ...(C.eventSections || [])].map(sec => {
          const isSelected = selectedSection === sec;
          return (
            <button key={sec} onClick={()=>setSelectedSection(sec)} style={{
              padding:"8px 16px", borderRadius:20, border:isSelected?"none":"1px solid var(--bd)",
              background:isSelected?"var(--dt)":"white", color:isSelected?"white":"var(--mu)",
              fontSize:".85rem", fontWeight:600, cursor:"pointer", transition:"all 0.2s"
            }}>
              {sec === "Default" ? "Default Section" : sec === "All" ? "All Groups" : sec}
            </button>
          );
        })}
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
                <th style={{padding:"14px 12px",textAlign:"center",whiteSpace:"nowrap"}}>View</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Date</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Event</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Txn ID</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Status</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Remarks</th>
                <th style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>Updated By</th>
                {allKeys.map(k => (
                  <th key={k} style={{padding:"14px 12px",textAlign:"left",whiteSpace:"nowrap"}}>{k}</th>
                ))}
                <th style={{padding:"14px 12px",textAlign:"left"}}>Delete</th>
              </tr>
              <tr style={{background:"#FAFAFA", borderBottom:"2px solid #E0E0E0"}}>
                <th></th>
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
                const ev = C.events?.find(e => e.title === r.eventTitle || e.title === r.eventName || e.title === r.eventId || e.id === r.eventId);

                return (
                  <tr key={i}>
                    <td style={{padding:"12px",textAlign:"center",whiteSpace:"nowrap"}}>
                      <button onClick={()=>setViewing(r)} style={{padding:"6px 12px",borderRadius:6,fontSize:".75rem",background:"var(--dt)",color:"white",border:"none",cursor:"pointer",fontWeight:500,boxShadow:"0 2px 6px rgba(0,0,0,0.15)"}}>View</button>
                    </td>
                    <td style={{padding:"12px",whiteSpace:"nowrap"}}>{date}</td>
                    <td style={{padding:"12px",whiteSpace:"nowrap"}}>
                      <div>{evName}</div>
                      {ev?.section && ev.section !== 'Default' && (
                        <span style={{fontSize:".7rem",background:"var(--tl)",color:"var(--dt)",padding:"2px 6px",borderRadius:4,marginTop:4,display:"inline-block",fontWeight:600}}>
                          {ev.section}
                        </span>
                      )}
                    </td>
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
                      <div style={{display:"flex", gap:"8px"}}>
                        <button onClick={()=>handleDeleteRegistration(r)} style={{padding:"6px 12px",borderRadius:6,fontSize:".75rem",background:"#FEF0EF",color:"#C0392B",border:"1px solid #F5B8B8",cursor:"pointer",fontWeight:500}} title="Permanently delete this registration">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRegs.length === 0 && <tr><td colSpan={allKeys.length + 8} style={{padding:40,textAlign:"center",color:"var(--mu)",fontSize:"1rem"}}>No registrations found matching your search.</td></tr>}
            </tbody>
          </table>
        </div>
        </>
      )}

      {viewing && (
        <VerificationModal viewing={viewing} setViewing={setViewing} allRegs={regs} saveVerification={saveVerification} />
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


// ── NEW PROFILE COMPONENTS ────────────────────────────────────────────────────────
function DashboardProfile({ globalProfile, globalAuthToken, mob }) {
  const [data, setData] = useState({ name: "", email: "", mobile: "", address: "", gender: "", photo: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (globalProfile) {
      setData({
        name: globalProfile.name || globalProfile['Full Name'] || "",
        email: globalProfile.email || "",
        mobile: globalProfile.mobile || globalProfile['Mobile Number'] || "",
        address: globalProfile.address || "",
        gender: globalProfile.gender || "",
        photo: globalProfile.photo || globalProfile.photoUrl || ""
      });
    }
  }, [globalProfile]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await fbUploadPublicFile(file, globalAuthToken);
      setData(prev => ({ ...prev, photo: url }));
    } catch(err) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: data.name,
        email: data.email,
        mobile: data.mobile,
        address: data.address,
        gender: data.gender,
        photo: data.photo,
        photoUrl: data.photo // support both
      };
      
      // Re-fetch user localId to save to users collection
      const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + getFB().apiKey, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({idToken: globalAuthToken})
      });
      const authData = await res.json();
      if (!authData.users || !authData.users[0]) throw new Error("Could not find user.");
      const localId = authData.users[0].localId;
      
      await fbSaveUserProfile(localId, payload, globalAuthToken);
      
      // Update local storage so next reload uses updated profile
      const newGlobalProfile = { ...globalProfile, ...payload };
      localStorage.setItem("globalProfile", JSON.stringify(newGlobalProfile));
      alert("Profile updated successfully! Refresh the page to see changes in the top bar.");
    } catch(e) {
      alert("Failed to save: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:"1.3rem",color:"var(--dt)",marginBottom:24,fontWeight:700}}>My Profile</h3>
      <div style={{background:"white",padding:mob?20:32,borderRadius:16,border:"1px solid var(--bd)"}}>
        
        <div style={{display:"flex",gap:24,marginBottom:32,alignItems:"center",flexDirection:mob?"column":"row"}}>
          <div style={{width:100,height:100,borderRadius:"50%",background:"#f5f5f5",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",border:"2px solid var(--bd)"}}>
            {data.photo ? <img src={data.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <span style={{fontSize:"2.5rem"}}>👤</span>}
          </div>
          <div style={{flex:1,textAlign:mob?"center":"left"}}>
            <label style={{cursor:"pointer",display:"inline-block",background:"var(--sf)",color:"white",padding:"8px 16px",borderRadius:8,fontWeight:600,fontSize:".9rem"}}>
              {uploading ? "Uploading..." : "Change Profile Photo"}
              <input type="file" style={{display:"none"}} accept="image/*" onChange={handlePhotoUpload} disabled={uploading}/>
            </label>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:20,marginBottom:24}}>
          <div>
            <label style={{display:"block",fontSize:".8rem",fontWeight:700,color:"var(--mu)",marginBottom:6}}>Full Name</label>
            <input type="text" value={data.name} onChange={e=>setData({...data,name:e.target.value})} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem"}}/>
          </div>
          <div>
            <label style={{display:"block",fontSize:".8rem",fontWeight:700,color:"var(--mu)",marginBottom:6}}>Mobile Number</label>
            <input type="text" value={data.mobile} onChange={e=>setData({...data,mobile:e.target.value})} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem"}}/>
          </div>
          <div>
            <label style={{display:"block",fontSize:".8rem",fontWeight:700,color:"var(--mu)",marginBottom:6}}>Email Address</label>
            <input type="email" value={data.email} onChange={e=>setData({...data,email:e.target.value})} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem"}}/>
          </div>
          <div>
            <label style={{display:"block",fontSize:".8rem",fontWeight:700,color:"var(--mu)",marginBottom:6}}>Gender</label>
            <select value={data.gender} onChange={e=>setData({...data,gender:e.target.value})} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem",background:"white"}}>
              <option value="">Select Gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div style={{gridColumn:mob?"1":"1 / -1"}}>
            <label style={{display:"block",fontSize:".8rem",fontWeight:700,color:"var(--mu)",marginBottom:6}}>Address</label>
            <textarea value={data.address} onChange={e=>setData({...data,address:e.target.value})} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem",minHeight:80,resize:"vertical"}}/>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving} className="btn-primary" style={{width:mob?"100%":"auto",padding:"12px 32px",borderRadius:8,fontSize:"1rem"}}>
          {saving ? "Saving Changes..." : "Save Profile"}
        </button>
      </div>
    </div>
  );
}

function AdminCertificates({ mob, C, auth }) {
  const [regs, setRegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchRegs = async () => {
    try {
      const d = await fbFetchRegistrations(auth?.idToken);
      setRegs(d || []);
    } catch(e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchRegs().finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchRegs();
    setRefreshing(false);
  };

  const toggleRelease = async (r) => {
    const newVal = !r.certificateReleased;
    setRegs(prev => prev.map(x => x.id === r.id ? { ...x, certificateReleased: newVal } : x));
    try {
      const cleanData = { ...r, certificateReleased: newVal };
      delete cleanData.id; delete cleanData._submittedAt;
      await fbUpdateRegistration(r.id, cleanData, auth?.idToken);
    } catch (e) {
      alert("Failed to update status: " + e.message);
      fetchRegs();
    }
  };

  const handlePreview = async (r, ev) => {
    const fieldsData = {...r};
    const sName = fieldsData["Full Name"] || fieldsData["Name"] || fieldsData["Participant Name"] || "Student";
    try {
      await generateCertificatePDF(ev, fieldsData, sName, true);
    } catch (e) {
      alert("Error generating certificate: " + e.message);
    }
  };

  const certEvents = (C.events || []).filter(e => e.issueCertificates === true || e.issueCertificates === "true");
  const certEventIds = certEvents.map(e => e.id);
  const certEventTitles = certEvents.map(e => e.title);
  const certEventTitlesGu = certEvents.map(e => e.titleGu);

  const certRegs = regs.filter(r => {
    if (r.Status !== "Approved") return false;
    let evName = r.eventName || r.eventTitle || r.eventId;
    return certEventIds.includes(r.eventId) || certEventTitles.includes(evName) || certEventTitlesGu.includes(evName);
  });

  const filteredRegs = certRegs.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return Object.values(r).some(v => String(v).toLowerCase().includes(q));
  });

  return (
    <div style={{display:"flex",width:"100%"}}>
      <div style={{flex:1,padding:mob?"16px":"32px",width:"100%",boxSizing:"border-box",overflowX:"hidden"}}>
        <div style={{display:"flex",flexDirection:mob?"column":"row",justifyContent:"space-between",alignItems:mob?"flex-start":"center",marginBottom:20,gap:16}}>
          <div>
            <h2 style={{fontFamily:"'Playfair Display',serif",color:"var(--dt)",margin:0}}>Certificate Console</h2>
            <p style={{fontSize:".85rem",color:"var(--mu)",marginTop:4}}>Manage and release certificates for approved registrations.</p>
          </div>
          <div style={{display:"flex",gap:12,width:mob?"100%":"auto"}}>
            <input type="text" placeholder="Search students..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".85rem",flex:1,minWidth:250,outline:"none",fontFamily:"inherit"}} />
            <button onClick={handleRefresh} disabled={refreshing} style={{padding:"8px 16px",borderRadius:8,fontSize:".85rem",fontWeight:600,display:"flex",alignItems:"center",gap:6,background:"white",border:"1px solid var(--bd)",color:"var(--dt)",cursor:refreshing?"wait":"pointer",boxShadow:"0 2px 8px rgba(0,0,0,0.05)",whiteSpace:"nowrap"}}>
              {refreshing ? "..." : "↻"} Refresh
            </button>
          </div>
        </div>

        {loading ? <p>Loading certificates...</p> : (
          <div style={{borderRadius:12,boxShadow:"0 10px 30px rgba(0,0,0,0.06)",overflow:"hidden",border:"1px solid #E0E0E0",background:"white",overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:".85rem",minWidth:900}}>
              <thead>
                <tr>
                  <th style={{padding:"14px 12px",textAlign:"left",background:"var(--dt)",color:"white",fontWeight:600}}>Date Approved</th>
                  <th style={{padding:"14px 12px",textAlign:"left",background:"var(--dt)",color:"white",fontWeight:600}}>Event</th>
                  <th style={{padding:"14px 12px",textAlign:"left",background:"var(--dt)",color:"white",fontWeight:600}}>Participant Name</th>
                  <th style={{padding:"14px 12px",textAlign:"center",background:"var(--dt)",color:"white",fontWeight:600}}>Status</th>
                  <th style={{padding:"14px 12px",textAlign:"center",background:"var(--dt)",color:"white",fontWeight:600}}>Viewed On</th>
                  <th style={{padding:"14px 12px",textAlign:"center",background:"var(--dt)",color:"white",fontWeight:600}}>Downloaded On</th>
                  <th style={{padding:"14px 12px",textAlign:"center",background:"var(--dt)",color:"white",fontWeight:600}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRegs.map((r, i) => {
                  let date = "-";
                  try { if(r._submittedAt) date = new Date(r._submittedAt).toLocaleString().split(',')[0]; } catch(e){}
                  let evName = r.eventName || r.eventTitle || r.eventId || "Unknown Event";
                  let pName = r["Full Name"] || r["Name"] || r["Participant Name"] || r.Email || "-";
                  let ev = certEvents.find(e => e.id === r.eventId || e.title === evName || e.titleGu === evName);
                  
                  let vDate = r.certViewDate ? new Date(r.certViewDate).toLocaleString() : "-";
                  let dDate = r.certDownloadDate ? new Date(r.certDownloadDate).toLocaleString() : "-";

                  return (
                    <tr key={i} style={{borderBottom:"1px solid #eee"}}>
                      <td style={{padding:"12px"}}>{date}</td>
                      <td style={{padding:"12px"}}>{evName}</td>
                      <td style={{padding:"12px",fontWeight:600}}>{pName}</td>
                      <td style={{padding:"12px",textAlign:"center"}}>
                        <span style={{padding:"4px 8px",borderRadius:6,fontSize:".75rem",fontWeight:700,background:r.certificateReleased?"#EDFAF1":"#FEF9EC",color:r.certificateReleased?"#1A7A3E":"#C8860A"}}>
                          {r.certificateReleased ? "Released" : "Pending"}
                        </span>
                      </td>
                      <td style={{padding:"12px",textAlign:"center",color:"var(--mu)",fontSize:".75rem"}}>{vDate}</td>
                      <td style={{padding:"12px",textAlign:"center",color:"var(--mu)",fontSize:".75rem"}}>{dDate}</td>
                      <td style={{padding:"12px",textAlign:"center"}}>
                        <div style={{display:"flex",justifyContent:"center",gap:8}}>
                          <button onClick={()=>handlePreview(r, ev)} style={{padding:"6px 12px",borderRadius:6,fontSize:".75rem",background:"white",border:"1px solid var(--bd)",cursor:"pointer",fontWeight:600}}>Preview</button>
                          <button onClick={()=>toggleRelease(r)} style={{padding:"6px 12px",borderRadius:6,fontSize:".75rem",background:r.certificateReleased?"#f5f5f5":"var(--dt)",color:r.certificateReleased?"#333":"white",border:r.certificateReleased?"1px solid #ccc":"none",cursor:"pointer",fontWeight:600}}>
                            {r.certificateReleased ? "Revoke" : "Release"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredRegs.length === 0 && <tr><td colSpan={7} style={{padding:40,textAlign:"center",color:"var(--mu)"}}>No certificates found to manage.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


function AdminInviteLetters({ mob, C, auth }) {
  const [regs, setRegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchRegs = async () => {
    try {
      const d = await fbFetchRegistrations(auth?.idToken);
      setRegs(d || []);
    } catch(e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchRegs().finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchRegs();
    setRefreshing(false);
  };

  const toggleRelease = async (r) => {
    const newVal = !r.inviteificateReleased;
    setRegs(prev => prev.map(x => x.id === r.id ? { ...x, inviteificateReleased: newVal } : x));
    try {
      const cleanData = { ...r, inviteificateReleased: newVal };
      delete cleanData.id; delete cleanData._submittedAt;
      await fbUpdateRegistration(r.id, cleanData, auth?.idToken);
    } catch (e) {
      alert("Failed to update status: " + e.message);
      fetchRegs();
    }
  };

  const handlePreview = async (r, ev) => {
    const fieldsData = {...r};
    const sName = fieldsData["Full Name"] || fieldsData["Name"] || fieldsData["Participant Name"] || "Student";
    try {
      await generateCertificatePDF(ev, fieldsData, sName, true);
    } catch (e) {
      alert("Error generating inviteificate: " + e.message);
    }
  };

  const inviteEvents = (C.events || []).filter(e => e.issueInviteLetters === true || e.issueInviteLetters === "true");
  const inviteEventIds = inviteEvents.map(e => e.id);
  const inviteEventTitles = inviteEvents.map(e => e.title);
  const inviteEventTitlesGu = inviteEvents.map(e => e.titleGu);

  const inviteRegs = regs.filter(r => {
    if (r.Status !== "Approved") return false;
    let evName = r.eventName || r.eventTitle || r.eventId;
    return inviteEventIds.includes(r.eventId) || inviteEventTitles.includes(evName) || inviteEventTitlesGu.includes(evName);
  });

  const filteredRegs = inviteRegs.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return Object.values(r).some(v => String(v).toLowerCase().includes(q));
  });

  return (
    <div style={{display:"flex",width:"100%"}}>
      <div style={{flex:1,padding:mob?"16px":"32px",width:"100%",boxSizing:"border-box",overflowX:"hidden"}}>
        <div style={{display:"flex",flexDirection:mob?"column":"row",justifyContent:"space-between",alignItems:mob?"flex-start":"center",marginBottom:20,gap:16}}>
          <div>
            <h2 style={{fontFamily:"'Playfair Display',serif",color:"var(--dt)",margin:0}}>Certificate Console</h2>
            <p style={{fontSize:".85rem",color:"var(--mu)",marginTop:4}}>Manage and release inviteLetters for approved registrations.</p>
          </div>
          <div style={{display:"flex",gap:12,width:mob?"100%":"auto"}}>
            <input type="text" placeholder="Search students..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",fontSize:".85rem",flex:1,minWidth:250,outline:"none",fontFamily:"inherit"}} />
            <button onClick={handleRefresh} disabled={refreshing} style={{padding:"8px 16px",borderRadius:8,fontSize:".85rem",fontWeight:600,display:"flex",alignItems:"center",gap:6,background:"white",border:"1px solid var(--bd)",color:"var(--dt)",cursor:refreshing?"wait":"pointer",boxShadow:"0 2px 8px rgba(0,0,0,0.05)",whiteSpace:"nowrap"}}>
              {refreshing ? "..." : "↻"} Refresh
            </button>
          </div>
        </div>

        {loading ? <p>Loading inviteLetters...</p> : (
          <div style={{borderRadius:12,boxShadow:"0 10px 30px rgba(0,0,0,0.06)",overflow:"hidden",border:"1px solid #E0E0E0",background:"white",overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:".85rem",minWidth:900}}>
              <thead>
                <tr>
                  <th style={{padding:"14px 12px",textAlign:"left",background:"var(--dt)",color:"white",fontWeight:600}}>Date Approved</th>
                  <th style={{padding:"14px 12px",textAlign:"left",background:"var(--dt)",color:"white",fontWeight:600}}>Event</th>
                  <th style={{padding:"14px 12px",textAlign:"left",background:"var(--dt)",color:"white",fontWeight:600}}>Participant Name</th>
                  <th style={{padding:"14px 12px",textAlign:"center",background:"var(--dt)",color:"white",fontWeight:600}}>Status</th>
                  <th style={{padding:"14px 12px",textAlign:"center",background:"var(--dt)",color:"white",fontWeight:600}}>Viewed On</th>
                  <th style={{padding:"14px 12px",textAlign:"center",background:"var(--dt)",color:"white",fontWeight:600}}>Downloaded On</th>
                  <th style={{padding:"14px 12px",textAlign:"center",background:"var(--dt)",color:"white",fontWeight:600}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRegs.map((r, i) => {
                  let date = "-";
                  try { if(r._submittedAt) date = new Date(r._submittedAt).toLocaleString().split(',')[0]; } catch(e){}
                  let evName = r.eventName || r.eventTitle || r.eventId || "Unknown Event";
                  let pName = r["Full Name"] || r["Name"] || r["Participant Name"] || r.Email || "-";
                  let ev = inviteEvents.find(e => e.id === r.eventId || e.title === evName || e.titleGu === evName);
                  
                  let vDate = r.inviteViewDate ? new Date(r.inviteViewDate).toLocaleString() : "-";
                  let dDate = r.inviteDownloadDate ? new Date(r.inviteDownloadDate).toLocaleString() : "-";

                  return (
                    <tr key={i} style={{borderBottom:"1px solid #eee"}}>
                      <td style={{padding:"12px"}}>{date}</td>
                      <td style={{padding:"12px"}}>{evName}</td>
                      <td style={{padding:"12px",fontWeight:600}}>{pName}</td>
                      <td style={{padding:"12px",textAlign:"center"}}>
                        <span style={{padding:"4px 8px",borderRadius:6,fontSize:".75rem",fontWeight:700,background:r.inviteificateReleased?"#EDFAF1":"#FEF9EC",color:r.inviteificateReleased?"#1A7A3E":"#C8860A"}}>
                          {r.inviteificateReleased ? "Released" : "Pending"}
                        </span>
                      </td>
                      <td style={{padding:"12px",textAlign:"center",color:"var(--mu)",fontSize:".75rem"}}>{vDate}</td>
                      <td style={{padding:"12px",textAlign:"center",color:"var(--mu)",fontSize:".75rem"}}>{dDate}</td>
                      <td style={{padding:"12px",textAlign:"center"}}>
                        <div style={{display:"flex",justifyContent:"center",gap:8}}>
                          <button onClick={()=>handlePreview(r, ev)} style={{padding:"6px 12px",borderRadius:6,fontSize:".75rem",background:"white",border:"1px solid var(--bd)",cursor:"pointer",fontWeight:600}}>Preview</button>
                          <button onClick={()=>toggleRelease(r)} style={{padding:"6px 12px",borderRadius:6,fontSize:".75rem",background:r.inviteificateReleased?"#f5f5f5":"var(--dt)",color:r.inviteificateReleased?"#333":"white",border:r.inviteificateReleased?"1px solid #ccc":"none",cursor:"pointer",fontWeight:600}}>
                            {r.inviteificateReleased ? "Revoke" : "Release"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredRegs.length === 0 && <tr><td colSpan={7} style={{padding:40,textAlign:"center",color:"var(--mu)"}}>No inviteLetters found to manage.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


function AdminMeritList({ mob, C, auth }) {
  const [regs, setRegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState("");
  
  // Field Mapping
  const [nameField, setNameField] = useState("Full Name");
  const [groupField, setGroupField] = useState("Standard");
  const [percentField, setPercentField] = useState("Percentage");
  
  // Groups Management
  const [groupsOrder, setGroupsOrder] = useState([]);
  const [cols, setCols] = useState(2);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fbFetchRegistrations(auth?.idToken).then(d => {
      setRegs(d || []); setLoading(false);
    }).catch(e => {
      console.error(e); setLoading(false);
    });
  }, [auth]);

  const events = C.events || [];
  
  // When event or grouping field changes, auto-extract groups
  useEffect(() => {
    if (!selectedEventId || !groupField) {
      setGroupsOrder([]);
      return;
    }
    const evRegs = regs.filter(r => r.eventId === selectedEventId && r.Status === "Approved");
    const uniqueGroups = new Set();
    evRegs.forEach(r => {
      let gVal = r[groupField];
      if (gVal) uniqueGroups.add(String(gVal).trim());
    });
    setGroupsOrder(Array.from(uniqueGroups).sort());
  }, [selectedEventId, groupField, regs]);

  const moveGroup = (index, direction) => {
    const newOrder = [...groupsOrder];
    if (direction === -1 && index > 0) {
      [newOrder[index], newOrder[index-1]] = [newOrder[index-1], newOrder[index]];
    } else if (direction === 1 && index < newOrder.length - 1) {
      [newOrder[index], newOrder[index+1]] = [newOrder[index+1], newOrder[index]];
    }
    setGroupsOrder(newOrder);
  };

  const getAvailableFields = () => {
    if (!selectedEventId) return [];
    const evRegs = regs.filter(r => r.eventId === selectedEventId);
    const keys = new Set();
    evRegs.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
    return Array.from(keys).filter(k => !['id', 'eventId', 'Status', 'isGlobalGuest', '_submittedAt', 'eventName', 'eventTitle', 'globalGuestId'].includes(k)).sort();
  };

  const availableFields = getAvailableFields();

  const handleGeneratePDF = () => {
    if (!selectedEventId) return alert("Select an event first.");
    if (groupsOrder.length === 0) return alert("No groups found for this field.");
    setGenerating(true);

    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const ev = events.find(e => e.id === selectedEventId);
      const evTitle = ev ? (ev.title || "Event") : "Merit List";
      
      const evRegs = regs.filter(r => r.eventId === selectedEventId && r.Status === "Approved");

      let yPos = 20;
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text(`Merit List - ${evTitle}`, 105, yPos, { align: "center" });
      yPos += 10;

      const pageWidth = doc.internal.pageSize.width; // A4 width is 210
      const margins = 15;
      const contentWidth = pageWidth - (margins * 2);
      const colWidth = contentWidth / cols;
      const rowHeight = 6;

      groupsOrder.forEach((g, gIdx) => {
        // Find students for this group
        const groupRegs = evRegs.filter(r => String(r[groupField] || "").trim() === g);
        if (groupRegs.length === 0) return;

        // Sort students: primary % (desc), secondary Name (asc)
        groupRegs.sort((a, b) => {
           let pA = String(a[percentField] || "").replace(/[^0-9.]/g, '');
           let pB = String(b[percentField] || "").replace(/[^0-9.]/g, '');
           let numA = parseFloat(pA) || 0;
           let numB = parseFloat(pB) || 0;
           if (numA !== numB) return numB - numA; // Descending
           
           let nA = String(a[nameField] || "").toLowerCase();
           let nB = String(b[nameField] || "").toLowerCase();
           if (nA < nB) return -1;
           if (nA > nB) return 1;
           return 0;
        });

        // Add group header
        if (yPos > 270) { doc.addPage(); yPos = 20; }
        yPos += 5;
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(`Group: ${g} (${groupRegs.length} students)`, margins, yPos);
        yPos += 8;

        doc.setFontSize(10);
        
        let currentCol = 0;
        let startY = yPos;
        let maxY = yPos;

        groupRegs.forEach((r, idx) => {
           const sName = String(r[nameField] || "Unknown");
           const sPct = String(r[percentField] || "-");

           if (yPos > 280) {
             currentCol++;
             if (currentCol >= cols) {
               // New page
               doc.addPage();
               currentCol = 0;
               startY = 20;
               yPos = startY;
               maxY = startY;
             } else {
               yPos = startY;
             }
           }

           const xPos = margins + (currentCol * colWidth);
           doc.setFont("helvetica", "normal");
           
           // Truncate name if it's too long for column
           const maxNameLen = cols === 3 ? 18 : 30;
           let dispName = sName;
           if (dispName.length > maxNameLen) dispName = dispName.substring(0, maxNameLen-2) + "..";

           doc.text(`${idx+1}. ${dispName}`, xPos, yPos);
           
           // Right align percentage within the column
           doc.setFont("helvetica", "bold");
           doc.text(sPct, xPos + colWidth - 8, yPos, { align: "right" });
           
           yPos += rowHeight;
           if (yPos > maxY) maxY = yPos;
        });

        // Move cursor below the tallest column
        yPos = maxY + 5;
      });

      doc.save(`Merit_List_${evTitle.replace(/[^a-z0-9]/gi, '_')}.pdf`);
    } catch(e) {
      alert("Error generating PDF: " + e.message);
    }
    setGenerating(false);
  };

  if (loading) return <div style={{padding:40}}>Loading data...</div>;

  return (
    <div style={{padding:mob?"16px":"32px"}}>
      <h2 style={{fontFamily:"'Playfair Display',serif",color:"var(--dt)",margin:0}}>Reports & Lists</h2>
      <p style={{fontSize:".85rem",color:"var(--mu)",marginTop:4,marginBottom:24}}>Generate multi-column merit lists sorted by grouped criteria.</p>

      <div style={{display:"flex",flexDirection:mob?"column":"row",gap:24}}>
        
        {/* Left Column: Settings */}
        <div style={{flex:1, background:"#F9F9F9", border:"1px solid #eee", borderRadius:12, padding:20}}>
          <h3 style={{fontSize:"1.1rem",marginBottom:16,borderBottom:"1px solid #ddd",paddingBottom:8}}>1. Setup</h3>
          
          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:".85rem",fontWeight:600,marginBottom:6}}>Select Event</label>
            <select value={selectedEventId} onChange={e=>setSelectedEventId(e.target.value)} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",outline:"none"}}>
              <option value="">-- Choose Event --</option>
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
            </select>
          </div>

          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:".85rem",fontWeight:600,marginBottom:6}}>Grouping Field (e.g. Standard, Section)</label>
            <select value={groupField} onChange={e=>setGroupField(e.target.value)} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",outline:"none"}}>
               <option value="Standard">Standard</option>
               <option value="Group">Group</option>
               <option value="Category">Category</option>
               {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:".85rem",fontWeight:600,marginBottom:6}}>Name Field</label>
            <select value={nameField} onChange={e=>setNameField(e.target.value)} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",outline:"none"}}>
               <option value="Full Name">Full Name</option>
               <option value="Name">Name</option>
               <option value="Participant Name">Participant Name</option>
               {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:".85rem",fontWeight:600,marginBottom:6}}>Percentage / Metric Field</label>
            <select value={percentField} onChange={e=>setPercentField(e.target.value)} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid var(--bd)",outline:"none"}}>
               <option value="Percentage">Percentage</option>
               <option value="%">%</option>
               <option value="Result">Result</option>
               <option value="Score">Score</option>
               {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:".85rem",fontWeight:600,marginBottom:6}}>Columns per Page</label>
            <div style={{display:"flex",gap:16}}>
              <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                <input type="radio" name="cols" checked={cols === 2} onChange={()=>setCols(2)} /> 2 Columns
              </label>
              <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                <input type="radio" name="cols" checked={cols === 3} onChange={()=>setCols(3)} /> 3 Columns
              </label>
            </div>
          </div>
          
          <button onClick={handleGeneratePDF} disabled={generating || groupsOrder.length===0} style={{width:"100%",padding:"12px",background:"var(--dt)",color:"white",border:"none",borderRadius:8,fontWeight:600,cursor:(generating||groupsOrder.length===0)?"not-allowed":"pointer",boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
            {generating ? "Generating PDF..." : "📄 Generate Merit List PDF"}
          </button>
        </div>

        {/* Right Column: Group Ordering */}
        <div style={{flex:1, background:"#F9F9F9", border:"1px solid #eee", borderRadius:12, padding:20}}>
           <h3 style={{fontSize:"1.1rem",marginBottom:16,borderBottom:"1px solid #ddd",paddingBottom:8}}>2. Group Order</h3>
           <p style={{fontSize:".85rem",color:"var(--mu)",marginBottom:16}}>Set the order in which groups will appear on the PDF. (Drag up/down)</p>
           
           {!selectedEventId && <div style={{color:"var(--mu)",fontSize:".9rem"}}>Please select an event first.</div>}
           {selectedEventId && groupsOrder.length === 0 && <div style={{color:"var(--mu)",fontSize:".9rem"}}>No groups found for the selected field.</div>}

           <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:450,overflowY:"auto"}}>
             {groupsOrder.map((g, idx) => (
               <div key={g} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"white",padding:"8px 12px",borderRadius:6,border:"1px solid #ddd"}}>
                 <span style={{fontWeight:600,fontSize:".9rem"}}>{idx+1}. {g}</span>
                 <div style={{display:"flex",gap:6}}>
                   <button onClick={()=>moveGroup(idx, -1)} disabled={idx===0} style={{padding:"4px 8px",background:idx===0?"#f5f5f5":"white",border:"1px solid #ddd",borderRadius:4,cursor:idx===0?"not-allowed":"pointer"}}>↑</button>
                   <button onClick={()=>moveGroup(idx, 1)} disabled={idx===groupsOrder.length-1} style={{padding:"4px 8px",background:idx===groupsOrder.length-1?"#f5f5f5":"white",border:"1px solid #ddd",borderRadius:4,cursor:idx===groupsOrder.length-1?"not-allowed":"pointer"}}>↓</button>
                 </div>
               </div>
             ))}
           </div>
        </div>

      </div>
    </div>
  );
}


function AdminProfile({ auth, mob, adminProfile, setAdminProfile }) {
  const [data, setData] = useState({ name: "", email: "", mobile: "", address: "", gender: "", photo: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (adminProfile) {
      setData({
        name: adminProfile.name || adminProfile['Full Name'] || "",
        email: adminProfile.email || auth.email || "",
        mobile: adminProfile.mobile || adminProfile['Mobile Number'] || "",
        address: adminProfile.address || "",
        gender: adminProfile.gender || "",
        photo: adminProfile.photo || adminProfile.photoUrl || ""
      });
    } else {
      setData(prev => ({ ...prev, email: auth.email || "" }));
    }
  }, [adminProfile, auth.email]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await fbUploadPhoto(file, auth.idToken);
      setData(prev => ({ ...prev, photo: url }));
    } catch(err) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: data.name,
        email: data.email,
        mobile: data.mobile,
        address: data.address,
        gender: data.gender,
        photo: data.photo,
        photoUrl: data.photo // support both
      };
      
      await fbSaveUserProfile(auth.localId, payload, auth.idToken);
      if(setAdminProfile) setAdminProfile(payload);
      alert("Admin profile updated successfully!");
    } catch(e) {
      alert("Failed to save: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{padding:mob?16:32,background:"#F4F6F8",minHeight:"100%"}}>
      <h2 style={{fontSize:"1.4rem",color:"var(--dt)",marginBottom:24,marginTop:0}}>Admin Profile</h2>
      <div style={{background:"white",padding:mob?20:32,borderRadius:16,border:"1px solid var(--bd)"}}>
        
        <div style={{display:"flex",gap:24,marginBottom:32,alignItems:"center",flexDirection:mob?"column":"row"}}>
          <div style={{width:100,height:100,borderRadius:"50%",background:"#f5f5f5",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",border:"2px solid var(--bd)"}}>
            {data.photo ? <img src={data.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <span style={{fontSize:"2.5rem"}}>👤</span>}
          </div>
          <div style={{flex:1,textAlign:mob?"center":"left"}}>
            <label style={{cursor:"pointer",display:"inline-block",background:"var(--dt)",color:"white",padding:"8px 16px",borderRadius:8,fontWeight:600,fontSize:".9rem"}}>
              {uploading ? "Uploading..." : "Change Admin Photo"}
              <input type="file" style={{display:"none"}} accept="image/*" onChange={handlePhotoUpload} disabled={uploading}/>
            </label>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:20,marginBottom:24}}>
          <div>
            <label style={{display:"block",fontSize:".8rem",fontWeight:700,color:"var(--mu)",marginBottom:6}}>Full Name</label>
            <input type="text" value={data.name} onChange={e=>setData({...data,name:e.target.value})} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem"}}/>
          </div>
          <div>
            <label style={{display:"block",fontSize:".8rem",fontWeight:700,color:"var(--mu)",marginBottom:6}}>Email Address</label>
            <input type="email" value={data.email} onChange={e=>setData({...data,email:e.target.value})} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem"}}/>
          </div>
          <div>
            <label style={{display:"block",fontSize:".8rem",fontWeight:700,color:"var(--mu)",marginBottom:6}}>Mobile Number</label>
            <input type="text" value={data.mobile} onChange={e=>setData({...data,mobile:e.target.value})} style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem"}}/>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving} className="btn-primary" style={{width:mob?"100%":"auto",padding:"12px 32px",borderRadius:8,fontSize:"1rem"}}>
          {saving ? "Saving Changes..." : "Save Admin Profile"}
        </button>
      </div>
    </div>
  );
}

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
    setPage("admin");
  };

  const handleLogout = () => {
    setAuth(null);
  };

  // ── Loading splash ────────────────────────────────────────────────────────
  if (fbState === "loading") return (
    <div id="app-root" className={C?.theme || "classic"}>
      <G theme={C?.theme || "classic"} />
      <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0D4B5E,#1A6B87)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
        <LogoMark logo={{...C.trust.logo, size: 60}} mob={false} />
        <div style={{color:"white",fontFamily:"'Playfair Display',serif",fontSize:"1.1rem"}}>Loading {C.trust.name}...</div>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,.2)",overflow:"hidden"}}>
          <div style={{height:"100%",background:"var(--sf)",borderRadius:2,animation:"shimLoad 1.2s ease-in-out infinite"}}/>
        </div>
        <style>{`@keyframes shimLoad{0%{width:0%}100%{width:100%}}`}</style>
      </div>
    </div>
  );

  return (
    <div id="app-root" className={C?.theme || "classic"}>
      <G theme={C?.theme || "classic"} />
      {page === "public"
        ? <Public C={C} lang={lang} setLang={setLang} setPage={goAdmin} auth={auth} onShowLogin={()=>setShowLogin(true)}/>
        : <Admin  C={C} setC={setC} setPage={setPage} auth={auth} onLogout={handleLogout} onShowLogin={()=>setShowLogin(true)}/>}
      {/* Login modal — overlays whatever page is showing */}
      {showLogin && <LoginScreen C={C} onLogin={handleLogin} onSkip={()=>setShowLogin(false)}/>}
    </div>
  );
}

