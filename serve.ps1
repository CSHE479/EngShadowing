param([int]$Port = 8765, [switch]$NoOpen)
# Minimal localhost-only static server so the browser remembers microphone permission.
$root = $PSScriptRoot
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/manifest+json'; '.png'='image/png' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Running at http://localhost:$Port/  (close this window to stop)"
if (-not $NoOpen) { Start-Process "http://localhost:$Port/" }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $name = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($name -eq '') { $name = 'index.html' }
  $path = [IO.Path]::GetFullPath((Join-Path $root $name))
  $ext = [IO.Path]::GetExtension($path)
  if ($path.StartsWith($root + [IO.Path]::DirectorySeparatorChar) -and $types.ContainsKey($ext) -and (Test-Path $path -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($path)
    $ctx.Response.ContentType = $types[$ext]
    if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
