const fs = require('fs');
const ftp = require('basic-ftp');
const { stdout } = process;

async function downloadFileFromFTPWithRetry(ftpClient, remotePath, localPath) {
    let retries = 0;
    const startTime = process.hrtime();

    while (true) {
        try {
            stdout.write(`Downloading ${remotePath}... `);
            await ftpClient.downloadTo(localPath, remotePath);
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

async function main() {
    const ftpClient = new ftp.Client();
    try {
        await ftpClient.access({
            host: "ropatch2.gravityus.com",
            user: "anonymous",
            password: "anonymous@",
            secure: false
        });

        if (!fs.existsSync('ftp_iro')) {
            fs.mkdirSync('ftp_iro');
        }
        if (!fs.existsSync('ftp_iro/patchlist')) {
            fs.mkdirSync('ftp_iro/patchlist');
        }

        let currentPatchNumber = 0;
        const currentPatchFile = 'ftp_iro/patchlist/current.txt';
        if (fs.existsSync(currentPatchFile)) {
            currentPatchNumber = parseInt(fs.readFileSync(currentPatchFile, 'utf8').trim());
        } else {
            fs.writeFileSync(currentPatchFile, '0');
        }

        await downloadFileFromFTPWithRetry(ftpClient, '/patch/patchlist/patch_allow.txt', 'ftp_iro/patchlist/patch_allow.txt');

        const patchAllowContent = fs.readFileSync('ftp_iro/patchlist/patch_allow.txt', 'utf8');

        if (patchAllowContent.includes('deny')) {
            console.log('Contains "deny". Aborting...');
            return;
        }

        await downloadFileFromFTPWithRetry(ftpClient, '/patch/patchlist/patch2.txt', 'ftp_iro/patchlist/patch2.txt');

        const patch2Content = fs.readFileSync('ftp_iro/patchlist/patch2.txt', 'utf8');

        const lines = patch2Content.split('\n');
        for (const line of lines) {
            if (/^\d/.test(line)) {
                const [patchNumber, filename] = line.split(' ');
                if (parseInt(patchNumber) > currentPatchNumber) {
                    await downloadFileFromFTPWithRetry(ftpClient, `/patch/${filename}`, `ftp_iro/${filename}`);
                    currentPatchNumber = parseInt(patchNumber);
                }
            }
        }

        fs.writeFileSync(currentPatchFile, currentPatchNumber.toString());
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await ftpClient.close();
    }
}

main();
