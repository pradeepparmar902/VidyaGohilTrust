const fs = require('fs');
const path = require('path');

const sourceDir = __dirname;
const targetDirs = [
  path.join(__dirname, '..', 'MMP-CWC'),
  path.join(__dirname, '..', 'VdiyaGohil')
];

// Folders and files to completely ignore during the copy process
const ignoreList = [
  'node_modules', 
  '.git', 
  'dist', 
  '.env', 
  'package-lock.json',
  'sync-to-communities.cjs'
];

function copyRecursiveSync(src, dest) {
  const stats = fs.statSync(src);
  const isDirectory = stats.isDirectory();
  const basename = path.basename(src);

  if (ignoreList.includes(basename)) {
    return; // Skip ignored files/folders
  }

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log("🚀 Starting code synchronization...");

targetDirs.forEach(target => {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  
  console.log(`\n📦 Copying to ${path.basename(target)}...`);
  
  // Read all items in the root of trust-frontend
  fs.readdirSync(sourceDir).forEach(item => {
    const srcPath = path.join(sourceDir, item);
    const destPath = path.join(target, item);
    
    copyRecursiveSync(srcPath, destPath);
  });
  
  console.log(`✅ Successfully synced to ${path.basename(target)}`);
});

console.log("\n🎉 All folders synced successfully! (Ignored .env, node_modules, .git, and dist)");
