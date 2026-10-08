---
title: Install and update
description: Download Galaxy Forge, get past the install warnings, open it again later and keep it up to date.
aliases: [download, installer, setup, exe, msi, windows defender, defender, smartscreen, unknown publisher, run anyway, virus, gatekeeper, xattr, linux, mac, macos, appimage, deb, rpm, open again, start menu, launch, new version, check for updates, checksum, sha256]
---
# Install and update

Galaxy Forge is a desktop app that runs outside the game, on Windows,
macOS and Linux.

<p class="download">
  <VPButton tag="a" size="big" theme="brand" text="Download the latest release" href="https://github.com/IanHeinrich/stellaris-galaxy-forge/releases/latest" />
</p>

Each section below says which file on the Releases page to download.

## Install on Windows

Download `Stellaris-Galaxy-Forge-<version>-Windows-Installer.exe` and run
it.

To run it without installing, download
`Stellaris-Galaxy-Forge-<version>-Windows-No-Install.zip` instead. Unzip
it and run the app inside. There is also an MSI for managed installs.

## Get past the Windows warning

The installer is signed by "Open Source Developer, Ian Heinrich".
Windows SmartScreen may still show a warning because the signing
certificate is new. Click More info, then Run anyway.

Your browser may also say the file isn't commonly downloaded. Choose
Keep. `SHA256SUMS` on the Releases page lists a checksum for every file,
so you can check a download before you run it.

An antivirus that reports the file as malware is a different warning
from SmartScreen. Check the file against `SHA256SUMS` first. If it
matches, [report it](../reference/troubleshooting.md#report-a-bug) with
the name of the detection.

## Install on a Mac

Download `Stellaris-Galaxy-Forge-<version>-Mac.dmg`. It runs on Intel and
Apple silicon Macs.

1. Open the `.dmg` and move Stellaris Galaxy Forge into Applications.
2. The app isn't signed, so Gatekeeper refuses to open it at first. Open
   Terminal and run
   `xattr -cr "/Applications/Stellaris Galaxy Forge.app"`, or
   right-click the app in Applications and choose Open.
3. Open the app from Applications.

## Install on Linux

Download `Stellaris-Galaxy-Forge-<version>-Linux.AppImage`. In a
terminal, go to the folder you saved it in, make the file executable
and start it:

```sh
cd ~/Downloads
chmod +x Stellaris-Galaxy-Forge-0.24.0-Linux.AppImage
./Stellaris-Galaxy-Forge-0.24.0-Linux.AppImage
```

Use the folder and version number of your download. There are also
`Linux-Debian-Ubuntu.deb` and `Linux-Fedora.rpm` packages. All of them
are built on Ubuntu 22.04 for x86_64.

I use Galaxy Forge on Windows. The Mac and Linux builds have had less
use.

## Open it again

Galaxy Forge is an app of its own. Open it from the Start menu on
Windows, or from Applications on a Mac. Stellaris and its launcher don't
start it.

It isn't a mod. Its
[Workshop page](https://steamcommunity.com/sharedfiles/filedetails/?id=3805578137)
has no mod files, so subscribing to it installs nothing. Most scenarios
are played through the [Paint a Galaxy](../scenario/paint-a-galaxy.md)
mod.

## Update the app

The app checks for a new release when it starts and shows a badge when
it finds one. Click it for the release notes and "Install and restart".
The no-install zip and the `.deb` and `.rpm` packages send you to the
releases page instead. The Help menu has "Check for updates…" and turns
the check at start on or off.
