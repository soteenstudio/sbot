import os from 'os';
import fs from 'fs';

export function getHumanFriendlyOS() {
    const type = os.type();
    const release = os.release();

    if (type === 'Windows_NT') {
        const buildNumber = parseInt(release.split('.')[2] || '0', 10);
        if (buildNumber >= 22000) return `Windows 11 (${release})`;
        return `Windows 10 (${release})`;
    } 
    
    if (type === 'Darwin') {
        const major = parseInt(release.split('.')[0], 10);
        const macVersion = major - 9;
        return `macOS 1${macVersion} (${release})`;
    }

    if (type === 'Linux') {
        try {
            if (fs.existsSync('/etc/os-release')) {
                const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
                const lines = osRelease.split('\n');
                let prettyName = '';
                let name = '';
                let ver = '';

                for (const line of lines) {
                    if (line.startsWith('PRETTY_NAME=')) {
                        prettyName = line.split('=')[1].replace(/["']/g, '');
                    } else if (line.startsWith('NAME=')) {
                        name = line.split('=')[1].replace(/["']/g, '');
                    } else if (line.startsWith('VERSION_ID=')) {
                        ver = line.split('=')[1].replace(/["']/g, '');
                    }
                }

                if (prettyName) return prettyName;
                if (name) return `${name} ${ver}`.trim();
            }
        } catch (e) {
            // Fallback kalau gagal baca file
        }
        return `Linux (${release})`;
    }

    return `${type} ${release}`;
}

console.log(getHumanFriendlyOS());
