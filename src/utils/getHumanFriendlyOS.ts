/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

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
        let id = '';
        let name = '';
        let versionId = '';

        for (const line of lines) {
          if (line.startsWith('ID=')) {
            id = line.split('=')[1].replace(/["']/g, '').toLowerCase();
          } else if (line.startsWith('NAME=')) {
            name = line.split('=')[1].replace(/["']/g, '');
          } else if (line.startsWith('VERSION_ID=')) {
            versionId = line.split('=')[1].replace(/["']/g, '');
          }
        }

        if (id.includes('android')) {
          return versionId ? `Android ${versionId}` : `Android`;
        }
        if (id.includes('ubuntu')) {
          return versionId ? `Ubuntu ${versionId}` : `Ubuntu`;
        }
        if (id.includes('rocky') || id.includes('rockylinux')) {
          return versionId ? `Rocky Linux ${versionId}` : `Rocky Linux`;
        }

        if (name) {
          return versionId ? `${name} ${versionId}` : name;
        }
      }
    } catch (e) {}
    return `Linux (${release})`;
  }

  return `${type} ${release}`;
}

console.log(getHumanFriendlyOS());
