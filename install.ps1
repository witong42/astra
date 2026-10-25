& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $repository = 'https://github.com/witong42/astra'
    $archiveRoot = 'Astra-win32-x64'

    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or ![Environment]::Is64BitOperatingSystem) {
        throw 'Astra requires 64-bit Windows. For macOS or Linux, use https://getastra.halcytron.chatgpt.site/install.sh.'
    }
    if ($PSVersionTable.PSVersion -lt [Version]'5.1') {
        throw 'Astra requires Windows PowerShell 5.1 or later.'
    }
    $installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Astra'
    if (Get-Process Astra -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installRoot\*" }) {
        throw 'Quit Astra before installing, then run this command again.'
    }

    $temporary = Join-Path ([IO.Path]::GetTempPath()) ("astra-download-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporary | Out-Null
    try {
        Write-Host 'Finding the latest Astra release...'
        if ($env:ASTRA_UPDATE_ARCHIVE) {
            $tag = $env:ASTRA_UPDATE_VERSION
            if (![IO.Path]::IsPathRooted($env:ASTRA_UPDATE_ARCHIVE) -or !(Test-Path -LiteralPath $env:ASTRA_UPDATE_ARCHIVE -PathType Leaf)) {
                throw 'The downloaded Astra update is missing. Download the update again.'
            }
        } else {
            $release = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/witong42/astra/releases/latest' -Headers @{ 'User-Agent' = 'Astra-Installer' } -TimeoutSec 60
            $tag = [string]$release.tag_name
        }
        if ($tag -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') {
            throw "No stable Astra release was found. Download manually from $repository/releases."
        }
        $archiveName = "Astra-$($tag.Substring(1))-windows-x64.zip"
        $archive = Join-Path $temporary $archiveName
        $checksum = "$archive.sha256"
        $download = "$repository/releases/download/$tag/$archiveName"
        Write-Host "Downloading Astra $tag for Windows..."
        if ($env:ASTRA_UPDATE_ARCHIVE) {
            Copy-Item -LiteralPath $env:ASTRA_UPDATE_ARCHIVE -Destination $archive
            Copy-Item -LiteralPath "$($env:ASTRA_UPDATE_ARCHIVE).sha256" -Destination $checksum
        } else {
            Invoke-WebRequest -UseBasicParsing -Uri $download -OutFile $archive -TimeoutSec 600
            Invoke-WebRequest -UseBasicParsing -Uri "$download.sha256" -OutFile $checksum -TimeoutSec 60
        }
        $line = (Get-Content -LiteralPath $checksum -Raw).Trim()
        if ($line -notmatch '\A([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)\z') {
            throw 'The release checksum is invalid. Nothing was installed.'
        }
        $expectedHash = $Matches[1]
        if ($Matches[2] -cne $archiveName -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
            throw 'The Astra download failed checksum verification. Nothing was installed; try again.'
        }

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        try {
            foreach ($entry in $zip.Entries) {
                $path = $entry.FullName.Replace('\', '/')
                if (!$path.StartsWith("$archiveRoot/", [StringComparison]::Ordinal) -or $path -match '(^|/)\.\.?(/|$)|:|//') {
                    throw 'The Astra archive contains an unexpected path. Nothing was installed.'
                }
            }
        } finally {
            $zip.Dispose()
        }
        $extracted = Join-Path $temporary 'extracted'
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $extracted)
        $application = Join-Path $extracted $archiveRoot
        foreach ($file in @('Install.ps1', 'app-manifest.json', 'Astra.exe')) {
            if (!(Test-Path -LiteralPath (Join-Path $application $file) -PathType Leaf)) {
                throw "The Astra archive is missing $file. Nothing was installed."
            }
        }
        $identity = Get-Content -LiteralPath (Join-Path $application 'app-manifest.json') -Raw | ConvertFrom-Json
        if ([string]$identity.version -cne $tag.Substring(1)) {
            throw 'The downloaded Astra package has the wrong release version. Nothing was installed.'
        }
        $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $installerArgs = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $application 'Install.ps1'))
        if ($env:ASTRA_UPDATE_DESTINATION) { $installerArgs += @('-Destination', $env:ASTRA_UPDATE_DESTINATION) }
        if ($env:ASTRA_NO_OPEN -eq '1') { $installerArgs += '-NoLaunch' }
        & $powershell @installerArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Astra's installer failed (exit $LASTEXITCODE). Close Astra and try again, or use $repository/releases."
        }
    } finally {
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
}
