function parseVersion(version) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`版本格式无效：${version}`);
  }
  return parts;
}

function nextReleaseVersion(version) {
  const [major, minor, patch] = parseVersion(version);
  if (patch < 9) return `${major}.${minor}.${patch + 1}`;
  if (minor < 9) return `${major}.${minor + 1}.0`;
  return `${major + 1}.0.0`;
}

function isSingleDigitVersion(version) {
  return parseVersion(version).every((part) => part <= 9);
}

if (require.main === module) {
  const [version] = process.argv.slice(2);
  if (!version) process.exit(1);
  process.stdout.write(nextReleaseVersion(version));
}

module.exports = { isSingleDigitVersion, nextReleaseVersion };
