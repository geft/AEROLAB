import { execSync } from 'child_process';

console.log('\n🔄 [AEROLAB] Updating to latest build...\n');

try {
  console.log('1. Pulling latest repository changes (git pull)...');
  try {
    execSync('git pull', { stdio: 'inherit' });
  } catch (gitErr) {
    console.warn('⚠️  git pull skipped or not a remote repository:', gitErr.message);
  }

  console.log('\n2. Verifying and updating dependencies (npm install)...');
  execSync('npm install', { stdio: 'inherit' });

  console.log('\n3. Building latest production bundles (npm run build:all)...');
  execSync('npm run build:all', { stdio: 'inherit' });

  console.log('\n✅ [AEROLAB] Successfully updated to the latest build!\n');
} catch (err) {
  console.error('\n❌ [AEROLAB] Update failed:', err.message);
  process.exit(1);
}
