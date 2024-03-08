const fs = require('fs');
const path = require('path');
const ftp = require('basic-ftp');
const { stdout } = process;

// Define the FTP server configurations
const ftpConfig = {
  host: 'ropatch2.gravityus.com',
  user: 'username',
  password: 'password'
};

// Create an FTP client instance
const client = new ftp.Client();
client.ftp.verbose = true; // Enable verbose mode for logging

async function downloadFileFromFTPWithRetry(remotePath, localPath) {
  let retries = 0;
  const startTime = process.hrtime();

  while (true) {
    try {
      stdout.write(`Downloading ${remotePath}... `);
      await client.downloadTo(localPath, remotePath);
      const stats = fs.statSync(localPath);
      const fileSizeInBytes = stats.size;
      const fileSizeInKb = fileSizeInBytes / 1024;
      const endTime = process.hrtime(startTime);
      const elapsedTimeInSeconds = endTime[0] + endTime[1] / 1e9;
      stdout.write(`Done! (${fileSizeInKb.toFixed(2)} KB, ${elapsedTimeInSeconds.toFixed(2)} seconds)\n`);
      break;
    } catch (err) {
      stdout.write('\n');
      if (err.code === 550) {
        console.error('File not found. Cancelling the process.');
        process.exit(1);
      }
      if (++retries > 5) {
        console.error(`Failed to download ${remotePath}. Maximum retries exceeded.`);
        process.exit(1);
      }
      console.error(`Failed to download ${remotePath}. Retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * retries));
    }
  }
}

const localPatchListDir = path.join(__dirname, 'ftp_iro', 'patchlist');
async function checkPatchAllow() {
  // Ensure local directories exist
  if (!fs.existsSync(localPatchListDir)) {
    fs.mkdirSync(localPatchListDir, { recursive: true });
  }

  // Define local patchAllow file path
  const patchAllowFile = path.join(localPatchListDir, 'patch_allow.txt');

  // Download patchAllow file
  const remotePatchAllowFile = '/patch/patchlist/patch_allow.txt';
  await downloadFileFromFTPWithRetry(remotePatchAllowFile, patchAllowFile);

  // Read patchAllow file
  const content = fs.readFileSync(patchAllowFile, 'utf8').toString().trim();
  if (/allow/i.test(content)) {
    return true;
  }
  return false;
}

// Function to get the current patch number
function getPatchCurrent() {
  let currentPatchNumber = 0;
  const patchCurrentFile = path.join(localPatchListDir, 'current.txt');
  if (!fs.existsSync(patchCurrentFile)) {
    return currentPatchNumber;
  }
  const content = fs.readFileSync(patchCurrentFile, 'utf8').toString().trim();
  return parseInt(content);
}

// Function to set the current patch number
function setPatchCurrent(patchNumber) {
  const patchCurrentFile = path.join(localPatchListDir, 'current.txt');
  fs.writeFileSync(patchCurrentFile, patchNumber.toString());
}

// Function to process the patchlist file and download required patches
async function processPatchList() {
  // Ensure local directories exist
  if (!fs.existsSync(localPatchListDir)) {
    fs.mkdirSync(localPatchListDir, { recursive: true });
  }

  let patchCurrent = getPatchCurrent();

  if (!checkPatchAllow()) {
    console.log('Patch not allowed');
    return;
  }
  const localPatchlistFile = path.join(localPatchListDir, 'patch2.txt');
  const remotePatchlistFile = '/patch/patchlist/patch2.txt';
  await downloadFileFromFTPWithRetry(remotePatchlistFile, localPatchlistFile);

  const lines = fs.readFileSync(localPatchlistFile, 'utf8').split(/\r?\n?/);


  const patchesToDownload = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    // if line does not start with a number and has a filename, skip it
    if (!/^\d+ \w+/.test(line)) {
      continue;
    }
    const [patchNumber, filename] = line.split(' ');

    // Convert patchNumber to integer
    const patchNum = parseInt(patchNumber);

    // Stop processing if patchNumber is less or equal to the current patchNumber
    if (patchNum <= patchCurrent) {
      break;
    }

    // Add file to download list
    patchesToDownload.push({ patchNum, filename });
  }
  let currentPatchNumber = 0;

  // Iterate over the download list in reverse order
  for (let i = patchesToDownload.length - 1; i >= 0; i--) {
    const { filename, patchNum } = patchesToDownload[i];
    const remoteFilePath = `/patch/${filename}`;
    const localFilePath = path.join(__dirname, 'ftp_iro', filename);

    console.log(`Downloading file: ${filename}`);
    await downloadFileFromFTPWithRetry(remoteFilePath, localFilePath)
      .then(() => {
        currentPatchNumber = patchNum;
        setPatchCurrent(currentPatchNumber);
      });
  }
}

// Connect to FTP server, process patchlist, and disconnect
async function main() {
  try {
    await client.access(ftpConfig);
    await processPatchList();
  } catch (error) {
    console.error('FTP connection error:', error);
  } finally {
    client.close();
  }
}

main();
