function AdminRegistrations({ mob, C, setC, auth }) {

  const [regs, setRegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewing, setViewing] = useState(null);
  
  const [activeSection, setActiveSection] = useState("All");
  const [newSectionName, setNewSectionName] = useState("");
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [deleteSecConfirm, setDeleteSecConfirm] = useState(null);
  const [deleteSecPass, setDeleteSecPass] = useState("");
  const [deleteSecLoading, setDeleteSecLoading] = useState(false);
  const sections = C.eventSections || [];
  
  const saveToFb = async (newC) => {
    try {
      await fbSave(newC, auth?.idToken);
      if(setC) setC(newC);
    } catch(e) {
      alert("Error saving: " + e.message);
    }
  };

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
  const [bulkGroup, setBulkGroup] = useState("");
  const [applyingBulkGroup, setApplyingBulkGroup] = useState(false);
  
  const [showSerialModal, setShowSerialModal] = useState(false);
  const [serialPrefix, setSerialPrefix] = useState("");
  const [serialStart, setSerialStart] = useState(1);
  const [sortLevels, setSortLevels] = useState([{ col: "", val: [], dir: "asc" }]);
  const [applyingSerial, setApplyingSerial] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("");

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

  const handleApplyBulkGroup = async () => {
    const gName = bulkGroup.trim();
    if (!gName) {
      alert("Please enter a group name to apply.");
      return;
    }
    if (filteredRegs.length === 0) {
      alert("No registrations are currently filtered.");
      return;
    }
    if (!window.confirm(`Are you sure you want to apply the group "${gName}" to all ${filteredRegs.length} currently filtered registrations?`)) return;
    
    setApplyingBulkGroup(true);
    let successCount = 0;
    try {
      for (const r of filteredRegs) {
        const cleanData = { ...r, Group: gName };
        delete cleanData.id; delete cleanData._submittedAt;
        await fbUpdateRegistration(r.id, cleanData, auth?.idToken);
        setRegs(prev => prev.map(x => x.id === r.id ? { ...x, Group: gName } : x));
        successCount++;
      }
      alert(`Successfully grouped ${successCount} registrations under "${gName}"!`);
      setBulkGroup("");
    } catch (e) {
      alert(`Error after grouping ${successCount} registrations: ` + e.message);
    }
    setApplyingBulkGroup(false);
  };

  const handleSavePreset = async (overwriteName = null) => {
    let pName = overwriteName;
    if (typeof overwriteName !== "string") pName = null; // in case event is passed
    if (!pName) {
      pName = prompt("Enter a name for this Serial Number Preset:");
      if (!pName) return;
    }
    
    const preset = {
      name: pName,
      prefix: serialPrefix,
      levels: sortLevels
    };
    
    const existing = C.serialPresets || [];
    const newPresets = [...existing.filter(p => p.name !== pName), preset];
    
    await saveToFb({ ...C, serialPresets: newPresets });
    setSelectedPreset(pName);
    alert(`Preset "${pName}" saved successfully!`);
  };

  const handleLoadPreset = (pName) => {
    setSelectedPreset(pName);
    if (!pName) {
      setSerialPrefix("");
      setSortLevels([{ col: "", val: [], dir: "asc" }]);
      return;
    }
    const preset = (C.serialPresets || []).find(p => p.name === pName);
    if (preset) {
      setSerialPrefix(preset.prefix || "");
      if (preset.levels) setSortLevels(preset.levels);
      else {
        // Fallback for old presets
        const arr = [];
        if (preset.l1 && preset.l1.col) arr.push(preset.l1);
        if (preset.l2 && preset.l2.col) arr.push(preset.l2);
        if (preset.l3 && preset.l3.col) arr.push(preset.l3);
        if (arr.length === 0) arr.push({ col: "", val: [], dir: "asc" });
        setSortLevels(arr);
      }
    }
  };

  const handleApplySerialNumbers = async () => {
    if (filteredRegs.length === 0) return alert("No registrations to assign numbers to.");
    
    // 1. Filter by specific values if selected, and strictly by Status == 'Approved'
    let targetRegs = filteredRegs.filter(r => r.Status === "Approved" || r.status === "Approved");
    const filterLevels = sortLevels.filter(l => l.col && l.val && l.val.length > 0);
    if (filterLevels.length > 0) {
      targetRegs = targetRegs.filter(r => {
        for (const level of filterLevels) {
          const rVal = String(r[level.col] || "").trim();
          if (!level.val.includes(rVal)) return false;
        }
        return true;
      });
    }

    if (targetRegs.length === 0) {
      return alert("No registrations match the selected value filters.");
    }
    
    if (!window.confirm(`Are you sure you want to assign serial numbers to ${targetRegs.length} students?`)) return;
    
    setApplyingSerial(true);
    
    // Sort logic
    const sorted = targetRegs.sort((a, b) => {
      const activeLevels = sortLevels.filter(l => l.col);
      for (const level of activeLevels) {
        let valA = String(a[level.col] || "").trim();
        let valB = String(b[level.col] || "").trim();
        
        // Custom value ordering logic
        if (level.val && level.val.length > 0) {
          const idxA = level.val.indexOf(valA);
          const idxB = level.val.indexOf(valB);
          
          if (idxA !== -1 && idxB !== -1) {
             if (idxA !== idxB) return level.dir === "asc" ? idxA - idxB : idxB - idxA;
             continue; // If they have the same custom index, proceed to next level
          }
          // If only A is in custom list, A comes first
          if (idxA !== -1) return level.dir === "asc" ? -1 : 1;
          // If only B is in custom list, B comes first
          if (idxB !== -1) return level.dir === "asc" ? 1 : -1;
        }
        
        // Handle numeric sorting if possible
        const numA = parseFloat(valA);
        const numB = parseFloat(valB);
        
        let cmp = 0;
        if (!isNaN(numA) && !isNaN(numB)) {
          cmp = numA - numB;
        } else {
          cmp = valA.toLowerCase().localeCompare(valB.toLowerCase());
        }
        
        if (cmp !== 0) {
          return level.dir === "asc" ? cmp : -cmp;
        }
      }
      return 0; // maintain original order if all sort levels are equal
    });

    let successCount = 0;
    try {
      let currentNum = Number(serialStart) || 1;
      for (const r of sorted) {
        const serialStr = serialPrefix ? `${serialPrefix}${currentNum}` : `${currentNum}`;
        const cleanData = { ...r, "Serial Number": serialStr };
        delete cleanData.id; delete cleanData._submittedAt;
        
        await fbUpdateRegistration(r.id, cleanData, auth?.idToken);
        setRegs(prev => prev.map(x => x.id === r.id ? { ...x, "Serial Number": serialStr } : x));
        
        currentNum++;
        successCount++;
      }
      alert(`Successfully assigned serial numbers to ${successCount} registrations!`);
      setShowSerialModal(false);
    } catch (e) {
      alert(`Error after assigning ${successCount} serial numbers: ` + e.message);
    }
    setApplyingSerial(false);
  };

  const handleResetSerialNumbers = async () => {
    let validRegs = [...filteredRegs];
    const filterLevels = sortLevels.filter(l => l.col && l.val && l.val.length > 0);
    if (filterLevels.length > 0) {
      validRegs = validRegs.filter(r => {
        for (const level of filterLevels) {
          const rVal = String(r[level.col] || "").trim();
          if (!level.val.includes(rVal)) return false;
        }
        return true;
      });
    }

    if (validRegs.length === 0) return alert("No registrations match the selected value filters.");
    
    if (!window.confirm(`Are you sure you want to completely clear the serial numbers from ${validRegs.length} students?`)) return;
    
    setApplyingSerial(true);
    let successCount = 0;
    try {
      for (const r of validRegs) {
        if (!r["Serial Number"]) continue; // Already clear
        
        const cleanData = { ...r };
        delete cleanData["Serial Number"];
        delete cleanData.id; 
        delete cleanData._submittedAt;
        
        await fbUpdateRegistration(r.id, { "Serial Number": null }, auth?.idToken);
        setRegs(prev => prev.map(x => x.id === r.id ? { ...x, "Serial Number": "" } : x));
        successCount++;
      }
      alert(`Successfully cleared serial numbers from ${successCount} registrations.`);
    } catch (e) {
      alert(`Error after clearing ${successCount} serial numbers: ` + e.message);
    }
    setApplyingSerial(false);
  };

  // 0. Filter by activeSection first so columns are dynamic to the section
  const sectionRegs = regs.filter(r => {
    if (!r) return false;
    if (activeSection === "All") return true;
    const evId = r.eventId;
    const ev = C.events?.find(e => e.id === evId || e.title === r.eventName || e.titleGu === r.eventName);
    const rSec = ev?.section || "Default";
    return rSec === activeSection;
  });

  // 1. Gather all unique dynamic field keys based on the section
  const ignoreKeys = ['id', 'eventId', 'eventTitle', 'eventName', '_submittedAt', 'Transaction ID', 'Status', 'Remarks', 'Updated By'];
  const allKeysSet = new Set();
  
  // 1. Gather all keys from submitted data
  sectionRegs.forEach(r => {
    Object.keys(r).forEach(k => {
      if (!ignoreKeys.includes(k) && !k.startsWith('_')) {
        // Exclude specific known bad keys that might have been imported incorrectly as columns
        if (k !== 'Commerce' && k !== 'Science' && k !== 'Arts' && k !== 'Other' && k !== 'Vibhag') {
          allKeysSet.add(k);
        }
      }
    });
  });

  // 2. Add keys from event definitions so they appear in dropdowns even if data is empty
  (C.events || []).forEach(ev => {
    const rSec = ev.section || "Default";
    if (activeSection === "All" || rSec === activeSection) {
      if (ev.formId && C.forms) {
        const form = C.forms.find(f => f.id === ev.formId);
        if (form && form.fields) {
          form.fields.forEach(f => {
            if (f.label && !ignoreKeys.includes(f.label)) {
              if (f.label !== 'Commerce' && f.label !== 'Science' && f.label !== 'Arts' && f.label !== 'Other' && f.label !== 'Vibhag') {
                allKeysSet.add(f.label);
              }
            }
          });
        }
      }
    }
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
    sectionRegs.forEach(r => {
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

  // 2. Filter registrations based on search query and column filters
  const filteredRegs = sectionRegs.filter(r => {
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
    <div style={{display: mob ? "block" : "flex", width:"100%"}}>
      <div style={{width: mob ? "100%" : "250px", borderRight: mob ? "none" : "1px solid var(--bd)", borderBottom: mob ? "1px solid var(--bd)" : "none", padding: "20px", background: "#f8f9fa", boxSizing:"border-box", minHeight: mob ? "auto" : "100vh"}}>
         <h3 style={{fontSize:"1rem", fontWeight:700, color:"var(--dt)", marginBottom:16}}>Registration Sections</h3>
         
         <div style={{display:"flex", flexDirection:"column", gap:6}}>
            <button onClick={()=>setActiveSection("All")} style={{textAlign:"left", padding:"8px 12px", borderRadius:6, border:"none", background: activeSection === "All" ? "var(--tl)" : "transparent", color: activeSection === "All" ? "var(--dt)" : "var(--mu)", fontWeight: activeSection === "All" ? 700 : 500, cursor:"pointer"}}>All Registrations</button>
            <button onClick={()=>setActiveSection("Default")} style={{textAlign:"left", padding:"8px 12px", borderRadius:6, border:"none", background: activeSection === "Default" ? "var(--tl)" : "transparent", color: activeSection === "Default" ? "var(--dt)" : "var(--mu)", fontWeight: activeSection === "Default" ? 700 : 500, cursor:"pointer"}}>Default Section</button>
            
            {sections.map(sec => (
              <div key={sec} style={{display:"flex", alignItems:"center"}}>
                 <button onClick={()=>setActiveSection(sec)} style={{flex:1, textAlign:"left", padding:"8px 12px", borderRadius:6, border:"none", background: activeSection === sec ? "var(--tl)" : "transparent", color: activeSection === sec ? "var(--dt)" : "var(--mu)", fontWeight: activeSection === sec ? 700 : 500, cursor:"pointer"}}>{sec}</button>
                 <button onClick={()=>{
                   const p1 = window.prompt(`Security Check 1/2: Please type the word "DELETE" (in all caps) to confirm.`);
                   if(p1 !== 'DELETE') {
                     alert("Incorrect. You must type the word DELETE. Deletion cancelled.");
                     return;
                   }
                   const p2 = window.prompt(`Security Check 2/2: Please type the exact section name "${sec}" to permanently delete it.`);
                   if(p2 !== sec) {
                     alert("Incorrect section name. Deletion cancelled.");
                     return;
                   }
                   
                   setDeleteSecConfirm(sec);
                 }} style={{background:"none", border:"none", color:"#C0392B", cursor:"pointer", padding:"4px", fontSize:"1.2rem"}}>×</button>
              </div>
            ))}
         </div>
         
         {isAddingSection ? (
            <div style={{marginTop:16, display:"flex", flexDirection:"column", gap:8}}>
               <input value={newSectionName} onChange={e=>setNewSectionName(e.target.value)} placeholder="Section Name" style={{padding:"6px", borderRadius:4, border:"1px solid var(--bd)", fontSize:".8rem"}} />
               <div style={{display:"flex", gap:6}}>
                 <button onClick={()=>{
                   if(!newSectionName.trim()) return;
                   if(sections.includes(newSectionName.trim())) return alert("Section already exists");
                   saveToFb({...C, eventSections: [...sections, newSectionName.trim()]});
                   setNewSectionName("");
                   setIsAddingSection(false);
                 }} style={{flex:1, background:"var(--dt)", color:"white", border:"none", borderRadius:4, padding:"6px", fontSize:".8rem", cursor:"pointer"}}>Save</button>
                 <button onClick={()=>setIsAddingSection(false)} style={{flex:1, background:"#eee", border:"none", borderRadius:4, padding:"6px", fontSize:".8rem", cursor:"pointer", color:"#333"}}>Cancel</button>
               </div>
            </div>
         ) : (
            <button onClick={()=>setIsAddingSection(true)} style={{marginTop:16, width:"100%", padding:"8px", background:"white", border:"1px dashed var(--mu)", color:"var(--dt)", borderRadius:6, fontSize:".8rem", fontWeight:600, cursor:"pointer"}}>+ Add Section</button>
         )}
      </div>

      <div style={{flex:1, padding:mob?"16px":"32px", width:"100%", boxSizing:"border-box", overflowX:"hidden"}}>
        <div style={{display:"flex",flexDirection:mob?"column":"row",flexWrap:"wrap",justifyContent:"space-between",alignItems:mob?"flex-start":"center",marginBottom:20,gap:16}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",color:"var(--dt)",margin:0}}>Event Registrations</h2>
          <div style={{display:"flex",flexWrap:"wrap",gap:12,width:mob?"100%":"auto"}}>
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

                return (
                  <tr key={i}>
                    <td style={{padding:"12px",textAlign:"center",whiteSpace:"nowrap"}}>
                      <button onClick={()=>setViewing(r)} style={{padding:"6px 12px",borderRadius:6,fontSize:".75rem",background:"var(--dt)",color:"white",border:"none",cursor:"pointer",fontWeight:500,boxShadow:"0 2px 6px rgba(0,0,0,0.15)"}}>View</button>
                    </td>
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

      {deleteSecConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:99999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"white",width:"100%",maxWidth:400,borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"16px 20px",background:"var(--dt)",color:"white",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <h3 style={{fontSize:"1.1rem",fontWeight:700}}>Final Verification</h3>
              <button onClick={()=>{setDeleteSecConfirm(null); setDeleteSecPass("");}} style={{background:"none",border:"none",color:"white",fontSize:"1.5rem",cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            <div style={{padding:24}}>
              <p style={{fontSize:".85rem",color:"var(--mu)",marginBottom:16}}>As a final security measure, please enter your Admin password to permanently delete the <strong>{deleteSecConfirm}</strong> section.</p>
              <input type="password" value={deleteSecPass} onChange={e=>setDeleteSecPass(e.target.value)} placeholder="Enter Admin Password" style={{width:"100%",padding:12,borderRadius:8,border:"1px solid var(--bd)",fontSize:"1rem",marginBottom:16,boxSizing:"border-box"}} />
              
              <div style={{display:"flex",gap:12}}>
                <button onClick={async () => {
                   setDeleteSecLoading(true);
                   try {
                     await fbLogin(auth.email, deleteSecPass);
                     
                     const newSecs = sections.filter(s => s !== deleteSecConfirm);
                     await saveToFb({...C, eventSections: newSecs});
                     if (activeSection === deleteSecConfirm) setActiveSection("All");
                     
                     setDeleteSecConfirm(null);
                     setDeleteSecPass("");
                     alert("Section deleted successfully.");
                   } catch(e) {
                     alert("Incorrect password. Deletion cancelled.");
                   } finally {
                     setDeleteSecLoading(false);
                   }
                }} disabled={deleteSecLoading || !deleteSecPass} style={{flex:1,padding:"12px",borderRadius:8,background:"#C0392B",color:"white",border:"none",fontWeight:600,cursor:(deleteSecLoading || !deleteSecPass)?"not-allowed":"pointer",opacity:(deleteSecLoading || !deleteSecPass)?0.6:1}}>
                   {deleteSecLoading ? "Verifying..." : "Confirm Delete"}
                </button>
                <button onClick={()=>{setDeleteSecConfirm(null); setDeleteSecPass("");}} disabled={deleteSecLoading} style={{flex:1,padding:"12px",borderRadius:8,background:"#f5f5f5",color:"var(--dt)",border:"none",fontWeight:600,cursor:deleteSecLoading?"not-allowed":"pointer"}}>
                   Cancel
                </button>
              </div>
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
    </div>
  );
}

// ── ADMIN INVITE LETTERS ────────────────────────────────────────────────────────