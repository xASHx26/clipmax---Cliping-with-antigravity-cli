$ErrorActionPreference = 'Stop'
$captionRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'bin\whisper'
New-Item -ItemType Directory -Force -Path $captionRoot | Out-Null
$runtimeZip = Join-Path $captionRoot 'runtime.zip'
if (-not (Test-Path -LiteralPath (Join-Path $captionRoot 'Release\whisper-cli.exe'))) {
    Invoke-WebRequest -Uri 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip' -OutFile $runtimeZip
    Expand-Archive -LiteralPath $runtimeZip -DestinationPath $captionRoot -Force
}
$modelFile = Join-Path $captionRoot 'ggml-base-q5_1.bin'
if (-not (Test-Path -LiteralPath $modelFile)) {
    Invoke-WebRequest -Uri 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin' -OutFile $modelFile
}
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.2/LICENSE' -OutFile (Join-Path $captionRoot 'LICENSE.whisper-cpp.txt')
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/openai/whisper/main/LICENSE' -OutFile (Join-Path $captionRoot 'LICENSE.whisper-model.txt')
Write-Output 'Local AI caption engine is ready. No API key is required.'
