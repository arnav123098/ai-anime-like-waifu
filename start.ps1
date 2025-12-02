Write-Host "Starting frontend..."
Start-Process powershell -NoNewWindow -ArgumentList "cd frontend; npm run dev"

Write-Host "Starting Python backend..."
Start-Process powershell -NoNewWindow -ArgumentList "python -m waitress --host=0.0.0.0 --port=6969 app:app"

Write-Host "Starting VoiceVox..."
Start-Process powershell -NoNewWindow -ArgumentList "cd VOICEVOX/vv-engine; ./run.exe"

Write-Host ""
Write-Host "All services launched. They are running in the same terminal."
Write-Host "Press Ctrl+C to stop everything."
while ($true) { Start-Sleep -Seconds 1 }
