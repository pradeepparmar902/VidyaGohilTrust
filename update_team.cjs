const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'CharitableTrust.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Inject state and functions inside AdminTeam
const stateSearch = `  const [activeNode, setActiveNode] = useState(null); // For editing details
  const [menuNode, setMenuNode] = useState(null); // For Add actions

  // Sync state if C changes`;
const stateReplace = `  const [activeNode, setActiveNode] = useState(null); // For editing details
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
      if (u.name) updateActiveNode("name", u.name);
      if (u.photo) updateActiveNode("image", u.photo);
      else if (u.photoUrl) updateActiveNode("image", u.photoUrl);
      if (u.position) updateActiveNode("position", u.position);
      e.target.value = "";
    }
  };

  // Sync state if C changes`;
content = content.replace(stateSearch, stateReplace);

// 2. Inject Modal changes
const modalSearch = `            <div style={{display:"flex",gap:16,marginBottom:20}}>
              <div style={{width:80,height:80,borderRadius:"50%",background:"#f5f5f5",overflow:"hidden",position:"relative"}}>
                {activeNode.image ? <img src={activeNode.image} style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"2rem"}}>👤</div>}
              </div>
              <div style={{flex:1}}>
                <label style={{display:"block",fontSize:".75rem",fontWeight:700,color:"var(--mu)",marginBottom:4}}>PHOTO URL (OR FIREBASE STORAGE URL)</label>
                <input type="text" value={activeNode.image} onChange={e=>updateActiveNode("image", e.target.value)} style={{width:"100%",padding:10,borderRadius:8,border:"1px solid var(--bd)",fontSize:".9rem"}} placeholder="https://..."/>
                <div style={{fontSize:".7rem",color:"var(--sf)",marginTop:4}}>*Tip: Upload image in Gallery first and paste link here for now.</div>
              </div>
            </div>`;
            
const modalReplace = `            <div style={{marginBottom:24, paddingBottom:20, borderBottom:"1px solid #eee"}}>
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
            </div>`;
content = content.replace(modalSearch, modalReplace);

fs.writeFileSync(file, content, 'utf8');
console.log("Updated AdminTeam modal.");
