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

The Releases page lists a file for each system. The sections below say
which one to pick.

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

## Install on a Mac

Download `Stellaris-Galaxy-Forge-<version>-Mac.dmg`, for Intel and Apple
silicon Macs. It isn't signed, so Gatekeeper refuses to open it until you
run `xattr -cr "/Applications/Stellaris Galaxy Forge.app"`, or
right-click the app and choose Open.

## Install on Linux

Download `Stellaris-Galaxy-Forge-<version>-Linux.AppImage` and run
`chmod +x` on it before you start it. There are also
`Linux-Debian-Ubuntu.deb` and `Linux-Fedora.rpm` packages. All of them
are built on Ubuntu 22.04 for x86_64.

I use Galaxy Forge on Windows. The Mac and Linux builds have had less
use.

## Open it again

Galaxy Forge is an app of its own. Open it from the Start menu on
Windows, or from Applications on a Mac. Stellaris and its launcher don't
start it.

It isn't a mod. The
[Workshop page](https://steamcommunity.com/sharedfiles/filedetails/?id=3805578137)
has no mod files, so subscribing to it installs nothing. You only need a
mod, [Paint a Galaxy](../scenario/paint-a-galaxy.md), to play a
scenario.

## Update the app

The app checks for a new release when it starts and shows a badge when
it finds one. Click it for the release notes and "Install and restart".
The no-install zip and the `.deb` and `.rpm` packages send you to the
releases page instead. The Help menu has "Check for updates…" and turns
the check at start on or off.
