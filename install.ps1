<#
.SYNOPSIS
    Install markspec on Windows — downloads the latest release binary for x86_64.

.DESCRIPTION
    Mirrors the POSIX install.sh: queries the latest GitHub release (or a pinned
    version via $env:MARKSPEC_VERSION), downloads the tarball + SHA-256 checksum,
    verifies the hash, extracts markspec.exe, and places it on disk under
    $env:MARKSPEC_INSTALL_DIR (default $HOME\.local\bin). The script does not
    modify the user PATH automatically — it prints the required PATH entry when
    the install directory is not already discoverable.

.EXAMPLE
    irm https://raw.githubusercontent.com/driftsys/markspec/main/install.ps1 | iex
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'driftsys/markspec'
$Binary = 'markspec.exe'
$InstallDir = if ($env:MARKSPEC_INSTALL_DIR) { $env:MARKSPEC_INSTALL_DIR }
              else { Join-Path $HOME '.local\bin' }

function Get-Target {
    $arch = (Get-CimInstance -ClassName Win32_Processor).Architecture
    # Win32_Processor.Architecture: 0 = x86, 9 = x64, 12 = ARM64
    switch ($arch) {
        9       { return 'x86_64-pc-windows-msvc' }
        default {
            Write-Error "error: unsupported architecture (Win32_Processor.Architecture=$arch). Only x86_64 is supported today."
        }
    }
}

function Get-Version {
    if ($env:MARKSPEC_VERSION) { return $env:MARKSPEC_VERSION }
    $api = "https://api.github.com/repos/$Repo/releases/latest"
    $release = Invoke-RestMethod -Uri $api -UseBasicParsing
    return $release.tag_name
}

function Test-Checksum {
    param([string]$File, [string]$ChecksumFile)
    # The .sha256 file format is "<hash>  <basename>" (two-space separator
    # produced by sha256sum / shasum -a 256 in the release workflow).
    $expected = ((Get-Content -LiteralPath $ChecksumFile -Raw).Trim() -split '\s+', 2)[0]
    $actual = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLower()
    if ($expected.ToLower() -ne $actual) {
        Write-Error "checksum mismatch: expected $expected, got $actual"
    }
}

function Main {
    $target = Get-Target
    $version = Get-Version
    $tarball = "markspec-$target.tar.gz"
    $url = "https://github.com/$Repo/releases/download/$version/$tarball"
    $checksumUrl = "$url.sha256"

    Write-Host "Installing markspec $version ($target)"
    Write-Host "  to: $InstallDir"

    $tmpdir = Join-Path ([System.IO.Path]::GetTempPath()) "markspec-install-$([System.Guid]::NewGuid())"
    New-Item -ItemType Directory -Path $tmpdir | Out-Null
    try {
        $tarballPath = Join-Path $tmpdir $tarball
        $checksumPath = "$tarballPath.sha256"
        Invoke-WebRequest -Uri $url -OutFile $tarballPath -UseBasicParsing
        Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumPath -UseBasicParsing

        Write-Host 'Verifying checksum...'
        Test-Checksum -File $tarballPath -ChecksumFile $checksumPath

        # Windows 10 1803+ and Windows 11 ship bsdtar as `tar`. Extract in
        # place; the tarball contains a single `markspec.exe`.
        tar -xzf $tarballPath -C $tmpdir
        if ($LASTEXITCODE -ne 0) {
            Write-Error "tar extraction failed (exit $LASTEXITCODE)"
        }

        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        $dest = Join-Path $InstallDir $Binary
        Move-Item -Force -Path (Join-Path $tmpdir $Binary) -Destination $dest

        Write-Host "Installed $dest"

        $pathEntries = $env:PATH -split ';' | Where-Object { $_ -ne '' }
        $onPath = $pathEntries | ForEach-Object {
            try { (Resolve-Path -LiteralPath $_ -ErrorAction Stop).Path } catch { $_ }
        } | Where-Object { $_ -ieq (Resolve-Path -LiteralPath $InstallDir).Path }

        if (-not $onPath) {
            Write-Host ''
            Write-Host 'Add to your PATH (current session):'
            Write-Host "  `$env:PATH = `"$InstallDir;`$env:PATH`""
            Write-Host ''
            Write-Host 'Add to your PATH (persistent, user scope):'
            Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$InstallDir;`" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"
        }
    }
    finally {
        Remove-Item -Recurse -Force -Path $tmpdir -ErrorAction SilentlyContinue
    }
}

Main
