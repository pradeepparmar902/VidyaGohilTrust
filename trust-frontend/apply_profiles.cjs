const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'CharitableTrust.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Update ANAV
content = content.replace(
  `  {id:"access",icon:"🔐",label:"Access Control"},`,
  `  {id:"access",icon:"🔐",label:"Access Control"},\n  {id:"profile",icon:"👤",label:"My Profile"},`
);

// 2. Update Admin hasAccess
content = content.replace(
  `hasAccess = master ? ["content", "overview", "donations", "events", "registrations", "volunteers", "gallery", "team", "achievements", "settings", "access"] : (userRole?.permissions || []);`,
  `hasAccess = master ? ["content", "overview", "donations", "events", "registrations", "volunteers", "gallery", "team", "achievements", "settings", "access", "profile"] : [...(userRole?.permissions || []), "profile"];`
);

// 3. Update Admin state to fetch admin profile
const adminStartSearch = `  const [open, setOpen] = useState(true);
  const w = useW(); const mob = w<768;`;
const adminStartReplace = `  const [open, setOpen] = useState(true);
  const [adminProfile, setAdminProfile] = useState(null);
  useEffect(() => {
    if (auth?.idToken && auth?.localId) {
      fbFetchUserProfile(auth.localId, auth.idToken).then(p => {
        if(p) setAdminProfile(p);
      }).catch(console.error);
    }
  }, [auth]);
  const w = useW(); const mob = w<768;`;
content = content.replace(adminStartSearch, adminStartReplace);

// 4. Update Admin Sidebar Logout section
const adminLogoutSearch = `          {/* Login / Logout in sidebar */}
          {auth?.email ? (
            <div onClick={onLogout} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",cursor:"pointer",borderRadius:10,justifyContent:open?"flex-start":"center",background:"rgba(192,57,43,.15)"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(192,57,43,.25)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(192,57,43,.15)"}>
              <span style={{fontSize:"1rem",flexShrink:0}}>🚪</span>
              {open && <div style={{minWidth:0}}>
                <div style={{fontSize:".75rem",color:"rgba(255,255,255,.8)",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{auth.email}</div>
                <div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)"}}>Tap to logout</div>
              </div>}
            </div>`;
const adminLogoutReplace = `          {/* Login / Logout in sidebar */}
          {auth?.email ? (
            <div onClick={onLogout} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",cursor:"pointer",borderRadius:10,justifyContent:open?"flex-start":"center",background:"rgba(192,57,43,.15)"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(192,57,43,.25)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(192,57,43,.15)"}>
              {adminProfile?.photo || adminProfile?.photoUrl ? (
                <img src={adminProfile.photo || adminProfile.photoUrl} style={{width:24,height:24,borderRadius:"50%",objectFit:"cover",flexShrink:0}} />
              ) : (
                <span style={{fontSize:"1rem",flexShrink:0}}>🚪</span>
              )}
              {open && <div style={{minWidth:0}}>
                <div style={{fontSize:".75rem",color:"rgba(255,255,255,.8)",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{adminProfile?.name || auth.email}</div>
                <div style={{fontSize:".65rem",color:"rgba(255,255,255,.45)"}}>Tap to logout</div>
              </div>}
            </div>`;
content = content.replace(adminLogoutSearch, adminLogoutReplace);

// 5. Update Admin render switch
content = content.replace(
  `{tab==="access"    && hasAccess.includes("access") && <AdminAccess C={C} setC={setC} master={master} auth={auth}/>}`,
  `{tab==="access"    && hasAccess.includes("access") && <AdminAccess C={C} setC={setC} master={master} auth={auth}/>}\n          {tab==="profile"   && hasAccess.includes("profile") && <AdminProfile auth={auth} mob={mob} adminProfile={adminProfile} setAdminProfile={setAdminProfile}/>}`
);

// 6. Update UserDashboard tabs
const udTabsSearch = `  const tabs = [
    { id: "Registrations", label: "Event Registrations", icon: "📅" },
    { id: "Awards", label: "Education Awards", icon: "🎓" },
    { id: "Receipts", label: "Payment Receipts", icon: "🧾" },
    { id: "Invites", label: "Special Invites", icon: "💌" }
  ];`;
const udTabsReplace = `  const tabs = [
    { id: "Registrations", label: "Event Registrations", icon: "📅" },
    { id: "Awards", label: "Education Awards", icon: "🎓" },
    { id: "Receipts", label: "Payment Receipts", icon: "🧾" },
    { id: "Invites", label: "Special Invites", icon: "💌" },
    { id: "Profile", label: "My Profile", icon: "👤" }
  ];`;
content = content.replace(udTabsSearch, udTabsReplace);

// 7. Update UserDashboard content switch
const udContentSearch = `          <div style={{flex:1,padding:mob?"20px 16px":"32px",overflowY:"auto",background:"#F8F9FA"}}>
            {activeTab === "Registrations" && (`;
const udContentReplace = `          <div style={{flex:1,padding:mob?"20px 16px":"32px",overflowY:"auto",background:"#F8F9FA"}}>
            {activeTab === "Profile" && <DashboardProfile globalProfile={globalProfile} globalAuthToken={globalAuthToken} mob={mob} />}
            {activeTab === "Registrations" && (`;
content = content.replace(udContentSearch, udContentReplace);

// 8. Append new components
const newComponents = `

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
      const url = await fbUploadPhoto(file, globalAuthToken);
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
      const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FB.apiKey, {
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

export default function App() {`;
content = content.replace(`export default function App() {`, newComponents);

fs.writeFileSync(file, content, 'utf8');
console.log("Applied profile changes.");
