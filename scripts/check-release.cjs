const fs = require('node:fs');
const path = require('node:path');

const STABLE_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function validateReleaseVersion(tag, manifest, lock) {
  const match = STABLE_RELEASE_TAG.exec(tag);
  if (!match) {
    throw new Error(`Release tag "${tag}" must use stable SemVer in the form vMAJOR.MINOR.PATCH.`);
  }

  const version = `${match[1]}.${match[2]}.${match[3]}`;
  const lockRootVersion = lock.packages?.['']?.version;
  if (manifest.version !== version || lock.version !== version || lockRootVersion !== version) {
    throw new Error(
      `Release tag ${tag} does not match package.json (${manifest.version}), ` +
      `package-lock.json (${lock.version}), and its root package (${lockRootVersion ?? 'missing'}).`
    );
  }

  return version;
}

function vsixFilename(name, version) {
  return `${name}-${version}.vsix`;
}

async function readVsixManifest(vsixPath) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(vsixPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error(`Could not open VSIX: ${vsixPath}`));
        return;
      }

      let manifestText;
      let manifestCount = 0;
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      zipFile.on('error', fail);
      zipFile.on('entry', entry => {
        if (entry.fileName !== 'extension/package.json') {
          zipFile.readEntry();
          return;
        }

        manifestCount++;
        if (manifestCount !== 1) {
          fail(new Error('VSIX contains more than one extension/package.json entry.'));
          zipFile.close();
          return;
        }

        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error('Could not read the VSIX extension manifest.'));
            zipFile.close();
            return;
          }

          const chunks = [];
          stream.on('error', fail);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            manifestText = Buffer.concat(chunks).toString('utf8');
            zipFile.readEntry();
          });
        });
      });
      zipFile.on('end', () => {
        if (settled) return;
        if (!manifestText) {
          fail(new Error('VSIX is missing extension/package.json.'));
          return;
        }
        try {
          const manifest = JSON.parse(manifestText);
          settled = true;
          resolve(manifest);
        } catch (error) {
          fail(new Error(`VSIX extension manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
      zipFile.readEntry();
    });
  });
}

async function verifyVsix(vsixPath, manifest, version) {
  const expectedFilename = vsixFilename(manifest.name, version);
  if (path.basename(vsixPath) !== expectedFilename) {
    throw new Error(`Expected VSIX filename ${expectedFilename}, got ${path.basename(vsixPath)}.`);
  }

  const packagedManifest = await readVsixManifest(vsixPath);
  if (packagedManifest.name !== manifest.name || packagedManifest.version !== version) {
    throw new Error(
      `VSIX manifest must contain ${manifest.name}@${version}; found ` +
      `${packagedManifest.name ?? 'unknown'}@${packagedManifest.version ?? 'unknown'}.`
    );
  }
}

async function main(args) {
  const tag = args[2];
  if (!tag) throw new Error('Usage: node scripts/check-release.cjs <tag> [--vsix <path>]');

  const vsixFlag = args.indexOf('--vsix', 3);
  if (vsixFlag !== -1 && (!args[vsixFlag + 1] || args.length !== vsixFlag + 2)) {
    throw new Error('The --vsix option requires exactly one VSIX path.');
  }
  if (vsixFlag === -1 && args.length !== 3) {
    throw new Error('Unexpected arguments. Usage: node scripts/check-release.cjs <tag> [--vsix <path>]');
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
  const version = validateReleaseVersion(tag, manifest, lock);
  console.log(`Release tag ${tag} matches package version ${version}.`);

  if (vsixFlag !== -1) {
    const vsixPath = path.resolve(args[vsixFlag + 1]);
    await verifyVsix(vsixPath, manifest, version);
    console.log(`VSIX ${path.basename(vsixPath)} contains ${manifest.name}@${version}.`);
  }
}

if (require.main === module) {
  main(process.argv).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { validateReleaseVersion, verifyVsix, vsixFilename };
