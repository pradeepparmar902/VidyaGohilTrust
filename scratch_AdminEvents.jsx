function AdminEvents({ mob, C, setC, auth }) {
  const [items, setItems] = useState(C.events || []);
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
