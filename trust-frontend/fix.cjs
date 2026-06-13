const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'CharitableTrust.jsx');
let content = fs.readFileSync(file, 'utf8');

// The exact string to find
const searchStr = '{tab==="volunteers"&& hasAccess.includes("volunteers") && <Volunteers mob={mob} auth={auth} C={C}/>}';
const replaceStr = '{tab==="volunteers"&& hasAccess.includes("volunteers") && <Volunteers mob={mob} auth={auth} C={C}/>}\n          {tab==="team"      && hasAccess.includes("team") && <AdminTeam mob={mob} C={C} setC={setC} auth={auth}/>}';

content = content.replace(searchStr, replaceStr);

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed Admin rendering.");
