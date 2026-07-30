fetch('https://pradeepparmar902.github.io/VidyaGohilTrust/index.html')
  .then(r => r.text())
  .then(body => {
    const match = body.match(/src="\/VidyaGohilTrust\/assets\/index[^"]*\.js"/);
    if(match) console.log('JS chunk:', match[0]);
    else console.log('No match');
  });
