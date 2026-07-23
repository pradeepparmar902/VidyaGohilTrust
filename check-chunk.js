fetch('https://pradeepparmar902.github.io/VidyaGohilTrust/assets/index-Cq6RboYG.js')
  .then(r => r.text())
  .then(body => {
    const lines = body.split('\n');
    let found = false;
    for(let i=0; i<lines.length; i++) {
      if(lines[i].includes('obj[lk]=value')) {
        console.log('Match on line', i, ':', lines[i].substring(0, 150));
        found = true;
      }
    }
    if(!found) console.log('No obj[lk]=value found in chunk!');
  });
