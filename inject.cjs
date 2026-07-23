const fs = require('fs');
const path = require('path');

const trustFile = path.join(__dirname, 'src', 'CharitableTrust.jsx');
let content = fs.readFileSync(trustFile, 'utf8');

const scratchDir = 'C:\\Users\\Pradeep.Parmar\\.gemini\\antigravity\\brain\\5a9c29b1-04ca-40ae-bbc1-b10eb43522ff\\scratch';
const adminTeamContent = fs.readFileSync(path.join(scratchDir, 'AdminTeam.jsx'), 'utf8');
const teamContent = fs.readFileSync(path.join(scratchDir, 'Team.jsx'), 'utf8');

// Inject AdminTeam component
content = content.replace('function AdminGallery({', adminTeamContent + '\n\nfunction AdminGallery({');

// Inject Team component
content = content.replace('function Gallery({', teamContent + '\n\nfunction Gallery({');

// Inject <Team> render in public
content = content.replace(
  '{bs.gallery  !== false && <Gallery C={C}/>}',
  '{bs.team !== false && <Team C={C} lang={lang}/>}\n          {bs.gallery  !== false && <Gallery C={C}/>}'
);

// Inject <AdminTeam> render in admin
content = content.replace(
  '{tab === "gallery" && <AdminGallery',
  '{tab === "team" && <AdminTeam mob={mob} C={C} setC={setC} auth={auth}/>}\n          {tab === "gallery" && <AdminGallery'
);

fs.writeFileSync(trustFile, content, 'utf8');
console.log("Injection complete.");
